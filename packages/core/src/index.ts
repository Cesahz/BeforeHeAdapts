// @beforeheadapts/core — motor de adaptación puro, agnóstico de dominio.
//
// Núcleo puro y determinista: sin I/O, sin Date.now(), sin Math.random() sin
// seed inyectada. El estado siempre es reduce(log) sobre eventos inmutables.
//
// Todavía sin lógica: los módulos signature/, ledger/, policy/ y engine/
// llegan en la Fase 1, después de que contract.test.ts fije la especificación.

/** Versión del contrato de eventos. Cada evento del log llevará este campo `v`. */
export const CONTRACT_VERSION = 1 as const;
