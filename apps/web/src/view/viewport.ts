// view/viewport.ts — la matemática de coordenadas entre pantalla y SVG.
//
// Vive en su propio módulo y sin tocar el DOM por un motivo concreto: esta
// conversión estuvo mucho tiempo "verificada" solo con matemática hecha a mano,
// y es la clase de código que se rompe en silencio — un factor de escala mal
// puesto no tira ningún error, solo hace que los ataques nazcan corridos y que
// nadie sepa por qué el juego se siente mal. Acá entra como datos (dos
// rectángulos) y sale como datos, así que se puede testear de verdad.
//
// Hay DOS cajas y confundirlas es el bug que esto previene:
//
//   ESCENA  — toda la ventana. Es donde el jugador puede trazar.
//   CUADRO  — el cuadrado centrado donde vive el ente. Es el sistema de
//             coordenadas del visualizador: ocupa exactamente `[0, size]²`.
//
// Antes eran el mismo elemento, y por eso el cursor tenía una pared invisible
// a mitad de pantalla en cualquier monitor que no fuera cuadrado.

export interface Rect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface ViewBox {
  readonly minX: number;
  readonly minY: number;
  readonly width: number;
  readonly height: number;
}

/** Unidades del SVG por píxel de pantalla. Sale del CUADRO, nunca de la escena. */
export function scaleOf(cuadro: Rect, size: number): number {
  return cuadro.width === 0 ? 1 : size / cuadro.width;
}

/**
 * Píxeles relativos a la escena → unidades del SVG.
 *
 * Fuera del cuadro del ente devuelve negativos o valores mayores que `size`, y
 * eso es correcto: el viewBox extendido de la capa efímera cubre esa zona.
 */
export function toSvg(point: Point, escena: Rect, cuadro: Rect, size: number): Point {
  const escala = scaleOf(cuadro, size);
  return {
    x: (point.x - (cuadro.left - escena.left)) * escala,
    y: (point.y - (cuadro.top - escena.top)) * escala,
  };
}

/**
 * El `viewBox` de la capa efímera: cubre la escena entera manteniendo el cuadro
 * del ente en `[0, size]²`.
 *
 * Esa invariante es la condición que el ADR 0010 §2 le impone al overlay — las
 * coordenadas de las dos capas tienen que significar lo mismo. Lo único que
 * cambia respecto de la capa canónica es que este viewBox se extiende hacia
 * afuera con origen negativo.
 */
export function viewBoxOf(escena: Rect, cuadro: Rect, size: number): ViewBox {
  const escala = scaleOf(cuadro, size);
  return {
    minX: (escena.left - cuadro.left) * escala,
    minY: (escena.top - cuadro.top) * escala,
    width: escena.width * escala,
    height: escena.height * escala,
  };
}

/** Serializa un viewBox al formato del atributo SVG. */
export function viewBoxAttr(box: ViewBox): string {
  return `${box.minX} ${box.minY} ${box.width} ${box.height}`;
}
