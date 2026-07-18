// gesture/ — la frontera de cuantización de entrada continua (ADR 0004).
//
// Dos lectores de lo mismo, los dos puros y con el tiempo como dato:
//
//   recognize.ts  trazos DELIBERADOS  → ataques con firma canónica
//   noise.ts      movimiento INVOLUNTARIO → estímulo de baja intensidad
//   trace.ts      la geometría que ambos comparten, sin umbrales
//
// El muestreador del puntero, que sí toca el DOM, vive en `view/pointer.ts`.

export {
  compositionFor,
  metricsOf,
  recognize,
  type GestureKind,
  type GesturePoint,
  type Recognition,
  type RejectionReason,
  type TraceMetrics,
} from "./recognize.js";

export { NoiseWatcher, erraticityOf, type NoiseReading } from "./noise.js";

export {
  distance,
  extentOf,
  pathLength,
  resample,
  signedTurns,
  type TracePoint,
} from "./trace.js";
