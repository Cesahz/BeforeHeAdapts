// scripts/evolucion.ts — el arco completo del ente, de 0 a saturación.
//
// El autor reportó que la adaptación se lee mucho mejor en la arena que en el
// replay del visualizador. No es una diferencia de renderizador: es la MISMA
// función `renderFrames`. Lo que cambia es el tema (`arenaTheme`, lienzo de
// 1000 con arrabal) y, sobre todo, el guion: `scripts/demo.ts` muestra nueve
// golpes elegidos para explicar el contrato, y con nueve golpes el ente nunca
// llega a verse como se ve jugando.
//
// Esto es lo otro: el arsenal REAL del jugador —los cuatro gestos del ADR 0009
// por los ocho elementos del catálogo, 32 composiciones— martillando hasta que
// no queda un cluster sin adaptar. El resultado es la evolución que se pide
// mirar: el ente vacío, después poblándose de nodos naranjas, tejiéndose de
// hilos de parentesco (R6), ganando un vértice y una cicatriz por cada salto.
//
// Vive fuera de `src/` a propósito, igual que el demo del visualizador: toca el
// disco, y en `src/` eso lo mataría la suite de pureza. No entra al build.
//
// Requisitos: `pnpm build` previo (importa los paquetes por su entrada pública)
// y Node ≥22 (stripping de tipos nativo).

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  clusterKeyOf,
  createInitialState,
  process as expose,
  requiredExposures,
  resistanceOf,
  type EngineState,
} from "@beforeheadapts/core";
import { ELEMENTS, toSignature, type Composition } from "@beforeheadapts/arena-dsl";
import { framesFrom, renderFrames, timelineOf } from "@beforeheadapts/visualizer";

// El código de `src/` importa con extensión `.js` —la convención de TS con
// `moduleResolution: nodenext`— y esos `.js` no existen: la arena la compila
// Vite, y `tsc --build` acá solo emite declaraciones. Este hook reescribe
// `./x.js` a `./x.ts` cuando el `.ts` está y el `.js` no.
//
// Es cañería de script, no una decisión de arquitectura. La alternativa era
// copiar acá `arenaTheme` y el mapeo de gestos, y entonces este render dejaría
// de ser "como en el juego real" en cuanto alguien tocara cualquiera de los
// dos — que es exactamente lo que se pide evitar.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith(".") && specifier.endsWith(".js") && context.parentURL !== undefined) {
      const candidato = new URL(specifier.slice(0, -3) + ".ts", context.parentURL);
      if (existsSync(candidato) && !existsSync(new URL(specifier, context.parentURL))) {
        return next(specifier.slice(0, -3) + ".ts", context);
      }
    }
    return next(specifier, context);
  },
});

const { compositionFor } = await import("../src/gesture/recognize.ts");
const { arenaTheme } = await import("../src/view/theme.ts");
type GestureKind = Parameters<typeof compositionFor>[0];

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "renders", "evolucion");

/** Los cuatro trazos del combate en vivo. Mismo orden que en el vocabulario. */
const GESTURES: readonly GestureKind[] = ["straight", "hold", "circle", "zigzag"];

/**
 * Milisegundos entre golpe y golpe en el LOG.
 *
 * No es el ritmo de la reproducción —de eso se ocupa `timelineOf`— sino la
 * separación temporal que el ledger exige entre eventos. Basta con que avance.
 */
const STEP_MS = 700;

/** Tope de golpes por composición: red de seguridad, no parte del guion. */
const MAX_HITS = 12;

/**
 * El guion: por elemento, los cuatro gestos, cada uno hasta que su cluster
 * adapta.
 *
 * El orden importa para lo que se ve. Recorrer elemento por elemento —y dentro
 * de cada uno, gesto por gesto— hace que los hilos de R6 aparezcan en racimos:
 * las cuatro firmas de un mismo elemento comparten una primitiva, y las de un
 * mismo gesto comparten vector y patrón. Recorrerlo al revés (gesto por gesto)
 * da el mismo estado final pero un tejido que crece parejo y aburrido.
 */
function guion(): readonly Composition[] {
  const golpes: Composition[] = [];
  for (const element of ELEMENTS) {
    for (const gesture of GESTURES) {
      golpes.push(compositionFor(gesture, element));
    }
  }
  return golpes;
}

function run(): EngineState {
  let state = createInitialState({}, "evolucion");
  let now = 0;

  for (const composition of guion()) {
    const signature = toSignature(composition);
    const clusterId = clusterKeyOf(signature);
    const needed = requiredExposures(signature);

    // Se golpea HASTA adaptar, no una cantidad fija: `N(c)` sale del motor y
    // hardcodearla acá sería reimplementar R2 en un script.
    for (let hit = 0; hit < MAX_HITS; hit += 1) {
      now += STEP_MS;
      state = expose(state, signature, now).state;
      if (resistanceOf(state, clusterId) > 0) break;
    }

    const marca = resistanceOf(state, clusterId) > 0 ? "✓" : "✗";
    console.log(
      `${marca} ${clusterId.padEnd(58)} N=${String(needed).padStart(2)}  eventos=${state.log.events.length}`,
    );
  }

  return state;
}

const state = run();
const frames = framesFrom(state.log);
const svgs = renderFrames(frames, { theme: arenaTheme });
const timeline = timelineOf(frames);

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

for (const [i, svg] of svgs.entries()) {
  writeFileSync(join(OUT_DIR, `frame-${String(i).padStart(4, "0")}.svg`), svg, "utf8");
}

writeFileSync(join(OUT_DIR, "index.html"), player(svgs, timeline.frames.map((f) => f.durationMs)), "utf8");

const clusters = state.clusters.size;
const adaptados = [...state.clusters.keys()].filter((id) => resistanceOf(state, id) > 0).length;
console.log(
  `\n${adaptados}/${clusters} clusters adaptados · ${state.log.events.length} eventos · ` +
    `${svgs.length} frames · ${(timeline.totalMs / 1000).toFixed(1)} s de replay`,
);
console.log(`\nabrir: ${join(OUT_DIR, "index.html")}`);

// --- El reproductor ---------------------------------------------------------
//
// Autocontenido y sin dependencias: los SVG van embebidos, así que el archivo
// se abre con doble clic y funciona sin servidor. El botón de grabar usa el
// mismo truco que `export/browser.ts` del visualizador —canvas + `captureStream(0)`
// con cuadros empujados a mano— para que el webm salga determinista y no dependa
// de cuán ocupada esté la pestaña.

function player(svgs: readonly string[], durations: readonly number[]): string {
  const datos = JSON.stringify({ svgs, durations });
  return `<!doctype html>
<meta charset="utf-8">
<title>Evolución del ente — de 0 a saturación</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; background:#05070a; color:#7fd4e8; font:13px/1.5 ui-monospace,monospace;
         display:flex; flex-direction:column; align-items:center; gap:12px; padding:16px; }
  #stage { width:min(88vh,88vw); aspect-ratio:1; }
  #stage svg { width:100%; height:100%; display:block; }
  .bar { display:flex; align-items:center; gap:12px; width:min(88vh,88vw); flex-wrap:wrap; }
  button { background:#0d1620; color:#7fd4e8; border:1px solid #3a5560; border-radius:4px;
           padding:6px 14px; font:inherit; cursor:pointer; }
  button:hover { border-color:#7fd4e8; }
  input[type=range] { flex:1; min-width:200px; accent-color:#e8a33d; }
  #estado { color:#e8a33d; min-width:150px; }
</style>
<div id="stage"></div>
<div class="bar">
  <button id="play">⏸ pausa</button>
  <input type="range" id="scrub" min="0" value="0" step="1">
  <span id="estado"></span>
</div>
<div class="bar">
  <label>velocidad <input type="range" id="vel" min="0.25" max="6" step="0.25" value="1" style="max-width:160px"></label>
  <span id="velTxt">1×</span>
  <button id="rec">● grabar webm</button>
  <span id="recEstado"></span>
</div>
<script type="module">
const { svgs, durations } = ${datos};
const stage = document.getElementById("stage");
const scrub = document.getElementById("scrub");
const estado = document.getElementById("estado");
const play = document.getElementById("play");
const vel = document.getElementById("vel");
const velTxt = document.getElementById("velTxt");

scrub.max = String(svgs.length - 1);
let i = 0, corriendo = true, resto = durations[0], ultimo = performance.now();

function pintar(n) {
  i = n;
  stage.innerHTML = svgs[n];
  scrub.value = String(n);
  estado.textContent = \`frame \${n + 1} / \${svgs.length}\`;
}

function bucle(ahora) {
  const dt = (ahora - ultimo) * Number(vel.value);
  ultimo = ahora;
  if (corriendo) {
    resto -= dt;
    while (resto <= 0 && i < svgs.length - 1) {
      pintar(i + 1);
      resto += durations[i];
    }
    if (i >= svgs.length - 1) { pintar(0); resto = durations[0]; }
  }
  requestAnimationFrame(bucle);
}

play.onclick = () => {
  corriendo = !corriendo;
  play.textContent = corriendo ? "⏸ pausa" : "▶ seguir";
};
scrub.oninput = () => { pintar(Number(scrub.value)); resto = durations[i]; };
vel.oninput = () => { velTxt.textContent = vel.value + "×"; };

pintar(0);
requestAnimationFrame(bucle);

// --- grabación ------------------------------------------------------------
const rec = document.getElementById("rec");
const recEstado = document.getElementById("recEstado");

function rasterizar(svg, size) {
  return new Promise((ok, mal) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = mal;
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  });
}

rec.onclick = async () => {
  rec.disabled = true;
  corriendo = false;
  play.textContent = "▶ seguir";

  const size = 800, fps = 30;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0];
  const grabador = new MediaRecorder(stream, { mimeType: "video/webm" });
  const trozos = [];
  grabador.ondataavailable = (e) => { if (e.data.size > 0) trozos.push(e.data); };
  grabador.start();

  for (let n = 0; n < svgs.length; n++) {
    const img = await rasterizar(svgs[n], size);
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(img, 0, 0, size, size);
    // Un cuadro por cada 1/fps que el frame debe durar: así el webm respeta el
    // guion temporal en vez de correr todo a velocidad de rasterizado.
    const cuadros = Math.max(1, Math.round((durations[n] / 1000) * fps));
    for (let c = 0; c < cuadros; c++) track.requestFrame();
    pintar(n);
    recEstado.textContent = \`grabando \${n + 1}/\${svgs.length}\`;
  }

  grabador.stop();
  await new Promise((ok) => (grabador.onstop = ok));
  const url = URL.createObjectURL(new Blob(trozos, { type: "video/webm" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "evolucion-del-ente.webm";
  a.click();
  URL.revokeObjectURL(url);
  recEstado.textContent = "listo ✓";
  rec.disabled = false;
};
</script>
`;
}
