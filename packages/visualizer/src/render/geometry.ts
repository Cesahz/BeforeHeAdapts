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

const TAU = Math.PI * 2;

/**
 * Decimales que sobreviven en un atributo SVG.
 *
 * Tres alcanzan de sobra a resolución de pantalla y hacen que el string sea
 * estable: sin esto, dos corridas del mismo frame pueden diferir en el último
 * bit del flotante y el SVG deja de ser comparable byte a byte.
 */
const SVG_PRECISION = 3;

/**
 * Polar → cartesiano alrededor de un centro.
 *
 * @param angle radianes, `0` hacia arriba, creciendo en sentido horario.
 */
export function polar(center: Point, radius: number, angle: number): Point {
  // `sin` en x y `-cos` en y es lo que rota la convención: 0 queda arriba
  // (y negativo en SVG) y el ángulo avanza en sentido horario.
  return {
    x: center.x + radius * Math.sin(angle),
    y: center.y - radius * Math.cos(angle),
  };
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
  center: Point,
  radius: number,
  sides: number,
  rotation = 0,
): readonly Point[] {
  if (!Number.isInteger(sides) || sides < 3) {
    throw new RangeError(`un polígono necesita al menos 3 lados enteros, no ${sides}`);
  }

  const step = TAU / sides;
  return Object.freeze(
    Array.from({ length: sides }, (_, i) => polar(center, radius, rotation + i * step)),
  );
}

/**
 * Mezclador de bits de 32 bits (finalizador de murmur3).
 *
 * No busca calidad criptográfica: busca que semillas contiguas —`seq` y `seq+1`,
 * vértice `i` e `i+1`— den valores sin relación visible. Si el ruido fuera
 * correlacionado, la vibración se leería como un patrón que ondula en vez de
 * como una sacudida.
 */
function mix(n: number): number {
  let h = n | 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x21f0aaad);
  h ^= h >>> 15;
  h = Math.imul(h, 0x735a2d97);
  h ^= h >>> 15;
  return h >>> 0;
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
export function jitter(seed: number, index: number): number {
  // La constante es el recíproco de la razón áurea en 32 bits: separa bien las
  // semillas contiguas antes de mezclarlas con el índice.
  const combined = Math.imul(seed | 0, 0x9e3779b1) ^ mix(index | 0);
  return (mix(combined) / 0xffffffff) * 2 - 1;
}

/**
 * Hash determinista de un string a un entero de 32 bits sin signo.
 *
 * Lo usa el layout para darle a cada firma un rumbo fijo de ataque. Que sea
 * estable importa: la misma firma tiene que llegar siempre desde la misma
 * dirección, si no el replay se ve como ruido en vez de como un patrón.
 */
export function hashString(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) {
    h = Math.imul(h, 31) + value.charCodeAt(i);
  }
  return mix(h);
}

/**
 * Escala del ente `age` frames después de una exposición: se contrae de golpe y
 * recupera. `1 - peak` en `age = 0`, de vuelta en `1` desde `age >= span`.
 */
export function contractionScale(age: number, span: number, peak: number): number {
  if (age < 0 || age >= span) return 1;
  // Recuperación lineal: el golpe es instantáneo, la vuelta es gradual. Al
  // revés se leería como si el ente se encogiera *anticipando* el impacto.
  return 1 - peak * (1 - age / span);
}

/**
 * Radio de la onda expansiva `age` frames después del snap de adaptación.
 * Arranca en el borde del ente y se va hasta `maxRadius`.
 */
export function shockwaveRadius(
  age: number,
  span: number,
  fromRadius: number,
  maxRadius: number,
): number {
  const t = clamp01(age / span);
  // Ease-out cuadrático: sale disparada y se frena al final, que es como se
  // percibe una onda de choque. Lineal se lee como un círculo que crece.
  const eased = 1 - (1 - t) ** 2;
  return fromRadius + (maxRadius - fromRadius) * eased;
}

/**
 * Opacidad de la onda expansiva: `1` en el frame del snap, `0` desde `span`.
 * Fuera de la ventana devuelve `0`, así el llamador puede no dibujar nada.
 */
export function shockwaveOpacity(age: number, span: number): number {
  if (age < 0 || age >= span) return 0;
  return 1 - age / span;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
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
export function svgNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new RangeError(`un atributo SVG no admite ${value}`);
  }

  const rounded = Number(value.toFixed(SVG_PRECISION));
  // `toFixed` deja `-0` y `-0.000` para los negativos que redondean a cero:
  // válidos en SVG, pero rompen la comparación byte a byte.
  if (rounded === 0) return "0";
  return String(rounded);
}
