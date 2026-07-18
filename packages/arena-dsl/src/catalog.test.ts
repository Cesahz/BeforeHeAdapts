import { describe, expect, it } from "vitest";

import {
  AXIS_PREFIX,
  ELEMENTS,
  MAX_PRIMITIVES,
  MODIFIERS,
  PATTERNS,
  VECTORS,
} from "./catalog.js";

/**
 * La propiedad que sostiene toda la decisión de `weaknessOf` del ADR 0008 §4.
 *
 * El núcleo elige como debilidad la primera primitiva en orden canónico
 * (alfabético). Para que esa primera primitiva sea SIEMPRE el elemento, cada
 * primitiva de elemento tiene que preceder lexicográficamente a toda primitiva
 * de cualquier otro eje — no basta con que `"elem:" < "mod:"` en abstracto,
 * porque lo que se ordena son los strings completos con su valor pegado.
 *
 * Es un test estructural sobre el catálogo entero: si alguien agrega un eje con
 * un prefijo alfabéticamente anterior a `elem:`, o renombra un prefijo, falla acá.
 */
describe("orden de prefijos (regla de weaknessOf)", () => {
  const elementPrimitives = ELEMENTS.map((v) => AXIS_PREFIX.element + v);
  const otherPrimitives = [
    ...VECTORS.map((v) => AXIS_PREFIX.vector + v),
    ...PATTERNS.map((v) => AXIS_PREFIX.pattern + v),
    ...MODIFIERS.map((v) => AXIS_PREFIX.modifier + v),
  ];

  it("toda primitiva de elemento precede a toda primitiva de otro eje", () => {
    for (const element of elementPrimitives) {
      for (const other of otherPrimitives) {
        expect(
          element < other,
          `"${element}" debería preceder a "${other}" en orden lexicográfico`,
        ).toBe(true);
      }
    }
  });

  it("el elemento sigue primero al ordenar el catálogo completo mezclado", () => {
    const sorted = [...otherPrimitives, ...elementPrimitives].sort();
    expect(sorted.slice(0, ELEMENTS.length)).toEqual([...elementPrimitives].sort());
  });
});

describe("integridad del catálogo", () => {
  it("ninguna primitiva contiene el separador de cluster del núcleo", () => {
    const all = [
      ...ELEMENTS.map((v) => AXIS_PREFIX.element + v),
      ...VECTORS.map((v) => AXIS_PREFIX.vector + v),
      ...PATTERNS.map((v) => AXIS_PREFIX.pattern + v),
      ...MODIFIERS.map((v) => AXIS_PREFIX.modifier + v),
    ];
    for (const primitive of all) {
      expect(primitive).not.toContain("|");
    }
  });

  it("no hay valores duplicados dentro de un eje", () => {
    for (const axis of [ELEMENTS, VECTORS, PATTERNS, MODIFIERS]) {
      expect(new Set(axis).size).toBe(axis.length);
    }
  });

  it("las cardinalidades son las que fija el ADR 0008", () => {
    expect(ELEMENTS.length).toBe(8);
    expect(VECTORS.length).toBe(6);
    expect(PATTERNS.length).toBe(5);
    expect(MODIFIERS.length).toBe(4);
    expect(MAX_PRIMITIVES).toBe(7);
  });
});
