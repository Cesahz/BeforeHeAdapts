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

import type { ClusterId, EngineEvent, EventLog, PolicyInput } from "@beforeheadapts/core";

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
export function framesFrom(_log: EventLog, _config: PolicyInput = {}): readonly Frame[] {
  throw new Error("framesFrom: no implementado todavía (Fase 2)");
}
