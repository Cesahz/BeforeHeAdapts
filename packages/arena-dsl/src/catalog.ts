// catalog.ts — el catálogo de primitivas del DSL de la arena (ADR 0008).
//
// Este módulo es puro y no importa nada: es solo el vocabulario. La traducción
// composición → firma canónica vive en `translate.ts`.
//
// Es EL dial de balance del juego: cuántas primitivas emite una composición
// determina N(c) (ADR 0002: N = cantidad de primitivas), y qué valores existen
// determina cuánta resistencia transfiere R6 entre ataques parecidos vía Jaccard.

/**
 * Prefijo de eje de cada primitiva.
 *
 * ⚠️ EL ORDEN LEXICOGRÁFICO DE ESTOS PREFIJOS ES LA REGLA DE `weaknessOf`. ⚠️
 *
 * El núcleo define la debilidad expuesta como "la primera primitiva en orden
 * canónico" (`engine/index.ts`), y el orden canónico es alfabético. Como
 * `elem:` < `mod:` < `pat:` < `vec:` y el elemento es obligatorio en toda
 * composición, la debilidad resulta SIEMPRE el elemento del ataque. Eso es una
 * decisión de diseño (ADR 0008 §4), no una casualidad — pero se sostiene sobre
 * cómo están deletreados estos cuatro strings.
 *
 * Renombrar cualquiera de estos prefijos puede cambiar silenciosamente qué
 * debilidad expone el ente. `catalog.test.ts` verifica la propiedad de orden
 * sobre el catálogo completo, y `translate.test.ts` la verifica de punta a punta
 * contra `process()`. Si tocás esto, esos tests son los que avisan.
 */
export const AXIS_PREFIX = {
  element: "elem:",
  modifier: "mod:",
  pattern: "pat:",
  vector: "vec:",
} as const;

/** Elemento del ataque. Eje obligatorio: define la debilidad que expone. */
export const ELEMENTS = [
  "ember",
  "frost",
  "current",
  "toxin",
  "gravity",
  "sound",
  "light",
  "void",
] as const;

/** Vector de entrega. Eje opcional. */
export const VECTORS = ["projectile", "beam", "wave", "field", "melee", "trap"] as const;

/** Patrón temporal. Eje opcional. */
export const PATTERNS = ["burst", "sustained", "pulse", "delayed", "escalating"] as const;

/** Modificadores. Eje opcional y combinable: hasta los cuatro a la vez. */
export const MODIFIERS = ["piercing", "splitting", "homing", "unstable"] as const;

export type Element = (typeof ELEMENTS)[number];
export type Vector = (typeof VECTORS)[number];
export type Pattern = (typeof PATTERNS)[number];
export type Modifier = (typeof MODIFIERS)[number];

/**
 * Composición mecánica: lo único que ve el motor.
 *
 * La capa de expresión visual (trayectoria, color, timing visual) NO vive acá:
 * es libre y no afecta la firma. Ver §2 de `docs/diseno-adaptador-web.md`.
 */
export interface Composition {
  readonly element: Element;
  readonly vector?: Vector;
  readonly pattern?: Pattern;
  readonly modifiers?: readonly Modifier[];
}

/** Costo de un eje base (vector, patrón). */
export const BASE_AXIS_COST = 1;

/** Costo de cada modificador: el doble que un eje base (ADR 0008 §3). */
export const MODIFIER_COST = 2;

/** Milisegundos de cooldown por unidad de costo. */
export const COOLDOWN_MS_PER_COST = 500;

/** Máximo de primitivas que puede emitir una composición: elem + vec + pat + 4 mods. */
export const MAX_PRIMITIVES = 3 + MODIFIERS.length;
