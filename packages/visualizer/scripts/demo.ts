// scripts/demo.ts — un replay de verdad, para mirarlo con los ojos.
//
// No es un test ni parte del paquete: es el banco de pruebas visual. Arma un log
// sintético con el motor real (nada de frames inventados a mano), lo pasa por
// `framesFrom` + `renderFrames` y escribe el resultado a disco.
//
// Vive fuera de `src/` a propósito: `tsconfig.json` compila solo `src/**`, así
// que este archivo no entra al build ni al paquete publicado. Toca el disco, y
// eso en `src/` lo mataría `purity.test.ts`.
//
// Se corre con Node ≥22 directamente (`node scripts/demo.ts`): el stripping de
// tipos nativo alcanza, no hace falta tsx. Sí hace falta el build previo, porque
// importa el paquete por su entrada pública.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  canonicalize,
  clusterKeyOf,
  createInitialState,
  generalizedInitialResistance,
  process as expose,
  type EngineState,
  type StimulusSignature,
} from "@beforeheadapts/core";
import {
  framesFrom,
  renderFrames,
  timelineOf,
  type Frame,
  type Timeline,
} from "@beforeheadapts/visualizer";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "renders", "demo");

// --- El guion ---------------------------------------------------------------
//
// Tres firmas elegidas para que cada regla del contrato se vea sin explicarla:
//
// - `percusion` es simple (c = 1 ⇒ N = 1): el ente la asimila del primer golpe.
//   Es el snap temprano, para que se entienda qué se está mirando.
// - `fuegoDistancia` es compuesta (c = 3 ⇒ N = 3): tres exposiciones de avance
//   antes del salto. Acá se lee R1 (escalón, no rampa) contra R5 (el vector
//   entrante llega más flaco en cada golpe).
// - `fuegoCuerpo` comparte dos de sus tres primitivas con la anterior
//   (sim = 2/4 = 0.5): hereda resistencia por R6 y queda unida por un hilo.

const percusion = canonicalize(["percusion"], 1);
const fuegoDistancia = canonicalize(["fuego", "proyectil", "distancia"], 1);
const fuegoCuerpo = canonicalize(["fuego", "proyectil", "cuerpo-a-cuerpo"], 1);

/** Un golpe del guion: qué firma entra y en qué instante. */
interface Beat {
  readonly signature: StimulusSignature;
  readonly at: number;
  /** Qué hay que mirar en este golpe. Se imprime en consola. */
  readonly note: string;
}

const script: readonly Beat[] = [
  { signature: percusion, at: 0, note: "firma simple: N=1, adapta de un solo golpe" },
  { signature: fuegoDistancia, at: 1_000, note: "compuesta: 1/3" },
  { signature: fuegoDistancia, at: 2_000, note: "2/3, el vector entrante ya llega mas palido" },
  { signature: fuegoDistancia, at: 3_000, note: "3/3: salto discreto + CounterReady" },
  { signature: fuegoDistancia, at: 4_000, note: "golpe post-adaptacion: eff(k) casi apagado" },
  { signature: fuegoCuerpo, at: 5_000, note: "firma nueva que hereda por generalizacion (R6)" },
  { signature: fuegoCuerpo, at: 6_000, note: "2/3" },
  { signature: fuegoCuerpo, at: 7_000, note: "3/3: segundo salto, el ente suma un vertice" },
  { signature: percusion, at: 8_000, note: "vuelta a lo viejo: la memoria sigue ahi" },
];

function run(): EngineState {
  let state = createInitialState({}, "demo");

  for (const beat of script) {
    // R6 se lee ANTES de exponer: es la resistencia que la firma nueva hereda de
    // lo ya asimilado, y después de la exposición el número ya no dice eso.
    const inherited = generalizedInitialResistance(state, beat.signature);
    const { state: next } = expose(state, beat.signature, beat.at);
    state = next;

    const heredado = inherited > 0 ? `  R0 heredada=${inherited.toFixed(3)}` : "";
    console.log(`  t=${String(beat.at).padStart(5)}  ${clusterKeyOf(beat.signature)}${heredado}`);
    console.log(`           ${beat.note}`);
  }

  return state;
}

// --- Salida -----------------------------------------------------------------

console.log("Guion del replay:");
const state = run();

const frames = framesFrom(state.log);
const svgs = renderFrames(frames);
const timeline = timelineOf(frames);

// Se borra y se rehace: si el guion se acorta, no quedan SVG huérfanos de una
// corrida anterior mezclados con los nuevos.
rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

const width = String(svgs.length - 1).length;
svgs.forEach((markup, i) => {
  writeFileSync(join(OUT_DIR, `frame-${String(i).padStart(width, "0")}.svg`), markup, "utf8");
});

writeFileSync(join(OUT_DIR, "index.html"), page(frames, svgs, timeline), "utf8");

console.log(`\n${svgs.length} frames escritos en ${OUT_DIR}`);
console.log(`Abrir: ${join(OUT_DIR, "index.html")}`);

// --- El reproductor ---------------------------------------------------------

/**
 * Página autocontenida que reproduce la secuencia.
 *
 * Los SVG van **embebidos**, no cargados con `fetch`: así el archivo se abre con
 * doble clic desde `file://`, sin levantar un servidor ni pelear con CORS. Los
 * archivos numerados igual se escriben aparte, que es lo que consume un encoder.
 *
 * Los tiempos salen de `timelineOf`, el mismo guion temporal que usará el export
 * a video: lo que se ve acá es lo que va a salir grabado.
 */
function page(
  frames: readonly Frame[],
  svgs: readonly string[],
  timeline: Timeline,
): string {
  const data = frames.map((frame, i) => ({
    seq: frame.seq,
    type: frame.event.type,
    ms: timeline.frames[i]!.durationMs,
    svg: svgs[i]!,
  }));

  return `<!doctype html>
<meta charset="utf-8">
<title>BeforeHeAdapts — replay demo</title>
<style>
  :root { color-scheme: dark; }
  body {
    margin: 0; min-height: 100vh;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 16px; background: #05070a; color: #7fd4e8;
    font: 13px ui-monospace, SFMono-Regular, Consolas, monospace;
  }
  #stage svg { display: block; width: min(80vmin, 600px); height: auto; }
  #bar { display: flex; align-items: center; gap: 12px; }
  button {
    background: none; border: 1px solid #4a6c7a; color: inherit;
    padding: 4px 12px; font: inherit; cursor: pointer;
  }
  button:hover { border-color: #7fd4e8; }
  #label { color: #e8a33d; min-width: 22ch; }
  #scrub { width: min(80vmin, 600px); accent-color: #e8a33d; }
</style>
<div id="stage"></div>
<input id="scrub" type="range" min="0" value="0">
<div id="bar">
  <button id="prev">◀</button>
  <button id="play">pausa</button>
  <button id="next">▶</button>
  <span id="label"></span>
</div>
<script>
const FRAMES = ${JSON.stringify(data)};
const stage = document.getElementById("stage");
const scrub = document.getElementById("scrub");
const label = document.getElementById("label");
const play = document.getElementById("play");

let index = 0;
let timer = null;

scrub.max = String(FRAMES.length - 1);

function show(i) {
  index = (i + FRAMES.length) % FRAMES.length;
  const frame = FRAMES[index];
  stage.innerHTML = frame.svg;
  scrub.value = String(index);
  label.textContent = "#" + frame.seq + " " + frame.type;
}

function tick() {
  show(index + 1);
  timer = setTimeout(tick, FRAMES[index].ms);
}

function pause() {
  clearTimeout(timer);
  timer = null;
  play.textContent = "play";
}

function resume() {
  if (timer === null) {
    play.textContent = "pausa";
    timer = setTimeout(tick, FRAMES[index].ms);
  }
}

play.onclick = () => (timer === null ? resume() : pause());
document.getElementById("prev").onclick = () => { pause(); show(index - 1); };
document.getElementById("next").onclick = () => { pause(); show(index + 1); };
scrub.oninput = () => { pause(); show(Number(scrub.value)); };

show(0);
resume();
</script>
`;
}
