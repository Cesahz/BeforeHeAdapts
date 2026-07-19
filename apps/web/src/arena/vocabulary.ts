// vocabulary.ts — cuánto arsenal le queda al jugador (ADR 0011 §2).
//
// Es el instrumento de tensión principal de la carrera: el jugador ve encogerse
// su propio vocabulario, golpe a golpe, y entiende sin tutorial que lo cierra
// él. El círculo del battle royale, salvo que acá no lo mueve un temporizador.
//
// **El contador es honesto, y esa es la decisión central del módulo.**
//
// La definición ingenua sería "viable = su cluster todavía no está adaptado".
// No se sostiene: por R6 una firma hereda `R₀(s) = max_c [sim(s,c) × transfer(c)]`
// de sus parientes, así que una composición formalmente no adaptada puede nacer
// ya casi inútil. Ese contador prometería opciones muertas y mentiría
// exactamente en el momento de mayor tensión, que es cuando más se lo mira. Acá
// lo que se muestra es siempre verdad — es la salvaguarda ética y la identidad
// de diseño del proyecto a la vez.
//
// Lo que se mide es el **multiplicador de daño real de la próxima exposición**:
//
//     efectividad esperada = eff(k) × (1 − R₀(s))
//
// que es literalmente `damage / intensity` de `Room.expose()`. Los dos factores
// tienen que estar: `eff(k)` es el desgaste propio de la firma (R5) y `R₀` es lo
// heredado de los parientes ya adaptados (R6). Mirar uno solo vuelve a mentir,
// nada más que por el otro lado.
//
// Nada de esto toca el motor: son selectores puros sobre `EngineState`.

import {
  effectiveness,
  generalizedInitialResistance,
  type EngineState,
} from "@beforeheadapts/core";
import { ELEMENTS, toSignature, type Composition, type Element } from "@beforeheadapts/arena-dsl";

import { VICTORY } from "./balance.js";
import { compositionFor, type GestureKind } from "../gesture/recognize.js";

/** Los cuatro trazos del combate en vivo (ADR 0009 §1). */
export const GESTURES: readonly GestureKind[] = ["straight", "hold", "circle", "zigzag"];

/**
 * Estado de desgaste de una firma. Es lo que tiñe cada build en el builder y en
 * el anillo del HUD, para que el titular no sea el único canal.
 */
export type SignatureStatus = "fresh" | "worn" | "spent";

/** Una entrada del vocabulario del jugador, con su desgaste actual. */
export interface VocabularyEntry {
  readonly gesture: GestureKind;
  readonly element: Element;
  readonly composition: Composition;
  /** `eff(k) × (1 − R₀)`: el multiplicador de daño que tendría el próximo golpe. */
  readonly expectedEffectiveness: number;
  readonly status: SignatureStatus;
}

/** El vocabulario entero, ya contado. Lo consume el HUD sin recalcular nada. */
export interface Vocabulary {
  readonly entries: readonly VocabularyEntry[];
  /** El titular: firmas que todavía rinden por encima del umbral. */
  readonly viable: number;
  /** El detalle: existen, pero ya no rinden. Se muestran como "+N debilitadas". */
  readonly weakened: number;
  readonly total: number;
}

/**
 * Efectividad esperada de una composición: el multiplicador de daño que
 * tendría el próximo golpe, entre 0 y 1.
 *
 * Monótona no creciente por R1 + R5: `eff(k)` solo baja con las exposiciones y
 * `R₀` solo puede subir porque una adaptación no se deshace. Esa monotonía es lo
 * que hace que el contador sea un reloj y no un indicador que va y viene.
 */
export function expectedEffectiveness(state: EngineState, composition: Composition): number {
  const signature = toSignature(composition);
  const eff = effectiveness(state, signature);
  const inherited = generalizedInitialResistance(state, signature);
  return eff * (1 - inherited);
}

function statusOf(expected: number): SignatureStatus {
  if (expected < VICTORY.spentThreshold) return "spent";
  if (expected < VICTORY.viableThreshold) return "worn";
  return "fresh";
}

/**
 * El vocabulario disponible: los cuatro gestos por cada elemento portable.
 *
 * Este es el catálogo que se agota, y es el del combate en vivo a propósito: lo
 * que el jugador puede efectivamente lanzar es `gesto × elemento armado`, no el
 * espacio entero de composiciones del DSL. Los prefabs son un atajo a un
 * subconjunto de esto, no vocabulario extra.
 *
 * ⚠️ Acopla la carrera al catálogo del ADR 0008: si cambian los gestos o los
 * elementos, cambia el tamaño inicial del contador y con él todo el balance.
 */
export function vocabularyOf(state: EngineState): Vocabulary {
  const entries: VocabularyEntry[] = [];

  for (const gesture of GESTURES) {
    for (const element of ELEMENTS) {
      const composition = compositionFor(gesture, element);
      const expected = expectedEffectiveness(state, composition);
      entries.push({
        gesture,
        element,
        composition,
        expectedEffectiveness: expected,
        status: statusOf(expected),
      });
    }
  }

  const viable = entries.filter((e) => e.status === "fresh").length;
  return { entries, viable, weakened: entries.length - viable, total: entries.length };
}
