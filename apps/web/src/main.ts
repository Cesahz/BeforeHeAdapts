// main.ts — punto de entrada de la arena.
//
// Vanilla TS a propósito (ADR 0008 §5): el estado de la sala ya ES el log del
// motor, así que un framework reactivo introduciría una segunda fuente de verdad
// para el mismo estado — justo lo que la Ley de arquitectura prohíbe. Acá se
// renderiza leyendo la sala, nunca acumulando estado propio en la UI.
//
// La vista del ente (frames + SVG del visualizador) todavía no está enganchada:
// esto es el loop de sala y el export, y se reemplaza en el paso siguiente.

import { cooldownOf, costOf } from "@beforeheadapts/arena-dsl";

import { downloadText } from "./arena/download.js";
import { PREFABS, type Prefab } from "./arena/prefabs.js";
import { replayFileName, serializeReplay } from "./arena/replay.js";
import { CooldownError, Room } from "./arena/room.js";

const root = document.querySelector<HTMLDivElement>("#arena");
if (root === null) throw new Error("falta el contenedor #arena");

const room = new Room("sala-local");

/** Reloj de la sala. Monótono y en milisegundos, como exige el ledger. */
const now = (): number => Math.round(performance.now());

const bitacora: string[] = [];

function log(line: string): void {
  bitacora.unshift(line);
  if (bitacora.length > 12) bitacora.pop();
}

function lanzar(prefab: Prefab): void {
  try {
    const outcome = room.attack(prefab.composition, now());
    const adaptado = outcome.adapted ? " · ADAPTADO" : "";
    log(
      `${prefab.name} — daño ${outcome.damage.toFixed(2)} · ` +
        `eff ${outcome.effApplied.toFixed(3)} · ` +
        `${outcome.exposures}/${outcome.requiredExposures} exposiciones${adaptado}`,
    );
  } catch (error) {
    if (error instanceof CooldownError) {
      const resta = ((error.readyAt - now()) / 1000).toFixed(1);
      log(`${prefab.name} — en cooldown, faltan ${resta} s`);
    } else {
      throw error;
    }
  }
  render();
}

function exportar(): void {
  downloadText(replayFileName(room), serializeReplay(room));
  log(`replay exportado (${room.log.events.length} eventos)`);
  render();
}

function render(): void {
  root!.replaceChildren();

  const titulo = document.createElement("h1");
  titulo.textContent = "Arena";
  root!.append(titulo);

  const botones = document.createElement("div");
  for (const prefab of PREFABS) {
    const boton = document.createElement("button");
    const disponible = room.canAttack(prefab.composition, now());
    boton.textContent =
      `${prefab.name} (costo ${costOf(prefab.composition)}, ` +
      `cd ${(cooldownOf(prefab.composition) / 1000).toFixed(1)}s)`;
    boton.title = prefab.note;
    boton.disabled = !disponible;
    boton.addEventListener("click", () => lanzar(prefab));
    botones.append(boton);
  }
  root!.append(botones);

  const estado = document.createElement("p");
  estado.textContent =
    `${room.state.clusters.size} clusters conocidos · ` +
    `${room.log.events.length} eventos en el log`;
  root!.append(estado);

  const exportarBoton = document.createElement("button");
  exportarBoton.textContent = "Exportar replay";
  exportarBoton.disabled = room.log.events.length === 0;
  exportarBoton.addEventListener("click", exportar);
  root!.append(exportarBoton);

  const lista = document.createElement("ul");
  for (const linea of bitacora) {
    const item = document.createElement("li");
    item.textContent = linea;
    lista.append(item);
  }
  root!.append(lista);
}

render();
// Los botones se rehabilitan solos cuando vence un cooldown; sin este tick la UI
// quedaría mintiendo hasta el próximo clic.
setInterval(render, 250);
