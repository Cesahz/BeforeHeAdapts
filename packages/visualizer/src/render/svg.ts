// render/svg.ts — serializador mínimo de SVG a string.
//
// No hay librería y no hace falta: el render emite un puñado de formas y una
// dependencia acá costaría más que las cincuenta líneas que reemplaza. Lo que
// sí hace falta es rigor en dos cosas, y por eso este módulo existe separado.
//
// **Escapeo.** Los `clusterId` derivan de firmas que en la arena vienen de
// usuarios, y terminan como atributos de un SVG montado en el DOM. Un `id` sin
// escapar es inyección de markup, no un detalle cosmético. Acá todo valor de
// atributo y todo texto pasa por el escape, siempre, sin puerta de escape.
//
// **Determinismo del string.** El orden de los atributos es el de inserción, y
// los números pasan por `svgNumber`. Dos corridas del mismo frame producen el
// mismo string byte a byte, que es lo que permite testear el render sin
// rasterizar nada (ADR 0007).

import { svgNumber } from "./geometry.js";

/**
 * Valor admisible para un atributo. Los números se formatean con `svgNumber`;
 * `false`, `null` y `undefined` omiten el atributo, para poder escribir
 * atributos condicionales sin `if` alrededor.
 */
export type AttrValue = string | number | boolean | null | undefined;

export type Attrs = Readonly<Record<string, AttrValue>>;

/**
 * Escapa texto para que no pueda cerrar una etiqueta ni abrir otra.
 *
 * Se escapan también las comillas: los atributos se emiten con comillas dobles,
 * así que una comilla sin escapar cierra el valor y lo que sigue se parsea como
 * atributo nuevo — que es exactamente el vector de inyección.
 */
export function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;") // primero, si no se re-escaparían los que siguen
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Serializa un mapa de atributos, omitiendo los ausentes. */
function serializeAttrs(attrs: Attrs): string {
  const parts: string[] = [];

  for (const [name, value] of Object.entries(attrs)) {
    if (value === false || value === null || value === undefined) continue;
    // Un atributo booleano en `true` se emite vacío (`<g hidden="">`).
    const text = value === true ? "" : typeof value === "number" ? svgNumber(value) : value;
    parts.push(`${name}="${escapeText(text)}"`);
  }

  return parts.length > 0 ? ` ${parts.join(" ")}` : "";
}

/**
 * Un elemento SVG. Sin hijos se emite auto-cerrado.
 *
 * Los hijos ya son markup serializado: van tal cual, sin escapar. Para texto
 * plano está `text()`, que sí escapa. La distinción es deliberada — si esta
 * función escapara sus hijos, anidar sería imposible.
 */
export function el(tag: string, attrs: Attrs = {}, children: readonly string[] = []): string {
  const open = `<${tag}${serializeAttrs(attrs)}`;
  return children.length === 0 ? `${open}/>` : `${open}>${children.join("")}</${tag}>`;
}

/** Un `<text>` con contenido escapado. La única vía para meter texto plano. */
export function text(content: string, attrs: Attrs = {}): string {
  return `<text${serializeAttrs(attrs)}>${escapeText(content)}</text>`;
}

/** El elemento raíz, con el `viewBox` y el namespace que exige un SVG suelto. */
export function svg(
  width: number,
  height: number,
  children: readonly string[],
  attrs: Attrs = {},
): string {
  return el(
    "svg",
    {
      xmlns: "http://www.w3.org/2000/svg",
      viewBox: `0 0 ${svgNumber(width)} ${svgNumber(height)}`,
      width,
      height,
      ...attrs,
    },
    children,
  );
}

/**
 * Atributo `points` de un `<polygon>`, a partir de vértices.
 *
 * Los pares van separados por espacio y las coordenadas por coma: es la forma
 * que menos ambigüedad tiene al leerla a ojo en un SVG exportado.
 */
export function pointsAttr(points: readonly { x: number; y: number }[]): string {
  return points.map((p) => `${svgNumber(p.x)},${svgNumber(p.y)}`).join(" ");
}
