// view/theme.ts — el tema de la ARENA, distinto del tema de export.
//
// `defaultTheme` está calibrado para el replay exportado: un gif cuadrado donde
// el ente llena el cuadro porque el ente ES el tema del clip. En la arena eso
// mismo es un defecto de diseño: con `orbitOuter: 280` sobre `size: 600` (mitad
// = 300), la órbita de clusters roza el borde del lienzo y no queda espacio por
// donde un ataque VIAJE. El autor lo reportó como "el ente tapa casi toda el
// área útil, los ataques no tienen recorrido", y tenía razón: no era el layout
// del CSS, era el tema.
//
// La corrección es agrandar el LIENZO, no achicar el ente: el ente conserva su
// `coreRadius` y sus órbitas casi intactos, y el cuadro crece a su alrededor.
// Así el ente se lee igual de sólido y aparece el arrabal por donde el combate
// puede ocurrir.
//
// Va como tema propio y no como cambio de `defaultTheme` porque los fixtures
// golden del visualizador están calibrados contra el default: cambiarlo sería
// reescribir la referencia de todos los replays viejos, que es exactamente lo
// que la Ley de arquitectura §3 prohíbe. `RenderOptions.theme` existe para esto.

import { defaultTheme, type Theme } from "@beforeheadapts/visualizer";

/**
 * Lienzo de la arena. 1.000 contra los 600 del export: el ente pasa de ocupar
 * el 30 % del ancho al 18 %, y la órbita exterior deja 140 unidades de arrabal
 * en vez de 20.
 */
export const ARENA_SIZE = 1000;

export const arenaTheme: Theme = Object.freeze({
  ...defaultTheme,
  size: ARENA_SIZE,
  // El ente y sus órbitas crecen mucho menos que el lienzo: ahí está el espacio
  // nuevo. Las órbitas sí se separan un poco entre sí, porque con más aire la
  // distancia entre "confianza plena" y "borde del olvido" se vuelve legible.
  coreRadius: 90,
  orbitInner: 210,
  orbitOuter: 360,
  // La onda del snap se mide desde el centro: si no crece con el lienzo, el
  // salto discreto —el evento más importante que dibuja la arena— pasa a ser un
  // destello chico en el medio en vez de barrer la pantalla.
  shockwaveRadius: 460,
});
