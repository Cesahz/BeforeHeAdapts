// export/timeline.ts — el guion temporal del replay.
//
// Los frames del log no tienen ritmo: hay uno por evento, y los eventos no se
// reparten parejo en el tiempo. Este módulo decide **cuánto dura cada frame en
// la reproducción**, que es una decisión de narración, no del motor.
//
// Es deliberadamente independiente de los timestamps del log. Un replay de una
// sala donde nadie atacó por diez minutos no debe tener diez minutos de nada, y
// dos salas con el mismo guion de estímulos deben verse igual aunque una haya
// ocurrido más lento. El tiempo del log sirve para auditar; el del replay, para
// que se entienda lo que pasó.
//
// Todo acá es puro: ni reloj, ni I/O. El adaptador que graba consume esto.

import type { Frame } from "../frames/index.js";

export interface TimingConfig {
  /** Duración de un frame que no tiene nada especial. */
  readonly frameDuration: number;
  /**
   * Tiempo extra en el frame del salto de adaptación. El snap es el momento que
   * el replay existe para mostrar: si pasa al mismo ritmo que el resto, se
   * pierde.
   */
  readonly snapHold: number;
  /** Tiempo extra en el último frame, para que el cierre se lea. */
  readonly tailHold: number;
  /** Cuadros por segundo del video resultante. */
  readonly fps: number;
}

export const defaultTiming: TimingConfig = Object.freeze({
  frameDuration: 120,
  snapHold: 480,
  tailHold: 800,
  fps: 30,
});

/** Un frame con su lugar en la línea de tiempo. */
export interface TimedFrame {
  readonly index: number;
  readonly startMs: number;
  readonly durationMs: number;
}

export interface Timeline {
  readonly frames: readonly TimedFrame[];
  readonly totalMs: number;
  readonly fps: number;
}

/**
 * Arma el guion temporal de una secuencia de frames.
 *
 * Los frames son contiguos: el que sigue arranca donde termina el anterior, sin
 * huecos. Eso es lo que permite que `frameAtMs` sea total sobre `[0, totalMs)`.
 */
export function timelineOf(
  frames: readonly Frame[],
  config: Partial<TimingConfig> = {},
): Timeline {
  const timing = { ...defaultTiming, ...config };
  validate(timing);

  let startMs = 0;
  const timed = frames.map((frame, i) => {
    const isSnap = frame.event.type === "AdaptationCompleted";
    const isLast = i === frames.length - 1;
    const durationMs =
      timing.frameDuration + (isSnap ? timing.snapHold : 0) + (isLast ? timing.tailHold : 0);

    const entry = Object.freeze({ index: i, startMs, durationMs });
    startMs += durationMs;
    return entry;
  });

  return Object.freeze({
    frames: Object.freeze(timed) as readonly TimedFrame[],
    totalMs: startMs,
    fps: timing.fps,
  });
}

/**
 * Qué frame se está mostrando en el milisegundo `ms`.
 *
 * Fuera de rango satura en los extremos en vez de fallar: un encoder que pide
 * un cuadro pasado el final debe recibir el último frame, no una excepción.
 */
export function frameAtMs(timeline: Timeline, ms: number): number {
  if (timeline.frames.length === 0) {
    throw new RangeError("una línea de tiempo vacía no tiene frames");
  }
  if (ms < 0) return 0;

  // Búsqueda lineal: las líneas de tiempo son de una sala y el encoder consulta
  // en orden creciente. Si alguna vez pesa, se cambia por binaria sin tocar la
  // firma.
  for (const frame of timeline.frames) {
    if (ms < frame.startMs + frame.durationMs) return frame.index;
  }
  return timeline.frames.length - 1;
}

/** Cuántos cuadros de video ocupa la línea de tiempo a su `fps`. */
export function totalTicks(timeline: Timeline): number {
  return Math.max(1, Math.round((timeline.totalMs / 1000) * timeline.fps));
}

function validate(timing: TimingConfig): void {
  const positivos: readonly (keyof TimingConfig)[] = ["frameDuration", "fps"];
  for (const key of positivos) {
    if (!Number.isFinite(timing[key]) || timing[key] <= 0) {
      throw new RangeError(`${key} debe ser un número positivo, no ${timing[key]}`);
    }
  }
  for (const key of ["snapHold", "tailHold"] as const) {
    if (!Number.isFinite(timing[key]) || timing[key] < 0) {
      throw new RangeError(`${key} no puede ser negativo, y era ${timing[key]}`);
    }
  }
}
