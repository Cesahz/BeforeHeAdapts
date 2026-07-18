// @beforeheadapts/visualizer — replay del log de eventos a animación.
//
// Fase 2. Consume el log tal como lo define el ADR 0006 y lo convierte en
// frames renderizables. La derivación de frames es pura y determinista; el
// render (canvas/SVG) y el export (gif/webm) son adaptadores que se enchufan
// encima y son los únicos que tocan el entorno.
//
// Este paquete depende de `@beforeheadapts/core`, nunca al revés: el motor no
// sabe que existe un visualizador.

export * from "./frames/index.js";
export * from "./render/index.js";

// El tema se exporta para poder recalibrar la estética sin tocar el render.
// `svg.ts`, `geometry.ts` y `layout.ts` quedan internos a propósito: son el
// *cómo* del dibujo, y fijarlos como API pública ataría las manos para cambiarlo.
export { centerOf, defaultTheme, type Palette, type Theme } from "./render/theme.js";
