import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { CONTRACT_VERSION } from "./index.js";

// Test de humo: valida que el andamiaje compila y que Vitest + fast-check están
// cableados. No es parte del contrato — se borra cuando llegue contract.test.ts.
describe("andamiaje", () => {
  it("expone la versión del contrato", () => {
    expect(CONTRACT_VERSION).toBe(1);
  });

  it("fast-check está operativo (la suma es conmutativa)", () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer(), (a, b) => a + b === b + a),
    );
  });
});
