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
  const theme = options.theme ?? defaultTheme;
  return Object.freeze(frames.map((_, i) => renderAt(frames, i, theme)));
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
  return renderAt(frames, index, options.theme ?? defaultTheme);
}

function renderAt(frames: readonly Frame[], index: number, theme: Theme): string {
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
      ...incomingLayer(frame.event, center, radius, theme),
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
      : shakenPolygon(center, radius, layout.coreVertices, frame.seq, amplitude);

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
 * Polígono con los vértices desplazados radialmente por ruido determinista.
 *
 * La semilla es el `seq` del evento: el mismo frame tiembla igual en cada
 * corrida. Con `Math.random()` acá, dos reproducciones del mismo log serían
 * dibujos distintos — y eso ya no sería un replay (ADR 0007 §5).
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
 * El vector entrante de R5, solo en los frames donde el motor atenuó algo.
 *
 * La curva `eff(k)` no se muestra con números: se muestra con un ataque que
 * llega **más pálido y más flaco** en cada exposición. El valor sale del propio
 * evento (`effApplied`), no se recalcula.
 */
function incomingLayer(
  event: EngineEvent,
  center: Point,
  coreRadius: number,
  theme: Theme,
): readonly string[] {
  if (event.type !== "ResistanceApplied") return [];

  const bearing = bearingOf(clusterKeyOf(event.signature));
  const from = polar(center, theme.size, bearing);
  const to = polar(center, coreRadius, bearing);

  return [
    el("line", {
      class: "incoming",
      x1: from.x,
      y1: from.y,
      x2: to.x,
      y2: to.y,
      stroke: theme.palette.incoming,
      "stroke-width": theme.incomingWidth * event.effApplied,
      "stroke-opacity": event.effApplied,
      "stroke-linecap": "round",
    }),
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
  return layout.nodes.map((node) =>
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
  );
}
