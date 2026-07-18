// @beforeheadapts/core — motor de adaptación puro, agnóstico de dominio.
//
// Núcleo puro y determinista: sin I/O, sin Date.now(), sin Math.random() sin
// seed inyectada. El estado siempre es reduce(log) sobre eventos inmutables.
//
// Fase 1 en curso: signature/ y ledger/ implementados; policy/ y engine/ siguen.

export * from "./signature/index.js";
export * from "./ledger/index.js";
