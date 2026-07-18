// gesture/trace.ts — geometría compartida de trazos. Puro, sin umbrales.
//
// Acá vive la matemática que usan los DOS lados de la frontera de cuantización
// del ADR 0004: el reconocedor de gestos (`recognize.ts`) y el lector de ruido
// ambiental (`noise.ts`). Ninguna decisión se toma en este archivo — no hay
// umbrales, no hay clasificación, no se importa `balance.ts`. Solo medidas.
//
// Ese corte es el mismo que `render/geometry.ts` hace en el visualizador, y por
// el mismo motivo: la parte que se testea con property tests es la que no
// decide nada.

/** Una muestra del puntero. `t` en milisegundos monótonos. */
export interface TracePoint {
  readonly x: number;
  readonly y: number;
  readonly t: number;
}

const TAU = Math.PI * 2;

export function distance(a: TracePoint, b: TracePoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Recorrido total: la suma de los segmentos. Crece con la cantidad de muestras. */
export function pathLength(points: readonly TracePoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += distance(points[i - 1]!, points[i]!);
  return total;
}

/**
 * Diagonal del bounding box: cuánta pantalla ocupa el trazo.
 *
 * No es redundante con `pathLength`. El recorrido crece con la cantidad de
 * muestras —jitter en una caja de 30 px puede acumular cientos de píxeles de
 * camino— mientras que la extensión no depende del sampling rate del
 * dispositivo. Es la medida que separa un gesto de un temblor, y la que el
 * ADR 0004 necesita para que el determinismo no dependa del hardware.
 */
export function extentOf(points: readonly TracePoint[]): number {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return points.length === 0 ? 0 : Math.hypot(maxX - minX, maxY - minY);
}

/**
 * Re-muestrea el trazo a `count` puntos equidistantes **por longitud de arco**.
 *
 * Es el paso que compra la invariancia a escala y velocidad: después de esto,
 * un círculo dibujado lento y grande y otro rápido y chico producen la misma
 * secuencia de ángulos. (Misma idea que el reconocedor $1, sin su plantilla ni
 * su rotación.)
 */
export function resample(points: readonly TracePoint[], count: number): readonly TracePoint[] {
  const total = pathLength(points);
  if (total === 0 || count < 2) return points;

  const step = total / (count - 1);
  const out: TracePoint[] = [points[0]!];
  let carried = 0;

  for (let i = 1; i < points.length; i += 1) {
    const from = points[i - 1]!;
    const to = points[i]!;
    let segment = distance(from, to);
    if (segment === 0) continue;

    // Un segmento largo puede contener varios puntos re-muestreados, de ahí el
    // while: se va cortando el segmento hasta que lo que sobra no llega al paso.
    let cursor = from;
    while (carried + segment >= step && out.length < count - 1) {
      const remaining = step - carried;
      const ratio = remaining / segment;
      cursor = {
        x: cursor.x + (to.x - cursor.x) * ratio,
        y: cursor.y + (to.y - cursor.y) * ratio,
        t: cursor.t + (to.t - cursor.t) * ratio,
      };
      out.push(cursor);
      segment -= remaining;
      carried = 0;
    }
    carried += segment;
  }

  // El último punto se fija explícitamente: acumular flotantes puede dejar el
  // arreglo un punto corto, y el cierre del trazo es justo lo que mide `circle`.
  while (out.length < count) out.push(points[points.length - 1]!);
  return out;
}

/**
 * Diferencia angular entre segmentos consecutivos, normalizada a (−π, π].
 *
 * ⚠️ El signo de un giro de exactamente 180° es ARBITRARIO. Un vaivén invierte
 * la marcha sin sentido de giro definido —no gira ni a favor ni en contra del
 * reloj— pero `atan2` obliga a elegir, y π cae siempre del mismo lado. Quien
 * consuma estos valores tiene que decidir qué hace con las cúspides:
 *
 *   - `recognize.ts` las EXCLUYE del giro con signo (si no, sacudir el mouse se
 *     lee como un círculo perfecto).
 *   - `noise.ts` las cuenta enteras (un vaivén es movimiento máximamente
 *     errático, que es justo lo que el ruido mide).
 *
 * La asimetría es deliberada y es la razón de que esta función devuelva los
 * giros crudos en vez de un agregado.
 */
export function signedTurns(points: readonly TracePoint[]): readonly number[] {
  const turns: number[] = [];
  for (let i = 2; i < points.length; i += 1) {
    const a = points[i - 2]!;
    const b = points[i - 1]!;
    const c = points[i]!;
    const previous = Math.atan2(b.y - a.y, b.x - a.x);
    const current = Math.atan2(c.y - b.y, c.x - b.x);
    let delta = current - previous;
    // Normalizar a (−π, π]: sin esto, cruzar el corte de `atan2` se lee como un
    // giro de casi una vuelta entera y un trazo recto parecería un círculo.
    while (delta > Math.PI) delta -= TAU;
    while (delta <= -Math.PI) delta += TAU;
    turns.push(delta);
  }
  return turns;
}
