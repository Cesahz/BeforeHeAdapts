// Guardia de pureza del reconocedor de gestos.
//
// `apps/web` es un adaptador y casi todo en él toca el DOM — pero el
// reconocedor NO puede. El ADR 0009 §6 lo deja en `apps/web/src/gesture/` en vez
// de en un paquete propio por proporción (son ~200 líneas y sería el sexto
// paquete del repo), y descarta el límite de paquete a cambio de esta guardia.
// O sea: este archivo es lo que el ADR prometió a cambio. Si desaparece,
// desaparece el enforcement.
//
// Por qué importa que sea puro:
//
//   - Un `Date.now()` adentro haría que el mismo trazo se clasifique distinto
//     según cuándo se dibujó, y el gesto es la puerta de entrada al log
//     append-only (ADR 0004). Un log irreproducible no es un log.
//   - Un `Math.random()` convertiría un rechazo en una firma inventada de vez
//     en cuando: exactamente lo que el ADR 0009 §1 prohíbe.
//   - El tiempo entra como DATO (`GesturePoint.t`), no se lee del entorno. Esa
//     es la misma disciplina que la Ley §1 le impone al núcleo.
//
// `balance.ts` entra en la vigilancia aunque viva en `arena/`: son constantes,
// y una constante que se lea del entorno deja de ser una constante.

import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const SRC = join(HERE, "..");

/** Módulos que se exigen puros, relativos a `src/`. */
const VIGILADOS: readonly string[] = [
  ...readdirSync(HERE)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => `gesture/${f}`),
  "arena/balance.ts",
];

/**
 * El código de un archivo, sin comentarios.
 *
 * Los comentarios de estos módulos explican una y otra vez por qué *no* se usa
 * `Math.random()`; una guardia sobre el texto crudo se dispararía justo con la
 * documentación de la regla que defiende.
 */
function codeOf(file: string): string {
  return readFileSync(join(SRC, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("pureza del reconocedor de gestos", () => {
  it("encuentra los módulos que tiene que vigilar", () => {
    // Sin esto, un filtro roto dejaría los tests de abajo pasando en vacío y la
    // guardia sería decorativa.
    expect(VIGILADOS).toContain("gesture/recognize.ts");
    expect(VIGILADOS).toContain("arena/balance.ts");
    expect(VIGILADOS.length).toBeGreaterThanOrEqual(2);
  });

  it.each([
    ["Math.random", /\bMath\s*\.\s*random\b/],
    ["Date.now", /\bDate\s*\.\s*now\b/],
    ["new Date", /\bnew\s+Date\b/],
    ["performance.now", /\bperformance\s*\.\s*now\b/],
  ])("ningún módulo vigilado usa %s", (_nombre, patron) => {
    for (const file of VIGILADOS) expect(codeOf(file)).not.toMatch(patron);
  });

  it.each([
    ["document", /\bdocument\s*\./],
    ["window", /\bwindow\s*\./],
    ["localStorage", /\blocalStorage\b/],
    ["addEventListener", /\baddEventListener\b/],
    ["PointerEvent", /\bPointerEvent\b/],
    ["MouseEvent", /\bMouseEvent\b/],
  ])("ningún módulo vigilado toca %s", (_nombre, patron) => {
    for (const file of VIGILADOS) expect(codeOf(file)).not.toMatch(patron);
  });

  it("el reconocedor recibe el tiempo como dato y no lo lee del entorno", () => {
    // La contracara positiva de la guardia: que no lea el reloj es la mitad;
    // la otra mitad es que el tiempo SÍ entre, porque dos de los cuatro gestos
    // (`hold` y `straight`) son distinciones temporales.
    expect(codeOf("gesture/recognize.ts")).toMatch(/readonly t:\s*number/);
  });
});
