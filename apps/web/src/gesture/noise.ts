// gesture/noise.ts — lectura de ruido ambiental (ADR 0009 §2).
//
// La otra mitad de la frontera de cuantización del ADR 0004. El reconocedor
// convierte trazos DELIBERADOS en ataques; esto convierte movimiento
// INVOLUNTARIO en un estímulo de baja intensidad. Los dos comparten geometría
// (`trace.ts`) y los dos son puros: el tiempo entra como dato.
//
// Vive en `gesture/` aunque el ruido no sea un gesto, porque es exactamente el
// mismo problema —entrada continua → eventos discretos— y porque así la guardia
// de pureza de la carpeta lo cubre sin configuración extra.
//
// Qué mide: **giro medio absoluto por segmento, normalizado a [0, 1]**.
//
//   erraticity = Σ|Δθᵢ| / (π × (n − 2))
//
// Una recta da 0. Una trayectoria que se dobla sobre sí misma tiende a 1. Solo
// mira ángulos, así que es invariante a escala y a velocidad por construcción
// — que es lo que el ADR 0004 exige para que el determinismo no dependa del
// hardware (los dispositivos muestrean entre 60 y 1000 Hz).
//
// ⚠️ Asimetría deliberada con el reconocedor: acá las cúspides (vaivenes de
// ~180°) cuentan ENTERAS. En `recognize.ts` se excluyen del giro con signo
// porque falsificarían una rotación; acá son la señal más pura que existe de
// movimiento errático. El mismo dato, leído para dos preguntas distintas.

import { NOISE } from "../arena/balance.js";
import { pathLength, signedTurns, type TracePoint } from "./trace.js";

/**
 * Erraticidad de una ventana de posiciones, en `[0, 1]`.
 *
 * Devuelve 0 si la ventana no recorrió lo suficiente: sin esa compuerta, un
 * cursor casi quieto produce ángulos basura por jitter sub-píxel y el ente
 * "percibiría" agitación en alguien que no se mueve.
 */
export function erraticityOf(points: readonly TracePoint[]): number {
  if (points.length < 3) return 0;
  if (pathLength(points) < NOISE.minPathPx) return 0;

  const turns = signedTurns(points);
  if (turns.length === 0) return 0;

  let total = 0;
  for (const turn of turns) total += Math.abs(turn);
  return Math.min(1, total / (Math.PI * turns.length));
}

/** Lo que el vigilante decide en cada consulta. */
export interface NoiseReading {
  /** Erraticidad vigente de la ventana, en `[0, 1]`. Sirve para el feedback continuo. */
  readonly erraticity: number;
  /** El ente percibe agitación ahora mismo (umbral superado). Alimenta la reacción preventiva. */
  readonly agitated: boolean;
  /** Corresponde emitir un estímulo de ruido: superó el umbral Y pasó el rate-limit. */
  readonly shouldEmit: boolean;
}

/**
 * Ventana deslizante de posiciones del cursor.
 *
 * Mutable —es el objeto vivo de la sesión— pero sin reloj propio: `push` y
 * `read` reciben el tiempo. Eso es lo que permite testear un minuto de
 * movimiento continuo sin esperar un minuto, y lo que hace que la decisión de
 * emitir sea reproducible.
 */
export class NoiseWatcher {
  #window: TracePoint[] = [];
  #lastSampleAt = Number.NEGATIVE_INFINITY;
  #lastEmitAt = Number.NEGATIVE_INFINITY;

  /**
   * Ofrece una posición del cursor. **Decima a paso fijo**: las muestras que
   * llegan antes de `NOISE.sampleStepMs` desde la anterior se descartan.
   *
   * Es la línea que hace que un mouse de 1000 Hz y uno de 60 Hz produzcan la
   * misma lectura. Sin esto, el dispositivo del jugador decidiría cuánto ruido
   * percibe el ente — un determinismo dependiente del hardware, que es
   * exactamente lo que el ADR 0004 existe para evitar.
   *
   * @returns `true` si la muestra se aceptó.
   */
  push(x: number, y: number, now: number): boolean {
    if (now - this.#lastSampleAt < NOISE.sampleStepMs) return false;
    this.#lastSampleAt = now;
    this.#window.push({ x, y, t: now });
    if (this.#window.length > NOISE.windowSize) this.#window.shift();
    return true;
  }

  /** La ventana vigente. Solo lectura; existe para los tests y el feedback visual. */
  get window(): readonly TracePoint[] {
    return this.#window;
  }

  /**
   * Lee el estado sin consumir el rate-limit.
   *
   * `shouldEmit` responde "¿corresponde?", no "¿ya lo hiciste?". Marcar el
   * disparo es responsabilidad de `markEmitted`, para que quien consuma esto
   * pueda decidir no emitir (por ejemplo, si la corrida terminó) sin que el
   * vigilante quede en un estado inconsistente.
   */
  read(now: number): NoiseReading {
    // La ventana tiene que estar llena: medir erraticidad sobre cuatro puntos
    // recién llegados da lecturas ruidosas justo al empezar a moverse.
    const full = this.#window.length >= NOISE.windowSize;
    const erraticity = full ? erraticityOf(this.#window) : 0;
    const agitated = erraticity >= NOISE.threshold;
    return {
      erraticity,
      agitated,
      shouldEmit: agitated && now - this.#lastEmitAt >= NOISE.cooldownMs,
    };
  }

  /** Registra que se emitió un estímulo de ruido: arranca el rate-limit. */
  markEmitted(now: number): void {
    this.#lastEmitAt = now;
  }
}
