// live.ts — la vista del ente en vivo, sobre el pipeline del visualizador.
//
// El invariante rector de la Fase 2 sigue rigiendo acá: un frame es una LECTURA
// del motor, nunca una segunda implementación. Esta vista no calcula estado
// propio — pide frames a `framesFrom` y los pinta con `renderFrame`.
//
// La ventana deslizante es el "cambio local" que el ADR 0007 dejó previsto para
// el vivo. Dos límites la justifican, medidos y no supuestos:
//
//   - `framesFrom` es O(n²) sobre el largo del log (2 ms a 112 eventos, 43 ms a
//     812). Es caro, pero solo hace falta recalcularlo cuando ENTRA un evento, y
//     los eventos entran gated por el cooldown (≥ 500 ms). Se recalcula al
//     atacar, nunca por cuadro de animación.
//   - `renderFrame` es ~0,2 ms y plano respecto del largo del log. Eso es lo que
//     corre a 60 fps, con holgura enorme sobre el presupuesto de 16,6 ms (§7).
//
// De ahí el reparto: `sync()` al atacar, `tick()` por cuadro.

import { framesFrom, renderFrame, type Frame } from "@beforeheadapts/visualizer";
import type { EventLog, PolicyInput } from "@beforeheadapts/core";

/** Cuántos frames de historia se conservan para resolver efectos en curso. */
export const WINDOW = 24;

/** Milisegundos que dura cada frame del replay en vivo. */
export const FRAME_HOLD_MS = 110;

export interface LiveStats {
  readonly fps: number;
  readonly frames: number;
  readonly lastSyncMs: number;
}

/**
 * Vista del ente montada sobre un contenedor.
 *
 * No se suscribe a la sala ni la conoce: quien la usa le pasa el log con
 * `sync()`. Así la vista sirve igual para una sala en vivo que para reproducir
 * un replay importado, sin cambiarle una línea.
 */
export class LiveView {
  #frames: readonly Frame[] = [];
  /** Índice del frame que se está mostrando. Avanza hacia el final del log. */
  #playhead = 0;
  #lastAdvance = 0;
  #lastSyncMs = 0;

  #fps = 0;
  #framesDrawn = 0;
  #fpsWindowStart = 0;

  #lastSvg = "";

  /**
   * @param container lo único que la vista necesita es dónde escribir el SVG.
   * Pedir `{ innerHTML }` en vez de `HTMLElement` no es abstracción por gusto:
   * es lo que permite testear la vista entera en Node, sin DOM.
   */
  constructor(
    private readonly container: { innerHTML: string },
    private readonly config: PolicyInput = {},
  ) {}

  get stats(): LiveStats {
    return { fps: this.#fps, frames: this.#frames.length, lastSyncMs: this.#lastSyncMs };
  }

  /**
   * Recalcula los frames desde el log. Llamar cuando el log crece, no por cuadro.
   *
   * Deja el playhead donde estaba si todavía es válido: así los frames nuevos se
   * reproducen en secuencia en vez de saltar directo al final, que es lo que
   * hace visible la onda del snap y el decaimiento del impacto.
   */
  sync(log: EventLog): void {
    const t0 = performance.now();
    this.#frames = framesFrom(log, this.config);
    this.#lastSyncMs = performance.now() - t0;

    if (this.#playhead >= this.#frames.length) {
      this.#playhead = Math.max(0, this.#frames.length - 1);
    }
  }

  /**
   * Avanza el reloj del replay y redibuja si hace falta.
   *
   * @param now milisegundos monótonos (típicamente `performance.now()`).
   */
  tick(now: number): void {
    if (this.#frames.length === 0) return;

    // Alcanzar el presente: si quedaron frames sin mostrar, avanzar de a uno
    // para que cada evento tenga su instante en pantalla.
    if (this.#playhead < this.#frames.length - 1 && now - this.#lastAdvance >= FRAME_HOLD_MS) {
      this.#playhead += 1;
      this.#lastAdvance = now;
    }

    this.#draw();
    this.#countFrame(now);
  }

  #draw(): void {
    // La ventana acota cuánto pasado ve el render. `renderFrame` mira hacia
    // atrás para resolver efectos en curso (onda del snap, contracción), así
    // que no alcanza con pasarle un frame suelto: necesita su cola.
    const end = this.#playhead + 1;
    const start = Math.max(0, end - WINDOW);
    const ventana = this.#frames.slice(start, end);
    const svg = renderFrame(ventana, ventana.length - 1);

    // Escribir el DOM solo cuando el dibujo cambió: entre dos cuadros idénticos
    // no hay nada que actualizar, y el SVG es determinista byte a byte, así que
    // comparar strings es una comparación exacta y no una heurística.
    if (svg !== this.#lastSvg) {
      this.container.innerHTML = svg;
      this.#lastSvg = svg;
    }
  }

  #countFrame(now: number): void {
    this.#framesDrawn += 1;
    const elapsed = now - this.#fpsWindowStart;
    if (elapsed >= 500) {
      this.#fps = (this.#framesDrawn * 1000) / elapsed;
      this.#framesDrawn = 0;
      this.#fpsWindowStart = now;
    }
  }
}
