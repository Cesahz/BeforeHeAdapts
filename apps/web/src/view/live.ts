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

import {
  DEFAULT_STEPS,
  densify,
  framesFrom,
  renderFrame,
  type DenseFrame,
  type Frame,
} from "@beforeheadapts/visualizer";
import type { EventLog, PolicyInput } from "@beforeheadapts/core";

/** Cuántos EVENTOS de historia se conservan para resolver efectos en curso. */
export const WINDOW = 24;

/**
 * Milisegundos que dura cada frame densificado.
 *
 * Antes eran 110 ms por evento, y con un frame por evento eso significaba que
 * la pantalla mostraba una imagen fija entre golpe y golpe: el "fofo" que
 * reportó el autor en la ronda 1. Ahora cada evento se abre en `DEFAULT_STEPS`
 * frames (ADR 0010 §1), así que el tramo dura lo mismo pero se recorre en
 * pasos de ~18 ms — la cadencia de un monitor de 60 Hz.
 */
export const FRAME_HOLD_MS = 18;

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
  /** La cola densificada: lo que el playhead recorre de verdad. */
  #dense: readonly DenseFrame[] = [];
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

  /** Frames densificados en la ventana vigente. Para tests y para el medidor. */
  get denseLength(): number {
    return this.#dense.length;
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

    // Se densifica SOLO la cola. `densify` es perezosa, pero acá hace falta el
    // arreglo materializado —el playhead lo recorre por índice— y densificar el
    // log entero sería materializar decenas de miles de frames que la ventana
    // de render nunca va a mirar. La cola es exactamente lo que se puede ver.
    const cola = this.#frames.slice(-WINDOW);
    const pendientes = Math.max(0, this.#dense.length - 1 - this.#playhead);
    this.#dense = [...densify(cola, { steps: DEFAULT_STEPS })];

    // El playhead se reubica CONTANDO DESDE EL FINAL, no desde el principio:
    // la cola se corre a medida que el log crece, así que un índice absoluto
    // saltaría hacia atrás en el replay cada vez que entra un evento.
    this.#playhead = Math.max(0, this.#dense.length - 1 - pendientes - DEFAULT_STEPS);

    this.#lastSyncMs = performance.now() - t0;
  }

  /**
   * Avanza el reloj del replay y redibuja si hace falta.
   *
   * @param now milisegundos monótonos (típicamente `performance.now()`).
   */
  tick(now: number): void {
    if (this.#dense.length === 0) return;

    // Alcanzar el presente: si quedaron frames sin mostrar, avanzar de a uno
    // para que cada instante tenga su cuadro en pantalla.
    if (this.#playhead < this.#dense.length - 1 && now - this.#lastAdvance >= FRAME_HOLD_MS) {
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
    //
    // Se mide en frames DENSOS, no en eventos: los transitorios del render
    // decaen por distancia en frames, y con la densificación esa distancia se
    // recorre en pasos chicos. Es lo que convierte un decaimiento a saltos en
    // uno continuo, sin que el render se entere de que algo cambió.
    const end = this.#playhead + 1;
    const start = Math.max(0, end - WINDOW * DEFAULT_STEPS);
    const ventana = this.#dense.slice(start, end);
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
