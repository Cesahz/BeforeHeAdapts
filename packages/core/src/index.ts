// @beforeheadapts/core — motor de adaptación puro, agnóstico de dominio.
//
// Núcleo puro y determinista: sin I/O, sin Date.now(), sin Math.random() sin
// seed inyectada. El estado siempre es reduce(log) sobre eventos inmutables.
//
// Fase 1 completa: signature/, ledger/, policy/ y engine/ implementados, con el
// contrato de aceptación (R1–R6) en verde.

export * from "./signature/index.js";
export * from "./ledger/index.js";
export * from "./engine/index.js";

// `effectiveness` existe en dos alturas: la fórmula cruda de la curva y el
// selector que la evalúa sobre un estado. En el borde del paquete el nombre
// corto es el selector (lo que consume el dominio) y la fórmula se expone como
// `curveEffectiveness`, que es como la usa quien calibra una policy.
export {
  adaptedResistance,
  confidenceAt,
  defaultPolicy,
  effectiveness as curveEffectiveness,
  generalizedResistance,
  resolvePolicy,
  type AdaptedCluster,
  type CurveConfig,
  type MemoryPolicy,
  type PolicyConfig,
  type PolicyInput,
} from "./policy/index.js";
