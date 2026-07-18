// view/pointer.ts — muestreador del puntero. El ÚNICO módulo del combate que
// toca el DOM.
//
// Vive fuera de `gesture/` a propósito: esa carpeta es pura y su guardia lo hace
// cumplir (ADR 0009 §6). Acá se escuchan eventos del navegador y se acumulan
// puntos; ninguna decisión se toma. Quien clasifica es `recognize.ts`, quien
// mide agitación es `noise.ts`, y los dos reciben datos, no eventos del DOM.
//
// El reparto de responsabilidades del ADR 0004, en una línea cada uno:
//
//   pointer.ts   junta posiciones          (impuro, sin decisiones)
//   noise.ts     mide agitación            (puro)
//   recognize.ts clasifica el trazo        (puro)
//   combat.ts    decide si eso llega al log (puro, tiempo como dato)
//
// El movimiento crudo no cruza de la primera línea a la última: lo que viaja
// son a lo sumo unos cientos de puntos que se descartan al soltar el botón.

import type { GesturePoint } from "../gesture/recognize.js";

export interface PointerHandlers {
  /** Cada posición del cursor, apretado o no. Alimenta el lector de ruido. */
  readonly onMove: (x: number, y: number, now: number) => void;
  /** Trazo terminado (se soltó el botón). Los puntos ya vienen relativos al contenedor. */
  readonly onStroke: (points: readonly GesturePoint[], now: number) => void;
}

/** Tope duro de muestras por trazo. Un trazo larguísimo no puede crecer sin límite. */
const MAX_STROKE_POINTS = 600;

/**
 * Engancha el muestreo a un elemento.
 *
 * @param clock inyectado en vez de leer `performance.now()` adentro: mantiene
 * una sola línea de tiempo para toda la sala (la del ledger, que rechaza
 * timestamps que retroceden) y hace testeable el muestreador si algún día hace
 * falta.
 * @returns función para desenganchar todo.
 */
export function attachPointer(
  element: HTMLElement,
  clock: () => number,
  handlers: PointerHandlers,
): () => void {
  let stroke: GesturePoint[] | undefined;

  const positionOf = (event: PointerEvent): { x: number; y: number } => {
    // Coordenadas relativas al contenedor: el gesto no puede depender de dónde
    // esté la ventana ni de cuánto se scrolleó la página.
    const box = element.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };

  const onPointerDown = (event: PointerEvent): void => {
    const now = clock();
    const { x, y } = positionOf(event);
    stroke = [{ x, y, t: now }];
    // Capturar el puntero hace que soltar el botón FUERA del contenedor igual
    // cierre el trazo acá. Sin esto, un gesto que se sale del área queda
    // colgado y el siguiente arranca con puntos viejos pegados adelante.
    element.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent): void => {
    const now = clock();
    const { x, y } = positionOf(event);
    handlers.onMove(x, y, now);
    if (stroke !== undefined && stroke.length < MAX_STROKE_POINTS) {
      stroke.push({ x, y, t: now });
    }
  };

  const finish = (event: PointerEvent): void => {
    if (stroke === undefined) return;
    const now = clock();
    const { x, y } = positionOf(event);
    stroke.push({ x, y, t: now });
    const points = stroke;
    stroke = undefined;
    if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
    handlers.onStroke(points, now);
  };

  element.addEventListener("pointerdown", onPointerDown);
  element.addEventListener("pointermove", onPointerMove);
  element.addEventListener("pointerup", finish);
  // `pointercancel` lo dispara el navegador si el sistema le roba el puntero
  // (gesto del SO, cambio de ventana). Se trata como un trazo terminado: el
  // reconocedor lo va a rechazar por incompleto, que es lo correcto.
  element.addEventListener("pointercancel", finish);

  return () => {
    element.removeEventListener("pointerdown", onPointerDown);
    element.removeEventListener("pointermove", onPointerMove);
    element.removeEventListener("pointerup", finish);
    element.removeEventListener("pointercancel", finish);
  };
}
