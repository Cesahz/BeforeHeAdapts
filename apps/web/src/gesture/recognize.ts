// gesture/recognize.ts — reconocedor heurístico de trazos (ADR 0009 §1).
//
// Este módulo es PURO: puntos muestreados con timestamps → gesto → composición
// del catálogo. No toca DOM, no lee relojes, no tiene estado. El muestreador del
// mouse —que sí toca DOM— vive afuera. `purity.test.ts` lo hace cumplir sobre el
// fuente, al estilo de `packages/visualizer/src/purity.test.ts`.
//
// Heurística geométrica, sin red neuronal. El gate de la NN (roadmap-avanzado
// §1) exige la 3b implementada con heurística MÁS evidencia medida de que no
// alcanza; no está cumplido y no se anticipa.
//
// Dos invariantes de diseño que los tests fijan:
//
//   1. **Invariancia a escala y velocidad.** Todo trazo se re-muestrea a puntos
//      equidistantes por arco antes de medir ángulos, así que la cadencia del
//      dispositivo y el tamaño del gesto dejan de importar. La única medida que
//      depende del tiempo es la velocidad de `straight`, y es deliberada: el
//      catálogo lo llama "trazo recto RÁPIDO".
//   2. **Un trazo ambiguo se rechaza, nunca se adivina.** Emitir una firma
//      aproximada ensuciaría un log append-only con un ataque que el jugador no
//      quiso lanzar. El rechazo NO consume cooldown: un reconocedor imperfecto
//      no puede cobrarle al jugador sus propios errores.
//
// Los cuatro gestos son **mutuamente excluyentes por construcción**, no por el
// orden en que se los prueba: `circle` exige rectitud ≤ 0,25 y `straight` ≥ 0,9;
// `circle` exige giro neto ≥ 5,0 y `zigzag` ≤ 2,0. Hay un property test sobre eso.

import type { Composition, Element } from "@beforeheadapts/arena-dsl";

import { GESTURE } from "../arena/balance.js";
import {
  distance,
  extentOf,
  pathLength,
  resample,
  signedTurns,
  type TracePoint,
} from "./trace.js";

/** Una muestra del trazo. `t` en milisegundos monótonos. */
export type GesturePoint = TracePoint;

/** Los cuatro gestos del catálogo mínimo viable (ADR 0009 §1). */
export type GestureKind = "straight" | "hold" | "circle" | "zigzag";

/**
 * Por qué se rechazó un trazo. Existe para que el feedback visual sea
 * accionable: "lento" le dice al jugador qué corregir, "ambiguo" no.
 */
export type RejectionReason = "insuficiente" | "lento" | "ambiguo";

export type Recognition =
  | { readonly ok: true; readonly kind: GestureKind }
  | { readonly ok: false; readonly reason: RejectionReason };

/** Medidas intermedias del trazo. Exportadas porque los tests aseveran sobre ellas. */
export interface TraceMetrics {
  /** Recorrido total en px. */
  readonly path: number;
  /**
   * Diagonal del bounding box en px: cuánta pantalla ocupa el gesto.
   *
   * No es redundante con `path`. El recorrido crece con la cantidad de muestras
   * —jitter en una caja de 30 px puede acumular cientos de píxeles— mientras
   * que la extensión no. Es la medida que separa un gesto de un temblor.
   */
  readonly extent: number;
  /** Duración en ms. */
  readonly duration: number;
  /** Desplazamiento neto / recorrido. 1 = recta perfecta, ~0 = vuelve al origen. */
  readonly directness: number;
  /** Velocidad media en px/ms. */
  readonly speed: number;
  /** Giro acumulado CON signo, en radianes. Un círculo acumula; un zigzag cancela. */
  readonly netTurn: number;
  /** Giro acumulado ABSOLUTO, en radianes. */
  readonly absTurn: number;
  /** Cambios de sentido de giro, ignorando giros por debajo de la zona muerta. */
  readonly reversals: number;
}

/** Calcula las medidas del trazo. Puro; no decide nada. */
export function metricsOf(points: readonly GesturePoint[]): TraceMetrics {
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const path = pathLength(points);
  const duration = last.t - first.t;

  const resampled = resample(points, GESTURE.resampleCount);
  const turns = signedTurns(resampled);

  let netTurn = 0;
  let absTurn = 0;
  let reversals = 0;
  let lastSign = 0;

  for (const turn of turns) {
    const magnitude = Math.abs(turn);
    absTurn += magnitude;

    // Una cúspide (vaivén de ~180°) invierte la marcha sin sentido de giro
    // definido, así que NO aporta al giro con signo. Ver `GESTURE.cuspRad`:
    // sin esta salvedad, agitar el mouse de ida y vuelta se leía como círculo.
    if (magnitude < GESTURE.cuspRad) netTurn += turn;

    if (magnitude < GESTURE.turnDeadzoneRad) continue;
    // Una cúspide siempre es un cambio de sentido, aunque su signo sea arbitrario.
    if (magnitude >= GESTURE.cuspRad) {
      reversals += 1;
      lastSign = 0;
      continue;
    }
    const sign = Math.sign(turn);
    if (lastSign !== 0 && sign !== lastSign) reversals += 1;
    lastSign = sign;
  }

  return {
    path,
    extent: extentOf(points),
    duration,
    directness: path === 0 ? 0 : distance(first, last) / path,
    speed: duration <= 0 ? 0 : path / duration,
    netTurn: Math.abs(netTurn),
    absTurn,
    reversals,
  };
}

/**
 * Clasifica un trazo.
 *
 * El orden de las pruebas no decide el resultado —los cuatro gestos son
 * disjuntos por umbrales— pero sí decide qué motivo de rechazo se reporta.
 */
export function recognize(points: readonly GesturePoint[]): Recognition {
  if (points.length < GESTURE.minPoints) return { ok: false, reason: "insuficiente" };

  const m = metricsOf(points);
  if (m.duration <= 0) return { ok: false, reason: "insuficiente" };

  // `hold` primero: es la ausencia de trazo, así que no tiene sentido medirle
  // ángulos a lo que apenas se movió.
  if (m.path < GESTURE.holdMaxPathPx) {
    return m.duration >= GESTURE.holdMinMs
      ? { ok: true, kind: "hold" }
      : { ok: false, reason: "insuficiente" };
  }

  if (m.path < GESTURE.minPathPx) return { ok: false, reason: "insuficiente" };

  if (
    m.extent >= GESTURE.circleMinExtentPx &&
    m.netTurn >= GESTURE.circleMinNetTurn &&
    m.directness <= GESTURE.circleMaxClosure
  ) {
    return { ok: true, kind: "circle" };
  }

  if (
    m.extent >= GESTURE.zigzagMinExtentPx &&
    m.absTurn >= GESTURE.zigzagMinAbsTurn &&
    m.netTurn <= GESTURE.zigzagMaxNetTurn &&
    m.reversals >= GESTURE.zigzagMinReversals
  ) {
    return { ok: true, kind: "zigzag" };
  }

  if (m.directness >= GESTURE.straightMinRatio) {
    // Recto pero lento: se rechaza con motivo propio en vez de mapearse a otro
    // gesto. El jugador tiene que poder saber qué corregir.
    return m.speed >= GESTURE.straightMinSpeedPxPerMs
      ? { ok: true, kind: "straight" }
      : { ok: false, reason: "lento" };
  }

  return { ok: false, reason: "ambiguo" };
}

/**
 * Gesto + elemento armado → composición del catálogo.
 *
 * El gesto elige vector y patrón; el elemento es un modo que el jugador porta
 * (ADR 0009 §1). De acá en adelante es una composición como cualquier otra:
 * hereda `cost` y `cooldown` del ADR 0008 y no existe economía paralela.
 */
export function compositionFor(kind: GestureKind, element: Element): Composition {
  switch (kind) {
    case "straight":
      return { element, vector: "projectile" };
    case "hold":
      return { element, vector: "beam", pattern: "sustained" };
    case "circle":
      return { element, vector: "field", pattern: "pulse" };
    case "zigzag":
      return { element, vector: "wave", pattern: "escalating", modifiers: ["unstable"] };
  }
}
