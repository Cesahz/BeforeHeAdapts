// combat.ts — la sesión de combate en vivo (ADR 0009).
//
// Es **la única puerta** por la que el movimiento del jugador se convierte en
// eventos del motor. Todo lo continuo —posiciones del cursor, trazos a medio
// dibujar, agitación— muere acá; lo único que sale son exposiciones discretas
// con firma canónica (ADR 0004).
//
// Sin reloj propio y sin DOM: el tiempo entra en cada llamada. Eso es lo que
// permite simular un minuto de movimiento continuo en un test sin esperar un
// minuto, y lo que hace que una sesión sea reproducible.
//
// El orden de las compuertas importa y es el del ADR 0009 §1:
//
//   trazo → ¿reconocido? → ¿fuera de cooldown? → recién ahí, al log
//
// Un gesto rechazado por ambiguo **no consume cooldown** (un reconocedor
// imperfecto no puede cobrarle al jugador sus propios errores) y un gesto en
// cooldown **no llega al log** (el rechazo ocurre antes de tocar la sala). Las
// dos cosas están testeadas.

import type { EngineEvent, Primitive, StimulusSignature } from "@beforeheadapts/core";
import { cooldownOf, type Composition, type Element } from "@beforeheadapts/arena-dsl";

import { AMBIENT_SIGNATURE } from "./ambient.js";
import { PLAYER, VICTORY } from "./balance.js";
import { Room, type AttackOutcome } from "./room.js";
import { vocabularyOf, type Vocabulary } from "./vocabulary.js";
import {
  compositionFor,
  recognize,
  type GestureKind,
  type GesturePoint,
  type RejectionReason,
} from "../gesture/recognize.js";
import { NoiseWatcher, type NoiseReading } from "../gesture/noise.js";

/** Resultado de intentar lanzar un gesto. Tres desenlaces, tres feedbacks distintos. */
export type GestureAttempt =
  /** El trazo se reconoció, estaba disponible y golpeó. Es el único caso que toca el log. */
  | { readonly kind: "attacked"; readonly gesture: GestureKind; readonly outcome: AttackOutcome }
  /** El trazo no se entendió. No consume cooldown. */
  | { readonly kind: "rejected"; readonly reason: RejectionReason }
  /** El trazo se entendió pero esa composición sigue en cooldown. No llega al log. */
  | {
      readonly kind: "cooldown";
      readonly gesture: GestureKind;
      readonly composition: Composition;
      readonly readyAt: number;
    };

/**
 * Lo que devuelve una exposición sin composición detrás: el ruido ambiental.
 *
 * No es un `AttackOutcome` con campos vacíos. El ruido no tiene composición ni
 * cooldown —su rate-limit vive en el `NoiseWatcher`, no en la sala— y el tipo
 * lo dice en vez de fingir lo contrario.
 */
export type ExposureOutcome = Omit<AttackOutcome, "composition" | "readyAt">;

/**
 * En qué acto está el encuentro (ADR 0011 §4).
 *
 * Derivado del HP del ente, que a su vez se deriva del log: el acto no es
 * estado guardado en ningún lado, y por eso un replay puede reconstruirlo.
 */
export type Act = 1 | 2 | 3;

/**
 * Cómo terminó la corrida, o que sigue viva.
 *
 * Las dos derrotas son distintas a propósito y la UI **tiene** que
 * distinguirlas: "te mataron" y "te quedaste sin vocabulario" son lecciones
 * opuestas, y confundirlas es lo que haría sentir injusta a la segunda.
 */
export type RunOutcome =
  | "ongoing"
  /** El HP del ente llegó a cero. La única victoria. */
  | "victory"
  /** El HP del jugador llegó a cero (ADR 0009 §3). */
  | "defeat-slain"
  /** Se acabaron las firmas viables con el ente en pie (ADR 0011 §3). */
  | "defeat-exhausted";

/** Una entrada del arsenal: un contraataque disponible, armado por `CounterReady`. */
export interface ArmedCounter {
  readonly weakness: Primitive;
  readonly clusterId: string;
  /** `seq` del evento que lo armó. Es la semilla determinista de la selección (§6.4). */
  readonly armedAtSeq: number;
}

export class CombatSession {
  readonly #room: Room;
  readonly #noise = new NoiseWatcher();
  readonly #arsenal = new Map<Primitive, ArmedCounter>();
  #element: Element;
  #lastGesture: GestureKind | undefined;
  #hp = PLAYER.maxHp;
  #enteHp = VICTORY.enteMaxHp;
  /** Vocabulario memoizado por largo del log: solo cambia cuando entra un evento. */
  #vocabCache: { readonly at: number; readonly value: Vocabulary } | undefined;

  constructor(room: Room = new Room(), element: Element = "ember") {
    this.#room = room;
    this.#element = element;
  }

  get room(): Room {
    return this.#room;
  }

  /** El elemento armado: un MODO que el jugador porta, no algo que el trazo decida. */
  get element(): Element {
    return this.#element;
  }

  arm(element: Element): void {
    this.#element = element;
  }

  /** Último gesto reconocido. Lo muestra el HUD; no participa de ninguna decisión. */
  get lastGesture(): GestureKind | undefined {
    return this.#lastGesture;
  }

  /**
   * Contraataques disponibles, en orden de armado.
   *
   * `CounterReady` **arma**, no dispara (ADR 0009 §4): el motor avisa que hay un
   * contraataque disponible por esa dimensión y cuándo materializarlo es
   * decisión del dominio.
   */
  get arsenal(): readonly ArmedCounter[] {
    return [...this.#arsenal.values()];
  }

  /** Vida del jugador. Estado del dominio arena: el motor no la conoce (ADR 0004). */
  get hp(): number {
    return this.#hp;
  }

  /** Vida del ente. Bajarla a cero es la victoria (ADR 0011 §1). */
  get enteHp(): number {
    return this.#enteHp;
  }

  /**
   * El vocabulario que le queda al jugador, con su desgaste (ADR 0011 §2).
   *
   * Es una proyección pura del estado del motor, memoizada por largo del log:
   * el HUD la pide por cuadro y solo puede cambiar cuando entra un evento.
   */
  get vocabulary(): Vocabulary {
    const at = this.#room.log.events.length;
    if (this.#vocabCache?.at !== at) {
      this.#vocabCache = { at, value: vocabularyOf(this.#room.state) };
    }
    return this.#vocabCache.value;
  }

  /**
   * En qué acto está el encuentro. Derivado del HP del ente, nunca guardado.
   *
   * Es el R1 del dominio: un salto discreto. Que sea derivable es lo que
   * permite que la transición se dibuje también en un replay (ADR 0011 §4).
   */
  get act(): Act {
    const fraction = this.#enteHp / VICTORY.enteMaxHp;
    if (fraction > VICTORY.actTwoAt) return 1;
    if (fraction > VICTORY.actThreeAt) return 2;
    return 3;
  }

  /**
   * Cómo va la corrida. Se evalúa en este orden y el orden importa:
   * matar al ente con el último golpe de tu último vocabulario es una VICTORIA.
   */
  get outcome(): RunOutcome {
    if (this.#enteHp <= 0) return "victory";
    if (this.#hp <= 0) return "defeat-slain";
    if (this.vocabulary.viable === 0) return "defeat-exhausted";
    return "ongoing";
  }

  /**
   * La corrida terminó, de cualquiera de las tres maneras.
   *
   * El desenlace es **terminal** (ADR 0009 §3). No se reencarna al jugador ni
   * se resetea al ente: lo primero anularía la presión que el contraataque
   * ejerce, y lo segundo crearía el incentivo perverso de suicidarse para
   * borrarle la adaptación.
   *
   * El log se preserva y sigue exportable: es el artefacto que importa.
   */
  get finished(): boolean {
    return this.outcome !== "ongoing";
  }

  /** El jugador cayó. Se conserva aparte de `finished` porque la UI las trata distinto. */
  get defeated(): boolean {
    return this.#hp <= 0;
  }

  /**
   * Aplica daño de un contraataque.
   *
   * No emite ningún evento: un golpe del ente **no es un estímulo percibido**,
   * así que no entra al log (ADR 0009 §4). El log registra lo que el ente
   * aprendió, no lo que hizo.
   */
  hurt(amount: number): void {
    if (this.finished) return;
    this.#hp = Math.max(0, this.#hp - amount);
  }

  /** Erraticidad vigente y si el ente está percibiendo agitación. Alimenta el feedback preventivo. */
  readNoise(now: number): NoiseReading {
    return this.#noise.read(now);
  }

  /** Instante en que el gesto vuelve a estar disponible con el elemento armado. */
  readyAtFor(gesture: GestureKind): number {
    return this.#room.readyAt(compositionFor(gesture, this.#element));
  }

  /** Cooldown total del gesto en ms, para dibujar la fracción restante. */
  cooldownFor(gesture: GestureKind): number {
    return cooldownOf(compositionFor(gesture, this.#element));
  }

  /**
   * Ofrece una posición del cursor al lector de ruido.
   *
   * Esta es la llamada de mayor frecuencia del juego y **no toca el motor**: la
   * decima el `NoiseWatcher` a paso fijo y a lo sumo actualiza una ventana de
   * 32 posiciones. El movimiento crudo muere exactamente acá.
   */
  observePointer(x: number, y: number, now: number): NoiseReading {
    this.#noise.push(x, y, now);
    return this.#noise.read(now);
  }

  /**
   * Emite el estímulo de ruido si corresponde (umbral + rate-limit).
   *
   * Se llama por cuadro, pero solo produce un evento cada `NOISE.cooldownMs` en
   * el peor caso: 20 por minuto de agitación continua.
   */
  pollNoise(now: number): ExposureOutcome | undefined {
    // Con la corrida terminada el log se congela: nada más entra. Es lo que
    // hace que el replay exportado sea exactamente la corrida y no incluya el
    // movimiento del cursor de alguien mirando la pantalla de derrota.
    if (this.finished) return undefined;
    if (!this.#noise.read(now).shouldEmit) return undefined;
    this.#noise.markEmitted(now);
    const outcome = this.#room.expose(AMBIENT_SIGNATURE, now);
    this.#absorb(outcome.events);
    this.#wound(outcome.damage);
    return outcome;
  }

  /**
   * Lanza una composición DELIBERADA: un prefab o una build del Builder.
   *
   * Existe porque el arsenal se llena leyendo los `CounterReady` del lote, y esa
   * lectura vive acá. Antes la arena atacaba la sala directamente para los
   * prefabs, así que un jugador que solo usara el Builder podía adaptarle ocho
   * clusters al ente **sin que el ente armara un solo contraataque**: el motor
   * emitía los `CounterReady` y no los escuchaba nadie. Lo encontró el test del
   * planificador al no poder construirse un arsenal por la puerta pública.
   *
   * Levanta `CooldownError` como la sala: es la misma operación, con el arsenal
   * enganchado.
   */
  attack(composition: Composition, now: number): AttackOutcome {
    const outcome = this.#room.attack(composition, now);
    this.#absorb(outcome.events);
    this.#wound(outcome.damage);
    return outcome;
  }

  /**
   * Intenta lanzar un trazo.
   *
   * Las dos compuertas están **antes** de la sala, en este orden: reconocer y
   * después consultar cooldown. Un gesto en cooldown se rechaza sin que la sala
   * se entere, así que no hay forma de que llegue al log.
   */
  attemptGesture(points: readonly GesturePoint[], now: number): GestureAttempt {
    if (this.finished) return { kind: "rejected", reason: "insuficiente" };

    const recognition = recognize(points);
    if (!recognition.ok) return { kind: "rejected", reason: recognition.reason };

    const gesture = recognition.kind;
    this.#lastGesture = gesture;
    const composition = compositionFor(gesture, this.#element);

    if (!this.#room.canAttack(composition, now)) {
      return { kind: "cooldown", gesture, composition, readyAt: this.#room.readyAt(composition) };
    }

    const outcome = this.#room.attack(composition, now);
    this.#absorb(outcome.events);
    this.#wound(outcome.damage);
    return { kind: "attacked", gesture, outcome };
  }

  /**
   * Acumula daño sobre el ente.
   *
   * **No emite ningún evento.** El golpe ya está en el log como
   * `ResistanceApplied` — que es lo que el ente aprendió — y el HP es una
   * lectura de dominio sobre esos eventos. Meter un evento nuevo convertiría al
   * log en un marcador y violaría el ADR 0006 por un concepto que ni siquiera
   * es del motor (ADR 0011, alternativas descartadas).
   */
  #wound(damage: number): void {
    this.#enteHp = Math.max(0, this.#enteHp - damage);
  }

  /** Lee los `CounterReady` del lote y arma el arsenal. El motor avisa; el dominio guarda. */
  #absorb(events: readonly EngineEvent[]): void {
    for (const event of events) {
      if (event.type !== "CounterReady") continue;
      const weakness = event.weakness.dimension;
      // Un cluster arma su contraataque una sola vez; si ya está, no se pisa el
      // `armedAtSeq`, que es la semilla determinista de la selección.
      if (this.#arsenal.has(weakness)) continue;
      this.#arsenal.set(weakness, {
        weakness,
        clusterId: event.clusterId,
        armedAtSeq: event.seq,
      });
    }
  }
}

/** La firma que emite el ruido. Re-exportada para los tests de la frontera. */
export const NOISE_SIGNATURE: StimulusSignature = AMBIENT_SIGNATURE;
