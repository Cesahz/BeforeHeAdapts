// archetypes.ts — los tres perfiles de jugador que se simulan.
//
// Cada arquetipo solo decide QUÉ compone en su ataque número `i`. El CUÁNDO lo
// resuelve el simulador con la economía del ADR 0008: cooldown por build más un
// hueco global mínimo. Esa separación es la que hace que los arquetipos se
// diferencien solos — el repetidor se come el cooldown completo de su única
// build, el variador puro nunca lo paga porque cada ataque es una build nueva.

import {
  ELEMENTS,
  MODIFIERS,
  PATTERNS,
  VECTORS,
  type Composition,
  type Modifier,
} from "@beforeheadapts/arena-dsl";

import { makeRng, pick } from "./rng.js";

export interface Archetype {
  readonly name: string;
  readonly description: string;
  /** Composición del ataque número `index` (0-based). */
  next(index: number): Composition;
}

/** Enumera el espacio completo de composiciones del catálogo: 8 × 7 × 6 × 16 = 5.376. */
export function allCompositions(): Composition[] {
  const out: Composition[] = [];
  const modifierSubsets: Modifier[][] = [];
  for (let mask = 0; mask < 1 << MODIFIERS.length; mask++) {
    modifierSubsets.push(MODIFIERS.filter((_, i) => (mask & (1 << i)) !== 0));
  }
  for (const element of ELEMENTS) {
    for (const vector of [undefined, ...VECTORS]) {
      for (const pattern of [undefined, ...PATTERNS]) {
        for (const modifiers of modifierSubsets) {
          out.push({
            element,
            modifiers,
            ...(vector === undefined ? {} : { vector }),
            ...(pattern === undefined ? {} : { pattern }),
          });
        }
      }
    }
  }
  return out;
}

/** Baraja determinista (Fisher-Yates con RNG sembrado). */
function shuffled<T>(items: readonly T[], seed: number): T[] {
  const rng = makeRng(seed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * Repetidor: una sola build, spameada para siempre.
 *
 * Usa la composición máxima (7 primitivas) por ser la que más exposiciones
 * aguanta antes del salto. Es el jugador que el ente debería castigar más rápido.
 */
export function repeater(): Archetype {
  const build: Composition = {
    element: "ember",
    vector: "beam",
    pattern: "pulse",
    modifiers: [...MODIFIERS],
  };
  return {
    name: "repetidor",
    description: "spamea una única build máxima (7 primitivas, cooldown 5,5 s)",
    next: () => build,
  };
}

/**
 * Variador puro: nunca repite una composición.
 *
 * Recorre el espacio completo barajado. Es el caso límite del riesgo de
 * granularidad que marca el ADR 0002: con identidad de cluster exacta, un
 * jugador así podría no ver adaptarse al ente jamás.
 */
export function pureVariator(seed: number): Archetype {
  const space = shuffled(allCompositions(), seed);
  return {
    name: "variador-puro",
    description: `nunca repite composición (recorre las ${space.length} del catálogo)`,
    next: (index) => {
      const composition = space[index % space.length];
      if (composition === undefined) throw new Error("espacio de composiciones vacío");
      return composition;
    },
  };
}

/**
 * Variador realista: rota entre 3-5 builds.
 *
 * El jugador que de verdad va a existir: tiene un puñado de builds favoritas y
 * las alterna. La rotación es round-robin, así que el simulador solo lo hace
 * esperar cuando la rotación vuelve a una build todavía en cooldown.
 */
export function realisticVariator(seed: number, buildCount = 4): Archetype {
  if (buildCount < 3 || buildCount > 5) {
    throw new Error("el variador realista rota entre 3 y 5 builds");
  }
  const rng = makeRng(seed);
  const builds: Composition[] = [];
  for (let i = 0; i < buildCount; i++) {
    const modifiers = MODIFIERS.filter(() => rng() < 0.4);
    builds.push({
      element: pick(rng, ELEMENTS),
      modifiers,
      ...(rng() < 0.8 ? { vector: pick(rng, VECTORS) } : {}),
      ...(rng() < 0.8 ? { pattern: pick(rng, PATTERNS) } : {}),
    });
  }
  return {
    name: "variador-realista",
    description: `rota ${buildCount} builds respetando cooldowns`,
    next: (index) => builds[index % builds.length]!,
  };
}
