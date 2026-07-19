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
  /**
   * ¿Se puede empezar un trazo ahora? Opcional; por defecto siempre sí.
   *
   * Existe para el stagger de la interrupción (ADR 0012 §1), y la pregunta se
   * hace ACÁ, en el borde: la decisión sigue siendo del dominio —quien contesta
   * es `CombatSession.canDraw`— y este módulo solo obedece. Un trazo que ni
   * siquiera arranca no acumula puntos, así que no hay nada que descartar
   * después ni riesgo de que un `pointerup` tardío lo reviva.
   */
  readonly canStart?: (now: number) => boolean;
}

/** El muestreador enganchado. Lo que el resto del juego puede pedirle. */
export interface PointerControl {
  /** Desengancha todo. Era el valor de retorno de `attachPointer` antes del ADR 0012. */
  readonly detach: () => void;
  /** ¿Hay un trazo en curso ahora mismo? Es lo que la interrupción puede romper. */
  readonly drawing: () => boolean;
  /**
   * Rompe el trazo en curso y lo tira: **no** llama a `onStroke`.
   *
   * Es la mitad física de la interrupción. El trazo no se convierte en
   * exposición y no llega al log — no llegó a ser un ataque.
   */
  readonly abort: () => void;
}

/** Tope duro de muestras por trazo. Un trazo larguísimo no puede crecer sin límite. */
const MAX_STROKE_POINTS = 600;

/**
 * Paso del latido de muestreo, en ms. Igual al decimado del ruido: es el mismo
 * criterio (una muestra por paso fijo, independiente del dispositivo).
 */
const HEARTBEAT_MS = 16;

/**
 * Engancha el muestreo a un elemento.
 *
 * @param clock inyectado en vez de leer `performance.now()` adentro: mantiene
 * una sola línea de tiempo para toda la sala (la del ledger, que rechaza
 * timestamps que retroceden) y hace testeable el muestreador si algún día hace
 * falta.
 * @returns el control del muestreador: desenganche, y la interrupción del ADR 0012.
 */
export function attachPointer(
  element: HTMLElement,
  clock: () => number,
  handlers: PointerHandlers,
): PointerControl {
  let stroke: GesturePoint[] | undefined;
  let last: { x: number; y: number } | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  /**
   * El puntero que estamos capturando, si hay trazo en curso.
   *
   * Hace falta para soltar la captura al ABORTAR, que es un camino donde no hay
   * evento del DOM del que sacar el `pointerId`. Sin esto, un trazo interrumpido
   * dejaría el puntero capturado y el siguiente `pointerdown` llegaría raro.
   */
  let capturado: number | undefined;

  /**
   * Late una muestra por paso aunque el puntero esté quieto.
   *
   * `pointermove` solo dispara cuando hay movimiento, así que un trazo definido
   * por NO moverse —`hold`— llegaba al reconocedor con dos puntos y se
   * rechazaba siempre. El muestreo tiene que ser por TIEMPO y no solo por
   * evento; si no, el gesto que mide quietud es justamente el que no se puede
   * medir.
   *
   * De paso empareja el muestreo de los trazos lentos, donde el navegador
   * entrega puntos muy espaciados.
   */
  const startHeartbeat = (): void => {
    stopHeartbeat();
    heartbeat = setInterval(() => {
      if (stroke === undefined || last === undefined) return;
      if (stroke.length >= MAX_STROKE_POINTS) return;
      stroke.push({ x: last.x, y: last.y, t: clock() });
    }, HEARTBEAT_MS);
  };

  const stopHeartbeat = (): void => {
    if (heartbeat !== undefined) clearInterval(heartbeat);
    heartbeat = undefined;
  };

  const positionOf = (event: PointerEvent): { x: number; y: number } => {
    // Coordenadas relativas al contenedor: el gesto no puede depender de dónde
    // esté la ventana ni de cuánto se scrolleó la página.
    const box = element.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };

  /** Suelta la captura del puntero, venga de un evento o de un abort. */
  const soltarCaptura = (pointerId: number | undefined): void => {
    if (pointerId === undefined) return;
    if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
    capturado = undefined;
  };

  const onPointerDown = (event: PointerEvent): void => {
    const now = clock();
    // El stagger de la interrupción: durante la recuperación el trazo ni
    // siquiera empieza. Apretar no acumula un punto que después haya que tirar.
    if (handlers.canStart !== undefined && !handlers.canStart(now)) return;
    const { x, y } = positionOf(event);
    stroke = [{ x, y, t: now }];
    last = { x, y };
    startHeartbeat();
    // Capturar el puntero hace que soltar el botón FUERA del contenedor igual
    // cierre el trazo acá. Sin esto, un gesto que se sale del área queda
    // colgado y el siguiente arranca con puntos viejos pegados adelante.
    element.setPointerCapture(event.pointerId);
    capturado = event.pointerId;
  };

  const onPointerMove = (event: PointerEvent): void => {
    const now = clock();
    const { x, y } = positionOf(event);
    handlers.onMove(x, y, now);
    last = { x, y };
    if (stroke !== undefined && stroke.length < MAX_STROKE_POINTS) {
      stroke.push({ x, y, t: now });
    }
  };

  const finish = (event: PointerEvent): void => {
    if (stroke === undefined) return;
    stopHeartbeat();
    const now = clock();
    const { x, y } = positionOf(event);
    stroke.push({ x, y, t: now });
    const points = stroke;
    stroke = undefined;
    soltarCaptura(event.pointerId);
    handlers.onStroke(points, now);
  };

  /**
   * El trazo se rompe y se tira. Ninguna diferencia con soltar el botón salvo la
   * que importa: `onStroke` **no se llama**, así que no hay reconocimiento, no
   * hay firma y no hay exposición. El trazo nunca existió para el motor.
   */
  const abort = (): void => {
    if (stroke === undefined) return;
    stopHeartbeat();
    stroke = undefined;
    soltarCaptura(capturado);
  };

  element.addEventListener("pointerdown", onPointerDown);
  element.addEventListener("pointermove", onPointerMove);
  element.addEventListener("pointerup", finish);
  // `pointercancel` lo dispara el navegador si el sistema le roba el puntero
  // (gesto del SO, cambio de ventana). Se trata como un trazo terminado: el
  // reconocedor lo va a rechazar por incompleto, que es lo correcto.
  element.addEventListener("pointercancel", finish);

  return {
    drawing: () => stroke !== undefined,
    abort,
    detach: () => {
      stopHeartbeat();
      element.removeEventListener("pointerdown", onPointerDown);
      element.removeEventListener("pointermove", onPointerMove);
      element.removeEventListener("pointerup", finish);
      element.removeEventListener("pointercancel", finish);
    },
  };
}
