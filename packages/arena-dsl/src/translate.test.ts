import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  clusterKeyOf,
  createInitialState,
  process as expose,
  requiredExposures,
  type AdaptationCompleted,
} from "@beforeheadapts/core";

import {
  AXIS_PREFIX,
  COOLDOWN_MS_PER_COST,
  ELEMENTS,
  MAX_PRIMITIVES,
  MODIFIERS,
  PATTERNS,
  VECTORS,
  type Composition,
} from "./catalog.js";
import { cooldownOf, costOf, toSignature } from "./translate.js";

/** Generador de composiciones válidas arbitrarias. */
const arbComposition: fc.Arbitrary<Composition> = fc
  .record(
    {
      element: fc.constantFrom(...ELEMENTS),
      vector: fc.option(fc.constantFrom(...VECTORS), { nil: undefined }),
      pattern: fc.option(fc.constantFrom(...PATTERNS), { nil: undefined }),
      modifiers: fc.uniqueArray(fc.constantFrom(...MODIFIERS)),
    },
    { requiredKeys: ["element", "modifiers"] },
  )
  .map((raw) => {
    // `exactOptionalPropertyTypes` obliga a omitir la clave, no a pasarla en undefined.
    const composition: Composition = {
      element: raw.element,
      modifiers: raw.modifiers,
      ...(raw.vector === undefined ? {} : { vector: raw.vector }),
      ...(raw.pattern === undefined ? {} : { pattern: raw.pattern }),
    };
    return composition;
  });

describe("toSignature", () => {
  it("el orden de selección de modificadores no cambia la firma", () => {
    fc.assert(
      fc.property(
        arbComposition.chain((composition) =>
          fc
            .constant(composition)
            .chain((c) =>
              fc
                .shuffledSubarray([...(c.modifiers ?? [])], {
                  minLength: (c.modifiers ?? []).length,
                })
                .map((shuffled) => [c, shuffled] as const),
            ),
        ),
        ([composition, shuffled]) => {
          const other: Composition = { ...composition, modifiers: shuffled };
          expect(toSignature(other)).toEqual(toSignature(composition));
        },
      ),
    );
  });

  it("modificadores duplicados no crean primitivas nuevas", () => {
    const base: Composition = { element: "ember", modifiers: ["homing"] };
    const duped: Composition = { element: "ember", modifiers: ["homing", "homing", "homing"] };
    expect(toSignature(duped)).toEqual(toSignature(base));
    expect(costOf(duped)).toBe(costOf(base));
  });

  it("N(c) es la cantidad de ejes seleccionados y nunca supera MAX_PRIMITIVES", () => {
    fc.assert(
      fc.property(arbComposition, (composition) => {
        const signature = toSignature(composition);
        const expected =
          1 +
          (composition.vector === undefined ? 0 : 1) +
          (composition.pattern === undefined ? 0 : 1) +
          new Set(composition.modifiers ?? []).size;
        expect(signature.primitives.length).toBe(expected);
        expect(requiredExposures(signature)).toBe(expected);
        expect(expected).toBeLessThanOrEqual(MAX_PRIMITIVES);
      }),
    );
  });

  it("la firma mínima (elemento solo) exige una sola exposición (R2)", () => {
    expect(requiredExposures(toSignature({ element: "void" }))).toBe(1);
  });

  it("la composición máxima exige 7 exposiciones", () => {
    const max: Composition = {
      element: "ember",
      vector: "beam",
      pattern: "pulse",
      modifiers: [...MODIFIERS],
    };
    expect(requiredExposures(toSignature(max))).toBe(7);
    expect(costOf(max)).toBe(11);
    expect(cooldownOf(max)).toBe(11 * COOLDOWN_MS_PER_COST);
  });

  it("rechaza valores fuera del catálogo", () => {
    expect(() => toSignature({ element: "plasma" as never })).toThrow(/elemento desconocido/);
    expect(() =>
      toSignature({ element: "ember", modifiers: ["cursed" as never] }),
    ).toThrow(/modificador desconocido/);
  });
});

/**
 * El test de integración del truco de prefijos (ADR 0008 §4).
 *
 * El complemento del property test estructural de `catalog.test.ts`: acá se
 * verifica de punta a punta, contra el `process()` real del núcleo, que la
 * debilidad grabada en `AdaptationCompleted` es siempre el elemento. Si el
 * núcleo cambiara su regla de `weaknessOf`, este test cae aunque el catálogo
 * siga intacto.
 */
describe("weaknessOf vía process() (ADR 0008 §4)", () => {
  it("la debilidad expuesta es siempre el elemento de la composición", () => {
    fc.assert(
      fc.property(arbComposition, (composition) => {
        const signature = toSignature(composition);
        let state = createInitialState();

        // Golpear hasta completar la adaptación del cluster.
        const completions: AdaptationCompleted[] = [];
        for (let i = 0; i < requiredExposures(signature); i++) {
          const result = expose(state, signature, i * 1000);
          state = result.state;
          for (const event of result.events) {
            if (event.type === "AdaptationCompleted") completions.push(event);
          }
        }

        expect(completions).toHaveLength(1);
        expect(completions[0]!.weakness.dimension).toBe(
          AXIS_PREFIX.element + composition.element,
        );
        expect(completions[0]!.clusterId).toBe(clusterKeyOf(signature));
      }),
    );
  });
});
