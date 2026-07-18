// @beforeheadapts/core — motor de adaptación puro, agnóstico de dominio.
//
// Núcleo puro y determinista: sin I/O, sin Date.now(), sin Math.random() sin
// seed inyectada. El estado siempre es reduce(log) sobre eventos inmutables.
//
// Fase 1 en curso: signature/, ledger/ y policy/ implementados; falta engine/.

export * from "./signature/index.js";
export * from "./ledger/index.js";
export * from "./policy/index.js";
