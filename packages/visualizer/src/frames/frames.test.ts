// Especificación de "replay del log → frames".
//
// Estos tests están **en rojo a propósito**: definen qué significa derivar
// frames antes de que exista la derivación, igual que `contract.test.ts` definió
// el motor en la Fase 0. `framesFrom` tira "no implementado" y ponerlos en verde
// es el trabajo de la Fase 2.

import { describe, expect, it } from "vitest";
import {
  canonicalize,
  clusterKeyOf,
  createInitialState,
  prefix,
  process,
  replayFrom,
  requiredExposures,
  resistanceOf,
  type EventLog,
  type StimulusSignature,
} from "@beforeheadapts/core";
import { framesFrom } from "./index.js";

/** Log de una sala con `times` exposiciones a la misma firma, tiempo regular. */
function logOf(signature: StimulusSignature, times: number): EventLog {
  let state = createInitialState({}, "sala-replay");
  for (let i = 0; i < times; i += 1) {
    state = process(state, signature, 1_000 + i * 100).state;
  }
  return state.log;
}

const fuego = canonicalize(["fuego"], 1);
const compuesta = canonicalize(["fuego", "hielo", "rayo"], 1);

describe("framesFrom — un frame por evento", () => {
  it("produce exactamente un frame por evento, en orden de seq", () => {
    const log = logOf(fuego, 3);
    const frames = framesFrom(log);

    expect(frames).toHaveLength(log.events.length);
    expect(frames.map((f) => f.seq)).toEqual(log.events.map((e) => e.seq));
    expect(frames.map((f) => f.event)).toEqual([...log.events]);
  });

  it("da frames vacíos para un log sin eventos", () => {
    const log = createInitialState({}, "sala-vacia").log;
    expect(framesFrom(log)).toEqual([]);
  });

  it("copia el timestamp del evento en vez de generar tiempo propio", () => {
    const log = logOf(fuego, 2);
    const frames = framesFrom(log);
    expect(frames.map((f) => f.timestamp)).toEqual(log.events.map((e) => e.timestamp));
  });
});

describe("framesFrom — el frame es proyección del motor, no estado paralelo", () => {
  // El invariante rector: nada en un frame puede discrepar de lo que el motor
  // dice al replayar ese mismo prefijo del log. Si esto se rompe, el
  // visualizador se convirtió en una segunda implementación del núcleo.
  it("el frame i coincide con replayFrom(prefix(log, i + 1))", () => {
    const log = logOf(compuesta, 4);
    const frames = framesFrom(log);

    frames.forEach((frame, i) => {
      const state = replayFrom(prefix(log, i + 1));
      for (const cluster of frame.clusters) {
        expect(cluster.resistance).toBe(resistanceOf(state, cluster.clusterId));
      }
    });
  });

  it("expone k, N(c) y el avance hacia el salto discreto", () => {
    const n = requiredExposures(compuesta);
    const log = logOf(compuesta, n);
    const frames = framesFrom(log);
    const clusterId = clusterKeyOf(compuesta);

    const last = frames.at(-1)!;
    const cluster = last.clusters.find((c) => c.clusterId === clusterId)!;

    expect(cluster.requiredExposures).toBe(n);
    expect(cluster.exposureCount).toBe(n);
    expect(cluster.progress).toBe(1);
    expect(cluster.adapted).toBe(true);
  });

  it("mantiene el progreso en [0, 1] y el cluster sin adaptar antes del salto", () => {
    const n = requiredExposures(compuesta);
    const frames = framesFrom(logOf(compuesta, n - 1));
    const clusterId = clusterKeyOf(compuesta);

    for (const frame of frames) {
      const cluster = frame.clusters.find((c) => c.clusterId === clusterId);
      if (cluster === undefined) continue;
      expect(cluster.progress).toBeGreaterThanOrEqual(0);
      expect(cluster.progress).toBeLessThan(1);
      expect(cluster.adapted).toBe(false);
    }
  });

  // El render dibuja los hilos de similitud de R6, y para eso necesita `sim()`
  // entre firmas — que sin este campo no tiene de dónde sacar. La firma se
  // **lee** del estado del motor (ADR 0007 §3): es dato derivado, no estado que
  // el visualizador acumule por su cuenta.
  it("expone la firma del cluster, tal como la tiene el motor", () => {
    const log = logOf(compuesta, 2);
    const frames = framesFrom(log);
    const clusterId = clusterKeyOf(compuesta);

    const cluster = frames.at(-1)!.clusters.find((c) => c.clusterId === clusterId)!;
    expect(cluster.signature).toEqual(compuesta);
    // La identidad del cluster es función pura de su firma (ADR 0002): si la
    // firma expuesta no reprodujera el id, estaríamos mostrando otra cosa.
    expect(clusterKeyOf(cluster.signature)).toBe(clusterId);
  });

  it("acumula los clusters vistos en orden estable de aparición", () => {
    let state = createInitialState({}, "sala-multi");
    state = process(state, fuego, 1_000).state;
    state = process(state, compuesta, 1_100).state;

    const last = framesFrom(state.log).at(-1)!;
    expect(last.clusters.map((c) => c.clusterId)).toEqual([
      clusterKeyOf(fuego),
      clusterKeyOf(compuesta),
    ]);
  });
});

describe("framesFrom — determinismo y pureza", () => {
  it("da frames idénticos para el mismo log (replay reproducible)", () => {
    const log = logOf(compuesta, 3);
    expect(framesFrom(log)).toEqual(framesFrom(log));
  });

  it("no muta el log recibido", () => {
    const log = logOf(fuego, 2);
    const snapshot = structuredClone({ roomId: log.roomId, events: [...log.events] });
    framesFrom(log);
    expect({ roomId: log.roomId, events: [...log.events] }).toEqual(snapshot);
  });

  it("la policy cambia los frames, así que viaja con el log (ADR 0006)", () => {
    const log = logOf(compuesta, requiredExposures(compuesta));
    const suave = framesFrom(log, { curve: { asymptote: 0.5 } });
    const dura = framesFrom(log, { curve: { asymptote: 0.01 } });
    expect(suave).not.toEqual(dura);
  });
});
