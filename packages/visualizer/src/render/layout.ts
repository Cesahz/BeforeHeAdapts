// render/layout.ts — de un frame a posiciones en pantalla.
//
// Esta es la capa donde el contrato se vuelve geometría: la confianza pasa a
// ser distancia al centro, la similitud pasa a ser un hilo, y los clusters
// asimilados pasan a ser vértices del ente. Sigue siendo pura y sin markup —
// no emite una sola etiqueta SVG, solo dice dónde va cada cosa.
//
// Nada acá recalcula el motor: todo sale de `Frame`, que ya es una lectura del
// núcleo. La única función de dominio que se invoca es `sim`, y se invoca del
// núcleo, no reimplementada (ADR 0007 §3).

import { requiredExposures, sim, type ClusterId } from "@beforeheadapts/core";
import type { ClusterFrame, Frame } from "../frames/index.js";
import { hashString, polar, type Point } from "./geometry.js";
import { centerOf, type Theme } from "./theme.js";

const TAU = Math.PI * 2;

/** Un cluster ubicado en su órbita. */
export interface NodeLayout {
  readonly clusterId: ClusterId;
  readonly center: Point;
  readonly radius: number;
  readonly adapted: boolean;
  readonly confidence: number;
  /**
   * Avance hacia el salto, en `[0, 1]`. Es lo que dibuja la cristalización:
   * el aviso de que la ventana se está cerrando (§4 del diseño del adaptador).
   */
  readonly progress: number;
}

/** Un hilo de similitud entre dos clusters (R6). */
export interface ThreadLayout {
  readonly from: ClusterId;
  readonly to: ClusterId;
  readonly similarity: number;
  readonly a: Point;
  readonly b: Point;
}

/**
 * Una cicatriz: la marca permanente que deja un cluster asimilado sobre el
 * cuerpo del ente (§5 del diseño del adaptador).
 *
 * El §5 pide que las modificaciones **se acumulen**, de modo que el cuerpo del
 * ente sea un registro visible de todo lo que aprendió — un ente muy adaptado
 * se *ve* distinto y su historia es legible en su forma.
 *
 * La cicatriz se ancla en el rumbo desde el que esa firma atacaba, así que la
 * marca aparece **donde el ente venía recibiendo los golpes**. Eso convierte la
 * deformación en algo que se puede leer: la zona endurecida es exactamente la
 * que ese ataque ya no va a poder volver a perforar.
 */
export interface ScarLayout {
  readonly clusterId: ClusterId;
  /** Rumbo del ataque que la produjo. El mismo de `bearingOf`. */
  readonly bearing: number;
  /**
   * Magnitud en `(0, 1]`, según la **complejidad** del cluster asimilado.
   *
   * El §5 lo pide explícitamente: complejidad baja → cambio superficial,
   * complejidad alta → cambio estructural. La complejidad se lee de `N(c)`, que
   * es la medida que el contrato ya tiene para eso (R2), en vez de inventar una
   * escala nueva que pudiera contradecirla.
   */
  readonly magnitude: number;
}

/** Todo lo que hay que ubicar en un frame, ya resuelto en coordenadas. */
export interface Layout {
  readonly nodes: readonly NodeLayout[];
  readonly threads: readonly ThreadLayout[];
  /** Vértices del ente: `baseVertices + clusters asimilados`. */
  readonly coreVertices: number;
  /** Cicatrices acumuladas, una por cluster asimilado, en orden de aparición. */
  readonly scars: readonly ScarLayout[];
}

/**
 * Resuelve las posiciones de un frame.
 *
 * El orden de los nodos es el del frame, que a su vez es el orden de primera
 * aparición que conserva el `Map` del motor. De ahí sale la estabilidad del
 * layout: un cluster no salta de lugar porque apareció otro.
 */
export function layoutOf(frame: Frame, theme: Theme): Layout {
  const center = centerOf(theme);
  const nodes = frame.clusters.map((cluster, i) =>
    nodeOf(cluster, i, frame.clusters.length, center, theme),
  );

  return Object.freeze({
    nodes: Object.freeze(nodes) as readonly NodeLayout[],
    threads: threadsOf(frame.clusters, nodes, theme),
    coreVertices: theme.baseVertices + frame.clusters.filter((c) => c.adapted).length,
    scars: scarsOf(frame.clusters, theme),
  });
}

/**
 * Las cicatrices de los clusters ya asimilados.
 *
 * Deriva **solo del frame**, como todo el resto del render: no hay estado visual
 * acumulado en ningún lado. Que la marca "persista" no es memoria del
 * renderizador — es que el cluster sigue adaptado en cada frame posterior, así
 * que su cicatriz se vuelve a derivar idéntica. Mismo log, misma forma final
 * (§5, "determinismo").
 */
function scarsOf(clusters: readonly ClusterFrame[], theme: Theme): readonly ScarLayout[] {
  const scars = clusters
    .filter((cluster) => cluster.adapted)
    .map((cluster) => {
      // `N(c)` es la medida de complejidad que el contrato ya define (R2).
      const required = requiredExposures(cluster.signature);
      const span = Math.max(1, theme.scarComplexityRef - 1);
      const crudo = Math.min(1, (required - 1) / span);
      // Piso de 0,25: una firma simple deja marca chica, nunca marca invisible.
      // Un cluster asimilado que no se viera sería el render callando el único
      // cambio que R1 considera irreversible.
      return Object.freeze({
        clusterId: cluster.clusterId,
        bearing: bearingOf(cluster.clusterId),
        magnitude: 0.25 + 0.75 * crudo,
      });
    });

  return Object.freeze(scars);
}

/**
 * Rumbo desde el que ataca una firma, en radianes.
 *
 * Se deriva del `clusterId`, no de la posición del nodo, por una razón de
 * orden de eventos: `ResistanceApplied` se emite **antes** que
 * `ExposureRecorded`, así que en el primer golpe de una firma nueva el cluster
 * todavía no existe en el layout y no habría nodo del cual salir.
 *
 * El efecto secundario es bueno: cada firma llega siempre desde la misma
 * dirección, así que el patrón de ataque se vuelve legible a lo largo del
 * replay en vez de parecer ruido.
 */
export function bearingOf(clusterId: ClusterId): number {
  return (hashString(clusterId) / 0x100000000) * TAU;
}

function nodeOf(
  cluster: ClusterFrame,
  index: number,
  total: number,
  center: Point,
  theme: Theme,
): NodeLayout {
  // Confianza plena pega el nodo a la órbita interior; confianza nula lo manda
  // al borde del olvido. R4 se lee como distancia, no como un número.
  const orbit =
    theme.orbitInner + (theme.orbitOuter - theme.orbitInner) * (1 - cluster.confidence);
  const required = requiredExposures(cluster.signature);

  return Object.freeze({
    clusterId: cluster.clusterId,
    center: polar(center, orbit, (index / total) * TAU),
    // Una firma más compleja exige más exposiciones y pesa más en pantalla.
    radius: theme.nodeRadius + (required - 1) * theme.nodeGrowth,
    adapted: cluster.adapted,
    confidence: cluster.confidence,
    progress: cluster.progress,
  });
}

/**
 * Hilos entre los pares que superan el umbral de similitud.
 *
 * El bucle recorre solo el triángulo superior (`j > i`): cada par se emite una
 * sola vez. Dibujarlo dos veces duplicaría la opacidad y el par se leería más
 * fuerte de lo que su similitud dice.
 */
function threadsOf(
  clusters: readonly ClusterFrame[],
  nodes: readonly NodeLayout[],
  theme: Theme,
): readonly ThreadLayout[] {
  const threads: ThreadLayout[] = [];

  for (let i = 0; i < clusters.length; i += 1) {
    for (let j = i + 1; j < clusters.length; j += 1) {
      const similarity = sim(clusters[i]!.signature, clusters[j]!.signature);
      if (similarity < theme.similarityThreshold) continue;

      threads.push(
        Object.freeze({
          from: clusters[i]!.clusterId,
          to: clusters[j]!.clusterId,
          similarity,
          a: nodes[i]!.center,
          b: nodes[j]!.center,
        }),
      );
    }
  }

  return Object.freeze(threads);
}
