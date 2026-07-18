// scripts/main.ts — el CLI del harness de balance.
//
// Vive fuera de `src/` a propósito, igual que el demo del visualizador: es lo
// único que toca disco y consola. Toda la simulación es pura y se testea aparte.
//
// Se corre con Node ≥22 (`node scripts/main.ts`): el stripping de tipos nativo
// alcanza. Requiere build previo, porque importa los paquetes por su entrada pública.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { defaultPolicy } from "@beforeheadapts/core";
import {
  pureVariator,
  realisticVariator,
  renderReport,
  renderSweep,
  repeater,
  simulate,
  sweep,
  type SimulationResult,
} from "@beforeheadapts/balance-sim";

const ATTACKS = Number(process.env["ATTACKS"] ?? 200);
const SEED = Number(process.env["SEED"] ?? 20260718);

const archetypes = [repeater(), pureVariator(SEED), realisticVariator(SEED, 4)];

const results: SimulationResult[] = archetypes.map((archetype) =>
  simulate(archetype, ATTACKS),
);

console.log(renderReport(results));

const sweepRows = sweep(archetypes, ATTACKS);
console.log(renderSweep(sweepRows));

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "out");
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, "balance.json");
writeFileSync(
  outFile,
  JSON.stringify(
    {
      generatedBy: "@beforeheadapts/balance-sim",
      adr: "0008",
      attacks: ATTACKS,
      seed: SEED,
      policy: defaultPolicy,
      results,
      sweep: sweepRows,
    },
    null,
    2,
  ),
  "utf8",
);

console.log(`JSON escrito en ${outFile}\n`);
