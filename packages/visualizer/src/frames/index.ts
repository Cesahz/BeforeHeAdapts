// frames/ — replay del log a frames renderizables.
//
// Un frame es el estado del ente **tal como se ve** en un instante del replay.
// La derivación es pura y determinista: mismo log + misma policy = mismos
// frames, siempre. El render (canvas/SVG) y el export (gif/webm) son
// adaptadores que consumen estos frames; acá no se dibuja nada ni se toca I/O.
//
// La entrada canónica es el log exportado del ADR 0006. Este módulo NO
// reimplementa la proyección del núcleo: la delega en `replayFrom` y sus
// selectores. Si un frame y el motor discrepan, el que está mal es el frame.

import {
  confidenceOf,
  prefix,
  replayFrom,
  requiredExposures,
  resistanceOf,
  type ClusterId,
  type ClusterState,
  type EngineEvent,
  type EngineState,
  type EventLog,
  type PolicyInput,
} from "@beforeheadapts/core";

/** Lo que se dibuja de un cluster en un instante del replay. */
export interface ClusterFrame {
  readonly clusterId: ClusterId;
  /** Resistencia vigente: escalón puro, `0` hasta el salto de adaptación (R1). */
  readonly resistance: number;
  /** `k`: exposiciones acumuladas. */
  readonly exposureCount: number;
  /** `N(c)`: exposiciones que exige la complejidad de la firma (R2). */
  readonly requiredExposures: number;
  /** Avance hacia el salto, en `[0, 1]`. Llega a `1` exactamente al adaptar. */
  readonly progress: number;
  /** `true` desde el `AdaptationCompleted` del cluster. */
  readonly adapted: boolean;
  /** Confianza vigente según la política de memoria (R4). */
  readonly confidence: number;
}

/**
 * Un instante del replay: el estado completo después de aplicar un evento.
 *
 * Hay exactamente un frame por evento del log, en orden de `seq`. Los eventos
 * que no mueven estado (`AdaptationProgressed`, `CounterReady`,
 * `ResistanceApplied`) igual producen frame: el visualizador necesita mostrar
 * el golpe y la notificación aunque los clusters no cambien.
 */
export interface Frame {
  readonly seq: number;
  readonly timestamp: number;
  /** El evento que produjo este frame. Es lo que el render anima. */
  readonly event: EngineEvent;
  /** Todos los clusters conocidos hasta acá, en orden estable de aparición. */
  readonly clusters: readonly ClusterFrame[];
}

/**
 * Deriva la secuencia de frames de un log completo.
 *
 * Invariante rector: el frame `i` es exactamente la proyección de los primeros
 * `i + 1` eventos. No hay estado paralelo ni acumulación propia del
 * visualizador — un frame es una *lectura* del motor, nunca una segunda
 * implementación de él.
 *
 * @param log log de una sala, tal como lo persiste el server o lo trae el export.
 * @param config la misma policy con la que se generó el log; sin ella el replay
 * no es reproducible (ADR 0006 §4, por eso `policyConfig` viaja en la cabecera).
 */
export function framesFrom(log: EventLog, config: PolicyInput = {}): readonly Frame[] {
  return log.events.map((event, i) => {
    // Cada frame se lee del motor sobre el prefijo correspondiente: el
    // visualizador no acumula nada por su cuenta.
    const state = replayFrom(prefix(log, i + 1), config);
    const clusters: ClusterFrame[] = [];

    // El Map del motor conserva el orden de primera aparición de cada cluster.
    for (const [clusterId, cluster] of state.clusters) {
      clusters.push(frameOf(state, clusterId, cluster));
    }

    return Object.freeze({
      seq: event.seq,
      timestamp: event.timestamp,
      event,
      clusters: Object.freeze(clusters) as readonly ClusterFrame[],
    });
  });
}

/** Lectura de un cluster del estado del motor. Nada acá recalcula el núcleo. */
function frameOf(
  state: EngineState,
  clusterId: ClusterId,
  cluster: ClusterState,
): ClusterFrame {
  const required = requiredExposures(cluster.signature);
  return Object.freeze({
    clusterId,
    resistance: resistanceOf(state, clusterId),
    exposureCount: cluster.exposureCount,
    requiredExposures: required,
    // Se satura en 1: después del salto el cluster sigue acumulando exposiciones
    // (un cluster adapta una sola vez), pero el avance ya no significa nada.
    progress: Math.min(1, cluster.exposureCount / required),
    adapted: cluster.adapted,
    confidence: confidenceOf(state, clusterId),
  });
}
