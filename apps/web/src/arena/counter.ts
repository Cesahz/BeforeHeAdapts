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

import { COUNTER } from "./balance.js";
import type { ArmedCounter } from "./combat.js";
import { AMBIENT_ELEMENT } from "./ambient.js";

export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * En qué está el ente ahora mismo. Lo lee la capa efímera para dibujar.
 *
 * El punto se **fija** al empezar el telegraph y no sigue al cursor: si
 * persiguiera, esquivar sería imposible y el aviso previo no significaría nada.
 */
export type CounterPhase =
  | { readonly kind: "idle" }
  | {
      readonly kind: "telegraph";
      readonly counter: ArmedCounter;
      readonly at: Point;
      readonly startedAt: number;
      readonly strikeAt: number;
    }
  | {
      readonly kind: "strike";
      readonly counter: ArmedCounter;
      readonly at: Point;
      readonly until: number;
      readonly hit: boolean;
    };

/** Un golpe resuelto. Lo devuelve `poll` una sola vez, en el instante en que resuelve. */
export interface CounterResolution {
  readonly counter: ArmedCounter;
  readonly at: Point;
  /** `false` si el cursor estaba fuera del disco: esquivado, sin daño. */
  readonly hit: boolean;
  /** HP. Ya es 0 cuando `hit` es `false`; quien llama no tiene que decidirlo. */
  readonly damage: number;
}

/** Cadencia según cuántos clusters adaptó el ente. Escala; nunca baja del piso. */
export function intervalFor(arsenalSize: number): number {
  if (arsenalSize <= 0) return Infinity;
  const raw = COUNTER.baseIntervalMs / (1 + COUNTER.intervalAccel * (arsenalSize - 1));
  return Math.max(COUNTER.minIntervalMs, raw);
}

/** Daño según cuántos clusters adaptó el ente. Crece sin techo: la ventana se cierra. */
export function damageFor(arsenalSize: number): number {
  if (arsenalSize <= 0) return 0;
  return COUNTER.baseDamage + COUNTER.damagePerCluster * (arsenalSize - 1);
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

  get phase(): CounterPhase {
    return this.#phase;
  }

  get shots(): number {
    return this.#shots;
  }

  /** Cuándo cae el próximo golpe de cadencia. Lo muestra el HUD como presión legible. */
  get nextAt(): number | undefined {
    return this.#nextAt;
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
  ): CounterResolution | undefined {
    // Sin arsenal el ente no tiene con qué golpear. No es una pausa: es que
    // todavía no aprendió nada, y el reloj recién arranca cuando aprende.
    if (arsenal.length === 0) {
      this.#phase = { kind: "idle" };
      this.#nextAt = undefined;
      return undefined;
    }

    if (this.#phase.kind === "strike") {
      if (now >= this.#phase.until) this.#phase = { kind: "idle" };
      return undefined;
    }

    if (this.#phase.kind === "telegraph") {
      if (now < this.#phase.strikeAt) return undefined;
      return this.#resolve(now, arsenal, cursor);
    }

    // Fase idle: o se agenda el primer golpe, o cae el que estaba agendado.
    if (this.#nextAt === undefined) {
      this.#nextAt = now + intervalFor(arsenal.length);
      return undefined;
    }
    if (now >= this.#nextAt) {
      this.#begin(now, arsenal, cursor ?? fallback);
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
      counter,
      at,
      startedAt: now,
      strikeAt: now + telegraphFor(arsenal.length),
    };
  }

  #resolve(
    now: number,
    arsenal: readonly ArmedCounter[],
    cursor: Point | undefined,
  ): CounterResolution {
    const fase = this.#phase as Extract<CounterPhase, { kind: "telegraph" }>;

    // Resuelve en el INSTANTE en que termina el aviso, no durante los 150 ms de
    // la resolución: si se evaluara en cualquier cuadro de esa ventana, entrar
    // al disco después del golpe lastimaría, y esquivar dejaría de tener un
    // momento claro. Los 150 ms son cuánto se VE el golpe, no cuánto dura.
    const hit =
      cursor === undefined ||
      Math.hypot(cursor.x - fase.at.x, cursor.y - fase.at.y) <= COUNTER.strikeRadiusPx;

    const damage = hit ? damageFor(arsenal.length) : 0;

    this.#shots += 1;
    this.#phase = { kind: "strike", counter: fase.counter, at: fase.at, until: now + COUNTER.strikeMs, hit };
    // La cadencia se reagenda desde la resolución, no desde el disparo: así el
    // intervalo es tiempo de RESPIRO entre golpes y no incluye el aviso previo,
    // que es justo el tramo en que el jugador ya está bajo presión.
    this.#nextAt = now + intervalFor(arsenal.length);

    return { counter: fase.counter, at: fase.at, hit, damage };
  }
}
