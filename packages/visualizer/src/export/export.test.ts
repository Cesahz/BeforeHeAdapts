// Especificación del guion temporal y de la orquestación del export.
//
// El punto de meter un puerto `FrameSink` en vez de rasterizar acá es
// exactamente esto: toda la lógica de exportación se verifica en Node, sin DOM
// y sin encoder. Lo único que queda fuera de los tests es el adaptador concreto
// del navegador, y por eso se lo mantiene delgado hasta lo tonto.

import { describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import {
  canonicalize,
  createInitialState,
  process,
  requiredExposures,
  type StimulusSignature,
} from "@beforeheadapts/core";
import { framesFrom, type Frame } from "../frames/index.js";
import { renderFrames } from "../render/index.js";
import {
  defaultTiming,
  exportReplay,
  frameAtMs,
  timelineOf,
  totalTicks,
  type FrameSink,
} from "./index.js";

const compuesta = canonicalize(["fuego", "hielo", "rayo"], 1);

function framesOf(...steps: readonly StimulusSignature[]): readonly Frame[] {
  let state = createInitialState({}, "sala-export");
  steps.forEach((signature, i) => {
    state = process(state, signature, 1_000 + i * 100).state;
  });
  return framesFrom(state.log);
}

function repeat(signature: StimulusSignature, times: number): readonly StimulusSignature[] {
  return Array.from({ length: times }, () => signature);
}

/** Sink de mentira: anota lo que recibe en vez de dibujarlo. */
function spySink(): FrameSink<readonly string[]> & {
  readonly drawn: { svg: string; durationMs: number }[];
  finished: number;
} {
  const drawn: { svg: string; durationMs: number }[] = [];
  return {
    drawn,
    finished: 0,
    draw(svg, durationMs) {
      drawn.push({ svg, durationMs });
    },
    finish() {
      this.finished += 1;
      return drawn.map((d) => d.svg);
    },
  };
}

describe("timelineOf — el guion", () => {
  const frames = framesOf(...repeat(compuesta, requiredExposures(compuesta)));

  it("da una entrada por frame, en orden", () => {
    const timeline = timelineOf(frames);
    expect(timeline.frames).toHaveLength(frames.length);
    expect(timeline.frames.map((f) => f.index)).toEqual(frames.map((_, i) => i));
  });

  // Sin huecos ni solapamientos: es lo que hace que `frameAtMs` sea total.
  it("encadena los frames sin dejar huecos", () => {
    const timeline = timelineOf(frames);
    let esperado = 0;
    for (const f of timeline.frames) {
      expect(f.startMs).toBe(esperado);
      expect(f.durationMs).toBeGreaterThan(0);
      esperado += f.durationMs;
    }
    expect(timeline.totalMs).toBe(esperado);
  });

  // El snap es el momento que el replay existe para mostrar. Si pasara al mismo
  // ritmo que el resto, se perdería entre los demás frames.
  it("sostiene el frame del salto de adaptación más que los otros", () => {
    const timeline = timelineOf(frames);
    const snap = frames.findIndex((f) => f.event.type === "AdaptationCompleted");
    expect(snap).toBeGreaterThan(0);

    expect(timeline.frames[snap]!.durationMs).toBeGreaterThan(
      timeline.frames[snap - 1]!.durationMs,
    );
  });

  it("sostiene el último frame para que el cierre se lea", () => {
    const timeline = timelineOf(frames);
    const ultimo = timeline.frames.at(-1)!;
    const anteultimo = timeline.frames.at(-2)!;
    expect(ultimo.durationMs).toBeGreaterThan(anteultimo.durationMs);
  });

  // El ritmo del replay es una decisión de narración, no un dato del log: dos
  // salas con el mismo guion se ven igual aunque una haya ocurrido más lento.
  it("ignora los timestamps del log", () => {
    let lenta = createInitialState({}, "sala-lenta");
    let rapida = createInitialState({}, "sala-rapida");
    for (let i = 0; i < 3; i += 1) {
      lenta = process(lenta, compuesta, 1_000 + i * 600_000).state;
      rapida = process(rapida, compuesta, 1_000 + i * 10).state;
    }

    expect(timelineOf(framesFrom(lenta.log))).toEqual(
      timelineOf(framesFrom(rapida.log)),
    );
  });

  it("acepta una línea de tiempo vacía", () => {
    const timeline = timelineOf([]);
    expect(timeline.frames).toEqual([]);
    expect(timeline.totalMs).toBe(0);
  });

  it("respeta la configuración de ritmo", () => {
    const timeline = timelineOf(frames, { frameDuration: 50, snapHold: 0, tailHold: 0 });
    for (const f of timeline.frames) {
      expect(f.durationMs).toBe(50);
    }
  });

  it("rechaza una configuración imposible", () => {
    expect(() => timelineOf(frames, { frameDuration: 0 })).toThrow();
    expect(() => timelineOf(frames, { fps: -1 })).toThrow();
    expect(() => timelineOf(frames, { snapHold: -1 })).toThrow();
  });
});

describe("frameAtMs — qué se ve en cada instante", () => {
  const timeline = timelineOf(framesOf(...repeat(compuesta, 3)));

  it("devuelve el frame cuyo intervalo contiene el instante", () => {
    for (const f of timeline.frames) {
      expect(frameAtMs(timeline, f.startMs)).toBe(f.index);
      expect(frameAtMs(timeline, f.startMs + f.durationMs - 1)).toBe(f.index);
    }
  });

  it("avanza monótonamente con el tiempo", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: timeline.totalMs }),
        fc.integer({ min: 0, max: timeline.totalMs }),
        (a, b) => {
          const [menor, mayor] = a <= b ? [a, b] : [b, a];
          expect(frameAtMs(timeline, menor)).toBeLessThanOrEqual(
            frameAtMs(timeline, mayor),
          );
        },
      ),
    );
  });

  // Un encoder que pide un cuadro pasado el final tiene que recibir el último
  // frame, no una excepción a mitad de la grabación.
  it("satura en los extremos en vez de fallar", () => {
    expect(frameAtMs(timeline, -500)).toBe(0);
    expect(frameAtMs(timeline, timeline.totalMs + 10_000)).toBe(
      timeline.frames.length - 1,
    );
  });

  it("falla solo si no hay ningún frame que mostrar", () => {
    expect(() => frameAtMs(timelineOf([]), 0)).toThrow();
  });
});

describe("totalTicks — cuadros de video", () => {
  it("convierte la duración a cuadros según el fps", () => {
    const timeline = timelineOf(framesOf(compuesta), { fps: 10 });
    expect(totalTicks(timeline)).toBe(Math.round((timeline.totalMs / 1000) * 10));
  });

  it("nunca da cero cuadros", () => {
    expect(totalTicks(timelineOf([]))).toBe(1);
  });
});

describe("exportReplay — orquestación", () => {
  const frames = framesOf(...repeat(compuesta, requiredExposures(compuesta)));

  it("entrega cada frame al sink, en orden y una sola vez", async () => {
    const sink = spySink();
    await exportReplay(frames, sink);

    expect(sink.drawn).toHaveLength(frames.length);
    expect(sink.drawn.map((d) => d.svg)).toEqual([...renderedOf(frames)]);
  });

  it("pasa la duración que dice el guion", async () => {
    const sink = spySink();
    await exportReplay(frames, sink);

    const timeline = timelineOf(frames);
    expect(sink.drawn.map((d) => d.durationMs)).toEqual(
      timeline.frames.map((f) => f.durationMs),
    );
  });

  it("cierra el sink una sola vez y devuelve su resultado", async () => {
    const sink = spySink();
    const salida = await exportReplay(frames, sink);

    expect(sink.finished).toBe(1);
    expect(salida).toHaveLength(frames.length);
  });

  it("informa avance creciente hasta 1", async () => {
    const onProgress = vi.fn();
    await exportReplay(frames, spySink(), { onProgress });

    const avances = onProgress.mock.calls.map(([r]) => r as number);
    expect(avances).toHaveLength(frames.length);
    for (let i = 1; i < avances.length; i += 1) {
      expect(avances[i]!).toBeGreaterThan(avances[i - 1]!);
    }
    expect(avances.at(-1)).toBeCloseTo(1, 9);
  });

  it("espera a un sink asíncrono antes de seguir", async () => {
    const orden: string[] = [];
    const sink: FrameSink<void> = {
      async draw(_svg, durationMs) {
        orden.push(`inicio-${durationMs}`);
        await Promise.resolve();
        orden.push(`fin-${durationMs}`);
      },
      finish() {
        orden.push("finish");
      },
    };

    await exportReplay(frames.slice(0, 2), sink);
    // Ningún `inicio` puede aparecer antes del `fin` del anterior.
    expect(orden.at(-1)).toBe("finish");
    expect(orden[1]).toMatch(/^fin-/);
  });

  it("no dibuja nada con un replay vacío, pero igual cierra", async () => {
    const sink = spySink();
    await exportReplay([], sink);
    expect(sink.drawn).toEqual([]);
    expect(sink.finished).toBe(1);
  });

  // El export es una lectura más del mismo replay: no puede diferir de lo que
  // se ve en pantalla, o el gif mostraría algo que nunca pasó.
  it("entrega exactamente los mismos SVG que el render", async () => {
    const sink = spySink();
    await exportReplay(frames, sink, { timing: { frameDuration: 1 } });
    expect(sink.drawn.map((d) => d.svg)).toEqual([...renderedOf(frames)]);
  });
});

/** Los SVG del replay, para comparar contra lo que recibe el sink. */
function renderedOf(frames: readonly Frame[]): readonly string[] {
  return renderFrames(frames);
}
