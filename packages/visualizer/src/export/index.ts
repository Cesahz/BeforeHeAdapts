// export/ — el replay como video.
//
// Acá está la frontera con el mundo. La estrategia es la misma que usa el motor
// con `CounterSynthesizer`: **la orquestación es pura y el I/O entra por un
// puerto**. `exportReplay` recorre el guion temporal y le va entregando frames
// a un `FrameSink`; quién es el sink y qué hace con ellos —canvas y
// MediaRecorder en el navegador, un encoder en Node, un espía en un test— no es
// asunto de este módulo.
//
// El resultado: la lógica de exportación se testea entera en Node, sin DOM y
// sin rasterizar un solo píxel. Lo único que queda sin cubrir por tests es el
// adaptador concreto, que por eso se mantiene lo más delgado posible.

import type { Frame } from "../frames/index.js";
import { renderFrames, type RenderOptions } from "../render/index.js";
import { timelineOf, type TimingConfig } from "./timeline.js";

export * from "./timeline.js";

/**
 * Destino de los frames de un replay.
 *
 * El puerto es "recibí este dibujo y sostenelo tanto tiempo", no "convertí esto
 * a píxeles": es lo que permite que el mismo orquestador sirva para grabar un
 * webm, escribir un gif o simplemente reproducir en pantalla.
 */
export interface FrameSink<T = unknown> {
  /** Recibe un frame ya renderizado y cuánto debe durar en pantalla. */
  draw(svg: string, durationMs: number): Promise<void> | void;
  /** Cierra la grabación y devuelve el artefacto (un `Blob`, un buffer, nada). */
  finish(): Promise<T> | T;
}

export interface ExportOptions extends RenderOptions {
  readonly timing?: Partial<TimingConfig>;
  /** Aviso de avance en `[0, 1]`, para poder mostrar una barra. */
  readonly onProgress?: (ratio: number) => void;
}

/**
 * Recorre el replay entero entregándoselo al sink, y devuelve lo que el sink
 * produzca.
 *
 * Los frames se renderizan una sola vez, por adelantado: `renderFrames` es la
 * API sobre la secuencia (ADR 0007) y llamarla por frame sería cuadrático sin
 * ganar nada.
 */
export async function exportReplay<T>(
  frames: readonly Frame[],
  sink: FrameSink<T>,
  options: ExportOptions = {},
): Promise<T> {
  const svgs = renderFrames(frames, options);
  const timeline = timelineOf(frames, options.timing);

  for (const timed of timeline.frames) {
    await sink.draw(svgs[timed.index]!, timed.durationMs);
    options.onProgress?.((timed.startMs + timed.durationMs) / timeline.totalMs);
  }

  return await sink.finish();
}
