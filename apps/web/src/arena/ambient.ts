// ambient.ts — la firma del ruido ambiental (ADR 0009 §2).
//
// El ruido NO es una composición del Builder: es lo que el ente percibe del
// movimiento involuntario del jugador. Por eso se arma acá con `canonicalize`
// del núcleo en vez de con `toSignature`, y por eso su elemento vive fuera del
// catálogo jugable de `packages/arena-dsl` — que sigue siendo exactamente los
// 8 elementos del ADR 0008, con su espacio de 5.376 composiciones intacto.
//
// Dos propiedades que la elección de `elem:ambient` compra:
//
//   1. **Mantiene la invariante del ADR 0008 §4.** `elem:` sigue siendo el
//      primer prefijo en orden lexicográfico, así que la debilidad que expone
//      el ente al adaptarse al ruido sigue siendo un elemento — legible y con
//      el mismo gancho para el `CounterSynthesizer` que cualquier otra.
//   2. **No colisiona con ningún ataque del jugador.** Si el ruido usara el
//      elemento armado, mover el mouse sería un alimentador gratuito de
//      exposiciones contra los propios clusters del jugador: el ente adaptaría
//      sus ataques sin que atacara.
//
// ⚠️ `ambient` NO es jugable. Toda UI que enumere elementos tiene que listar los
// 8 de `ELEMENTS` y nunca este. Hay un test que lo vigila.

import { canonicalize, type StimulusSignature } from "@beforeheadapts/core";

import { NOISE } from "./balance.js";

/** El noveno elemento: el que el jugador no puede lanzar. */
export const AMBIENT_ELEMENT = "ambient";

/**
 * Firma del estímulo de ruido. `N(c) = 4` por el ADR 0002 (una exposición por
 * primitiva): con el rate-limit de 3 s, el ente necesita **≥ 12 s de agitación
 * acumulada** para adaptarse al ruido. No es un evento de un segundo.
 *
 * La intensidad es el mínimo del catálogo: el ruido informa, no lastima.
 */
export const AMBIENT_SIGNATURE: StimulusSignature = canonicalize(
  [`elem:${AMBIENT_ELEMENT}`, "mod:unstable", "pat:sustained", "vec:field"],
  NOISE.intensity,
);
