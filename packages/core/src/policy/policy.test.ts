import { describe, it, expect } from "vitest";
import fc from "fast-check";

import { canonicalize } from "../signature/index.js";
import {
  adaptedResistance,
  confidenceAt,
  defaultPolicy,
  effectiveness,
  generalizedResistance,
  resolvePolicy,
  type CurveConfig,
} from "./index.js";

// Tests unitarios y de propiedad de policy/. Las 6 reglas se verifican de punta
// a punta en contract.test.ts; acá se prueban las garantías de cada fórmula.

const curveArb: fc.Arbitrary<CurveConfig> = fc
  .tuple(
    fc.double({ min: 0.5, max: 100, noNaN: true }), // base
    fc.double({ min: 0.05, max: 0.95, noNaN: true }), // r
    fc.double({ min: 0.001, max: 0.4, noNaN: true }), // fracción del piso sobre base
  )
  .map(([base, r, floorRatio]) => ({ base, r, asymptote: base * floorRatio }));

/** Curvas no degeneradas: lejos de la saturación numérica en el rango probado. */
const sanaCurveArb: fc.Arbitrary<CurveConfig> = fc
  .tuple(
    fc.double({ min: 0.5, max: 100, noNaN: true }),
    fc.double({ min: 0.3, max: 0.95, noNaN: true }),
    fc.double({ min: 0.001, max: 0.4, noNaN: true }),
  )
  .map(([base, r, floorRatio]) => ({ base, r, asymptote: base * floorRatio }));

const kArb = fc.integer({ min: 0, max: 60 });

describe("resolvePolicy", () => {
  it("completa con los defaults y deja la config congelada", () => {
    const p = resolvePolicy({ memory: "decaimiento" });
    expect(p.memory).toBe("decaimiento");
    expect(p.curve).toEqual(defaultPolicy.curve);
    expect(p.generalizationRadius).toBe(defaultPolicy.generalizationRadius);
    expect(() => ((p as { memory: string }).memory = "permanente")).toThrow();
  });

  it("permite sobrescribir la curva parcialmente", () => {
    const p = resolvePolicy({ curve: { r: 0.8 } });
    expect(p.curve).toEqual({ base: 1, r: 0.8, asymptote: 0.01 });
  });

  it("el piso por defecto es el extremo bajo de la convención (ADR 0003)", () => {
    expect(defaultPolicy.curve.asymptote).toBe(0.01);
  });

  it("rechaza curvas que violarían R5 en vez de absorberlas", () => {
    expect(() => resolvePolicy({ curve: { asymptote: 0 } })).toThrow(/nunca interruptor/);
    expect(() => resolvePolicy({ curve: { asymptote: -1 } })).toThrow(/nunca interruptor/);
    expect(() => resolvePolicy({ curve: { asymptote: 1, base: 1 } })).toThrow(/menor que curve.base/);
    expect(() => resolvePolicy({ curve: { r: 1 } })).toThrow(/\(0, 1\)/);
    expect(() => resolvePolicy({ curve: { r: 0 } })).toThrow(/\(0, 1\)/);
    expect(() => resolvePolicy({ curve: { base: 0 } })).toThrow(/finito positivo/);
  });

  it("rechaza radio y vida media fuera de rango", () => {
    expect(() => resolvePolicy({ generalizationRadius: 1.5 })).toThrow(/\[0, 1\]/);
    expect(() => resolvePolicy({ generalizationRadius: -0.1 })).toThrow(/\[0, 1\]/);
    expect(() => resolvePolicy({ confidenceHalfLife: 0 })).toThrow(/finito positivo/);
  });
});

describe("effectiveness — la curva de R5", () => {
  it("eff(0) es exactamente base", () => {
    fc.assert(
      fc.property(curveArb, (curve) => {
        expect(effectiveness(curve, 0)).toBeCloseTo(curve.base, 10);
      }),
    );
  });

  it("es estrictamente decreciente en el régimen que le importa al contrato", () => {
    // R5 solo exige decrecimiento estricto para k < N(c), y N(c) = cantidad de
    // primitivas (ADR 0002): en la práctica, k de un dígito. Se prueba con
    // holgura hasta k = 30 y curvas no degeneradas.
    fc.assert(
      fc.property(sanaCurveArb, fc.integer({ min: 0, max: 30 }), (curve, k) => {
        expect(effectiveness(curve, k + 1)).toBeLessThan(effectiveness(curve, k));
      }),
    );
  });

  it("es no creciente para cualquier k, incluso donde satura numéricamente", () => {
    // En k grande, (base − asymptote)·r^k cae bajo el epsilon relativo de
    // asymptote y la suma en coma flotante devuelve el piso exacto: ahí la curva
    // se aplana. Es un límite del double, no de la fórmula.
    fc.assert(
      fc.property(curveArb, kArb, (curve, k) => {
        expect(effectiveness(curve, k + 1)).toBeLessThanOrEqual(effectiveness(curve, k));
      }),
    );
  });

  it("nunca baja del piso: eff(k) ≥ asymptote > 0 para todo k", () => {
    fc.assert(
      fc.property(curveArb, kArb, (curve, k) => {
        expect(effectiveness(curve, k)).toBeGreaterThanOrEqual(curve.asymptote);
        expect(effectiveness(curve, k)).toBeGreaterThan(0);
      }),
    );
  });

  it("tiende al piso, no a cero (ADR 0003)", () => {
    const curve = defaultPolicy.curve;
    expect(effectiveness(curve, 400)).toBeCloseTo(curve.asymptote, 12);
    expect(effectiveness(curve, 400)).toBeGreaterThan(0);
  });

  it("valores concretos con la curva por defecto", () => {
    const curve = defaultPolicy.curve; // base 1, r 0.5, piso 0.01
    expect(effectiveness(curve, 0)).toBeCloseTo(1, 12);
    expect(effectiveness(curve, 1)).toBeCloseTo(0.505, 12);
    expect(effectiveness(curve, 2)).toBeCloseTo(0.2575, 12);
  });

  it("rechaza k inválido", () => {
    expect(() => effectiveness(defaultPolicy.curve, -1)).toThrow(/entero ≥ 0/);
    expect(() => effectiveness(defaultPolicy.curve, 1.5)).toThrow(/entero ≥ 0/);
  });
});

describe("adaptedResistance — el salto de R1", () => {
  it("queda en (0, 1): nunca hay inmunidad total", () => {
    fc.assert(
      fc.property(curveArb, (curve) => {
        const rest = adaptedResistance(curve);
        expect(rest).toBeGreaterThan(0);
        expect(rest).toBeLessThan(1);
      }),
    );
  });

  it("con la curva por defecto bloquea el 99% del estímulo", () => {
    expect(adaptedResistance(defaultPolicy.curve)).toBeCloseTo(0.99, 12);
  });

  it("un piso más alto deja un ente más blando", () => {
    const blando = resolvePolicy({ curve: { asymptote: 0.05 } });
    expect(adaptedResistance(blando.curve)).toBeLessThan(adaptedResistance(defaultPolicy.curve));
  });
});

describe("confidenceAt — decaimiento de R4", () => {
  const decaimiento = resolvePolicy({ memory: "decaimiento", confidenceHalfLife: 10 });

  it("las políticas sin decaimiento mantienen la confianza en 1", () => {
    for (const memory of ["permanente", "por-sesion"] as const) {
      const p = resolvePolicy({ memory });
      expect(confidenceAt(p, 0)).toBe(1);
      expect(confidenceAt(p, 10_000)).toBe(1);
    }
  });

  it("arranca en 1 y cae a la mitad en cada vida media", () => {
    expect(confidenceAt(decaimiento, 0)).toBe(1);
    expect(confidenceAt(decaimiento, 10)).toBeCloseTo(0.5, 12);
    expect(confidenceAt(decaimiento, 20)).toBeCloseTo(0.25, 12);
  });

  it("es estrictamente decreciente y siempre positiva", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1000, noNaN: true }), (elapsed) => {
        const antes = confidenceAt(decaimiento, elapsed);
        const despues = confidenceAt(decaimiento, elapsed + 1);
        expect(despues).toBeLessThan(antes);
        expect(despues).toBeGreaterThan(0);
        expect(antes).toBeLessThanOrEqual(1);
      }),
    );
  });

  it("rechaza tiempo negativo", () => {
    expect(() => confidenceAt(decaimiento, -1)).toThrow(/≥ 0/);
  });
});

describe("generalizedResistance — R6", () => {
  const config = resolvePolicy({ generalizationRadius: 0.5 });
  const fuegoRapido = canonicalize(["fuego", "rapido"], 1);
  const adapted = [{ signature: fuegoRapido, transfer: 0.9 }];

  it("una firma idéntica hereda la transferencia completa", () => {
    const twin = canonicalize(["rapido", "fuego"], 3);
    expect(generalizedResistance(config, twin, adapted)).toBeCloseTo(0.9, 12);
  });

  it("una firma totalmente disímil no hereda nada", () => {
    expect(generalizedResistance(config, canonicalize(["hielo"], 1), adapted)).toBe(0);
  });

  it("sin clusters adaptados no hay nada que heredar", () => {
    expect(generalizedResistance(config, fuegoRapido, [])).toBe(0);
  });

  it("el radio corta la transferencia de los clusters lejanos", () => {
    // sim([fuego] , [fuego,rapido]) = 1/2 = 0.5
    const media = canonicalize(["fuego"], 1);
    expect(generalizedResistance(config, media, adapted)).toBeCloseTo(0.45, 12);

    const estricto = resolvePolicy({ generalizationRadius: 0.75 });
    expect(generalizedResistance(estricto, media, adapted)).toBe(0);
  });

  it("toma el máximo entre clusters, nunca la suma", () => {
    const varios = [
      { signature: fuegoRapido, transfer: 0.4 },
      { signature: canonicalize(["fuego", "rapido", "presion"], 1), transfer: 0.9 },
    ];
    // sim con el segundo = 2/3 ≈ 0.667 ⇒ 0.6; con el primero = 1 ⇒ 0.4.
    expect(generalizedResistance(config, fuegoRapido, varios)).toBeCloseTo(0.6, 12);
  });

  it("nunca devuelve más que la mayor transferencia disponible", () => {
    const signatureArb = fc
      .uniqueArray(fc.constantFrom("fuego", "rapido", "presion", "hielo"), {
        minLength: 1,
        maxLength: 4,
      })
      .map((ps) => canonicalize(ps, 1));

    fc.assert(
      fc.property(
        signatureArb,
        fc.array(fc.tuple(signatureArb, fc.double({ min: 0, max: 1, noNaN: true })), {
          maxLength: 5,
        }),
        (s, pares) => {
          const clusters = pares.map(([signature, transfer]) => ({ signature, transfer }));
          const r0 = generalizedResistance(config, s, clusters);
          const maxTransfer = clusters.reduce((m, c) => Math.max(m, c.transfer), 0);
          expect(r0).toBeGreaterThanOrEqual(0);
          expect(r0).toBeLessThanOrEqual(maxTransfer);
        },
      ),
    );
  });
});
