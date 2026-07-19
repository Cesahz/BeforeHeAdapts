// vocabulary.test.ts — el contador tiene que ser HONESTO, no optimista.
//
// La enmienda P2 del ADR 0011 es el motivo entero de este archivo: la versión
// ingenua del contador ("viable = cluster no adaptado") pasaría todos los tests
// obvios y mentiría igual. Los que importan acá son los que la distinguen de la
// honesta — sobre todo `no cuenta entera una firma que heredó resistencia`.

import { describe, expect, it } from "vitest";
import { generalizedInitialResistance } from "@beforeheadapts/core";
import { toSignature, type Composition } from "@beforeheadapts/arena-dsl";

import { VICTORY } from "./balance.js";
import { Room } from "./room.js";
import { expectedEffectiveness, vocabularyOf } from "./vocabulary.js";

/** Golpea una composición hasta adaptarla, saltándose los cooldowns con el reloj. */
function adaptar(room: Room, composition: Composition, desde = 0): number {
  let now = desde;
  for (let i = 0; i < 12; i += 1) {
    const outcome = room.attack(composition, now);
    now = outcome.readyAt;
    if (outcome.adapted) return now;
  }
  throw new Error("no adaptó en 12 golpes: revisar el fixture, no el test");
}

describe("vocabulario", () => {
  it("arranca con todo el catálogo viable", () => {
    const vocab = vocabularyOf(new Room().state);

    expect(vocab.total).toBe(32); // 4 gestos × 8 elementos
    expect(vocab.viable).toBe(vocab.total);
    expect(vocab.weakened).toBe(0);
    expect(vocab.entries.every((e) => e.status === "fresh")).toBe(true);
  });

  it("adaptar una firma la saca del conteo de viables", () => {
    const room = new Room();
    const antes = vocabularyOf(room.state).viable;

    adaptar(room, { element: "ember", vector: "projectile" }); // el gesto `straight`

    const despues = vocabularyOf(room.state);
    expect(despues.viable).toBeLessThan(antes);

    const entry = despues.entries.find((e) => e.gesture === "straight" && e.element === "ember");
    expect(entry?.status).toBe("spent");
    expect(entry?.expectedEffectiveness).toBeLessThan(VICTORY.spentThreshold);
  });

  it("NO cuenta entera una firma que solo heredó resistencia (R6)", () => {
    // El corazón de la enmienda P2. Al adaptar una composición, su pariente
    // hereda R₀ sin haber sido golpeada nunca. El contador ingenuo la seguiría
    // contando como si estuviera fresca.
    const room = new Room();
    const pariente: Composition = { element: "frost", vector: "projectile", pattern: "burst" };
    const hermana: Composition = { element: "frost", vector: "projectile" };

    adaptar(room, pariente);

    const heredada = generalizedInitialResistance(room.state, toSignature(hermana));
    expect(heredada).toBeGreaterThan(0); // hay parentesco de verdad

    // La hermana nunca fue golpeada, así que su eff(k) sigue en 1: toda la
    // caída de efectividad viene de la herencia. Eso es exactamente lo que el
    // contador optimista ignoraría.
    expect(expectedEffectiveness(room.state, hermana)).toBeCloseTo(1 - heredada, 5);
    expect(expectedEffectiveness(room.state, hermana)).toBeLessThan(1);
  });

  it("la efectividad esperada es monótona no creciente", () => {
    // R1 + R5: `eff(k)` solo baja y `R₀` solo sube. Si esto se rompiera, el
    // contador dejaría de ser un reloj.
    const room = new Room();
    const build: Composition = { element: "current", vector: "beam", pattern: "sustained" };

    let previa = expectedEffectiveness(room.state, build);
    let now = 0;
    for (let i = 0; i < 8; i += 1) {
      now = room.attack(build, now).readyAt;
      const actual = expectedEffectiveness(room.state, build);
      expect(actual).toBeLessThanOrEqual(previa + 1e-9);
      previa = actual;
    }
  });

  it("viables + debilitadas es siempre el total", () => {
    const room = new Room();
    adaptar(room, { element: "ember" });
    adaptar(room, { element: "frost", vector: "projectile" }, 20_000);

    const vocab = vocabularyOf(room.state);
    expect(vocab.viable + vocab.weakened).toBe(vocab.total);
  });
});
