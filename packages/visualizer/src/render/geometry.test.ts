// Especificación de la geometría del render.
//
// **En rojo a propósito**: define qué tiene que cumplir la matemática del
// dibujo antes de que exista, igual que `contract.test.ts` definió el motor.
//
// Los invariantes que importan son propiedades, no casos: que un vértice esté
// *siempre* sobre el radio, que un decaimiento sea *siempre* monótono, que el
// jitter dé *siempre* el mismo valor. Por eso el grueso va con fast-check y no
// con ejemplos sueltos.

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  contractionScale,
  hashString,
  jitter,
  polar,
  regularPolygon,
  shockwaveOpacity,
  shockwaveRadius,
  svgNumber,
  type Point,
} from "./geometry.js";

const ORIGIN: Point = { x: 0, y: 0 };
const TAU = Math.PI * 2;

/** Distancia euclídea, para aseverar que algo cae sobre un radio. */
function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

const anyCenter = fc.record({
  x: fc.double({ min: -500, max: 500, noNaN: true }),
  y: fc.double({ min: -500, max: 500, noNaN: true }),
});
const anyRadius = fc.double({ min: 0.1, max: 1_000, noNaN: true });
const anyAngle = fc.double({ min: -TAU * 2, max: TAU * 2, noNaN: true });

describe("polar — coordenadas orbitales", () => {
  it("coloca el punto exactamente sobre el radio pedido", () => {
    fc.assert(
      fc.property(anyCenter, anyRadius, anyAngle, (center, radius, angle) => {
        expect(distance(center, polar(center, radius, angle))).toBeCloseTo(radius, 6);
      }),
    );
  });

  it("con radio 0 devuelve el centro, sea cual sea el ángulo", () => {
    fc.assert(
      fc.property(anyCenter, anyAngle, (center, angle) => {
        const p = polar(center, 0, angle);
        expect(p.x).toBeCloseTo(center.x, 9);
        expect(p.y).toBeCloseTo(center.y, 9);
      }),
    );
  });

  // La convención de ADR 0007: 0 arriba, horario. Es la que hace legible el
  // layout de órbitas, y es distinta de la matemática estándar — se fija acá
  // para que nadie la "corrija" sin romper un test.
  it("ubica el ángulo 0 arriba y avanza en sentido horario", () => {
    const arriba = polar(ORIGIN, 10, 0);
    expect(arriba.x).toBeCloseTo(0, 9);
    expect(arriba.y).toBeCloseTo(-10, 9); // y crece hacia abajo en SVG

    const derecha = polar(ORIGIN, 10, Math.PI / 2);
    expect(derecha.x).toBeCloseTo(10, 9);
    expect(derecha.y).toBeCloseTo(0, 9);
  });

  it("es periódica en 2π", () => {
    fc.assert(
      fc.property(anyRadius, anyAngle, (radius, angle) => {
        const a = polar(ORIGIN, radius, angle);
        const b = polar(ORIGIN, radius, angle + TAU);
        expect(a.x).toBeCloseTo(b.x, 6);
        expect(a.y).toBeCloseTo(b.y, 6);
      }),
    );
  });
});

describe("regularPolygon — la silueta del ente", () => {
  const anySides = fc.integer({ min: 3, max: 64 });

  it("devuelve exactamente `sides` vértices", () => {
    fc.assert(
      fc.property(anyCenter, anyRadius, anySides, (center, radius, sides) => {
        expect(regularPolygon(center, radius, sides)).toHaveLength(sides);
      }),
    );
  });

  it("pone todos los vértices sobre el radio", () => {
    fc.assert(
      fc.property(anyCenter, anyRadius, anySides, (center, radius, sides) => {
        for (const v of regularPolygon(center, radius, sides)) {
          expect(distance(center, v)).toBeCloseTo(radius, 6);
        }
      }),
    );
  });

  it("reparte los vértices en ángulos equiespaciados", () => {
    fc.assert(
      fc.property(anyRadius, anySides, (radius, sides) => {
        const vs = regularPolygon(ORIGIN, radius, sides);
        const esperado = distance(vs[0]!, vs[1]!);
        // Todos los lados miden lo mismo: eso *es* ser regular.
        for (let i = 0; i < sides; i += 1) {
          expect(distance(vs[i]!, vs[(i + 1) % sides]!)).toBeCloseTo(esperado, 6);
        }
      }),
    );
  });

  it("arranca en `rotation` y respeta la convención de polar", () => {
    const [primero] = regularPolygon(ORIGIN, 10, 5);
    expect(primero!.x).toBeCloseTo(0, 9);
    expect(primero!.y).toBeCloseTo(-10, 9);
  });

  it("es determinista: mismas entradas, mismos vértices", () => {
    fc.assert(
      fc.property(anyCenter, anyRadius, anySides, (center, radius, sides) => {
        expect(regularPolygon(center, radius, sides)).toEqual(
          regularPolygon(center, radius, sides),
        );
      }),
    );
  });

  // Asimilar un cluster suma un vértice (ADR 0007 §4). Menos de 3 no es una
  // silueta, es un error del llamador: que reviente fuerte y temprano.
  it("rechaza menos de 3 lados", () => {
    for (const sides of [-1, 0, 1, 2]) {
      expect(() => regularPolygon(ORIGIN, 10, sides)).toThrow();
    }
  });

  it("rechaza un número de lados no entero", () => {
    expect(() => regularPolygon(ORIGIN, 10, 5.5)).toThrow();
  });
});

describe("jitter — vibración determinista", () => {
  const anySeed = fc.integer({ min: 0, max: 100_000 });
  const anyIndex = fc.integer({ min: 0, max: 512 });

  // El invariante que hace que un replay sea un replay.
  it("da siempre el mismo valor para la misma semilla", () => {
    fc.assert(
      fc.property(anySeed, anyIndex, (seed, index) => {
        expect(jitter(seed, index)).toBe(jitter(seed, index));
      }),
    );
  });

  it("se queda dentro de [-1, 1]", () => {
    fc.assert(
      fc.property(anySeed, anyIndex, (seed, index) => {
        const v = jitter(seed, index);
        expect(v).toBeGreaterThanOrEqual(-1);
        expect(v).toBeLessThanOrEqual(1);
        expect(Number.isFinite(v)).toBe(true);
      }),
    );
  });

  // Si vibrara igual en todos los vértices el ente pulsaría en vez de vibrar.
  it("no devuelve el mismo valor para todos los vértices de una semilla", () => {
    const valores = new Set(Array.from({ length: 16 }, (_, i) => jitter(42, i)));
    expect(valores.size).toBeGreaterThan(8);
  });

  // Y si vibrara igual en cada frame, la vibración no se vería.
  it("no devuelve el mismo valor para todas las semillas de un vértice", () => {
    const valores = new Set(Array.from({ length: 16 }, (_, s) => jitter(s, 0)));
    expect(valores.size).toBeGreaterThan(8);
  });
});

describe("hashString — rumbo estable por firma", () => {
  it("da siempre el mismo valor para el mismo string", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(hashString(s)).toBe(hashString(s));
      }),
    );
  });

  it("devuelve un entero de 32 bits sin signo", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const h = hashString(s);
        expect(Number.isInteger(h)).toBe(true);
        expect(h).toBeGreaterThanOrEqual(0);
        expect(h).toBeLessThanOrEqual(0xffffffff);
      }),
    );
  });

  // Los clusterId reales son firmas canónicas: comparten prefijos y separadores.
  // Si el hash los mapeara juntos, firmas distintas atacarían desde el mismo lado.
  it("separa strings parecidos", () => {
    const ids = ["fuego", "fuego|hielo", "fuego|rayo", "hielo", "hielo|fuego"];
    expect(new Set(ids.map(hashString)).size).toBe(ids.length);
  });
});

describe("contractionScale — el golpe de la exposición", () => {
  const anySpan = fc.integer({ min: 1, max: 12 });
  const anyPeak = fc.double({ min: 0.01, max: 0.9, noNaN: true });

  it("se contrae al máximo en el frame del impacto", () => {
    fc.assert(
      fc.property(anySpan, anyPeak, (span, peak) => {
        expect(contractionScale(0, span, peak)).toBeCloseTo(1 - peak, 9);
      }),
    );
  });

  it("está de vuelta en 1 al terminar la ventana", () => {
    fc.assert(
      fc.property(anySpan, anyPeak, (span, peak) => {
        expect(contractionScale(span, span, peak)).toBeCloseTo(1, 9);
        expect(contractionScale(span + 5, span, peak)).toBeCloseTo(1, 9);
      }),
    );
  });

  it("recupera monótonamente, nunca rebota", () => {
    fc.assert(
      fc.property(anySpan, anyPeak, (span, peak) => {
        for (let age = 0; age < span + 3; age += 1) {
          expect(contractionScale(age + 1, span, peak)).toBeGreaterThanOrEqual(
            contractionScale(age, span, peak) - 1e-9,
          );
        }
      }),
    );
  });
});

describe("shockwave — el snap de R1", () => {
  const anySpan = fc.integer({ min: 1, max: 12 });

  it("la opacidad es total en el frame del snap y nula al terminar", () => {
    fc.assert(
      fc.property(anySpan, (span) => {
        expect(shockwaveOpacity(0, span)).toBeCloseTo(1, 9);
        expect(shockwaveOpacity(span, span)).toBe(0);
        expect(shockwaveOpacity(span + 3, span)).toBe(0);
      }),
    );
  });

  it("la opacidad decae monótonamente", () => {
    fc.assert(
      fc.property(anySpan, (span) => {
        for (let age = 0; age < span + 3; age += 1) {
          expect(shockwaveOpacity(age + 1, span)).toBeLessThanOrEqual(
            shockwaveOpacity(age, span) + 1e-9,
          );
        }
      }),
    );
  });

  it("el radio se expande monótonamente desde el borde del ente", () => {
    fc.assert(
      fc.property(anySpan, (span) => {
        expect(shockwaveRadius(0, span, 40, 200)).toBeCloseTo(40, 9);
        expect(shockwaveRadius(span, span, 40, 200)).toBeCloseTo(200, 9);
        for (let age = 0; age < span; age += 1) {
          expect(shockwaveRadius(age + 1, span, 40, 200)).toBeGreaterThanOrEqual(
            shockwaveRadius(age, span, 40, 200) - 1e-9,
          );
        }
      }),
    );
  });
});

describe("svgNumber — números que no rompen el SVG ni el determinismo", () => {
  const anyValue = fc.double({ min: -1e6, max: 1e6, noNaN: true });

  // SVG no acepta notación exponencial en varios contextos de atributo.
  it("nunca emite notación exponencial", () => {
    fc.assert(
      fc.property(fc.double({ min: -1e-6, max: 1e-6, noNaN: true }), (v) => {
        expect(svgNumber(v)).not.toMatch(/e/i);
      }),
    );
    expect(svgNumber(0.0000001)).not.toMatch(/e/i);
  });

  // `-0` es válido pero hace que dos corridas idénticas difieran en el string.
  it("normaliza el cero negativo", () => {
    expect(svgNumber(-0)).toBe("0");
    expect(svgNumber(-0.00000001)).toBe("0");
  });

  it("no arrastra cola de precisión flotante", () => {
    expect(svgNumber(0.1 + 0.2)).toBe("0.3");
    expect(svgNumber(1 / 3)).toBe("0.333");
  });

  it("recorta los ceros a la derecha", () => {
    expect(svgNumber(10)).toBe("10");
    expect(svgNumber(10.5)).toBe("10.5");
    expect(svgNumber(10.5000001)).toBe("10.5");
  });

  it("es estable: el mismo valor da siempre el mismo string", () => {
    fc.assert(
      fc.property(anyValue, (v) => {
        expect(svgNumber(v)).toBe(svgNumber(v));
      }),
    );
  });

  it("se mantiene cerca del valor original", () => {
    fc.assert(
      fc.property(anyValue, (v) => {
        expect(Number(svgNumber(v))).toBeCloseTo(v, 2);
      }),
    );
  });

  it("rechaza lo que no es un número finito", () => {
    for (const v of [NaN, Infinity, -Infinity]) {
      expect(() => svgNumber(v)).toThrow();
    }
  });
});
