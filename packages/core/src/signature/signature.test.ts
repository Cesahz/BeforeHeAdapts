import { describe, it, expect } from "vitest";
import fc from "fast-check";

import {
  canonicalize,
  clusterKeyOf,
  complexityOf,
  requiredExposures,
  sim,
  type StimulusSignature,
} from "./index.js";

// Tests unitarios y de propiedad de signature/. Los invariantes de las 6 reglas
// viven en contract.test.ts; acá se prueban las garantías del módulo en sí.

const primitiveArb = fc.constantFrom("fuego", "corte", "presion", "sonido", "rayo", "hielo");
const primitivesArb = fc.array(primitiveArb, { minLength: 1, maxLength: 6 });
const intensityArb = fc.double({ min: 0.01, max: 100, noNaN: true });
const signatureArb: fc.Arbitrary<StimulusSignature> = fc
  .tuple(primitivesArb, intensityArb)
  .map(([ps, i]) => canonicalize(ps, i));

describe("canonicalize", () => {
  it("ordena y deduplica las primitivas", () => {
    const s = canonicalize(["presion", "fuego", "presion"], 1);
    expect(s.primitives).toEqual(["fuego", "presion"]);
    expect(s.intensity).toBe(1);
  });

  it("es independiente del orden de construcción", () => {
    fc.assert(
      fc.property(primitivesArb, intensityArb, (ps, i) => {
        const shuffled = [...ps].reverse();
        expect(canonicalize(shuffled, i)).toEqual(canonicalize(ps, i));
      }),
    );
  });

  it("es idempotente", () => {
    fc.assert(
      fc.property(signatureArb, (s) => {
        expect(canonicalize(s.primitives, s.intensity)).toEqual(s);
      }),
    );
  });

  it("rechaza firmas inválidas en vez de tolerarlas en silencio", () => {
    expect(() => canonicalize([], 1)).toThrow(/al menos una primitiva/);
    expect(() => canonicalize([""], 1)).toThrow(/primitiva vacía/);
    expect(() => canonicalize(["fue|go"], 1)).toThrow(/separador/);
    expect(() => canonicalize(["fuego"], 0)).toThrow(/intensidad/);
    expect(() => canonicalize(["fuego"], -1)).toThrow(/intensidad/);
    expect(() => canonicalize(["fuego"], Number.NaN)).toThrow(/intensidad/);
    expect(() => canonicalize(["fuego"], Number.POSITIVE_INFINITY)).toThrow(/intensidad/);
  });
});

describe("clusterKeyOf (ADR 0002)", () => {
  it("colapsa firmas con las mismas primitivas y separa las que difieren", () => {
    expect(clusterKeyOf(canonicalize(["rapido", "fuego"], 1))).toBe("fuego|rapido");
    expect(clusterKeyOf(canonicalize(["fuego", "rapido"], 9))).toBe("fuego|rapido");
    expect(clusterKeyOf(canonicalize(["fuego"], 1))).toBe("fuego");
  });

  it("es función pura de las primitivas: la intensidad no cambia el cluster", () => {
    fc.assert(
      fc.property(primitivesArb, intensityArb, intensityArb, (ps, i1, i2) => {
        expect(clusterKeyOf(canonicalize(ps, i1))).toBe(clusterKeyOf(canonicalize(ps, i2)));
      }),
    );
  });

  it("dos firmas comparten cluster si y sólo si comparten conjunto de primitivas", () => {
    fc.assert(
      fc.property(signatureArb, signatureArb, (a, b) => {
        const mismoConjunto =
          a.primitives.length === b.primitives.length &&
          a.primitives.every((p, idx) => p === b.primitives[idx]);
        expect(clusterKeyOf(a) === clusterKeyOf(b)).toBe(mismoConjunto);
      }),
    );
  });
});

describe("requiredExposures — N(c) (R2, ADR 0002)", () => {
  it("la firma de complejidad mínima requiere exactamente 1 exposición", () => {
    expect(requiredExposures(canonicalize(["fuego"], 1))).toBe(1);
  });

  it("es lineal en la cantidad de dimensiones activas", () => {
    fc.assert(
      fc.property(signatureArb, (s) => {
        expect(requiredExposures(s)).toBe(complexityOf(s));
        expect(requiredExposures(s)).toBeGreaterThanOrEqual(1);
      }),
    );
  });

  it("es monótona creciente: agregar una dimensión nunca reduce N", () => {
    fc.assert(
      fc.property(signatureArb, primitiveArb, (base, extra) => {
        const complex = canonicalize([...base.primitives, extra], base.intensity);
        expect(requiredExposures(complex)).toBeGreaterThanOrEqual(requiredExposures(base));
      }),
    );
  });
});

describe("sim — métrica del espacio de firmas", () => {
  it("vale 1 en firmas idénticas y 0 en firmas disjuntas", () => {
    const a = canonicalize(["fuego", "rapido"], 1);
    expect(sim(a, canonicalize(["rapido", "fuego"], 5))).toBe(1);
    expect(sim(a, canonicalize(["hielo"], 1))).toBe(0);
  });

  it("es proporcional al solapamiento (Jaccard)", () => {
    const a = canonicalize(["fuego", "rapido"], 1);
    const b = canonicalize(["fuego"], 1);
    expect(sim(a, b)).toBeCloseTo(0.5); // 1 en común sobre 2 en la unión
  });

  it("es reflexiva, simétrica y acotada en [0,1]", () => {
    fc.assert(
      fc.property(signatureArb, signatureArb, (a, b) => {
        expect(sim(a, a)).toBe(1);
        expect(sim(a, b)).toBe(sim(b, a));
        expect(sim(a, b)).toBeGreaterThanOrEqual(0);
        expect(sim(a, b)).toBeLessThanOrEqual(1);
      }),
    );
  });

  it("sim = 1 equivale a compartir cluster (ADR 0002: sim no funde, transfiere)", () => {
    fc.assert(
      fc.property(signatureArb, signatureArb, (a, b) => {
        expect(sim(a, b) === 1).toBe(clusterKeyOf(a) === clusterKeyOf(b));
      }),
    );
  });

  it("ignora la intensidad: mide tipo de estímulo, no magnitud", () => {
    fc.assert(
      fc.property(primitivesArb, primitivesArb, intensityArb, intensityArb, (pa, pb, i1, i2) => {
        expect(sim(canonicalize(pa, i1), canonicalize(pb, i2))).toBe(
          sim(canonicalize(pa, 1), canonicalize(pb, 1)),
        );
      }),
    );
  });
});
