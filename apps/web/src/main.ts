// main.ts — punto de entrada de la arena.
//
// Andamiaje de la Fase 3a: por ahora solo prueba que el motor corre EN el
// navegador, sin servidor. Una sala local = un engine + un log en memoria.
//
// Vanilla TS a propósito (ADR 0008 §5): el estado de la sala ya ES el log del
// motor, así que un framework reactivo introduciría una segunda fuente de verdad
// para el mismo estado — justo lo que la Ley de arquitectura prohíbe.

import {
  clusterKeyOf,
  createInitialState,
  process as expose,
  resistanceOf,
} from "@beforeheadapts/core";
import { toSignature } from "@beforeheadapts/arena-dsl";

const root = document.querySelector<HTMLDivElement>("#arena");
if (root === null) throw new Error("falta el contenedor #arena");

// Golpe de humo: una firma mínima adapta al primer golpe (R2).
const signature = toSignature({ element: "ember" });
const { state, events } = expose(createInitialState({}, "sala-local"), signature, 0);

root.textContent =
  `motor vivo en el navegador — firma [${signature.primitives.join(", ")}], ` +
  `${events.length} eventos, resistencia ${resistanceOf(state, clusterKeyOf(signature)).toFixed(2)}`;
