import { describe, it, expect } from "vitest";
import fc from "fast-check";

import { canonicalize } from "../signature/index.js";
import {
  CONTRACT_VERSION,
  append,
  createLog,
  fold,
  lastTimestamp,
  logFrom,
  nextSeq,
  prefix,
  type EngineEvent,
  type EventDraft,
  type EventLog,
} from "./index.js";

// Tests unitarios y de propiedad de ledger/. Garantizan las leyes del log
// (append-only, versionado, aislado por sala, replayable), no la semántica de
// las 6 reglas: eso vive en contract.test.ts.

const sigFuego = canonicalize(["fuego"], 1);

function exposure(exposureCount: number): EventDraft {
  return {
    type: "ExposureRecorded",
    clusterId: "fuego",
    signature: sigFuego,
    exposureCount,
  };
}

const completed: EventDraft = {
  type: "AdaptationCompleted",
  clusterId: "fuego",
  weakness: { dimension: "fuego" },
};

const draftArb: fc.Arbitrary<EventDraft> = fc
  .integer({ min: 1, max: 20 })
  .map((k) => exposure(k));

/** Log con `n` exposiciones anexadas de a una, con timestamps crecientes. */
function logWith(n: number, roomId = "sala-1"): EventLog {
  let log = createLog(roomId);
  for (let i = 0; i < n; i++) log = append(log, [exposure(i + 1)], i);
  return log;
}

describe("createLog", () => {
  it("arranca vacío y con seq 0", () => {
    const log = createLog("sala-1");
    expect(log.events).toEqual([]);
    expect(nextSeq(log)).toBe(0);
    expect(lastTimestamp(log)).toBeUndefined();
  });

  it("rechaza una sala sin identidad", () => {
    expect(() => createLog("")).toThrow(/roomId vacío/);
  });
});

describe("append", () => {
  it("estampa v, roomId, seq consecutivo y timestamp", () => {
    const log = append(createLog("sala-1"), [exposure(1), completed], 42);
    expect(log.events).toHaveLength(2);
    expect(log.events.map((e) => e.seq)).toEqual([0, 1]);
    expect(log.events.every((e) => e.v === CONTRACT_VERSION)).toBe(true);
    expect(log.events.every((e) => e.roomId === "sala-1")).toBe(true);
    expect(log.events.every((e) => e.timestamp === 42)).toBe(true);
  });

  it("no muta el log anterior: los estados previos siguen siendo replayables", () => {
    const before = logWith(3);
    const snapshot = [...before.events];
    const after = append(before, [completed], 99);

    expect(before.events).toEqual(snapshot);
    expect(before.events).toHaveLength(3);
    expect(after.events).toHaveLength(4);
    expect(() => (after.events as EngineEvent[]).push(exposure(1) as EngineEvent)).toThrow();
  });

  it("anexar cero eventos deja el log idéntico", () => {
    const log = logWith(2);
    expect(append(log, [], 100)).toBe(log);
  });

  it("rechaza timestamps no finitos o que retroceden", () => {
    const log = append(createLog("sala-1"), [exposure(1)], 10);
    expect(() => append(log, [exposure(2)], Number.NaN)).toThrow(/finito/);
    expect(() => append(log, [exposure(2)], 9)).toThrow(/retrocede/);
    expect(() => append(log, [exposure(2)], 10)).not.toThrow(); // mismo instante: válido
  });

  it("los seq son densos y estrictamente crecientes para cualquier secuencia de appends", () => {
    fc.assert(
      fc.property(fc.array(fc.array(draftArb, { maxLength: 3 }), { maxLength: 10 }), (batches) => {
        let log = createLog("sala-1");
        batches.forEach((batch, t) => {
          log = append(log, batch, t);
        });
        expect(log.events.map((e) => e.seq)).toEqual(log.events.map((_, i) => i));
        expect(nextSeq(log)).toBe(log.events.length);
      }),
    );
  });
});

describe("aislamiento por sala", () => {
  it("cada log estampa su propia sala", () => {
    const a = append(createLog("sala-A"), [exposure(1)], 0);
    const b = append(createLog("sala-B"), [exposure(1)], 0);
    expect(a.events[0]!.roomId).toBe("sala-A");
    expect(b.events[0]!.roomId).toBe("sala-B");
  });

  it("logFrom rechaza eventos de otra sala", () => {
    const ajeno = logWith(2, "sala-A").events;
    expect(() => logFrom("sala-B", ajeno)).toThrow(/pertenece a la sala/);
  });
});

describe("logFrom (rehidratación desde persistencia)", () => {
  it("reconstruye un log íntegro tal cual", () => {
    const original = logWith(4);
    expect(logFrom("sala-1", original.events)).toEqual(original);
  });

  it("rechaza logs corruptos en vez de operar sobre ellos", () => {
    const events = logWith(3).events;
    const salteado = [events[0]!, events[2]!];
    expect(() => logFrom("sala-1", salteado)).toThrow(/seq 2 en la posición 1/);

    const desordenado = [events[0]!, { ...events[1]!, timestamp: -5 }];
    expect(() => logFrom("sala-1", desordenado)).toThrow(/retrocede/);
  });
});

describe("prefix", () => {
  it("devuelve un log independiente con los primeros eventos", () => {
    const log = logWith(5);
    const p = prefix(log, 2);
    expect(p.events).toEqual(log.events.slice(0, 2));
    expect(p.roomId).toBe(log.roomId);
  });

  it("todo prefijo es a su vez un log válido", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 8 }), (n) => {
        const log = logWith(8);
        const p = prefix(log, n);
        expect(logFrom(p.roomId, p.events)).toEqual(p);
      }),
    );
  });

  it("rechaza índices fuera de rango", () => {
    const log = logWith(2);
    expect(() => prefix(log, 3)).toThrow(/fuera de/);
    expect(() => prefix(log, -1)).toThrow(/fuera de/);
  });
});

describe("fold", () => {
  const contar = (state: number, event: EngineEvent) =>
    event.type === "ExposureRecorded" ? state + 1 : state;

  it("proyecta el log a estado", () => {
    expect(fold(logWith(3), contar, 0)).toBe(3);
  });

  it("replayar el mismo log produce siempre el mismo estado", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10 }), (n) => {
        const log = logWith(n);
        expect(fold(log, contar, 0)).toBe(fold(logFrom(log.roomId, log.events), contar, 0));
      }),
    );
  });

  it("el fold de un prefijo coincide con el fold incremental hasta ese punto", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 8 }), (n) => {
        const log = logWith(8);
        expect(fold(prefix(log, n), contar, 0)).toBe(n);
      }),
    );
  });
});
