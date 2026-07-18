// translate.ts — `StimulusTranslator`: composición del DSL → firma canónica.
//
// Es la única puerta por la que la arena le habla al motor. Puro y determinista:
// la misma composición produce siempre la misma firma, sin importar el orden en
// que el jugador seleccionó los valores ni cómo se vea el ataque en pantalla.
//
// Ver ADR 0008 §2 (canonicalización) y §3 (economía).

import { canonicalize, type StimulusSignature } from "@beforeheadapts/core";

import {
  AXIS_PREFIX,
  BASE_AXIS_COST,
  COOLDOWN_MS_PER_COST,
  ELEMENTS,
  MODIFIERS,
  MODIFIER_COST,
  PATTERNS,
  VECTORS,
  type Composition,
  type Modifier,
} from "./catalog.js";

/** Modificadores deduplicados, en el orden del catálogo. Base de `cost` y de las primitivas. */
function uniqueModifiers(composition: Composition): readonly Modifier[] {
  const selected = new Set(composition.modifiers ?? []);
  return MODIFIERS.filter((m) => selected.has(m));
}

/**
 * Costo de la composición (ADR 0008 §3): `1 + vec + pat + 2 × |modificadores|`.
 *
 * Rango 1…11. Es a la vez la intensidad de la firma y la base del cooldown: en
 * la Fase 3a la única moneda es el tiempo.
 */
export function costOf(composition: Composition): number {
  validate(composition);
  return (
    1 +
    (composition.vector === undefined ? 0 : BASE_AXIS_COST) +
    (composition.pattern === undefined ? 0 : BASE_AXIS_COST) +
    MODIFIER_COST * uniqueModifiers(composition).length
  );
}

/** Cooldown en milisegundos: `500 ms × cost`. */
export function cooldownOf(composition: Composition): number {
  return COOLDOWN_MS_PER_COST * costOf(composition);
}

/**
 * Traduce una composición a su firma canónica.
 *
 * Una primitiva por valor seleccionado, prefijada con el código de su eje. El
 * `canonicalize` del núcleo se encarga de ordenar y deduplicar, así que el orden
 * en que se arma este arreglo no importa para la identidad de la firma.
 */
export function toSignature(composition: Composition): StimulusSignature {
  const cost = costOf(composition);
  const primitives: string[] = [AXIS_PREFIX.element + composition.element];
  if (composition.vector !== undefined) {
    primitives.push(AXIS_PREFIX.vector + composition.vector);
  }
  if (composition.pattern !== undefined) {
    primitives.push(AXIS_PREFIX.pattern + composition.pattern);
  }
  for (const modifier of uniqueModifiers(composition)) {
    primitives.push(AXIS_PREFIX.modifier + modifier);
  }
  return canonicalize(primitives, cost);
}

/**
 * Valida que todos los valores pertenezcan al catálogo.
 *
 * No es paranoia: las composiciones entran por `localStorage` y por códigos de
 * import compartidos entre jugadores (§3 del diseño), o sea desde fuera del
 * sistema de tipos. Una composición inválida es un error del borde, y se
 * rechaza acá antes de que llegue a ensuciar un log append-only.
 */
export function validate(composition: Composition): void {
  if (!(ELEMENTS as readonly string[]).includes(composition.element)) {
    throw new Error(`composición inválida: elemento desconocido "${composition.element}"`);
  }
  if (
    composition.vector !== undefined &&
    !(VECTORS as readonly string[]).includes(composition.vector)
  ) {
    throw new Error(`composición inválida: vector desconocido "${composition.vector}"`);
  }
  if (
    composition.pattern !== undefined &&
    !(PATTERNS as readonly string[]).includes(composition.pattern)
  ) {
    throw new Error(`composición inválida: patrón desconocido "${composition.pattern}"`);
  }
  for (const modifier of composition.modifiers ?? []) {
    if (!(MODIFIERS as readonly string[]).includes(modifier)) {
      throw new Error(`composición inválida: modificador desconocido "${modifier}"`);
    }
  }
}
