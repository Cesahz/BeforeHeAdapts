// gesture/ — reconocedor heurístico de trazos del mouse (ADR 0009 §1).
//
// Puro por contrato: puntos con timestamps → gesto → composición del catálogo.
// El muestreador del puntero, que sí toca el DOM, vive fuera de esta carpeta.

export {
  compositionFor,
  metricsOf,
  recognize,
  resample,
  type GestureKind,
  type GesturePoint,
  type Recognition,
  type RejectionReason,
  type TraceMetrics,
} from "./recognize.js";
