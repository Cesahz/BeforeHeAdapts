import { describe, expect, it } from "vitest";

import { MODIFIERS, cooldownOf, type Composition } from "@beforeheadapts/arena-dsl";

import {
  allCompositions,
  pureVariator,
  realisticVariator,
  repeater,
  type Archetype,
} from "./archetypes.js";
import { GLOBAL_GAP_MS, simulate } from "./simulate.js";

describe("catálogo enumerado", () => {
  it("cubre el espacio completo sin duplicados", () => {
    const all = allCompositions();
    expect(all.length).toBe(8 * 7 * 6 * 16);
    const keys = all.map((c) =>
      [c.element, c.vector ?? "-", c.pattern ?? "-", [...(c.modifiers ?? [])].sort().join(",")].join(
        "/",
      ),
    );
    expect(new Set(keys).size).toBe(all.length);
  });
});

describe("determinismo", () => {
  it("la misma semilla produce el mismo resultado", () => {
    const a = simulate(pureVariator(42), 50);
    const b = simulate(pureVariator(42), 50);
    expect(a).toEqual(b);
  });

  it("semillas distintas producen builds distintas", () => {
    const a = realisticVariator(1).next(0);
    const b = realisticVariator(999).next(0);
    expect(a).not.toEqual(b);
  });
});

describe("economía del ADR 0008", () => {
  it("el repetidor espera el cooldown completo de su build entre ataques", () => {
    const archetype = repeater();
    const build = archetype.next(0);
    const result = simulate(archetype, 10);
    // 9 huecos de cooldown entre 10 ataques; el primero ocurre en t=0.
    expect(result.elapsedMs).toBe(9 * cooldownOf(build));
  });

  it("el variador puro solo paga el hueco global, nunca un cooldown propio", () => {
    const result = simulate(pureVariator(7), 10);
    expect(result.elapsedMs).toBe(9 * GLOBAL_GAP_MS);
    expect(result.distinctClusters).toBe(10);
  });
});

describe("adaptación", () => {
  it("el repetidor adapta su cluster exactamente una vez", () => {
    const result = simulate(repeater(), 100);
    expect(result.adaptations).toBe(1);
    expect(result.distinctClusters).toBe(1);
    // La build máxima son 7 primitivas: N(c) = 7 (ADR 0002).
    expect(result.firstSnapAttack).toBe(7);
  });

  it("el ente nunca adapta dos veces el mismo cluster", () => {
    const result = simulate(realisticVariator(5), 300);
    expect(result.adaptations).toBeLessThanOrEqual(result.distinctClusters);
  });

  it("la eff registrada nunca cae a cero (R5: curva, no interruptor)", () => {
    const result = simulate(repeater(), 200);
    expect(result.eff.min).toBeGreaterThan(0);
  });

  it("una build simple adapta al primer golpe (R2)", () => {
    const simple: Composition = { element: "void", modifiers: [] };
    const archetype: Archetype = {
      name: "simple",
      description: "una sola primitiva",
      next: () => simple,
    };
    const result = simulate(archetype, 5);
    expect(result.firstSnapAttack).toBe(1);
    expect(result.firstSnapMs).toBe(0);
  });
});

describe("métricas", () => {
  it("las fracciones de los buckets de eff suman 1", () => {
    const result = simulate(realisticVariator(3), 120);
    const total = result.eff.buckets.reduce((a, b) => a + b.fraction, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it("R₀ generalizada arranca en 0 y es no negativa", () => {
    const result = simulate(repeater(), 50);
    expect(result.meanGeneralizedResistance).toBeGreaterThanOrEqual(0);
    expect(result.maxGeneralizedResistance).toBeLessThanOrEqual(1);
  });

  it("el variador realista rota exactamente sus builds", () => {
    for (const count of [3, 4, 5]) {
      const result = simulate(realisticVariator(11, count), 60);
      expect(result.distinctClusters).toBeLessThanOrEqual(count);
    }
  });

  it("rechaza rotaciones fuera del rango 3-5", () => {
    expect(() => realisticVariator(1, 2)).toThrow(/entre 3 y 5/);
    expect(() => realisticVariator(1, 6)).toThrow(/entre 3 y 5/);
  });

  it("la build máxima del repetidor usa los cuatro modificadores", () => {
    expect(repeater().next(0).modifiers).toEqual([...MODIFIERS]);
  });
});

describe("multiplicador de daño compuesto", () => {
  it("nunca excede eff (R₀ solo puede restar)", () => {
    for (const archetype of [repeater(), pureVariator(2), realisticVariator(2)]) {
      const result = simulate(archetype, 80);
      expect(result.damageMultiplier.mean).toBeLessThanOrEqual(result.eff.mean + 1e-9);
      expect(result.damageMultiplier.min).toBeGreaterThanOrEqual(0);
    }
  });

  it("sin clusters adaptados el daño real es idéntico a eff", () => {
    // El primer ataque siempre ocurre contra un ente virgen: R₀ = 0.
    const result = simulate(pureVariator(3), 1);
    expect(result.damageMultiplier.mean).toBeCloseTo(result.eff.mean, 10);
  });
});
