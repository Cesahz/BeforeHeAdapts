// sweep.ts — barrido de `generalizationRadius` sobre los arquetipos.
//
// La primera corrida del harness mostró un colapso bimodal: el variador puro
// deja al ente en eff = 1.0 y R₀ = 0.0 (ciego total), mientras el variador
// realista queda clavado en el piso de eff a los pocos segundos. El sospechoso
// es R6: con `generalizationRadius = 0.5` (default) y firmas de hasta 7
// primitivas, dos composiciones distintas casi nunca alcanzan Jaccard ≥ 0.5, así
// que la transferencia entre clusters nunca se activa y adaptar deja de servir.
//
// Este barrido mide exactamente eso: cuánto mueve el radio la aguja, sin tocar
// el núcleo ni el catálogo. Es config de `policy`, el dial más barato disponible.

import type { Archetype } from "./archetypes.js";
import { simulate, type SimulationResult } from "./simulate.js";

export interface SweepRow {
  readonly radius: number;
  readonly results: readonly SimulationResult[];
}

/** Radios a probar. 0.5 es el default actual del núcleo. */
export const SWEEP_RADII = [0.5, 0.35, 0.25, 0.15, 0.05] as const;

export function sweep(
  archetypes: readonly Archetype[],
  attacks: number,
  radii: readonly number[] = SWEEP_RADII,
): SweepRow[] {
  return radii.map((radius) => ({
    radius,
    results: archetypes.map((a) => simulate(a, attacks, { generalizationRadius: radius })),
  }));
}

/** Tabla compacta: cómo se mueven eff media y R₀ media con el radio. */
export function renderSweep(rows: readonly SweepRow[]): string {
  const lines: string[] = [
    "",
    "── barrido de generalizationRadius (R6) ───────────────",
    "",
    "   El radio es config de policy: mover esto NO toca el núcleo ni el catálogo.",
    "",
  ];

  const names = rows[0]?.results.map((r) => r.archetype) ?? [];
  for (const name of names) {
    lines.push(`   ${name}`);
    lines.push("     radio    R₀ media    daño real    adaptaciones");
    for (const row of rows) {
      const result = row.results.find((r) => r.archetype === name);
      if (result === undefined) continue;
      lines.push(
        `     ${row.radius.toFixed(2).padStart(5)}   ` +
          `${result.meanGeneralizedResistance.toFixed(4).padStart(8)}   ` +
          `${result.damageMultiplier.mean.toFixed(4).padStart(9)}   ` +
          `${String(result.adaptations).padStart(11)}`,
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}
