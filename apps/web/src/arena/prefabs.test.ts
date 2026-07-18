import { describe, expect, it } from "vitest";

import { defaultPolicy, requiredExposures, sim } from "@beforeheadapts/core";
import { cooldownOf, toSignature } from "@beforeheadapts/arena-dsl";

import { PREFABS } from "./prefabs.js";
import { Room } from "./room.js";

const byId = (id: string) => {
  const prefab = PREFABS.find((p) => p.id === id);
  if (prefab === undefined) throw new Error(`falta el prefab ${id}`);
  return prefab;
};

describe("prefabs", () => {
  it("tienen id y nombre únicos", () => {
    expect(new Set(PREFABS.map((p) => p.id)).size).toBe(PREFABS.length);
    expect(new Set(PREFABS.map((p) => p.name)).size).toBe(PREFABS.length);
  });

  it("son 4-6, para poder jugar sin el Builder", () => {
    expect(PREFABS.length).toBeGreaterThanOrEqual(4);
    expect(PREFABS.length).toBeLessThanOrEqual(6);
  });

  it("todas las composiciones son válidas y traducen a una firma", () => {
    for (const prefab of PREFABS) {
      expect(() => toSignature(prefab.composition)).not.toThrow();
    }
  });

  /**
   * Las notas de los prefabs se muestran en la UI, así que son afirmaciones
   * sobre el motor y pueden ser falsas. Estos tests las verifican.
   */
  describe("las notas dicen la verdad", () => {
    it("Chispa adapta al primer golpe", () => {
      const chispa = byId("chispa");
      expect(requiredExposures(toSignature(chispa.composition))).toBe(1);
      expect(new Room().attack(chispa.composition, 0).adapted).toBe(true);
    });

    it("Lanza helada y Esquirla superan el radio de generalización", () => {
      const a = toSignature(byId("lanza-helada").composition);
      const b = toSignature(byId("esquirla").composition);
      const similitud = sim(a, b);
      expect(similitud).toBeCloseTo(2 / 3, 10);
      expect(similitud).toBeGreaterThanOrEqual(defaultPolicy.generalizationRadius);
    });

    it("adaptar Lanza helada le transfiere resistencia a Esquirla (R6)", () => {
      const lanza = byId("lanza-helada").composition;
      const esquirla = byId("esquirla").composition;
      const room = new Room();
      const cd = cooldownOf(lanza);

      // Sin nada adaptado todavía, Esquirla no hereda nada.
      expect(room.attack(esquirla, 0).generalizedResistance).toBe(0);

      let now = 0;
      for (let i = 0; i < requiredExposures(toSignature(lanza)); i++) {
        room.attack(lanza, now);
        now += cd;
      }

      // Ya con Lanza helada adaptada, Esquirla arranca con resistencia heredada.
      expect(room.attack(esquirla, now).generalizedResistance).toBeGreaterThan(0);
    });

    it("Descarga no tiene parentesco con ningún otro prefab", () => {
      const descarga = toSignature(byId("descarga").composition);
      for (const prefab of PREFABS) {
        if (prefab.id === "descarga") continue;
        expect(sim(descarga, toSignature(prefab.composition))).toBeLessThan(
          defaultPolicy.generalizationRadius,
        );
      }
    });

    it("Colapso exige 7 exposiciones y 5,5 s de cooldown", () => {
      const colapso = byId("colapso").composition;
      expect(requiredExposures(toSignature(colapso))).toBe(7);
      expect(cooldownOf(colapso)).toBe(5500);
    });
  });
});
