// @beforeheadapts/arena-dsl — el DSL de ataques de la arena (ADR 0008).
//
// Adaptador de dominio: traduce composiciones del jugador a firmas canónicas del
// motor. Depende de `@beforeheadapts/core`; el motor no sabe que existe.
//
// Vive como paquete propio y no dentro de `apps/web` porque tiene dos consumidores:
// la arena y el harness de simulación de balance (`apps/balance-sim`). Duplicar
// el catálogo entre ambos sería duplicar el dial de balance del juego.

export * from "./catalog.js";
export * from "./translate.js";
