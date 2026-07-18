// Especificación del layout: de un frame a posiciones en pantalla.
//
// **En rojo a propósito.** Acá se decide dónde va cada cosa, que es donde el
// contrato se vuelve visible: la confianza es distancia al centro, la
// similitud es un hilo, y los clusters asimilados cambian la silueta del ente.
// Si el layout miente, el replay muestra un motor que no es el que corrió.

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  canonicalize,
  clusterKeyOf,
  createInitialState,
  process,
  requiredExposures,
  sim,
  type StimulusSignature,
} from "@beforeheadapts/core";
import { framesFrom, type Frame } from "../frames/index.js";
import { layoutOf } from "./layout.js";
import { centerOf, defaultTheme } from "./theme.js";

const theme = defaultTheme;
const center = centerOf(theme);

const fuego = canonicalize(["fuego"], 1);
const fuegoHielo = canonicalize(["fuego", "hielo"], 1);
const viento = canonicalize(["viento"], 1);

/** Último frame de una sala donde se procesan las firmas dadas, en orden. */
function lastFrameOf(...steps: readonly StimulusSignature[]): Frame {
  let state = createInitialState({}, "sala-layout");
  steps.forEach((signature, i) => {
    state = process(state, signature, 1_000 + i * 100).state;
  });
  return framesFrom(state.log).at(-1)!;
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

describe("layoutOf — nodos en órbita", () => {
  it("da un nodo por cluster, en el mismo orden que el frame", () => {
    const frame = lastFrameOf(fuego, fuegoHielo, viento);
    const layout = layoutOf(frame, theme);

    expect(layout.nodes.map((n) => n.clusterId)).toEqual(
      frame.clusters.map((c) => c.clusterId),
    );
  });

  // La confianza (R4) es distancia al centro: la memoria que se desvanece se
  // ve como un nodo que se aleja hasta perderse, no como un número que baja.
  it("traduce confianza en radio orbital: más confianza, más cerca", () => {
    const frame = lastFrameOf(fuego);
    const layout = layoutOf(frame, theme);
    const nodo = layout.nodes[0]!;
    const confianza = frame.clusters[0]!.confidence;

    const esperado =
      theme.orbitInner + (theme.orbitOuter - theme.orbitInner) * (1 - confianza);
    expect(distance(center, nodo.center)).toBeCloseTo(esperado, 6);
  });

  it("pone los nodos sobre la órbita interior cuando la confianza es plena", () => {
    const frame = lastFrameOf(fuego);
    // La política permanente por defecto no decae: confianza 1 en toda la sala.
    expect(frame.clusters[0]!.confidence).toBe(1);
    expect(distance(center, layoutOf(frame, theme).nodes[0]!.center)).toBeCloseTo(
      theme.orbitInner,
      6,
    );
  });

  it("reparte los nodos en ángulos equiespaciados según su orden", () => {
    const frame = lastFrameOf(fuego, fuegoHielo, viento);
    const { nodes } = layoutOf(frame, theme);

    // Tres nodos a la misma distancia del centro: los lados del triángulo que
    // forman tienen que ser iguales si están bien repartidos.
    const lados = nodes.map((n, i) => distance(n.center, nodes[(i + 1) % nodes.length]!.center));
    for (const lado of lados) {
      expect(lado).toBeCloseTo(lados[0]!, 6);
    }
  });

  // Firma compleja = nodo más pesado. N(c) se lee de un vistazo por tamaño.
  it("escala el radio del nodo con N(c)", () => {
    const frame = lastFrameOf(fuego, fuegoHielo);
    const { nodes } = layoutOf(frame, theme);

    const simple = nodes.find((n) => n.clusterId === clusterKeyOf(fuego))!;
    const compleja = nodes.find((n) => n.clusterId === clusterKeyOf(fuegoHielo))!;

    expect(requiredExposures(fuegoHielo)).toBeGreaterThan(requiredExposures(fuego));
    expect(compleja.radius).toBeGreaterThan(simple.radius);
  });

  it("marca los nodos adaptados", () => {
    const n = requiredExposures(fuego);
    const frame = lastFrameOf(...Array.from({ length: n }, () => fuego));
    expect(layoutOf(frame, theme).nodes[0]!.adapted).toBe(true);
  });

  it("mantiene todo nodo dentro del lienzo", () => {
    const frame = lastFrameOf(fuego, fuegoHielo, viento);
    for (const nodo of layoutOf(frame, theme).nodes) {
      expect(nodo.center.x).toBeGreaterThanOrEqual(0);
      expect(nodo.center.x).toBeLessThanOrEqual(theme.size);
      expect(nodo.center.y).toBeGreaterThanOrEqual(0);
      expect(nodo.center.y).toBeLessThanOrEqual(theme.size);
    }
  });
});

describe("layoutOf — hilos de similitud (R6)", () => {
  // `fuego` y `fuego|hielo` comparten una primitiva de dos: Jaccard = 0.5.
  it("conecta los clusters que superan el umbral de similitud", () => {
    expect(sim(fuego, fuegoHielo)).toBeGreaterThanOrEqual(theme.similarityThreshold);

    const { threads } = layoutOf(lastFrameOf(fuego, fuegoHielo), theme);
    expect(threads).toHaveLength(1);
    expect(threads[0]!.similarity).toBeCloseTo(sim(fuego, fuegoHielo), 9);
  });

  it("no conecta los clusters que no se parecen", () => {
    expect(sim(fuego, viento)).toBeLessThan(theme.similarityThreshold);
    expect(layoutOf(lastFrameOf(fuego, viento), theme).threads).toEqual([]);
  });

  it("no conecta un cluster consigo mismo", () => {
    const { threads } = layoutOf(lastFrameOf(fuego, fuegoHielo), theme);
    for (const hilo of threads) {
      expect(hilo.from).not.toBe(hilo.to);
    }
  });

  // Un hilo por par, no dos: dibujarlo dos veces duplica la opacidad y el par
  // se ve más fuerte de lo que su similitud dice.
  it("emite cada par una sola vez", () => {
    const { threads } = layoutOf(lastFrameOf(fuego, fuegoHielo, viento), theme);
    const pares = threads.map((t) => [t.from, t.to].sort().join("↔"));
    expect(new Set(pares).size).toBe(pares.length);
  });

  it("ancla los extremos del hilo en los centros de sus nodos", () => {
    const { nodes, threads } = layoutOf(lastFrameOf(fuego, fuegoHielo), theme);
    const nodoDe = (id: string) => nodes.find((n) => n.clusterId === id)!;

    for (const hilo of threads) {
      expect(hilo.a).toEqual(nodoDe(hilo.from).center);
      expect(hilo.b).toEqual(nodoDe(hilo.to).center);
    }
  });

  it("no emite hilos con un solo cluster", () => {
    expect(layoutOf(lastFrameOf(fuego), theme).threads).toEqual([]);
  });
});

describe("layoutOf — la silueta del ente", () => {
  // Ojo con la firma a usar acá: por R2 una firma simple exige **una sola**
  // exposición, así que `fuego` ya queda adaptado en el primer golpe. Para ver
  // el ente sin asimilar hace falta una firma compuesta a medio camino.
  it("arranca en los vértices base sin nada asimilado", () => {
    const frame = lastFrameOf(fuegoHielo);
    expect(frame.clusters[0]!.adapted).toBe(false);
    expect(layoutOf(frame, theme).coreVertices).toBe(theme.baseVertices);
  });

  // R1 hecho silueta: asimilar cambia la forma del ente, y es permanente.
  it("suma un vértice por cluster asimilado", () => {
    const n = requiredExposures(fuego);
    const frame = lastFrameOf(...Array.from({ length: n }, () => fuego));
    expect(frame.clusters[0]!.adapted).toBe(true);
    expect(layoutOf(frame, theme).coreVertices).toBe(theme.baseVertices + 1);
  });
});

describe("layoutOf — determinismo", () => {
  it("da el mismo layout para el mismo frame", () => {
    const frame = lastFrameOf(fuego, fuegoHielo, viento);
    expect(layoutOf(frame, theme)).toEqual(layoutOf(frame, theme));
  });

  it("no depende del contenido del clusterId, solo de su orden", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 6 }), (cantidad) => {
        const firmas = Array.from({ length: cantidad }, (_, i) =>
          canonicalize([`prim-${i}`], 1),
        );
        const layout = layoutOf(lastFrameOf(...firmas), theme);
        expect(layout.nodes).toHaveLength(cantidad);
      }),
    );
  });
});
