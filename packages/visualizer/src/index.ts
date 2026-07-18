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
