// ledger/ — catálogo de eventos y log append-only versionado.
//
// Este módulo es la única fuente de verdad del estado: todo cambio ocurre como
// evento y el estado siempre es `fold(log)`. El ledger no sabe *qué significan*
// los eventos; solo garantiza su forma, su orden y su inmutabilidad. La
// proyección a estado del ente vive en engine/.
//
// Es puro: no genera tiempo ni identidad. `timestamp` entra como dato.

import type { ClusterId, Primitive, StimulusSignature } from "../signature/index.js";

/** Versión del formato de eventos. Cada evento la lleva en su campo `v`. */
export const CONTRACT_VERSION = 1 as const;

/** Identidad de la sala. Un log por sala, sin nada compartido entre salas. */
export type RoomId = string;

/** Dimensión por la que el ente quedó expuesto al adaptarse a un cluster. */
export interface Weakness {
  readonly dimension: Primitive;
}

/** Campos que lleva todo evento del log. */
interface Envelope {
  readonly v: typeof CONTRACT_VERSION;
  readonly roomId: RoomId;
  readonly seq: number;
  readonly timestamp: number;
}

/** Exposición procesada registrada contra un cluster. */
export interface ExposureRecorded extends Envelope {
  readonly type: "ExposureRecorded";
  readonly clusterId: ClusterId;
  readonly signature: StimulusSignature;
  readonly exposureCount: number;
}

/** El contador de exposiciones avanzó sin llegar a `N(c)`. */
export interface AdaptationProgressed extends Envelope {
  readonly type: "AdaptationProgressed";
  readonly clusterId: ClusterId;
  /** Avance en `[0, 1)`: `exposureCount / N(c)`. */
  readonly progress: number;
}

/** El contador llegó a `N(c)`: salto discreto de resistencia (R1). */
export interface AdaptationCompleted extends Envelope {
  readonly type: "AdaptationCompleted";
  readonly clusterId: ClusterId;
  readonly weakness: Weakness;
}

/** Emitido inmediatamente tras `AdaptationCompleted` (R3). */
export interface CounterReady extends Envelope {
  readonly type: "CounterReady";
  readonly clusterId: ClusterId;
  readonly weakness: Weakness;
}

/** El motor atenuó un estímulo entrante con la curva `eff(k)` (R5). */
export interface ResistanceApplied extends Envelope {
  readonly type: "ResistanceApplied";
  readonly signature: StimulusSignature;
  readonly effApplied: number;
  readonly k: number;
}

export type EngineEvent =
  | ExposureRecorded
  | AdaptationProgressed
  | AdaptationCompleted
  | CounterReady
  | ResistanceApplied;

/** Evento tal como lo emite `engine/`: sin sobre. El ledger lo estampa al anexar. */
export type EventDraft = {
  [E in EngineEvent as E["type"]]: Omit<E, keyof Envelope>;
}[EngineEvent["type"]];

/**
 * Log append-only de una sala. Inmutable: `append` devuelve un log nuevo y nunca
 * toca el anterior, de modo que cualquier estado previo sigue siendo replayable.
 */
export interface EventLog {
  readonly roomId: RoomId;
  readonly events: readonly EngineEvent[];
}

/** Log vacío de una sala. */
export function createLog(roomId: RoomId): EventLog {
  if (roomId.length === 0) {
    throw new Error("log inválido: roomId vacío");
  }
  return Object.freeze({ roomId, events: Object.freeze([]) as readonly EngineEvent[] });
}

/** `seq` que le tocaría al próximo evento. Los `seq` son densos y arrancan en 0. */
export function nextSeq(log: EventLog): number {
  return log.events.length;
}

/** Timestamp del último evento, o `undefined` si el log está vacío. */
export function lastTimestamp(log: EventLog): number | undefined {
  return log.events.at(-1)?.timestamp;
}

/**
 * Anexa los eventos de un procesamiento, estampándolos con `v`, `roomId`, `seq`
 * consecutivo y el `timestamp` recibido.
 *
 * @throws si el timestamp no es finito o retrocede respecto del último evento:
 * un log con tiempo no monótono rompe el replay y es un bug del llamador.
 */
export function append(
  log: EventLog,
  drafts: readonly EventDraft[],
  timestamp: number,
): EventLog {
  if (!Number.isFinite(timestamp)) {
    throw new Error("append inválido: el timestamp debe ser un número finito");
  }
  const previous = lastTimestamp(log);
  if (previous !== undefined && timestamp < previous) {
    throw new Error(
      `append inválido: el timestamp ${timestamp} retrocede respecto de ${previous}`,
    );
  }
  if (drafts.length === 0) return log;

  const stamped = drafts.map((draft, i) =>
    Object.freeze({
      ...draft,
      v: CONTRACT_VERSION,
      roomId: log.roomId,
      seq: log.events.length + i,
      timestamp,
    } as EngineEvent),
  );
  return Object.freeze({
    roomId: log.roomId,
    events: Object.freeze([...log.events, ...stamped]) as readonly EngineEvent[],
  });
}

/**
 * Rehidrata un log persistido, validando que sea un log íntegro de una sola sala.
 *
 * Es la puerta de entrada desde `apps/server`: si la persistencia devuelve
 * eventos de otra sala, con `seq` salteado o con tiempo no monótono, el núcleo
 * lo rechaza en vez de operar sobre un log corrupto.
 */
export function logFrom(roomId: RoomId, events: readonly EngineEvent[]): EventLog {
  let log = createLog(roomId);
  events.forEach((event, i) => {
    if (event.roomId !== roomId) {
      throw new Error(
        `log corrupto: el evento ${i} pertenece a la sala "${event.roomId}", no a "${roomId}"`,
      );
    }
    if (event.seq !== i) {
      throw new Error(`log corrupto: seq ${event.seq} en la posición ${i}`);
    }
    const previous = lastTimestamp(log);
    if (previous !== undefined && event.timestamp < previous) {
      throw new Error(`log corrupto: el timestamp del evento ${i} retrocede`);
    }
    log = Object.freeze({ roomId, events: Object.freeze([...log.events, event]) });
  });
  return log;
}

/**
 * Prefijo del log con los primeros `count` eventos, como log independiente.
 * Sirve para replays parciales y para los property tests de monotonicidad (R4).
 */
export function prefix(log: EventLog, count: number): EventLog {
  if (!Number.isInteger(count) || count < 0 || count > log.events.length) {
    throw new Error(`prefijo inválido: ${count} fuera de [0, ${log.events.length}]`);
  }
  return Object.freeze({
    roomId: log.roomId,
    events: Object.freeze(log.events.slice(0, count)) as readonly EngineEvent[],
  });
}

/**
 * Proyección genérica del log a estado: `estado = fold(log)`.
 *
 * El ledger no conoce la semántica; el reductor lo aporta `engine/`. Debe ser
 * puro, de modo que replayar el mismo log produzca siempre el mismo estado.
 */
export function fold<S>(
  log: EventLog,
  reducer: (state: S, event: EngineEvent) => S,
  initial: S,
): S {
  return log.events.reduce(reducer, initial);
}
