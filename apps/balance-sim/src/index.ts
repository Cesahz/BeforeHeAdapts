// @beforeheadapts/balance-sim — harness de simulación de balance.
//
// Responde con datos la pregunta que el ADR 0002 dejó abierta y el ADR 0008
// heredó: con identidad de cluster exacta y 5.376 firmas, ¿el ente llega a
// adaptarse alguna vez, o el jugador que varía lo deja ciego para siempre?
//
// La lógica es pura y vive acá; el CLI que escribe a disco vive en `scripts/`.

export * from "./archetypes.js";
export * from "./report.js";
export * from "./rng.js";
export * from "./simulate.js";
export * from "./sweep.js";
