// export/browser.ts — el único módulo del paquete que toca el DOM.
//
// Implementa `FrameSink` con canvas + MediaRecorder, que es lo que permite
// exportar un webm sin una sola dependencia nueva. Va en su propio punto de
// entrada (`@beforeheadapts/visualizer/browser`) para que importar el paquete
// desde Node —tests, scripts, CI— nunca arrastre referencias a `document`.
//
// **Está escrito para ser aburrido a propósito.** Es la parte que los tests no
// cubren (no hay DOM en la suite), así que toda decisión que se pueda mover a
// `export/index.ts` o a `timeline.ts` —que sí se testean— se movió. Lo que
// queda acá es cañería: rasterizar un SVG, dibujarlo, pedir un cuadro.

import type { FrameSink } from "./index.js";

export interface RecorderOptions {
  /** Lado del video en píxeles. El SVG se escala para llenarlo. */
  readonly size?: number;
  /** Cuadros por segundo. Debe coincidir con el `fps` del guion temporal. */
  readonly fps?: number;
  /** Tipo MIME. El default se negocia con lo que soporte el navegador. */
  readonly mimeType?: string;
}

const CANDIDATE_TYPES = [
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
] as const;

/**
 * Sink que graba el replay a un `Blob` de webm.
 *
 * El cuadro se empuja a mano con `requestFrame()` sobre un stream a 0 fps, en
 * vez de dejar que el navegador muestree en tiempo real. Es la diferencia entre
 * un video determinista y uno que depende de cuán ocupada esté la pestaña: con
 * muestreo automático, una máquina lenta produciría un replay distinto del de
 * una rápida, y eso rompería la garantía que sostiene todo el diseño.
 */
export function createWebmSink(options: RecorderOptions = {}): FrameSink<Blob> {
  const size = options.size ?? 600;
  const fps = options.fps ?? 30;

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const context = canvas.getContext("2d");
  if (context === null) {
    throw new Error("el navegador no dio un contexto 2d: no se puede grabar el replay");
  }

  // `captureStream(0)` deja el stream esperando cuadros explícitos.
  const stream = canvas.captureStream(0);
  const [track] = stream.getVideoTracks() as unknown as readonly CanvasCaptureMediaStreamTrack[];
  if (track === undefined) {
    throw new Error("el canvas no expuso una pista de video");
  }

  const recorder = new MediaRecorder(stream, { mimeType: pickMimeType(options.mimeType) });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  recorder.start();

  return {
    async draw(svg, durationMs) {
      const image = await rasterize(svg, size);
      context.clearRect(0, 0, size, size);
      context.drawImage(image, 0, 0, size, size);

      // Un cuadro por cada tick que el frame ocupa a este fps: así la duración
      // del guion se respeta sin depender del reloj de la pestaña.
      const ticks = Math.max(1, Math.round((durationMs / 1000) * fps));
      for (let i = 0; i < ticks; i += 1) {
        track.requestFrame();
      }
    },

    finish() {
      return new Promise<Blob>((resolve) => {
        recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType }));
        recorder.stop();
        track.stop();
      });
    },
  };
}

/**
 * SVG (string) → imagen rasterizada.
 *
 * Se pasa como data URI y no como blob URL para no tener que acordarse de
 * revocarlo: la fuga de memoria en un replay de cientos de frames sería real.
 */
function rasterize(svg: string, size: number): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image(size, size);
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("el navegador no pudo rasterizar el frame"));
    // `encodeURIComponent` en vez de base64: el SVG es texto y así queda legible
    // al depurar, además de evitar problemas con caracteres no ASCII.
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

function pickMimeType(preferred?: string): string {
  if (preferred !== undefined) return preferred;
  const supported = CANDIDATE_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
  if (supported === undefined) {
    throw new Error("este navegador no soporta grabar webm");
  }
  return supported;
}
