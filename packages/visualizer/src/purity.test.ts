// Guardia de pureza del visualizador.
//
// La Ley §1 rige formalmente `packages/core`, pero el visualizador se la impone
// por una razón propia: **un replay que se ve distinto en cada corrida no es un
// replay**. Un `Math.random()` en la vibración o un `Date.now()` en el guion
// temporal no romperían ningún test de comportamiento — romperían la promesa de
// que el mismo log produce siempre el mismo dibujo, en silencio.
//
// El otro frente es el DOM. `tsconfig.json` habilita `lib: DOM` porque el
// adaptador de grabación lo necesita, y el `lib` no distingue archivos: a nivel
// de tipos, cualquier módulo podría escribir `document`. La frontera de verdad
// es este test.

import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL(".", import.meta.url));

/** El único módulo autorizado a tocar el entorno. Ver ADR 0007. */
const ADAPTADOR = "export/browser.ts";

/**
 * El código de un archivo, sin comentarios.
 *
 * Hace falta porque los comentarios de este paquete explican una y otra vez por
 * qué *no* se usa `Math.random()` — y una guardia que mire el texto crudo se
 * dispararía justo con la documentación de la regla que defiende.
 */
function codeOf(file: string): string {
  return readFileSync(join(SRC, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function sourceFiles(dir: string): readonly string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) return [];
    return [full];
  });
}

/** Archivos fuente del paquete, sin tests y sin el adaptador de navegador. */
const modulosPuros = sourceFiles(SRC)
  .map((file) => relative(SRC, file).replace(/\\/g, "/"))
  .filter((file) => file !== ADAPTADOR);

describe("pureza del visualizador", () => {
  it("encuentra los módulos que tiene que vigilar", () => {
    // Si el filtro se rompe y no queda nada que revisar, los tests de abajo
    // pasarían vacíos y la guardia sería decorativa.
    expect(modulosPuros.length).toBeGreaterThan(4);
    expect(modulosPuros).toContain("render/index.ts");
    expect(modulosPuros).toContain("export/timeline.ts");
  });

  it.each([
    ["Math.random", /\bMath\s*\.\s*random\b/],
    ["Date.now", /\bDate\s*\.\s*now\b/],
    ["new Date", /\bnew\s+Date\b/],
    ["performance.now", /\bperformance\s*\.\s*now\b/],
  ])("ningún módulo puro usa %s", (_nombre, patron) => {
    for (const file of modulosPuros) {
      expect(codeOf(file)).not.toMatch(patron);
    }
  });

  it.each([
    ["document", /\bdocument\s*\./],
    ["window", /\bwindow\s*\./],
    ["MediaRecorder", /\bMediaRecorder\b/],
    ["fetch", /\bfetch\s*\(/],
  ])("solo el adaptador de navegador toca %s", (_nombre, patron) => {
    for (const file of modulosPuros) {
      expect(codeOf(file)).not.toMatch(patron);
    }
  });

  // El adaptador existe y sí toca el entorno: si este test empieza a fallar, o
  // se movió el archivo o alguien "limpió" el DOM de donde tiene que estar, y
  // los tests de arriba pasarían a vigilar un conjunto vacío de riesgo real.
  it("el adaptador autorizado sigue existiendo y sigue siendo el que toca el DOM", () => {
    const fuente = codeOf(ADAPTADOR);
    expect(fuente).toMatch(/\bdocument\s*\./);
    expect(fuente).toMatch(/\bMediaRecorder\b/);
  });
});
