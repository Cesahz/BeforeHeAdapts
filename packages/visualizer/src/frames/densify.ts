// frames/densify.ts — densificación determinista de la secuencia de frames.
//
// ADR 0010 §1. Nace de un reporte de verificación humana: la animación se
// sentía floja. El diagnóstico contraintuitivo es que **no faltaban cuadros por
// segundo** —el medidor marcaba 180 fps— sino DATOS entre evento y evento:
// `framesFrom` emite un frame por evento, así que a un ataque cada 1-2 s le
// tocan un puñado de cuadros distintos y el resto del tiempo la pantalla se
// redibuja idéntica a sí misma.
//
// La salida obvia sería interpolar con un reloj en la vista viva. Está
// descartada: rompería la promesa del ADR 0007 de que el DOM y el export son
// idénticos, y esa divergencia es invisible hasta que alguien compara el gif
// con lo que vio. Acá se resuelve con **más datos deterministas, no con un
// reloj** — el mismo movimiento que el ADR 0007 hizo al recibir la secuencia
// completa en vez del frame suelto.
//
// Dos reglas gobiernan qué se interpola:
//
//   1. **Lo continuo se interpola**: progreso, confianza, el avance hacia el
//      salto. Son magnitudes que el motor mueve de a poco.
//   2. **Lo discreto NO**: `adapted`, `resistance`, la cantidad de clusters.
//      Son escalones del contrato (R1) y siguen saltando. Interpolar un salto
//      de resistencia sería mentir sobre el motor, y el salto discreto es
//      justamente lo que este proyecto existe para mostrar.
//
// Es perezosa por diseño (encargo de la revisión externa del ADR 0010): un log
// de 800 eventos a 60 fps son decenas de miles de frames y el export no puede
// materializarlos. La pereza no le quita pureza — cada frame sigue siendo
// función de la entrada.

import type { ClusterFrame, Frame } from "./index.js";

/** Cuántos frames se emiten por cada evento del log. */
export const DEFAULT_STEPS = 6;

export interface DensifyOptions {
  /**
   * Frames por evento. `1` devuelve la secuencia original intacta.
   *
   * Con el `FRAME_HOLD_MS` de la vista viva (110 ms), 6 pasos dan ~18 ms por
   * frame: la cadencia de un monitor de 60 Hz.
   */
  readonly steps?: number;
}

/**
 * Un frame densificado sabe en qué punto del tramo está.
 *
 * `sub` existe por una razón muy concreta y nada obvia: la vibración del ente
 * se siembra con el `seq` del evento (ADR 0007 §5), y todos los frames
 * interpolados de un mismo evento COMPARTEN `seq`. Sin un sub-índice, los seis
 * frames de un evento tendrían jitter idéntico — el temblor se congelaría
 * exactamente donde tiene que temblar y saltaría de golpe al cambiar de evento.
 *
 * Lo detectó la revisión externa leyendo el ADR, antes de que existiera el
 * código.
 */
export interface DenseFrame extends Frame {
  /** Posición dentro del tramo, en `[0, steps)`. Los frames canónicos llevan 0. */
  readonly sub: number;
}

/**
 * Semilla del jitter para un frame densificado.
 *
 * Mezcla `seq` y `sub` con avalancha de 32 bits, en vez de combinarlos con una
 * suma o una concatenación: dos frames contiguos difieren en un solo bit de
 * entrada y tienen que dar semillas sin ninguna relación visible, si no el
 * temblor se ve "caminar" en vez de vibrar.
 *
 * Sigue sin haber `Math.random()` ni reloj: `sub` es un entero derivado de la
 * posición en la secuencia. La reproducibilidad byte por byte se mantiene.
 */
export function subSeed(seq: number, sub: number): number {
  // `sub === 0` devuelve el `seq` crudo para que los frames canónicos tiemblen
  // exactamente como antes de que existiera la densificación: los fixtures
  // golden de la Fase 2 siguen siendo válidos byte por byte.
  if (sub === 0) return seq >>> 0;
  let h = Math.imul(seq | 0, 0x9e3779b1) ^ Math.imul(sub | 0, 0x85ebca6b);
  h ^= h >>> 16;
  h = Math.imul(h, 0x21f0aaad);
  h ^= h >>> 15;
  return h >>> 0;
}

export function seedOf(frame: DenseFrame): number {
  return subSeed(frame.seq, frame.sub);
}

/** Interpolación lineal. */
function lerp(from: number, to: number, r: number): number {
  return from + (to - from) * r;
}

/**
 * Interpola un cluster hacia su estado en el frame siguiente.
 *
 * Solo las magnitudes continuas. `adapted` y `resistance` se toman del frame de
 * PARTIDA sin tocar: son el escalón de R1, y hasta que el tramo termina el
 * cluster todavía no adaptó. Que el salto ocurra en el último frame del tramo y
 * no repartido a lo largo es lo que lo hace leerse como salto.
 */
function tweenCluster(from: ClusterFrame, to: ClusterFrame | undefined, r: number): ClusterFrame {
  if (to === undefined) return from;
  return Object.freeze({
    ...from,
    progress: lerp(from.progress, to.progress, r),
    confidence: lerp(from.confidence, to.confidence, r),
  });
}

/**
 * Expande la secuencia de frames a `steps` frames por evento.
 *
 * @param frames secuencia canónica, tal como la devuelve `framesFrom`.
 * @returns iterador perezoso. Consumirlo dos veces exige llamar de nuevo.
 */
export function* densify(
  frames: Iterable<Frame>,
  options: DensifyOptions = {},
): IterableIterator<DenseFrame> {
  const steps = Math.max(1, Math.floor(options.steps ?? DEFAULT_STEPS));

  let pending: Frame | undefined;

  const expand = function* (frame: Frame, next: Frame | undefined): IterableIterator<DenseFrame> {
    for (let sub = 0; sub < steps; sub += 1) {
      // Los intermedios pertenecen al frame de PARTIDA: llevan su evento y su
      // `seq`. El siguiente solo aporta hacia dónde van las magnitudes
      // continuas, así que el evento que se muestra nunca es ambiguo.
      if (sub === 0) {
        yield Object.freeze({ ...frame, sub: 0 });
        continue;
      }
      const r = sub / steps;
      yield Object.freeze({
        ...frame,
        sub,
        timestamp: next === undefined ? frame.timestamp : lerp(frame.timestamp, next.timestamp, r),
        clusters: Object.freeze(
          frame.clusters.map((cluster, i) => tweenCluster(cluster, next?.clusters[i], r)),
        ) as readonly ClusterFrame[],
      });
    }
  };

  for (const frame of frames) {
    if (pending !== undefined) yield* expand(pending, frame);
    pending = frame;
  }

  // El ÚLTIMO evento también recibe sus `steps` frames, aunque no haya hacia
  // dónde interpolar. No es simetría por prolijidad: sin esto, la vista viva
  // se congela apenas alcanza el presente —que es la mayor parte del tiempo,
  // porque los ataques entran cada 1-2 s— y volvería el problema que este
  // módulo existe para resolver. Los valores se sostienen, pero `sub` avanza,
  // y eso basta para que la vibración siga viva y para que los efectos
  // transitorios del render (que decaen por distancia en frames) terminen de
  // apagarse suavemente en vez de quedar clavados a mitad de camino.
  if (pending !== undefined) yield* expand(pending, undefined);
}

/**
 * Densifica y materializa. Atajo para tests y para consumidores acotados.
 *
 * ⚠️ No usar sobre logs largos: es exactamente lo que la pereza de `densify`
 * existe para evitar. La vista viva toma una ventana y el export consume en
 * streaming; ninguno de los dos debería llamar a esto.
 */
export function densifyAll(
  frames: Iterable<Frame>,
  options: DensifyOptions = {},
): readonly DenseFrame[] {
  return [...densify(frames, options)];
}
