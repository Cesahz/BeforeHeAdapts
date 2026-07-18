// Tests de la métrica de erraticidad (ADR 0009 §2).
//
// La métrica decide cuándo el ente "te percibe", así que es balance disfrazado
// de geometría. Lo que se fija acá son sus PROPIEDADES —qué tiene que dar 0,
// qué tiene que dar ~1, de qué no puede depender— no sus valores exactos: el
// umbral concreto vive en `balance.ts` y se va a mover con la mano del autor.

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { NOISE } from "../arena/balance.js";
import { NoiseWatcher, erraticityOf } from "./noise.js";
import type { TracePoint } from "./trace.js";

/** Recta: el movimiento menos errático posible. */
function recta(n = 40, paso = 20): readonly TracePoint[] {
  return Array.from({ length: n }, (_, i) => ({ x: i * paso, y: 0, t: i * 16 }));
}

/** Vaivén: el más errático posible. */
function vaiven(n = 40, amplitud = 120): readonly TracePoint[] {
  return Array.from({ length: n }, (_, i) => ({
    x: i % 2 === 0 ? 0 : amplitud,
    y: 0,
    t: i * 16,
  }));
}

describe("erraticidad", () => {
  it("una recta da 0", () => {
    expect(erraticityOf(recta())).toBeCloseTo(0, 6);
  });

  it("un vaivén satura cerca de 1", () => {
    // Cada quiebre es una cúspide de 180°. A diferencia del reconocedor —donde
    // las cúspides se excluyen para no falsificar rotación— acá cuentan
    // enteras: un vaivén ES la agitación máxima.
    expect(erraticityOf(vaiven())).toBeGreaterThan(0.95);
  });

  it("está acotada en [0, 1]", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({ x: fc.integer({ min: -500, max: 500 }), y: fc.integer({ min: -500, max: 500 }) }),
          { minLength: 3, maxLength: 60 },
        ),
        (raw) => {
          const e = erraticityOf(raw.map((p, i) => ({ ...p, t: i * 16 })));
          expect(e).toBeGreaterThanOrEqual(0);
          expect(e).toBeLessThanOrEqual(1);
        },
      ),
    );
  });

  it("es invariante a escala: solo mira ángulos", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 40 }), (factor) => {
        const base = vaiven(40, 20);
        const escalado = base.map((p) => ({ ...p, x: p.x * factor, y: p.y * factor }));
        expect(erraticityOf(escalado)).toBeCloseTo(erraticityOf(base.map((p) => ({ ...p, x: p.x * 6 }))), 6);
      }),
    );
  });

  it("es invariante a velocidad: el tiempo no entra en la fórmula", () => {
    const base = vaiven();
    const lento = base.map((p) => ({ ...p, t: p.t * 10 }));
    expect(erraticityOf(lento)).toBeCloseTo(erraticityOf(base), 6);
  });

  it("un cursor casi quieto da 0 aunque tiemble mucho", () => {
    // La compuerta de reposo. Sin ella, el jitter sub-píxel de un cursor
    // apoyado produce ángulos basura y el ente "percibiría" a alguien inmóvil.
    const tembloroso = Array.from({ length: 40 }, (_, i) => ({
      x: (i % 3) * 0.5,
      y: (i % 2) * 0.4,
      t: i * 16,
    }));
    expect(erraticityOf(tembloroso)).toBe(0);
  });
});

describe("NoiseWatcher", () => {
  it("decima a paso fijo: el sampling rate del dispositivo no cambia la ventana", () => {
    const rapido = new NoiseWatcher();
    const lento = new NoiseWatcher();
    // 1000 Hz contra 62,5 Hz sobre la misma trayectoria y el mismo lapso.
    for (let t = 0; t <= 2000; t += 1) rapido.push(t, 0, t);
    for (let t = 0; t <= 2000; t += 16) lento.push(t, 0, t);
    expect(rapido.window.length).toBe(lento.window.length);
  });

  it("la ventana no crece sin límite", () => {
    const watcher = new NoiseWatcher();
    for (let t = 0; t <= 100_000; t += 16) watcher.push(t % 300, 0, t);
    expect(watcher.window.length).toBe(NOISE.windowSize);
  });

  it("no emite hasta llenar la ventana", () => {
    const watcher = new NoiseWatcher();
    for (let i = 0; i < NOISE.windowSize - 1; i += 1) {
      watcher.push(i % 2 === 0 ? 0 : 120, 0, i * 16);
    }
    expect(watcher.read(1000).shouldEmit).toBe(false);
  });

  it("`read` no consume el rate-limit; `markEmitted` sí", () => {
    const watcher = new NoiseWatcher();
    for (let i = 0; i < NOISE.windowSize; i += 1) watcher.push(i % 2 === 0 ? 0 : 120, 0, i * 16);
    const t = NOISE.windowSize * 16;

    // Consultar mil veces no gasta nada: la decisión de emitir es de quien
    // consume, no del vigilante.
    for (let i = 0; i < 1000; i += 1) expect(watcher.read(t).shouldEmit).toBe(true);

    watcher.markEmitted(t);
    expect(watcher.read(t).shouldEmit).toBe(false);
    expect(watcher.read(t + NOISE.cooldownMs - 1).shouldEmit).toBe(false);
    expect(watcher.read(t + NOISE.cooldownMs).shouldEmit).toBe(true);
  });

  it("`agitated` se levanta antes de que haya emisión (feedback preventivo)", () => {
    // La reacción preventiva del §4 tiene que poder verse aunque el rate-limit
    // esté bloqueando la emisión: el ente se orienta mientras te agitás, no
    // solo en el instante en que aprende.
    const watcher = new NoiseWatcher();
    for (let i = 0; i < NOISE.windowSize; i += 1) watcher.push(i % 2 === 0 ? 0 : 120, 0, i * 16);
    const t = NOISE.windowSize * 16;
    watcher.markEmitted(t);
    const reading = watcher.read(t + 100);
    expect(reading.agitated).toBe(true);
    expect(reading.shouldEmit).toBe(false);
  });
});
