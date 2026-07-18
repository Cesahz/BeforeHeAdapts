import { describe, expect, it } from "vitest";

import { defaultPolicy, replayFrom } from "@beforeheadapts/core";
import { cooldownOf, type Composition } from "@beforeheadapts/arena-dsl";

import { CooldownError, Room } from "./room.js";
import { ENGINE_VERSION, replayFileName, serializeReplay, toReplayFile } from "./replay.js";

const simple: Composition = { element: "ember" };
const compuesta: Composition = {
  element: "frost",
  vector: "beam",
  pattern: "pulse",
  modifiers: ["homing"],
};

describe("Room", () => {
  it("una firma simple adapta al primer golpe (R2)", () => {
    const room = new Room();
    const outcome = room.attack(simple, 0);
    expect(outcome.requiredExposures).toBe(1);
    expect(outcome.adapted).toBe(true);
    expect(outcome.events.map((e) => e.type)).toContain("AdaptationCompleted");
  });

  it("una firma compuesta necesita N(c) golpes", () => {
    const room = new Room();
    let now = 0;
    const cd = cooldownOf(compuesta);
    for (let i = 0; i < 3; i++) {
      expect(room.attack(compuesta, now).adapted).toBe(false);
      now += cd;
    }
    expect(room.attack(compuesta, now).adapted).toBe(true);
  });

  it("rechaza atacar con una build en cooldown", () => {
    const room = new Room();
    room.attack(compuesta, 0);
    expect(() => room.attack(compuesta, 100)).toThrow(CooldownError);
    expect(room.canAttack(compuesta, 100)).toBe(false);
    expect(room.canAttack(compuesta, cooldownOf(compuesta))).toBe(true);
  });

  it("el cooldown es por build, no global", () => {
    const room = new Room();
    room.attack(compuesta, 0);
    // Otra composición sigue disponible en el mismo instante.
    expect(() => room.attack(simple, 0)).not.toThrow();
  });

  it("la efectividad decae golpe a golpe sin llegar a cero (R5)", () => {
    const room = new Room();
    const cd = cooldownOf(compuesta);
    const effs: number[] = [];
    for (let i = 0; i < 6; i++) {
      effs.push(room.attack(compuesta, i * cd).effApplied);
    }
    for (let i = 1; i < effs.length; i++) {
      expect(effs[i]!).toBeLessThan(effs[i - 1]!);
    }
    expect(effs.at(-1)!).toBeGreaterThan(0);
  });

  it("el daño combina intensidad, eff y R₀", () => {
    const room = new Room();
    const outcome = room.attack(compuesta, 0);
    expect(outcome.damage).toBeCloseTo(
      outcome.signature.intensity * outcome.effApplied * (1 - outcome.generalizedResistance),
      10,
    );
    // Contra un ente virgen no hay nada de qué generalizar.
    expect(outcome.generalizedResistance).toBe(0);
  });

  it("no comparte nada con otra sala (Ley §4)", () => {
    const a = new Room("sala-a");
    const b = new Room("sala-b");
    a.attack(simple, 0);
    expect(a.log.events.length).toBeGreaterThan(0);
    expect(b.log.events).toHaveLength(0);
    expect(b.attack(simple, 0).adapted).toBe(true);
  });
});

describe("export del replay (ADR 0006)", () => {
  it("lleva la cabecera completa", () => {
    const room = new Room("mi-sala");
    room.attack(simple, 0);
    const file = toReplayFile(room);
    expect(file.schemaVersion).toBe(1);
    expect(file.engineVersion).toBe(ENGINE_VERSION);
    expect(file.roomId).toBe("mi-sala");
    expect(file.events.length).toBe(room.log.events.length);
  });

  it("exporta la policy resuelta, con los defaults explícitos", () => {
    const room = new Room("s", { curve: { r: 0.7 } });
    const { policyConfig } = toReplayFile(room);
    expect(policyConfig.curve.r).toBe(0.7);
    // Lo que NO se configuró viaja igual, con su valor por defecto.
    expect(policyConfig.curve.asymptote).toBe(defaultPolicy.curve.asymptote);
    expect(policyConfig.memory).toBe(defaultPolicy.memory);
  });

  it("el replay exportado reproduce el mismo estado final", () => {
    const room = new Room("s");
    const cd = cooldownOf(compuesta);
    for (let i = 0; i < 4; i++) room.attack(compuesta, i * cd);
    // El log es una sola línea de tiempo: el reloj nunca retrocede, ni siquiera
    // al cambiar de build. El ledger lo hace cumplir.
    room.attack(simple, 4 * cd);

    const file = JSON.parse(serializeReplay(room)) as ReturnType<typeof toReplayFile>;
    const revivido = replayFrom(
      { roomId: file.roomId, events: file.events },
      file.policyConfig,
    );

    expect(revivido.clusters.size).toBe(room.state.clusters.size);
    for (const [clusterId, cluster] of room.state.clusters) {
      const otro = revivido.clusters.get(clusterId);
      expect(otro?.exposureCount).toBe(cluster.exposureCount);
      expect(otro?.adapted).toBe(cluster.adapted);
    }
  });

  it("el nombre de archivo no lleva caracteres inválidos", () => {
    const room = new Room("sala local #1");
    expect(replayFileName(room)).toMatch(/^replay-[a-zA-Z0-9_-]+-\d+ev\.json$/);
  });
});
