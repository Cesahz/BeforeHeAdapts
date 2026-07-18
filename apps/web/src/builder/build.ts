// build.ts — una build del jugador: composición mecánica + expresión visual.
//
// LA REGLA DURA DEL §2 DEL DISEÑO: son dos capas estrictamente separadas.
//
//   - `composition` es lo ÚNICO que ve el motor. Compila a firma canónica.
//   - `visual` es libre y no afecta la firma. Dos builds con la misma
//     composición y distinta expresión visual **son la misma firma**.
//
// Eso es lo que mantiene sano el espacio de firmas: la creatividad visual no
// crea firmas nuevas, solo las primitivas del DSL lo hacen. Si algún día un
// campo visual empezara a influir en la firma, las dos capas se habrían fundido
// y el balance dejaría de ser analizable. `build.test.ts` lo verifica con un
// property test sobre variaciones visuales arbitrarias.

import type { Composition } from "@beforeheadapts/arena-dsl";

/**
 * Versión del esquema de una build guardada.
 *
 * Mismo criterio que el campo `v` de los eventos del motor (Ley §3): las builds
 * viejas del `localStorage` de un jugador tienen que seguir cargando siempre.
 * Cuando cambie la forma, sube la versión y se agrega un migrador puro.
 */
export const BUILD_VERSION = 1 as const;

/**
 * Expresión visual. Libertad tipo editor: al motor no le importa nada de esto.
 *
 * Se guarda con la build y viaja en el código de export, pero jamás entra a
 * `toSignature`.
 */
export interface VisualExpression {
  /** Matiz del trazo, en grados. */
  readonly hue: number;
  /** Largo de la estela, en `[0, 1]`. */
  readonly trail: number;
  /** Rotación del ataque al viajar, en `[-1, 1]`. */
  readonly spin: number;
}

export interface Build {
  readonly v: typeof BUILD_VERSION;
  readonly id: string;
  readonly name: string;
  readonly composition: Composition;
  readonly visual: VisualExpression;
}

export const defaultVisual: VisualExpression = Object.freeze({ hue: 190, trail: 0.5, spin: 0 });

/**
 * Normaliza una expresión visual para que sobreviva al viaje por JSON.
 *
 * El único caso que importa hoy es **`-0`**: `JSON.stringify(-0)` produce `"0"`,
 * así que un `spin: -0` vuelve del código de import como `+0` y el roundtrip
 * deja de ser una identidad. Un giro negativo cero no significa nada distinto de
 * un giro cero, así que se colapsan en el borde en vez de arrastrar la
 * asimetría. Lo encontró un property test, no una revisión a ojo.
 *
 * Mismo criterio que `svgNumber` en el visualizador, que normaliza `-0` para
 * que el SVG sea comparable byte a byte.
 */
export function normalizeVisual(visual: VisualExpression): VisualExpression {
  // `x === 0` es true tanto para `+0` como para `-0`; sumar 0 los colapsa.
  return {
    hue: visual.hue === 0 ? 0 : visual.hue,
    trail: visual.trail === 0 ? 0 : visual.trail,
    spin: visual.spin === 0 ? 0 : visual.spin,
  };
}

/** Build nueva con expresión visual por defecto. */
export function makeBuild(id: string, name: string, composition: Composition): Build {
  return { v: BUILD_VERSION, id, name, composition, visual: defaultVisual };
}

/** Build con expresión visual explícita, normalizada en el borde. */
export function withVisual(build: Build, visual: VisualExpression): Build {
  return { ...build, visual: normalizeVisual(visual) };
}

/**
 * Valida la forma de una build que viene de afuera.
 *
 * Las builds entran por `localStorage` y por códigos que un jugador le pasa a
 * otro, o sea desde fuera del sistema de tipos. Se valida la estructura acá; la
 * validez de la composición contra el catálogo la comprueba `toSignature`.
 */
export function isBuildShape(value: unknown): value is Build {
  if (typeof value !== "object" || value === null) return false;
  const b = value as Partial<Build>;
  return (
    b.v === BUILD_VERSION &&
    typeof b.id === "string" &&
    typeof b.name === "string" &&
    typeof b.composition === "object" &&
    b.composition !== null &&
    typeof b.visual === "object" &&
    b.visual !== null &&
    typeof b.visual.hue === "number" &&
    typeof b.visual.trail === "number" &&
    typeof b.visual.spin === "number"
  );
}
