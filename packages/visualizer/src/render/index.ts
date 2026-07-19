// render/ — de la secuencia de frames a SVG.
//
// La API va sobre la **secuencia completa**, no sobre un frame suelto
// (ADR 0007 §1). No es capricho: los efectos que dan lectura al contrato duran
// más de un evento —la onda expansiva del snap, la vibración tras el impacto— y
// un `renderFrame(frame)` aislado no tiene de dónde saber cuántos eventos
// pasaron desde que se dispararon. Mirar hacia atrás una ventana acotada
// resuelve eso sin meter un reloj ni un game-loop: **el decaimiento se mide en
// frames**, así que el DOM y el gif exportado salen idénticos por construcción.
//
// Sigue siendo puro: `renderFrames(f)[i]` es siempre el mismo string, byte a
// byte. Nada acá toca el DOM, el disco ni el tiempo. Montar y exportar son
// adaptadores aparte.

import type { EngineEvent } from "@beforeheadapts/core";
import { clusterKeyOf } from "@beforeheadapts/core";
import type { Frame } from "../frames/index.js";
import { subSeed } from "../frames/densify.js";
import {
  contractionScale,
  jitter,
  polar,
  regularPolygon,
  shockwaveOpacity,
  shockwaveRadius,
  type Point,
} from "./geometry.js";
import { bearingOf, layoutOf, type Layout } from "./layout.js";
import { centerOf, defaultTheme, type Theme } from "./theme.js";
import { el, pointsAttr, svg } from "./svg.js";

const TAU = Math.PI * 2;

export interface RenderOptions {
  readonly theme?: Theme;
  /**
   * `seq` de los eventos cuyo VIAJE ya dibuja la capa efímera (ADR 0010,
   * enmienda P3).
   *
   * Cada capa es dueña de un tramo de la historia del evento: la efímera es
   * dueña del viaje —y solo existe en vivo—, la canónica es dueña del impacto
   * —y existe siempre—. Nunca dos dueños del mismo tramo. Sin esto, un ataque
   * por gesto se dibujaba dos veces en vivo: el trazador efímero volando hacia
   * el ente y, encima, el vector canónico de `ResistanceApplied` apareciendo de
   * golpe con otra dirección.
   *
   * Solo la arena en vivo lo setea. **El replay jamás lo pasa** y dibuja el
   * vector completo, exactamente como hoy: la capa efímera no se grabó, así que
   * si el replay también se lo callara nadie dibujaría ese tramo.
   *
   * La pureza queda intacta: mismas entradas → misma salida. La divergencia
   * entre vivo y replay vive DECLARADA en las opciones, no escondida en un `if`
   * que mire si hay DOM.
   */
  readonly ephemeralOwnedSeqs?: ReadonlySet<number>;
}

/**
 * Renderiza toda la secuencia: un SVG por frame, en el orden del log.
 *
 * Es la API primaria. `renderFrame` existe para pedir uno solo, pero recibe
 * igual la secuencia porque sin ella no puede resolver los efectos en curso.
 */
export function renderFrames(
  frames: readonly Frame[],
  options: RenderOptions = {},
): readonly string[] {
  return Object.freeze(frames.map((_, i) => renderAt(frames, i, options)));
}

/** Un frame de la secuencia. Ver `renderFrames` para por qué pide el arreglo. */
export function renderFrame(
  frames: readonly Frame[],
  index: number,
  options: RenderOptions = {},
): string {
  if (!Number.isInteger(index) || index < 0 || index >= frames.length) {
    throw new RangeError(`no hay frame en el índice ${index}`);
  }
  return renderAt(frames, index, options);
}

function renderAt(frames: readonly Frame[], index: number, options: RenderOptions): string {
  const theme = options.theme ?? defaultTheme;
  const frame = frames[index]!;
  const layout = layoutOf(frame, theme);
  const center = centerOf(theme);

  // Cuánto hace que pegaron y cuánto hace que el ente asimiló algo. `Infinity`
  // cuando nunca pasó: las funciones de decaimiento ya devuelven reposo ahí.
  const sinceHit = framesSince(frames, index, "ExposureRecorded");
  const sinceSnap = framesSince(frames, index, "AdaptationCompleted");

  const scale = contractionScale(sinceHit, theme.contractionSpan, theme.contractionPeak);
  const radius = theme.coreRadius * scale;

  // Las capas van de atrás hacia adelante. El vector entrante pasa por debajo
  // del ente para que se lea como algo que impacta, no como algo encima.
  return svg(
    theme.size,
    theme.size,
    [
      el("rect", {
        width: theme.size,
        height: theme.size,
        fill: theme.palette.background,
      }),
      ...threadLayer(layout, theme),
      ...incomingLayer(frame, center, radius, theme, options.ephemeralOwnedSeqs),
      shockwaveLayer(sinceSnap, center, radius, theme),
      coreLayer(frame, layout, center, radius, scale, theme),
      ...nodeLayer(layout, theme),
    ].filter((piece): piece is string => piece !== undefined),
    { class: "replay-frame", "data-seq": frame.seq },
  );
}

/**
 * Distancia en frames hasta la aparición más reciente de un tipo de evento,
 * contando el frame actual como 0. `Infinity` si nunca ocurrió.
 *
 * Esta es toda la "memoria" que se permite el render, y es de solo lectura
 * sobre la secuencia: no hay estado acumulado en ningún lado.
 */
function framesSince(
  frames: readonly Frame[],
  index: number,
  type: EngineEvent["type"],
): number {
  for (let i = index; i >= 0; i -= 1) {
    if (frames[i]!.event.type === type) return index - i;
  }
  return Infinity;
}

/** El ente: polígono cuyos vértices cuenta los clusters asimilados (R1). */
function coreLayer(
  frame: Frame,
  layout: Layout,
  center: Point,
  radius: number,
  scale: number,
  theme: Theme,
): string {
  // La vibración se apaga junto con la contracción: máxima en el impacto,
  // nula una vez recuperado. Derivarla de `scale` las mantiene en fase sin
  // llevar una segunda cuenta.
  const intensity = theme.contractionPeak === 0 ? 0 : (1 - scale) / theme.contractionPeak;
  const amplitude = theme.vibration * intensity;

  const vertices =
    amplitude === 0
      ? regularPolygon(center, radius, layout.coreVertices)
      : shakenPolygon(center, radius, layout.coreVertices, vibrationSeed(frame), amplitude);

  return el("polygon", {
    class: "core",
    points: pointsAttr(vertices),
    fill: "none",
    stroke: theme.palette.core,
    "stroke-width": 2,
    "stroke-linejoin": "round",
  });
}

/**
 * Semilla de vibración de un frame, densificado o no.
 *
 * Un frame canónico tiembla según su `seq`. Un frame densificado comparte `seq`
 * con sus hermanos del mismo evento, así que necesita además su `sub` — si no,
 * los seis frames de un evento temblarían EXACTAMENTE IGUAL y la vibración
 * quedaría congelada justo donde tiene que vibrar (ADR 0010 §1).
 *
 * La lectura es estructural y no por tipo: el render acepta `Frame` y
 * `DenseFrame` indistintamente, y no tiene por qué saber cuál le tocó.
 */
function vibrationSeed(frame: Frame): number {
  return subSeed(frame.seq, (frame as { readonly sub?: number }).sub ?? 0);
}

/**
 * Polígono con los vértices desplazados radialmente por ruido determinista.
 *
 * El mismo frame tiembla igual en cada corrida. Con `Math.random()` acá, dos
 * reproducciones del mismo log serían dibujos distintos — y eso ya no sería un
 * replay (ADR 0007 §5).
 */
function shakenPolygon(
  center: Point,
  radius: number,
  sides: number,
  seed: number,
  amplitude: number,
): readonly Point[] {
  const step = TAU / sides;
  return Array.from({ length: sides }, (_, i) =>
    polar(center, radius + amplitude * jitter(seed, i), i * step),
  );
}

/** Los hilos de similitud de R6: presentes, pero de fondo. */
function threadLayer(layout: Layout, theme: Theme): readonly string[] {
  return layout.threads.map((thread) =>
    el("line", {
      class: "thread",
      x1: thread.a.x,
      y1: thread.a.y,
      x2: thread.b.x,
      y2: thread.b.y,
      stroke: theme.palette.thread,
      "stroke-width": 1,
      // La opacidad *es* la similitud: un parentesco fuerte se ve más.
      "stroke-opacity": thread.similarity * theme.threadOpacity,
    }),
  );
}

/**
 * El ataque entrante de R5, solo en los frames donde el motor atenuó algo.
 *
 * La curva `eff(k)` no se muestra con números: se muestra con un ataque que
 * llega **más pálido y más flaco** en cada exposición, y que **penetra menos**
 * cada vez. El valor sale del propio evento (`effApplied`), no se recalcula.
 *
 * Son DOS tramos con DOS dueños (ADR 0010, enmienda P3):
 *
 *   - el **viaje** —la línea que cruza el lienzo— lo cede esta capa cuando la
 *     efímera ya lo está dibujando en vivo;
 *   - el **impacto** —la mordida sobre el borde del ente— lo dibuja SIEMPRE
 *     esta capa, en vivo y en replay.
 *
 * Es la misma regla que ya rige la puntería: la dirección le da forma al viaje,
 * nunca al destino. El destino es el ente y lo cuenta el log.
 */
function incomingLayer(
  frame: Frame,
  center: Point,
  coreRadius: number,
  theme: Theme,
  ephemeralOwnedSeqs: ReadonlySet<number> | undefined,
): readonly string[] {
  const event = frame.event;
  if (event.type !== "ResistanceApplied") return [];

  const bearing = bearingOf(clusterKeyOf(event.signature));
  const eff = event.effApplied;

  // El impacto: una cuña que entra en el ente desde el borde. Cuanto más
  // adaptado está el cluster, menos hondo llega — la resistencia se VE como
  // profundidad, que es lo que un número en un HUD nunca comunica.
  const surface = polar(center, coreRadius, bearing);
  const depth = polar(center, coreRadius * (1 - 0.45 * eff), bearing);
  const impacto = [
    el("line", {
      class: "impact",
      x1: surface.x,
      y1: surface.y,
      x2: depth.x,
      y2: depth.y,
      stroke: theme.palette.incoming,
      "stroke-width": theme.incomingWidth * eff,
      "stroke-opacity": eff,
      "stroke-linecap": "round",
    }),
  ];

  // El viaje, si esta capa sigue siendo su dueña.
  if (ephemeralOwnedSeqs?.has(frame.seq) === true) return impacto;

  const from = polar(center, theme.size, bearing);
  return [
    el("line", {
      class: "incoming",
      x1: from.x,
      y1: from.y,
      x2: surface.x,
      y2: surface.y,
      stroke: theme.palette.incoming,
      "stroke-width": theme.incomingWidth * eff,
      "stroke-opacity": eff,
      "stroke-linecap": "round",
    }),
    ...impacto,
  ];
}

/** La onda del snap de R1. `undefined` fuera de la ventana: no se dibuja nada. */
function shockwaveLayer(
  age: number,
  center: Point,
  coreRadius: number,
  theme: Theme,
): string | undefined {
  const opacity = shockwaveOpacity(age, theme.shockwaveSpan);
  if (opacity === 0) return undefined;

  return el("circle", {
    class: "shockwave",
    cx: center.x,
    cy: center.y,
    r: shockwaveRadius(age, theme.shockwaveSpan, coreRadius, theme.shockwaveRadius),
    fill: "none",
    stroke: theme.palette.assimilated,
    "stroke-width": 3 * opacity,
    "stroke-opacity": opacity,
  });
}

/**
 * Los nodos de memoria. Lo asimilado pasa a sólido y grueso en color de
 * advertencia: el ente ya sabe defenderse de eso, y se ve.
 */
function nodeLayer(layout: Layout, theme: Theme): readonly string[] {
  return layout.nodes.flatMap((node) => [
    ...crystalLayer(node, theme),
    el("circle", {
      class: node.adapted ? "node node-adapted" : "node",
      "data-cluster": node.clusterId,
      cx: node.center.x,
      cy: node.center.y,
      r: node.radius,
      fill: node.adapted ? theme.palette.assimilated : "none",
      stroke: node.adapted ? theme.palette.assimilated : theme.palette.node,
      "stroke-width": node.adapted ? 3 : 1,
    }),
  ]);
}

/**
 * La cristalización de R5: el aviso de que la ventana se está cerrando (§4).
 *
 * Un cluster a medio adaptar dibuja un anillo facetado que se endurece a medida
 * que `k` se acerca a `N(c)`. La opacidad va con el **cuadrado** del avance a
 * propósito: casi invisible al principio y evidente en la última exposición, que
 * es cuando la información importa. Con relación lineal, el primer golpe de una
 * firma de dos exposiciones ya gritaría lo mismo que el último de una de siete.
 *
 * Solo aparece antes del salto: una vez adaptado el cluster, el aviso no
 * significa nada y el nodo pasa a su estado asimilado (ADR 0007 §4).
 */
function crystalLayer(node: Layout["nodes"][number], theme: Theme): readonly string[] {
  if (node.adapted || node.progress <= 0) return [];

  const radius = node.radius * (1 + theme.crystalGrowth * node.progress);
  const vertices = regularPolygon(node.center, radius, theme.crystalFacets);

  return [
    el("polygon", {
      class: "crystal",
      "data-cluster": node.clusterId,
      points: pointsAttr(vertices),
      fill: "none",
      stroke: theme.palette.incoming,
      "stroke-width": 1,
      "stroke-opacity": node.progress * node.progress * theme.crystalOpacity,
      "stroke-linejoin": "round",
    }),
  ];
}
