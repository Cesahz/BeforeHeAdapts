// Tests del reconocedor de gestos (ADR 0009 §1).
//
// Los trazos son SINTÉTICOS: se generan con matemática, no se graban de un
// mouse. Eso es lo que hace testeable la frontera de cuantización del ADR 0004
// —"trazo sintético → firma esperada"— sin navegador y sin fixtures binarios.

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { costOf, toSignature } from "@beforeheadapts/arena-dsl";
import { requiredExposures } from "@beforeheadapts/core";

import { GESTURE } from "../arena/balance.js";
import {
  compositionFor,
  metricsOf,
  recognize,
  type GestureKind,
  type GesturePoint,
} from "./recognize.js";
import { resample } from "./trace.js";

// --- Generadores de trazos sintéticos ---------------------------------------

/** Recta de `from` a `to`, con `n` muestras repartidas en `durationMs`. */
function straightTrace(
  from: readonly [number, number],
  to: readonly [number, number],
  n = 24,
  durationMs = 400,
): readonly GesturePoint[] {
  return Array.from({ length: n }, (_, i) => {
    const r = i / (n - 1);
    return {
      x: from[0] + (to[0] - from[0]) * r,
      y: from[1] + (to[1] - from[1]) * r,
      t: r * durationMs,
    };
  });
}

/** Círculo completo de radio `radius`. `turns` permite dibujar vueltas parciales. */
function circleTrace(radius: number, n = 48, durationMs = 900, turns = 1): readonly GesturePoint[] {
  return Array.from({ length: n }, (_, i) => {
    const r = i / (n - 1);
    const angle = r * turns * Math.PI * 2;
    return {
      x: 300 + radius * Math.cos(angle),
      y: 300 + radius * Math.sin(angle),
      t: r * durationMs,
    };
  });
}

/** Sierra de `peaks` picos: avanza en x y alterna en y. */
function zigzagTrace(
  peaks = 8,
  width = 400,
  amplitude = 60,
  durationMs = 800,
): readonly GesturePoint[] {
  const points: GesturePoint[] = [];
  for (let i = 0; i <= peaks; i += 1) {
    const r = i / peaks;
    points.push({
      x: r * width,
      y: i % 2 === 0 ? -amplitude : amplitude,
      t: r * durationMs,
    });
  }
  // Se densifica interpolando: un mouse real entrega muchas más muestras que
  // vértices, y el re-muestreo tiene que verse con datos parecidos a esos.
  const dense: GesturePoint[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    for (let k = 0; k < 6; k += 1) {
      const r = k / 6;
      dense.push({ x: a.x + (b.x - a.x) * r, y: a.y + (b.y - a.y) * r, t: a.t + (b.t - a.t) * r });
    }
  }
  dense.push(points[points.length - 1]!);
  return dense;
}

/** Puntero quieto (con jitter sub-píxel, como uno real) durante `durationMs`. */
function holdTrace(durationMs = 600, n = 20): readonly GesturePoint[] {
  return Array.from({ length: n }, (_, i) => ({
    x: 200 + (i % 3) * 0.4,
    y: 200 + (i % 2) * 0.3,
    t: (i / (n - 1)) * durationMs,
  }));
}

const kindOf = (points: readonly GesturePoint[]): GestureKind | string => {
  const result = recognize(points);
  return result.ok ? result.kind : `rechazado:${result.reason}`;
};

// --- Reconocimiento de cada gesto -------------------------------------------

describe("reconocimiento de los cuatro gestos", () => {
  it("una recta rápida es `straight`", () => {
    expect(kindOf(straightTrace([0, 0], [400, 0]))).toBe("straight");
  });

  it("un círculo cerrado es `circle`", () => {
    expect(kindOf(circleTrace(120))).toBe("circle");
  });

  it("una sierra es `zigzag`", () => {
    expect(kindOf(zigzagTrace())).toBe("zigzag");
  });

  it("el puntero quieto sostenido es `hold`", () => {
    expect(kindOf(holdTrace())).toBe("hold");
  });
});

// --- Invariancias (el corazón del ADR 0004) ---------------------------------

describe("invariancia a escala", () => {
  it("un círculo es `circle` para cualquier radio jugable", () => {
    fc.assert(
      fc.property(fc.integer({ min: 40, max: 300 }), (radius) => {
        expect(kindOf(circleTrace(radius))).toBe("circle");
      }),
    );
  });

  it("una recta es `straight` a cualquier largo, si mantiene la velocidad", () => {
    fc.assert(
      fc.property(fc.integer({ min: 80, max: 900 }), (length) => {
        // Duración proporcional al largo: se varía la ESCALA sin variar la
        // velocidad, que es la única medida que `straight` sí mira.
        const durationMs = length / 0.8;
        expect(kindOf(straightTrace([0, 0], [length, 0], 24, durationMs))).toBe("straight");
      }),
    );
  });

  it("una sierra es `zigzag` a cualquier amplitud suficiente", () => {
    fc.assert(
      fc.property(fc.integer({ min: 40, max: 200 }), (amplitude) => {
        expect(kindOf(zigzagTrace(8, 400, amplitude))).toBe("zigzag");
      }),
    );
  });
});

describe("invariancia a velocidad", () => {
  it("un círculo es `circle` sin importar cuánto tarde", () => {
    fc.assert(
      fc.property(fc.integer({ min: 200, max: 3000 }), (durationMs) => {
        expect(kindOf(circleTrace(120, 48, durationMs))).toBe("circle");
      }),
    );
  });

  it("una sierra es `zigzag` sin importar cuánto tarde", () => {
    fc.assert(
      fc.property(fc.integer({ min: 250, max: 3000 }), (durationMs) => {
        expect(kindOf(zigzagTrace(8, 400, 60, durationMs))).toBe("zigzag");
      }),
    );
  });

  it("la cantidad de muestras no cambia el gesto (dispositivos de 60 a 1000 Hz)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 12, max: 400 }), (n) => {
        expect(kindOf(circleTrace(120, n))).toBe("circle");
      }),
    );
  });
});

// --- Rechazo explícito: nunca una firma inventada ---------------------------

describe("los trazos ambiguos se rechazan", () => {
  it("un arco suave no es ni recta ni círculo", () => {
    // Media vuelta: gira demasiado para ser recta y muy poco para ser círculo.
    // (Un CUARTO de vuelta no sirve de ejemplo: su rectitud es 0,90 — cuerda
    // sobre arco—, o sea que geométricamente sí es casi una recta.)
    const result = recognize(circleTrace(150, 40, 700, 0.5));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("ambiguo");
  });

  it("una recta lenta se rechaza por lenta, con motivo propio", () => {
    const result = recognize(straightTrace([0, 0], [300, 0], 24, 4000));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("lento");
  });

  it("un roce corto no alcanza para nada", () => {
    const result = recognize(straightTrace([0, 0], [45, 0], 10, 100));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("insuficiente");
  });

  it("un clic sin sostener no es `hold`", () => {
    const result = recognize(holdTrace(120));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("insuficiente");
  });

  it("muy pocas muestras se rechazan antes de medir nada", () => {
    expect(recognize([]).ok).toBe(false);
    expect(recognize(straightTrace([0, 0], [400, 0], 3)).ok).toBe(false);
  });

  /**
   * El jitter dentro de una caja chica NUNCA puede falsificar los dos gestos
   * caros. `hold` y `straight` sí son alcanzables ahí y con razón: un manotazo
   * de 50 px en 80 ms *es* un trazo recto rápido, y quedarse quieto *es* un
   * hold. Lo que no puede pasar es que agitar el mouse compre un `circle`
   * (cost 3) o un `zigzag` (cost 5) que el jugador no dibujó.
   *
   * Esta propiedad es la que atrapó el bug de las cúspides: sin
   * `GESTURE.cuspRad`, un vaivén de 180° acumulaba giro con signo y salía
   * `circle`.
   */
  it("el jitter en una caja chica nunca falsifica `circle` ni `zigzag`", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            x: fc.integer({ min: 0, max: 30 }),
            y: fc.integer({ min: 0, max: 30 }),
          }),
          { minLength: 6, maxLength: 40 },
        ),
        (raw) => {
          const points = raw.map((p, i) => ({ ...p, t: i * 16 }));
          const result = recognize(points);
          if (result.ok) expect(["hold", "straight"]).toContain(result.kind);
        },
      ),
    );
  });
});

// --- Propiedades estructurales ----------------------------------------------

describe("propiedades del reconocedor", () => {
  it("es determinista: el mismo trazo da siempre el mismo gesto", () => {
    const trace = circleTrace(137, 53, 811);
    const first = recognize(trace);
    for (let i = 0; i < 5; i += 1) expect(recognize(trace)).toEqual(first);
  });

  it("los umbrales de `circle` y `straight` son disjuntos por construcción", () => {
    // No es una casualidad de los tests: ningún trazo puede ser ambos, porque
    // la misma medida (rectitud) tiene que estar de los dos lados a la vez.
    expect(GESTURE.circleMaxClosure).toBeLessThan(GESTURE.straightMinRatio);
  });

  it("los umbrales de `circle` y `zigzag` son disjuntos por construcción", () => {
    // Se separan por cambios de SENTIDO, no por cantidad de giro. Un zigzag
    // dibujado en arco acumula giro de círculo; lo que lo delata es que va y
    // vuelve. Mientras este orden se mantenga, ningún trazo puede ser ambos.
    expect(GESTURE.circleMaxReversals).toBeLessThan(GESTURE.zigzagMinReversals);
  });

  /**
   * Regresión del bug que encontró el autor en la ronda 1: la sierra dibujada
   * en arco —que es como sale naturalmente, no como la genera un test— se
   * clasificaba como `circle` porque el círculo no miraba los cambios de
   * sentido.
   */
  it("un zigzag dibujado en arco sigue siendo `zigzag`", () => {
    const puntos: GesturePoint[] = [];
    const picos = 8;
    for (let i = 0; i <= picos; i += 1) {
      // Los vértices se reparten sobre un arco amplio en vez de una recta.
      const a = (i / picos) * Math.PI * 1.4;
      const radio = i % 2 === 0 ? 150 : 250;
      puntos.push({ x: 300 + radio * Math.cos(a), y: 300 + radio * Math.sin(a), t: i * 90 });
    }
    const denso: GesturePoint[] = [];
    for (let i = 1; i < puntos.length; i += 1) {
      const a = puntos[i - 1]!;
      const b = puntos[i]!;
      for (let k = 0; k < 6; k += 1) {
        const r = k / 6;
        denso.push({ x: a.x + (b.x - a.x) * r, y: a.y + (b.y - a.y) * r, t: a.t + (b.t - a.t) * r });
      }
    }
    denso.push(puntos[puntos.length - 1]!);
    expect(kindOf(denso)).toBe("zigzag");
  });

  /**
   * Regresión del otro bug de la ronda 1, y el más caro: `hold` no se reconoció
   * NI UNA VEZ. Un puntero quieto no genera `pointermove`, así que el trazo
   * llegaba con dos muestras y moría en el mínimo de puntos — el único gesto
   * cuya esencia es no moverse era el único que el muestreo por movimiento no
   * podía capturar.
   */
  it("`hold` se reconoce aunque llegue con dos muestras", () => {
    expect(
      kindOf([
        { x: 200, y: 200, t: 0 },
        { x: 200, y: 200, t: 700 },
      ]),
    ).toBe("hold");
  });

  it("dos muestras quietas pero breves siguen siendo un clic, no un `hold`", () => {
    expect(
      kindOf([
        { x: 200, y: 200, t: 0 },
        { x: 200, y: 200, t: 120 },
      ]),
    ).toBe("rechazado:insuficiente");
  });

  it("el re-muestreo conserva los extremos del trazo", () => {
    const trace = zigzagTrace();
    const out = resample(trace, GESTURE.resampleCount);
    expect(out.length).toBe(GESTURE.resampleCount);
    expect(out[0]).toEqual(trace[0]);
    expect(out[out.length - 1]!.x).toBeCloseTo(trace[trace.length - 1]!.x, 3);
  });

  it("el círculo gira siempre igual y el zigzag va y vuelve", () => {
    // Es LA distinción entre los dos, y no es la cantidad de giro: las dos
    // acumulan mucho. Es que el círculo no cambia de sentido nunca.
    const circulo = metricsOf(circleTrace(120));
    const sierra = metricsOf(zigzagTrace());

    expect(circulo.netTurn).toBeGreaterThan(GESTURE.circleMinNetTurn);
    expect(circulo.reversals).toBeLessThanOrEqual(GESTURE.circleMaxReversals);

    expect(sierra.absTurn).toBeGreaterThan(GESTURE.zigzagMinAbsTurn);
    expect(sierra.reversals).toBeGreaterThanOrEqual(GESTURE.zigzagMinReversals);
  });
});

// --- Compilación a composición: sin economía paralela -----------------------

describe("compositionFor", () => {
  const KINDS: readonly GestureKind[] = ["straight", "hold", "circle", "zigzag"];

  it("toda composición generada es válida y traduce a una firma", () => {
    for (const kind of KINDS) {
      expect(() => toSignature(compositionFor(kind, "ember"))).not.toThrow();
    }
  });

  /**
   * La tabla del ADR 0009 §1 se muestra al jugador, así que es una afirmación
   * falsable sobre la economía del ADR 0008. Estos números NO se calculan acá:
   * salen de `costOf` y `requiredExposures`, o sea del catálogo y del motor.
   */
  it.each([
    ["straight", 2, 2],
    ["hold", 3, 3],
    ["circle", 3, 3],
    ["zigzag", 5, 4],
  ] as const)("%s cuesta %i y exige %i exposiciones", (kind, cost, exposures) => {
    const composition = compositionFor(kind, "ember");
    expect(costOf(composition)).toBe(cost);
    expect(requiredExposures(toSignature(composition))).toBe(exposures);
  });

  it("el elemento armado es lo único que cambia entre gestos iguales", () => {
    const brasa = compositionFor("circle", "ember");
    const escarcha = compositionFor("circle", "frost");
    expect({ ...brasa, element: "frost" }).toEqual(escarcha);
    // Y son firmas DISTINTAS: el elemento es una primitiva mecánica, no un color.
    expect(toSignature(brasa)).not.toEqual(toSignature(escarcha));
  });

  it("los cuatro gestos producen cuatro firmas distintas con el mismo elemento", () => {
    const claves = KINDS.map((k) => toSignature(compositionFor(k, "void")).primitives.join("|"));
    expect(new Set(claves).size).toBe(4);
  });
});
