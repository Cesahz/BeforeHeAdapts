import { describe, it, expect } from "vitest";
import fc from "fast-check";

import { logFrom, type EngineEvent } from "../ledger/index.js";
import { canonicalize } from "../signature/index.js";
import {
  clusterIdOf,
  confidenceOf,
  createInitialState,
  effectiveness,
  generalizedInitialResistance,
  process,
  replayFrom,
  resistanceOf,
  type EngineState,
} from "./index.js";

// Tests de engine/. El contrato (R1–R6) vive en contract.test.ts; acá se prueban
// las garantías estructurales: estado = fold(log), inmutabilidad, aislamiento
// por sala y forma de los eventos emitidos.

const fuego = canonicalize(["fuego"], 1);
const fuegoRapido = canonicalize(["fuego", "rapido"], 1);
const hielo = canonicalize(["hielo"], 1);

const signatureArb = fc
  .uniqueArray(fc.constantFrom("fuego", "rapido", "presion", "hielo", "sonido"), {
    minLength: 1,
    maxLength: 3,
  })
  .map((ps) => canonicalize(ps, 1));

/** Procesa una secuencia de firmas con timestamps crecientes. */
function runAll(state: EngineState, signatures: readonly ReturnType<typeof canonicalize>[]) {
  return signatures.reduce((s, sig, t) => process(s, sig, t).state, state);
}

describe("estado = fold(log)", () => {
  it("replayFrom reconstruye exactamente el estado vivido", () => {
    fc.assert(
      fc.property(fc.array(signatureArb, { maxLength: 15 }), (signatures) => {
        const vivido = runAll(createInitialState(), signatures);
        const replayado = replayFrom(vivido.log);
        expect(replayado.clusters).toEqual(vivido.clusters);
        expect(replayado.now).toBe(vivido.now);
      }),
    );
  });

  it("un log persistido y rehidratado produce el mismo estado (fixture golden)", () => {
    const vivido = runAll(createInitialState(), [fuegoRapido, fuegoRapido, fuego, fuegoRapido]);
    const persistido = JSON.parse(JSON.stringify(vivido.log.events)) as EngineEvent[];
    const rehidratado = replayFrom(logFrom(vivido.roomId, persistido));

    expect(rehidratado.clusters).toEqual(vivido.clusters);
    expect(resistanceOf(rehidratado, "fuego|rapido")).toBe(resistanceOf(vivido, "fuego|rapido"));
  });

  it("el mismo log siempre produce el mismo estado final (determinismo)", () => {
    const a = runAll(createInitialState(), [fuego, fuegoRapido, fuego]);
    const b = runAll(createInitialState(), [fuego, fuegoRapido, fuego]);
    expect(a.log.events).toEqual(b.log.events);
    expect(a.clusters).toEqual(b.clusters);
  });
});

describe("inmutabilidad", () => {
  it("process no toca el estado anterior", () => {
    const inicial = createInitialState();
    const antes = process(inicial, fuego, 0).state;
    const clustersAntes = new Map(antes.clusters);

    process(antes, fuego, 1);

    expect(antes.clusters).toEqual(clustersAntes);
    expect(antes.log.events).toHaveLength(4); // ResistanceApplied + Exposure + Completed + Counter
    expect(inicial.clusters.size).toBe(0);
    expect(inicial.log.events).toHaveLength(0);
  });

  it("estados intermedios siguen siendo consultables después de avanzar", () => {
    const s0 = createInitialState();
    const s1 = process(s0, fuegoRapido, 0).state; // aún no adapta (N = 2)
    const s2 = process(s1, fuegoRapido, 1).state; // adapta

    expect(resistanceOf(s0, "fuego|rapido")).toBe(0);
    expect(resistanceOf(s1, "fuego|rapido")).toBe(0);
    expect(resistanceOf(s2, "fuego|rapido")).toBeGreaterThan(0);
  });
});

describe("eventos emitidos", () => {
  it("emite la atenuación antes del registro de la exposición", () => {
    const { events } = process(createInitialState(), fuegoRapido, 0);
    expect(events.map((e) => e.type)).toEqual([
      "ResistanceApplied",
      "ExposureRecorded",
      "AdaptationProgressed",
    ]);
  });

  it("al completar, el contraataque va inmediatamente detrás del salto", () => {
    const s1 = process(createInitialState(), fuegoRapido, 0).state;
    const { events } = process(s1, fuegoRapido, 1);
    expect(events.map((e) => e.type)).toEqual([
      "ResistanceApplied",
      "ExposureRecorded",
      "AdaptationCompleted",
      "CounterReady",
    ]);
  });

  it("un cluster adapta una sola vez, por más que lo sigan golpeando", () => {
    const state = runAll(createInitialState(), Array.from({ length: 10 }, () => fuego));
    const completados = state.log.events.filter((e) => e.type === "AdaptationCompleted");
    const counters = state.log.events.filter((e) => e.type === "CounterReady");
    expect(completados).toHaveLength(1);
    expect(counters).toHaveLength(1);
  });

  it("la atenuación registrada coincide con eff(k) del estado previo", () => {
    let state = createInitialState();
    for (let t = 0; t < 5; t++) {
      const esperado = effectiveness(state, fuego);
      const { events, state: siguiente } = process(state, fuego, t);
      const aplicado = events.find((e) => e.type === "ResistanceApplied");
      expect(aplicado?.effApplied).toBeCloseTo(esperado, 12);
      expect(aplicado?.k).toBe(t);
      state = siguiente;
    }
  });

  it("todo evento lleva versión, sala y seq denso", () => {
    const state = runAll(createInitialState({}, "sala-7"), [fuego, hielo, fuego]);
    state.log.events.forEach((e, i) => {
      expect(e.v).toBe(1);
      expect(e.roomId).toBe("sala-7");
      expect(e.seq).toBe(i);
    });
  });
});

describe("aislamiento entre salas", () => {
  it("dos salas con la misma firma no comparten nada", () => {
    const salaA = runAll(createInitialState({}, "sala-A"), [fuego, fuego, fuego]);
    const salaB = createInitialState({}, "sala-B");

    expect(resistanceOf(salaA, "fuego")).toBeGreaterThan(0);
    expect(resistanceOf(salaB, "fuego")).toBe(0);
    expect(salaB.log.events).toHaveLength(0);
    expect(effectiveness(salaB, fuego)).toBe(effectiveness(createInitialState(), fuego));
  });
});

describe("selectores", () => {
  it("clusterIdOf no depende del estado (ADR 0002)", () => {
    const vacio = createInitialState();
    const usado = runAll(createInitialState(), [fuegoRapido, fuegoRapido]);
    expect(clusterIdOf(usado, fuegoRapido)).toBe(clusterIdOf(vacio, fuegoRapido));
    expect(clusterIdOf(vacio, canonicalize(["rapido", "fuego"], 9))).toBe("fuego|rapido");
  });

  it("un cluster desconocido no tiene resistencia ni confianza", () => {
    const state = createInitialState();
    expect(resistanceOf(state, "inexistente")).toBe(0);
    expect(confidenceOf(state, "inexistente")).toBe(0);
    expect(generalizedInitialResistance(state, fuego)).toBe(0);
  });

  it("bajo memoria permanente la confianza no decae con el tiempo", () => {
    let state = process(createInitialState(), fuego, 0).state;
    for (let t = 100; t < 110; t++) state = process(state, hielo, t).state;
    expect(confidenceOf(state, "fuego")).toBe(1);
  });

  it("la generalización hereda de un cluster adaptado y decae con su confianza", () => {
    const permanente = runAll(createInitialState(), [fuegoRapido, fuegoRapido]);
    const heredadoPermanente = generalizedInitialResistance(permanente, fuegoRapido);

    let conDecaimiento = runAll(
      createInitialState({ memory: "decaimiento", confidenceHalfLife: 10 }),
      [fuegoRapido, fuegoRapido],
    );
    const heredadoFresco = generalizedInitialResistance(conDecaimiento, fuegoRapido);
    for (let t = 100; t < 110; t++) conDecaimiento = process(conDecaimiento, hielo, t).state;

    expect(heredadoPermanente).toBeGreaterThan(0);
    expect(heredadoFresco).toBeCloseTo(heredadoPermanente, 12);
    // La memoria del cluster queda intacta; solo cae lo que se transfiere (R4).
    expect(resistanceOf(conDecaimiento, "fuego|rapido")).toBe(
      resistanceOf(permanente, "fuego|rapido"),
    );
    expect(generalizedInitialResistance(conDecaimiento, fuegoRapido)).toBeLessThan(heredadoFresco);
  });
});

describe("validación", () => {
  it("rechaza timestamps que retroceden", () => {
    const state = process(createInitialState(), fuego, 10).state;
    expect(() => process(state, fuego, 9)).toThrow(/retrocede/);
  });

  it("rechaza una policy que violaría R5", () => {
    expect(() => createInitialState({ curve: { asymptote: 0 } })).toThrow(/nunca interruptor/);
  });
});
