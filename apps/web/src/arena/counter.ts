// counter.ts — el planificador de contraataques (ADR 0009 §4).
//
// Esta es la mitad del loop que faltaba. Hasta acá el arsenal del ente crecía
// con cada `CounterReady` y **no disparaba nunca**: la vida del jugador no bajó
// jamás, así que el juego no tenía amenaza y por lo tanto no tenía carrera.
//
// Lo que materializa el puerto `CounterSynthesizer` es esto: el motor avisa que
// hay un contraataque disponible por una dimensión, y el DOMINIO decide cuándo
// y cómo se convierte en un golpe. Toda la escalada vive acá y en `balance.ts`;
// el motor no sabe que existe.
//
// Sin reloj propio, sin DOM y sin `Math.random()`: el tiempo entra en cada
// llamada y la selección sale de `armedAtSeq` (§6.4). Eso es lo que permite
// simular diez minutos de combate en un test sin esperarlos, y lo que haría
// reproducible una corrida si algún día se graba.
//
// **Los disparos no entran al log.** Un contraataque no es un estímulo
// percibido: el log registra lo que el ente aprendió, no lo que hizo (ADR 0009
// §4). Por eso este módulo no toca la sala ni emite eventos — solo dice qué
// pasó, y quien lo llama aplica el daño.

import type { Primitive } from "@beforeheadapts/core";

import { BASAL, COUNTER, VICTORY } from "./balance.js";
import type { Act, ArmedCounter } from "./combat.js";
import { AMBIENT_ELEMENT } from "./ambient.js";

export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * De dónde sale un golpe (ADR 0012 §3).
 *
 * `arsenal` es el contraataque **dirigido**: el ente usando una debilidad que
 * aprendió de vos. Es la recompensa de adaptar y lleva la identidad de su
 * debilidad.
 *
 * `basal` es el ente **ocupando espacio**: no dirigido, sin debilidad detrás,
 * porque no hay ninguna aprendida que expresar. Es un piso de amenaza, no un
 * contraataque. Los dos tienen que **verse distintos**: si se ven iguales, la
 * recompensa de adaptar se vuelve invisible.
 */
export type CounterSource = "arsenal" | "basal";

/**
 * En qué está el ente ahora mismo. Lo lee la capa efímera para dibujar.
 *
 * El punto se **fija** al empezar el telegraph y no sigue al cursor: si
 * persiguiera, esquivar sería imposible y el aviso previo no significaría nada.
 *
 * `counter` es `undefined` exactamente cuando `source` es `basal`: no hay
 * debilidad que mostrar. El tipo lo deja explícito para que ningún consumidor
 * pueda dibujar los dos golpes igual sin darse cuenta.
 */
export type CounterPhase =
  | { readonly kind: "idle" }
  | {
      readonly kind: "telegraph";
      readonly source: CounterSource;
      readonly counter: ArmedCounter | undefined;
      readonly at: Point;
      readonly startedAt: number;
      readonly strikeAt: number;
    }
  | {
      readonly kind: "strike";
      readonly source: CounterSource;
      readonly counter: ArmedCounter | undefined;
      readonly at: Point;
      readonly until: number;
      readonly hit: boolean;
    };

/** Un golpe resuelto. Lo devuelve `poll` una sola vez, en el instante en que resuelve. */
export interface CounterResolution {
  readonly source: CounterSource;
  /** `undefined` en la amenaza basal: no hay debilidad detrás del golpe. */
  readonly counter: ArmedCounter | undefined;
  readonly at: Point;
  /** `false` si el cursor estaba fuera del disco: esquivado, sin daño. */
  readonly hit: boolean;
  /** HP. Ya es 0 cuando `hit` es `false`; quien llama no tiene que decidirlo. */
  readonly damage: number;
}

/**
 * Los dos diales que el acto escala (ADR 0011 §4).
 *
 * El acto **no toca el motor ni fuerza adaptaciones**: solo multiplica presión
 * que ya existía. Es diseño de encuentro, y por eso vive del lado del dominio.
 */
function scalesFor(act: Act): { readonly interval: number; readonly damage: number } {
  // Comparaciones por rango y no un `switch` exhaustivo: el tipo `Act` ya
  // restringe a 1|2|3, pero esto se llama desde el bucle de render y un valor
  // inesperado tiene que degradar al Acto I, no devolver `undefined` y
  // reventar a mitad de un combate.
  if (act >= 3) {
    return { interval: VICTORY.actThreeIntervalScale, damage: VICTORY.actThreeDamageScale };
  }
  if (act === 2) {
    return { interval: VICTORY.actTwoIntervalScale, damage: VICTORY.actTwoDamageScale };
  }
  return { interval: 1, damage: 1 };
}

/**
 * Cadencia según cuántos clusters adaptó el ente y en qué acto va. Escala;
 * nunca baja del piso.
 *
 * El piso se aplica DESPUÉS del multiplicador de acto, y sigue siendo duro: por
 * avanzado que esté el encuentro, `minIntervalMs` es el límite de lo que sigue
 * siendo jugable, no un número de dificultad.
 */
export function intervalFor(arsenalSize: number, act: Act = 1): number {
  if (arsenalSize <= 0) return Infinity;
  const raw = COUNTER.baseIntervalMs / (1 + COUNTER.intervalAccel * (arsenalSize - 1));
  return Math.max(COUNTER.minIntervalMs, raw * scalesFor(act).interval);
}

/** Daño según clusters adaptados y acto. Crece sin techo: la ventana se cierra. */
export function damageFor(arsenalSize: number, act: Act = 1): number {
  if (arsenalSize <= 0) return 0;
  const raw = COUNTER.baseDamage + COUNTER.damagePerCluster * (arsenalSize - 1);
  return raw * scalesFor(act).damage;
}

/**
 * Cadencia de la amenaza basal (ADR 0012 §3). **Nunca es `Infinity`**: corre
 * desde el segundo cero, con arsenal vacío, que es todo el punto del dial.
 */
export function basalIntervalFor(arsenalSize: number, act: Act = 1): number {
  const raw = BASAL.baseIntervalMs / (1 + BASAL.intervalAccel * Math.max(0, arsenalSize));
  return Math.max(BASAL.minIntervalMs, raw * scalesFor(act).interval);
}

/** Daño de la amenaza basal. Escala con lo adaptado y con el acto, como todo lo demás. */
export function basalDamageFor(arsenalSize: number, act: Act = 1): number {
  const raw = BASAL.baseDamage + BASAL.damagePerCluster * Math.max(0, arsenalSize);
  return raw * scalesFor(act).damage;
}

/** Aviso previo según cuántos clusters adaptó el ente. Se acorta; nunca por debajo del piso. */
export function telegraphFor(arsenalSize: number): number {
  if (arsenalSize <= 0) return COUNTER.baseTelegraphMs;
  const raw = COUNTER.baseTelegraphMs - COUNTER.telegraphShrinkMs * (arsenalSize - 1);
  return Math.max(COUNTER.minTelegraphMs, raw);
}

/**
 * Cuál entrada del arsenal usa el disparo número `shot`.
 *
 * Determinista y variada: recorre el arsenal ordenado por `armedAtSeq` con un
 * desfasaje que sale de los propios `seq`. Nunca `Math.random()` — dos corridas
 * con el mismo log tienen que dar la misma secuencia de contraataques.
 */
export function selectCounter(
  arsenal: readonly ArmedCounter[],
  shot: number,
): ArmedCounter | undefined {
  if (arsenal.length === 0) return undefined;
  const ordenado = [...arsenal].sort((a, b) => a.armedAtSeq - b.armedAtSeq);
  const semilla = ordenado.reduce((suma, entry) => suma + entry.armedAtSeq, 0);
  return ordenado[(semilla + shot) % ordenado.length];
}

/** La debilidad del ruido: la que se dispara sola cuando el jugador se agita. */
const AMBIENT_WEAKNESS: Primitive = `elem:${AMBIENT_ELEMENT}`;

export class CounterScheduler {
  #phase: CounterPhase = { kind: "idle" };
  /** Cuándo dispara el próximo de cadencia. `undefined` mientras el arsenal esté vacío. */
  #nextAt: number | undefined;
  /** Disparos resueltos. Es la otra mitad de la semilla de selección. */
  #shots = 0;
  /** Rate-limit propio del contraataque de ruido, independiente de la cadencia. */
  #lastAmbientAt = -Infinity;
  /** Reloj de la amenaza basal: propio, y corriendo desde el primer `poll`. */
  #nextBasalAt: number | undefined;

  get phase(): CounterPhase {
    return this.#phase;
  }

  get shots(): number {
    return this.#shots;
  }

  /**
   * Cuándo cae el próximo golpe de cadencia dirigida. `undefined` mientras el
   * arsenal esté vacío — que ya no significa "sin amenaza": ver `nextBasalAt`.
   */
  get nextAt(): number | undefined {
    return this.#nextAt;
  }

  /** Cuándo cae la próxima amenaza basal. `undefined` solo antes del primer `poll`. */
  get nextBasalAt(): number | undefined {
    return this.#nextBasalAt;
  }

  /**
   * El próximo golpe, venga de donde venga. Es lo que el HUD tiene que mostrar
   * como presión legible, y con lo que razona un jugador que mira el reloj.
   */
  get nextThreatAt(): number | undefined {
    if (this.#nextAt === undefined) return this.#nextBasalAt;
    if (this.#nextBasalAt === undefined) return this.#nextAt;
    return Math.min(this.#nextAt, this.#nextBasalAt);
  }

  /**
   * Avanza el reloj del ente.
   *
   * Se llama por cuadro. Devuelve algo **solo** en el cuadro en que un golpe
   * resuelve; el resto del tiempo el estado vive en `phase`, que es lo que
   * dibuja la capa efímera.
   *
   * @param cursor dónde está el jugador. `undefined` si nunca movió el puntero:
   * ahí el golpe se ancla en `fallback` y no puede fallar por casualidad.
   */
  poll(
    now: number,
    arsenal: readonly ArmedCounter[],
    cursor: Point | undefined,
    fallback: Point,
    act: Act = 1,
  ): CounterResolution | undefined {
    // La amenaza basal arranca su reloj en el primer cuadro, con el arsenal
    // vacío: es exactamente el tramo en frío que el ADR 0012 vino a llenar.
    this.#nextBasalAt ??= now + basalIntervalFor(arsenal.length, act);

    // Sin arsenal el ente no tiene con qué golpear DIRIGIDO: no aprendió
    // ninguna debilidad todavía, y ese reloj recién arranca cuando aprende. La
    // amenaza basal sigue corriendo igual — sin arsenal no hay golpe *dirigido*
    // (enmienda al ADR 0009 §4).
    if (arsenal.length === 0) this.#nextAt = undefined;

    if (this.#phase.kind === "strike") {
      if (now >= this.#phase.until) this.#phase = { kind: "idle" };
      return undefined;
    }

    if (this.#phase.kind === "telegraph") {
      if (now < this.#phase.strikeAt) return undefined;
      return this.#resolve(now, arsenal, cursor, act);
    }

    // Fase idle: o se agenda el próximo golpe, o cae el que estaba agendado.
    if (arsenal.length > 0) {
      if (this.#nextAt === undefined) {
        this.#nextAt = now + intervalFor(arsenal.length, act);
      } else if (now >= this.#nextAt) {
        this.#begin(now, arsenal, cursor ?? fallback);
        return undefined;
      }
    }

    // La basal cede ante el dirigido: si los dos vencen en el mismo cuadro pega
    // el que lleva identidad, y la basal espera. Dos telegraphs simultáneos
    // sobre la misma pantalla son ilegibles, y de los dos el que no puede
    // perderse es el que muestra lo que el ente aprendió de vos.
    if (now >= this.#nextBasalAt) {
      this.#beginBasal(now, cursor ?? fallback);
    }
    return undefined;
  }

  /**
   * El contraataque de ruido: tiene disparador propio (ADR 0009 §4).
   *
   * Si el ente ya adaptó la agitación del jugador, agitarse lo invoca — fuera de
   * la cadencia y con su propio rate-limit. Es la única parte del combate donde
   * el jugador se lastima con algo que no es un ataque suyo, y es deliberada:
   * enseña que el ente aprende de todo, no solo de lo que le tiran.
   *
   * No dispara si ya hay un golpe en curso: dos telegraphs simultáneos sobre la
   * misma pantalla son ilegibles.
   */
  triggerAmbient(now: number, arsenal: readonly ArmedCounter[], at: Point): boolean {
    if (this.#phase.kind !== "idle") return false;
    if (now - this.#lastAmbientAt < COUNTER.ambientCooldownMs) return false;
    const ambient = arsenal.find((entry) => entry.weakness === AMBIENT_WEAKNESS);
    if (ambient === undefined) return false;

    this.#lastAmbientAt = now;
    this.#phase = {
      kind: "telegraph",
      source: "arsenal",
      counter: ambient,
      at,
      startedAt: now,
      strikeAt: now + telegraphFor(arsenal.length),
    };
    return true;
  }

  #begin(now: number, arsenal: readonly ArmedCounter[], at: Point): void {
    const counter = selectCounter(arsenal, this.#shots);
    if (counter === undefined) return;
    this.#phase = {
      kind: "telegraph",
      source: "arsenal",
      counter,
      at,
      startedAt: now,
      strikeAt: now + telegraphFor(arsenal.length),
    };
  }

  /** El golpe no dirigido. Mismo aviso, mismo disco, sin debilidad detrás. */
  #beginBasal(now: number, at: Point): void {
    this.#phase = {
      kind: "telegraph",
      source: "basal",
      counter: undefined,
      at,
      startedAt: now,
      // Aviso fijo: no se acorta con el arsenal. Lo que el ente aprendió acelera
      // sus contraataques dirigidos; la amenaza de fondo se mantiene legible.
      strikeAt: now + BASAL.telegraphMs,
    };
  }

  #resolve(
    now: number,
    arsenal: readonly ArmedCounter[],
    cursor: Point | undefined,
    act: Act,
  ): CounterResolution {
    const fase = this.#phase as Extract<CounterPhase, { kind: "telegraph" }>;

    // Resuelve en el INSTANTE en que termina el aviso, no durante los 150 ms de
    // la resolución: si se evaluara en cualquier cuadro de esa ventana, entrar
    // al disco después del golpe lastimaría, y esquivar dejaría de tener un
    // momento claro. Los 150 ms son cuánto se VE el golpe, no cuánto dura.
    const hit =
      cursor === undefined ||
      Math.hypot(cursor.x - fase.at.x, cursor.y - fase.at.y) <= COUNTER.strikeRadiusPx;

    const basal = fase.source === "basal";
    const damage = hit
      ? basal
        ? basalDamageFor(arsenal.length, act)
        : damageFor(arsenal.length, act)
      : 0;

    this.#shots += 1;
    this.#phase = {
      kind: "strike",
      source: fase.source,
      counter: fase.counter,
      at: fase.at,
      until: now + COUNTER.strikeMs,
      hit,
    };
    // Las dos cadencias se reagendan desde la resolución, no desde el disparo:
    // así el intervalo es tiempo de RESPIRO entre golpes y no incluye el aviso
    // previo, que es justo el tramo en que el jugador ya está bajo presión.
    //
    // Se reagenda SOLO el reloj que disparó: son relojes independientes, y que
    // un golpe dirigido corriera el de la amenaza basal la volvería a atar al
    // arsenal, que es exactamente lo que el ADR 0012 §3 no quiere.
    if (basal) {
      this.#nextBasalAt = now + basalIntervalFor(arsenal.length, act);
    } else {
      this.#nextAt = now + intervalFor(arsenal.length, act);
    }

    return { source: fase.source, counter: fase.counter, at: fase.at, hit, damage };
  }
}
