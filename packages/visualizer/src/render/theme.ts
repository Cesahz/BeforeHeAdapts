// render/theme.ts — la calibración visual, en un solo lugar.
//
// Acá no hay lógica: son las constantes que definen cómo se ve y cómo respira
// el replay. Viven juntas y con nombre para que ajustar la estética sea editar
// datos, no cazar números mágicos repartidos por el serializador.
//
// **Las ventanas se miden en frames, no en milisegundos** (ADR 0007 §1). Esa es
// la razón de que el DOM y el gif exportado salgan idénticos: no hay reloj en
// ningún lado, solo distancia en eventos respecto del que disparó el efecto.

import type { Point } from "./geometry.js";

/** Paleta: telemetría, no dashboard. Fondo casi negro y trazo frío. */
export interface Palette {
  readonly background: string;
  /** El ente: geometría limpia y fría mientras no lo golpeen. */
  readonly core: string;
  /** Nodos de cluster todavía no adaptados. */
  readonly node: string;
  /** Hilos de similitud (R6): presentes pero de fondo. */
  readonly thread: string;
  /** El vector entrante de R5, antes de que la curva lo apague. */
  readonly incoming: string;
  /** Lo asimilado: color de advertencia. El ente ya sabe defenderse de esto. */
  readonly assimilated: string;
}

export interface Theme {
  readonly palette: Palette;
  /** Lado del lienzo cuadrado, en unidades de usuario del SVG. */
  readonly size: number;
  /** Radio base del ente, antes de contracción. */
  readonly coreRadius: number;
  /** Vértices del ente sin ningún cluster asimilado. */
  readonly baseVertices: number;
  /** Radio de la órbita con confianza plena (`confidence = 1`). */
  readonly orbitInner: number;
  /** Radio de la órbita con confianza nula: el borde del olvido. */
  readonly orbitOuter: number;
  /** Radio de un nodo con `N(c) = 1`, y cuánto crece por exposición exigida. */
  readonly nodeRadius: number;
  readonly nodeGrowth: number;
  /** Similitud mínima para que dos nodos se conecten con un hilo. */
  readonly similarityThreshold: number;
  /** Opacidad de un hilo con similitud 1; se escala por `sim`. */
  readonly threadOpacity: number;
  /** Grosor del vector entrante con efectividad plena. */
  readonly incomingWidth: number;
  /** Frames que dura la contracción del ente, y cuánto se encoge. */
  readonly contractionSpan: number;
  readonly contractionPeak: number;
  /** Frames que dura la onda expansiva del snap, y hasta dónde llega. */
  readonly shockwaveSpan: number;
  readonly shockwaveRadius: number;
  /** Amplitud de la vibración de vértices, en unidades de usuario. */
  readonly vibration: number;
  /**
   * Cristalización: el aviso de que `k` se acerca a `N(c)` (§4 del diseño).
   *
   * Un cluster a medio adaptar dibuja un anillo facetado que se endurece a
   * medida que avanza. Es lo que convierte la carrera de tempo en imagen: el
   * jugador ve cerrarse la ventana antes de que el salto ocurra, en vez de
   * enterarse cuando ya es tarde.
   */
  readonly crystalOpacity: number;
  /** Cuánto crece el anillo respecto del nodo, con avance pleno. */
  readonly crystalGrowth: number;
  /** Caras del anillo facetado. */
  readonly crystalFacets: number;
}

export const defaultTheme: Theme = Object.freeze({
  palette: Object.freeze({
    background: "#05070a",
    core: "#7fd4e8",
    node: "#4a6c7a",
    thread: "#3a5560",
    incoming: "#e8f4f8",
    assimilated: "#e8a33d",
  }),
  size: 600,
  coreRadius: 90,
  // Cinco es el mínimo que se lee como "geometría deliberada" y no como un
  // triángulo o un cuadrado accidental. Cada cluster asimilado suma uno.
  baseVertices: 5,
  orbitInner: 170,
  orbitOuter: 280,
  nodeRadius: 5,
  nodeGrowth: 1.5,
  // Jaccard de 0.3 ya es parentesco visible sin llenar la pantalla de hilos.
  similarityThreshold: 0.3,
  threadOpacity: 0.4,
  incomingWidth: 6,
  contractionSpan: 3,
  contractionPeak: 0.12,
  shockwaveSpan: 4,
  shockwaveRadius: 300,
  vibration: 4,
  crystalOpacity: 0.85,
  crystalGrowth: 1.6,
  // Seis caras: leen como cristal sin competir con el polígono del ente.
  crystalFacets: 6,
});

/** El centro del lienzo: donde vive el ente. */
export function centerOf(theme: Theme): Point {
  const half = theme.size / 2;
  return { x: half, y: half };
}
