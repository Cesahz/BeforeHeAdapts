// report.ts — formateo del reporte. Puro: devuelve strings, no imprime nada.

import type { SimulationResult } from "./simulate.js";

function ms(value: number | null): string {
  if (value === null) return "nunca";
  if (value < 1000) return `${value} ms`;
  return `${(value / 1000).toFixed(1)} s`;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function bar(fraction: number, width = 24): string {
  const filled = Math.round(fraction * width);
  return "█".repeat(filled) + "·".repeat(width - filled);
}

function section(result: SimulationResult): string {
  const lines: string[] = [];
  lines.push(`── ${result.archetype} ${"─".repeat(Math.max(0, 46 - result.archetype.length))}`);
  lines.push(`   ${result.description}`);
  lines.push("");
  lines.push(`   ataques simulados      ${result.attacks}`);
  lines.push(`   tiempo del mundo       ${ms(result.elapsedMs)}`);
  lines.push(`   clusters distintos     ${result.distinctClusters}`);
  lines.push(`   adaptaciones           ${result.adaptations}`);
  lines.push(
    `   primer salto           ${ms(result.firstSnapMs)}` +
      (result.firstSnapAttack === null ? "" : ` (ataque nº ${result.firstSnapAttack})`),
  );
  lines.push(
    `   R₀ generalizada (R6)   media ${result.meanGeneralizedResistance.toFixed(4)}` +
      `   máx ${result.maxGeneralizedResistance.toFixed(4)}`,
  );
  lines.push(
    `   eff aplicada           media ${result.eff.mean.toFixed(4)}` +
      `   mediana ${result.eff.median.toFixed(4)}` +
      `   rango [${result.eff.min.toFixed(4)}, ${result.eff.max.toFixed(4)}]`,
  );
  lines.push(
    `   daño real eff×(1−R₀)   media ${result.damageMultiplier.mean.toFixed(4)}` +
      `   mediana ${result.damageMultiplier.median.toFixed(4)}`,
  );
  lines.push("");
  lines.push("   distribución del daño real eff×(1−R₀):");
  for (const bucket of result.damageMultiplier.buckets) {
    lines.push(
      `     ${bucket.label.padEnd(12)} ${bar(bucket.fraction)} ${pct(bucket.fraction).padStart(6)}` +
        `  (${bucket.count})`,
    );
  }
  return lines.join("\n");
}

/** Reporte legible en consola de todos los arquetipos. */
export function renderReport(results: readonly SimulationResult[]): string {
  const header = [
    "",
    "═══════════════════════════════════════════════════════",
    "  Simulación de balance — catálogo del ADR 0008",
    "═══════════════════════════════════════════════════════",
    "",
  ].join("\n");

  const summary = [
    "",
    "── resumen ────────────────────────────────────",
    "",
    "   arquetipo            adapt.  1er salto   eff media   R₀ media   daño real",
    ...results.map(
      (r) =>
        `   ${r.archetype.padEnd(20)} ${String(r.adaptations).padStart(5)}  ` +
        `${ms(r.firstSnapMs).padStart(9)}   ${r.eff.mean.toFixed(4).padStart(9)}   ` +
        `${r.meanGeneralizedResistance.toFixed(4).padStart(8)}   ` +
        `${r.damageMultiplier.mean.toFixed(4).padStart(9)}`,
    ),
    "",
  ].join("\n");

  return header + results.map(section).join("\n\n") + "\n" + summary;
}
