// simulate.ts — corre un arquetipo contra un ente y mide qué pasó.
//
// Puro: no toca disco ni reloj. El tiempo del mundo simulado sale enteramente de
// la economía del ADR 0008 (cooldown por build + hueco global), y entra al motor
// como dato en cada `process()`, igual que lo hará la arena de verdad.

import {
  clusterKeyOf,
  createInitialState,
  generalizedInitialResistance,
  process as expose,
  requiredExposures,
  type EngineState,
  type PolicyInput,
} from "@beforeheadapts/core";
import { cooldownOf, toSignature, type Composition } from "@beforeheadapts/arena-dsl";

import type { Archetype } from "./archetypes.js";

/**
 * Hueco mínimo entre dos ataques cualesquiera, sea cual sea la build.
 *
 * Sin esto el variador puro atacaría infinitas veces en el instante 0: como cada
 * ataque suyo es una build nueva, ningún cooldown propio lo frena nunca. Es el
 * equivalente al tiempo que le lleva al jugador apuntar y lanzar, y equivale al
 * cooldown de la build más barata del catálogo (costo 1).
 */
export const GLOBAL_GAP_MS = 500;

export interface SimulationResult {
  readonly archetype: string;
  readonly description: string;
  readonly attacks: number;
  /** Duración total del mundo simulado, en milisegundos. */
  readonly elapsedMs: number;
  /** Cantidad de `AdaptationCompleted` emitidos. */
  readonly adaptations: number;
  /** Instante del primer salto, o `null` si el ente nunca adaptó nada. */
  readonly firstSnapMs: number | null;
  /** Ataques que hicieron falta hasta el primer salto, o `null`. */
  readonly firstSnapAttack: number | null;
  /** Clusters distintos que el jugador tocó al menos una vez. */
  readonly distinctClusters: number;
  /** Promedio de `R₀(s)` (R6) leído antes de cada ataque. */
  readonly meanGeneralizedResistance: number;
  /** Máximo de `R₀(s)` observado. */
  readonly maxGeneralizedResistance: number;
  /** Estadística de los `effApplied` que el motor grabó en el log. Solo R5. */
  readonly eff: EffStats;
  /**
   * Estadística del multiplicador de daño REAL que verá la arena.
   *
   * El motor no combina R5 con R6: `effApplied` sale solo de la curva `eff(k)`,
   * y `R₀(s)` se expone como selector aparte para que el dominio lo aplique.
   * O sea que ninguna de las dos métricas por separado dice cuánto pega un
   * ataque — la que importa es `eff(k) × (1 − R₀(s))`, que es como la arena va a
   * calcular el daño. Medir solo `eff` sobreestima al jugador que varía.
   */
  readonly damageMultiplier: EffStats;
}

export interface EffStats {
  readonly mean: number;
  readonly median: number;
  readonly min: number;
  readonly max: number;
  /** Fracción de ataques en cada tramo de eficacia. */
  readonly buckets: readonly EffBucket[];
}

export interface EffBucket {
  readonly label: string;
  readonly lo: number;
  readonly hi: number;
  readonly count: number;
  readonly fraction: number;
}

const BUCKET_EDGES = [0, 0.05, 0.1, 0.25, 0.5, 0.75, 1.0001] as const;

function bucketize(values: readonly number[]): EffBucket[] {
  const buckets: EffBucket[] = [];
  for (let i = 0; i < BUCKET_EDGES.length - 1; i++) {
    const lo = BUCKET_EDGES[i]!;
    const hi = BUCKET_EDGES[i + 1]!;
    const count = values.filter((v) => v >= lo && v < hi).length;
    buckets.push({
      label: `${lo.toFixed(2)}–${Math.min(hi, 1).toFixed(2)}`,
      lo,
      hi,
      count,
      fraction: values.length === 0 ? 0 : count / values.length,
    });
  }
  return buckets;
}

function statsOf(values: readonly number[]): EffStats {
  if (values.length === 0) {
    return { mean: 0, median: 0, min: 0, max: 0, buckets: bucketize(values) };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? ((sorted[mid - 1]! + sorted[mid]!) / 2) : sorted[mid]!;
  return {
    mean: values.reduce((a, b) => a + b, 0) / values.length,
    median,
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
    buckets: bucketize(values),
  };
}

/** Clave estable de una build para llevarle el cooldown. */
function buildKey(composition: Composition): string {
  return clusterKeyOf(toSignature(composition));
}

/**
 * Simula `attacks` ataques de un arquetipo contra un ente recién creado.
 *
 * El estado del ente sale enteramente del motor: acá no se calcula ni se guarda
 * nada derivado. Las métricas se leen con los selectores públicos del núcleo y
 * con los eventos que `process()` emite.
 */
export function simulate(
  archetype: Archetype,
  attacks: number,
  config: PolicyInput = {},
): SimulationResult {
  let state: EngineState = createInitialState(config, `sim-${archetype.name}`);
  const readyAt = new Map<string, number>();
  const effApplied: number[] = [];
  const damage: number[] = [];
  const generalized: number[] = [];
  const touched = new Set<string>();

  let now = 0;
  let lastAttackAt = -GLOBAL_GAP_MS;
  let adaptations = 0;
  let firstSnapMs: number | null = null;
  let firstSnapAttack: number | null = null;

  for (let i = 0; i < attacks; i++) {
    const composition = archetype.next(i);
    const key = buildKey(composition);
    const signature = toSignature(composition);

    // El CUÁNDO: la build tiene que estar fuera de cooldown y hay que respetar
    // el hueco global. El jugador espera lo que haga falta.
    now = Math.max(lastAttackAt + GLOBAL_GAP_MS, readyAt.get(key) ?? 0);

    // R6 se lee ANTES de exponer: es la resistencia que la firma hereda por
    // parecerse a lo que el ente ya adaptó, no la que tendrá después.
    const r0 = generalizedInitialResistance(state, signature);
    generalized.push(r0);

    const result = expose(state, signature, now);
    state = result.state;

    for (const event of result.events) {
      if (event.type === "ResistanceApplied") {
        effApplied.push(event.effApplied);
        damage.push(event.effApplied * (1 - r0));
      }
      if (event.type === "AdaptationCompleted") {
        adaptations++;
        if (firstSnapMs === null) {
          firstSnapMs = now;
          firstSnapAttack = i + 1;
        }
      }
    }

    touched.add(key);
    readyAt.set(key, now + cooldownOf(composition));
    lastAttackAt = now;
  }

  return {
    archetype: archetype.name,
    description: archetype.description,
    attacks,
    elapsedMs: now,
    adaptations,
    firstSnapMs,
    firstSnapAttack,
    distinctClusters: touched.size,
    meanGeneralizedResistance:
      generalized.length === 0 ? 0 : generalized.reduce((a, b) => a + b, 0) / generalized.length,
    maxGeneralizedResistance: generalized.length === 0 ? 0 : Math.max(...generalized),
    eff: statsOf(effApplied),
    damageMultiplier: statsOf(damage),
  };
}

/** `N(c)` de una composición, expuesto para el reporte. */
export function exposuresFor(composition: Composition): number {
  return requiredExposures(toSignature(composition));
}
