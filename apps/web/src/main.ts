// main.ts — punto de entrada de la arena.
//
// Vanilla TS a propósito (ADR 0008 §5): el estado de la sala ya ES el log del
// motor, así que un framework reactivo introduciría una segunda fuente de verdad
// para el mismo estado — justo lo que la Ley de arquitectura prohíbe. Acá se
// renderiza leyendo la sala, nunca acumulando estado propio en la UI.

import { cooldownOf, costOf } from "@beforeheadapts/arena-dsl";

import "./style.css";

import { downloadText } from "./arena/download.js";
import { PREFABS, type Prefab } from "./arena/prefabs.js";
import { replayFileName, serializeReplay } from "./arena/replay.js";
import { CooldownError, Room } from "./arena/room.js";
import { Builder } from "./builder/ui.js";
import { LiveView } from "./view/live.js";

const root = document.querySelector<HTMLDivElement>("#arena");
if (root === null) throw new Error("falta el contenedor #arena");

const room = new Room("sala-local");

/** Reloj de la sala. Monótono y en milisegundos, como exige el ledger. */
const now = (): number => Math.round(performance.now());

// --- Estructura de la página, montada una sola vez ---------------------------
// El DOM se construye acá y después solo se ACTUALIZA. Reconstruirlo por cuadro
// mataría el foco, el hover y cualquier animación del SVG.

const escena = document.createElement("div");
escena.className = "escena";
// El pipeline del visualizador emite un frame POR EVENTO, así que con el log
// vacío no hay nada que dibujar y el ente recién aparece con el primer golpe.
// Se avisa en vez de dejar un hueco negro sin explicación.
escena.innerHTML = `<p class="vacio">el ente todavía no fue expuesto a nada — atacá para despertarlo</p>`;

const panel = document.createElement("div");
panel.className = "panel";

const botonera = document.createElement("div");
botonera.className = "botonera";

const estado = document.createElement("p");
estado.className = "estado";

const medidor = document.createElement("p");
medidor.className = "medidor";

const exportarBoton = document.createElement("button");
exportarBoton.textContent = "Exportar replay";

const bitacoraLista = document.createElement("ul");
bitacoraLista.className = "bitacora";

panel.append(botonera, estado, medidor, exportarBoton, bitacoraLista);
root.append(escena, panel);

const view = new LiveView(escena);

// --- Botones de ataque -------------------------------------------------------

const botones = PREFABS.map((prefab) => {
  const boton = document.createElement("button");
  boton.title = prefab.note;
  boton.addEventListener("click", () => lanzar(prefab));
  botonera.append(boton);
  return { prefab, boton };
});

const bitacora: string[] = [];

function log(line: string): void {
  bitacora.unshift(line);
  if (bitacora.length > 8) bitacora.pop();
  bitacoraLista.replaceChildren(
    ...bitacora.map((linea) => {
      const item = document.createElement("li");
      item.textContent = linea;
      return item;
    }),
  );
}

/** Un prefab y una build del Builder se lanzan igual: nombre + composición. */
type Lanzable = Pick<Prefab, "name" | "composition">;

function lanzar(lanzable: Lanzable): void {
  try {
    const outcome = room.attack(lanzable.composition, now());
    log(
      `${lanzable.name} — daño ${outcome.damage.toFixed(2)} · ` +
        `eff ${outcome.effApplied.toFixed(3)} · ` +
        `${outcome.exposures}/${outcome.requiredExposures}` +
        (outcome.adapted ? " · ADAPTADO" : ""),
    );
    // El log creció: los frames se recalculan ACÁ, no por cuadro.
    view.sync(room.log);
  } catch (error) {
    if (error instanceof CooldownError) {
      log(`${lanzable.name} — en cooldown, faltan ${((error.readyAt - now()) / 1000).toFixed(1)} s`);
    } else {
      throw error;
    }
  }
}

// El Builder persiste en el `localStorage` real; los tests le pasan otro almacén.
const builder = new Builder(window.localStorage, {
  onLaunch: (build) => lanzar(build),
  onNotice: (mensaje) => log(mensaje),
});
root.append(builder.element);

exportarBoton.addEventListener("click", () => {
  downloadText(replayFileName(room), serializeReplay(room));
  log(`replay exportado (${room.log.events.length} eventos)`);
});

// --- Bucle de animación ------------------------------------------------------

function frame(): void {
  const t = now();

  view.tick(t);

  for (const { prefab, boton } of botones) {
    const disponible = room.canAttack(prefab.composition, t);
    boton.disabled = !disponible;
    const restante = room.readyAt(prefab.composition) - t;
    boton.textContent = disponible
      ? `${prefab.name} · costo ${costOf(prefab.composition)}`
      : `${prefab.name} · ${(restante / 1000).toFixed(1)}s`;
  }

  estado.textContent =
    `${room.state.clusters.size} clusters · ${room.log.events.length} eventos · ` +
    `cooldown máximo ${(Math.max(...PREFABS.map((p) => cooldownOf(p.composition))) / 1000).toFixed(1)}s`;

  const { fps, lastSyncMs } = view.stats;
  medidor.textContent = `${fps.toFixed(0)} fps · último sync ${lastSyncMs.toFixed(1)} ms`;

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
