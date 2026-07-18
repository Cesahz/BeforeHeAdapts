// render/geometry.ts — la matemática del render, sin una sola etiqueta SVG.
//
// Todo acá es geometría pura: puntos, polígonos, decaimientos y formateo de
// números. No hay colores, no hay atributos, no hay strings de marcado. Ese
// corte es a propósito: es la parte que se testea con property tests, y la que
// quedaría intacta si alguna vez aparece un backend de canvas (ADR 0007).
//
// Convención de ángulos: **0 apunta hacia arriba y crece en sentido horario**,
// que es como se leen las órbitas en pantalla. No es la convención matemática
// estándar (0 a la derecha, antihorario); se elige por legibilidad del layout.
//
// Determinismo estricto (ADR 0007 §5): ni `Math.random()` ni `Date.now()`. La
// vibración del ente sale de `jitter`, que es una función pura de la semilla.

/** Un punto en el espacio del SVG. `y` crece hacia abajo, como en SVG. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * Polar → cartesiano alrededor de un centro.
 *
 * @param angle radianes, `0` hacia arriba, creciendo en sentido horario.
 */
export function polar(_center: Point, _radius: number, _angle: number): Point {
  throw new Error("no implementado");
}

/**
 * Vértices de un polígono regular, en orden horario desde `rotation`.
 *
 * El ente es esto: `sides` crece con cada cluster asimilado, así que la silueta
 * cambia de forma discreta y permanente en cada salto de R1.
 *
 * @param sides al menos 3; menos no es un polígono y es error del llamador.
 */
export function regularPolygon(
  _center: Point,
  _radius: number,
  _sides: number,
  _rotation = 0,
): readonly Point[] {
  throw new Error("no implementado");
}

/**
 * Ruido determinista en `[-1, 1]`, para la vibración de vértices del ente.
 *
 * Misma semilla = mismo valor, siempre y en todas las corridas. Es lo que
 * permite que un replay se vea *idéntico* dos veces: un `Math.random()` acá
 * haría que cada reproducción del mismo log fuera un dibujo distinto, y eso ya
 * no sería un replay.
 *
 * @param seed normalmente el `seq` del evento.
 * @param index índice del vértice, para que no vibren todos igual.
 */
export function jitter(_seed: number, _index: number): number {
  throw new Error("no implementado");
}

/**
 * Escala del ente `age` frames después de una exposición: se contrae de golpe y
 * recupera. `1 - peak` en `age = 0`, de vuelta en `1` desde `age >= span`.
 */
export function contractionScale(_age: number, _span: number, _peak: number): number {
  throw new Error("no implementado");
}

/**
 * Radio de la onda expansiva `age` frames después del snap de adaptación.
 * Arranca en el borde del ente y se va hasta `maxRadius`.
 */
export function shockwaveRadius(
  _age: number,
  _span: number,
  _fromRadius: number,
  _maxRadius: number,
): number {
  throw new Error("no implementado");
}

/**
 * Opacidad de la onda expansiva: `1` en el frame del snap, `0` desde `span`.
 * Fuera de la ventana devuelve `0`, así el llamador puede no dibujar nada.
 */
export function shockwaveOpacity(_age: number, _span: number): number {
  throw new Error("no implementado");
}

/**
 * Formatea un número para un atributo SVG.
 *
 * No es cosmética: los flotantes crudos meten notación exponencial (`1e-7`, que
 * SVG no acepta en varios contextos), `-0`, y colas de precisión que hacen que
 * dos corridas del mismo frame difieran en el string aunque el dibujo sea el
 * mismo. Redondear a precisión fija hace que el SVG sea comparable byte a byte,
 * que es lo que permite testear determinismo sin rasterizar.
 */
export function svgNumber(_value: number): string {
  throw new Error("no implementado");
}
