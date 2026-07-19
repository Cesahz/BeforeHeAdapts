// Tests de la conversión de coordenadas.
//
// El bug que estos tests existen para prevenir NO tira excepciones: hace que
// los ataques nazcan corridos y que el juego se sienta mal sin que nadie sepa
// por qué. Por eso se testea con geometrías concretas de monitor —ancho, alto y
// cuadrado— en vez de con una sola caja de laboratorio.

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { scaleOf, toSvg, viewBoxOf, type Rect } from "./viewport.js";

const SIZE = 1000;

/** Escena de `w × h` con el cuadro del ente centrado, como lo arma el CSS. */
function pantalla(w: number, h: number): { escena: Rect; cuadro: Rect } {
  const lado = Math.min(w, h);
  return {
    escena: { left: 0, top: 0, width: w, height: h },
    cuadro: { left: (w - lado) / 2, top: (h - lado) / 2, width: lado, height: lado },
  };
}

const ANCHA = pantalla(1920, 1080);
const ALTA = pantalla(800, 1200);
const CUADRADA = pantalla(900, 900);
const TODAS = [ANCHA, ALTA, CUADRADA];

describe("el cuadro del ente sigue siendo [0, size]²", () => {
  it("el centro del cuadro cae en el centro del sistema del visualizador", () => {
    for (const { escena, cuadro } of TODAS) {
      const centro = toSvg(
        { x: cuadro.left - escena.left + cuadro.width / 2, y: cuadro.top - escena.top + cuadro.height / 2 },
        escena,
        cuadro,
        SIZE,
      );
      expect(centro.x).toBeCloseTo(SIZE / 2, 6);
      expect(centro.y).toBeCloseTo(SIZE / 2, 6);
    }
  });

  it("la esquina del cuadro cae en el origen", () => {
    for (const { escena, cuadro } of TODAS) {
      const origen = toSvg(
        { x: cuadro.left - escena.left, y: cuadro.top - escena.top },
        escena,
        cuadro,
        SIZE,
      );
      expect(origen.x).toBeCloseTo(0, 6);
      expect(origen.y).toBeCloseTo(0, 6);
    }
  });
});

describe("la pared invisible", () => {
  // El defecto que reportó el autor: "el cursor queda en el límite del medio".
  // En una pantalla ancha, el borde izquierdo está MUY afuera del cuadro del
  // ente, y tiene que seguir teniendo coordenadas utilizables.
  it("el borde de una pantalla ancha da coordenadas fuera del cuadro, no recortadas", () => {
    const { escena, cuadro } = ANCHA;
    const izquierda = toSvg({ x: 0, y: 540 }, escena, cuadro, SIZE);
    const derecha = toSvg({ x: 1919, y: 540 }, escena, cuadro, SIZE);

    expect(izquierda.x).toBeLessThan(0);
    expect(derecha.x).toBeGreaterThan(SIZE);
  });

  it("todo punto de la escena cae dentro del viewBox de la capa efímera", () => {
    // Esta es LA propiedad: si fallara, un ataque nacido en ese punto se
    // dibujaría fuera del viewBox y el jugador no vería nada salir de su cursor.
    fc.assert(
      fc.property(
        fc.constantFrom(...TODAS),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        ({ escena, cuadro }, fx, fy) => {
          const punto = toSvg(
            { x: fx * escena.width, y: fy * escena.height },
            escena,
            cuadro,
            SIZE,
          );
          const box = viewBoxOf(escena, cuadro, SIZE);

          expect(punto.x).toBeGreaterThanOrEqual(box.minX - 1e-6);
          expect(punto.x).toBeLessThanOrEqual(box.minX + box.width + 1e-6);
          expect(punto.y).toBeGreaterThanOrEqual(box.minY - 1e-6);
          expect(punto.y).toBeLessThanOrEqual(box.minY + box.height + 1e-6);
        },
      ),
    );
  });
});

describe("el viewBox extendido", () => {
  it("contiene siempre al cuadro del ente completo", () => {
    for (const { escena, cuadro } of TODAS) {
      const box = viewBoxOf(escena, cuadro, SIZE);
      expect(box.minX).toBeLessThanOrEqual(0);
      expect(box.minY).toBeLessThanOrEqual(0);
      expect(box.minX + box.width).toBeGreaterThanOrEqual(SIZE - 1e-6);
      expect(box.minY + box.height).toBeGreaterThanOrEqual(SIZE - 1e-6);
    }
  });

  it("conserva la relación de aspecto de la escena", () => {
    // Si no la conservara, el SVG escalaría distinto en cada eje y el retículo
    // dejaría de coincidir con el cursor real — que es como se vería el bug.
    for (const { escena, cuadro } of TODAS) {
      const box = viewBoxOf(escena, cuadro, SIZE);
      expect(box.width / box.height).toBeCloseTo(escena.width / escena.height, 6);
    }
  });

  it("en una pantalla cuadrada coincide exactamente con la capa canónica", () => {
    const { escena, cuadro } = CUADRADA;
    const box = viewBoxOf(escena, cuadro, SIZE);
    expect(box).toEqual({ minX: 0, minY: 0, width: SIZE, height: SIZE });
  });
});

describe("casos degenerados", () => {
  it("no divide por cero con el cuadro sin medir todavía", () => {
    const vacio: Rect = { left: 0, top: 0, width: 0, height: 0 };
    expect(scaleOf(vacio, SIZE)).toBe(1);
    expect(toSvg({ x: 10, y: 10 }, vacio, vacio, SIZE)).toEqual({ x: 10, y: 10 });
  });
});
