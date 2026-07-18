// engine/ — el motor: `process()` puro y la proyección del log a estado.
//
// Acá se juntan las tres piezas anteriores: signature/ decide identidad y N(c),
// ledger/ guarda los hechos, policy/ pone los números. El motor solo decide
// *qué pasó* y lo escribe como eventos.
//
// Invariante central (Ley §2): el estado siempre es `fold(log)`. `process` no
// muta nada: anexa eventos al log y reproyecta. Por eso `replayFrom(log)` sobre
// cualquier log produce exactamente el mismo estado que haberlo vivido.

import {
  append,
  createLog,
  fold,
  type EngineEvent,
  type EventDraft,
  type EventLog,
  type RoomId,
  type Weakness,
} from "../ledger/index.js";
import {
  adaptedResistance,
  confidenceAt,
  effectiveness as curveEffectiveness,
  generalizedResistance,
  resolvePolicy,
  type AdaptedCluster,
  type PolicyConfig,
  type PolicyInput,
} from "../policy/index.js";
import {
  clusterKeyOf,
  requiredExposures,
  type ClusterId,
  type StimulusSignature,
} from "../signature/index.js";

/** Lo que el motor sabe de un cluster. Proyección pura del log. */
export interface ClusterState {
  /** Firma canónica del cluster (todas las firmas del cluster comparten primitivas). */
  readonly signature: StimulusSignature;
  /** `k`: exposiciones procesadas acumuladas. */
  readonly exposureCount: number;
  /** `true` desde que se emitió su `AdaptationCompleted`. */
  readonly adapted: boolean;
  /** Timestamp de la última exposición: ancla del decaimiento de confianza (R4). */
  readonly lastReinforcedAt: number;
}

/**
 * Estado de una sala. Opaco para el consumidor: se lee vía los selectores de
 * abajo, nunca por dentro.
 */
export interface EngineState {
  readonly config: PolicyConfig;
  readonly roomId: RoomId;
  readonly log: EventLog;
  readonly clusters: ReadonlyMap<ClusterId, ClusterState>;
  /** "Ahora" según el log: timestamp del último evento. Nunca lo genera el núcleo. */
  readonly now: number;
}

export interface ProcessResult {
  readonly state: EngineState;
  readonly events: readonly EngineEvent[];
}

/**
 * Reductor del log. Es la **única** forma en que cambian los clusters.
 *
 * Solo `ExposureRecorded` y `AdaptationCompleted` mueven el estado; los otros
 * tres eventos son notificaciones derivadas (el dominio los consume, el motor no
 * los necesita para reconstruirse). Toda la información que necesita el reductor
 * viaja dentro del evento, así que un log viejo se reproyecta sin ambigüedad.
 */
function applyEvent(
  clusters: ReadonlyMap<ClusterId, ClusterState>,
  event: EngineEvent,
): ReadonlyMap<ClusterId, ClusterState> {
  switch (event.type) {
    case "ExposureRecorded": {
      const next = new Map(clusters);
      const previous = clusters.get(event.clusterId);
      next.set(event.clusterId, {
        signature: previous?.signature ?? event.signature,
        exposureCount: event.exposureCount,
        adapted: previous?.adapted ?? false,
        lastReinforcedAt: event.timestamp,
      });
      return next;
    }
    case "AdaptationCompleted": {
      const previous = clusters.get(event.clusterId);
      if (previous === undefined) {
        throw new Error(
          `log corrupto: AdaptationCompleted de "${event.clusterId}" sin exposición previa`,
        );
      }
      const next = new Map(clusters);
      next.set(event.clusterId, { ...previous, adapted: true });
      return next;
    }
    default:
      return clusters;
  }
}

/** Estado inicial de una sala: log vacío, sin clusters, sin nada heredado. */
export function createInitialState(config: PolicyInput = {}, roomId: RoomId = "sala"): EngineState {
  return Object.freeze({
    config: resolvePolicy(config),
    roomId,
    log: createLog(roomId),
    clusters: new Map<ClusterId, ClusterState>(),
    now: 0,
  });
}

/**
 * Reproyecta un log completo. `replayFrom(log, config)` ≡ haber procesado esas
 * exposiciones una por una: es el invariante que hace de los logs fixtures golden.
 */
export function replayFrom(log: EventLog, config: PolicyInput = {}): EngineState {
  return Object.freeze({
    config: resolvePolicy(config),
    roomId: log.roomId,
    log,
    clusters: fold(log, applyEvent, new Map<ClusterId, ClusterState>()),
    now: log.events.at(-1)?.timestamp ?? 0,
  });
}

/**
 * Debilidad que abre la adaptación de un cluster (R3).
 *
 * El motor NUNCA sabe qué es una contramedida concreta: solo nombra la dimensión
 * expuesta, y el dominio la materializa vía el puerto `CounterSynthesizer`.
 * La regla es la primera primitiva en orden canónico: determinista y estable
 * frente al replay, que es lo único que el núcleo necesita garantizar.
 */
function weaknessOf(signature: StimulusSignature): Weakness {
  return { dimension: signature.primitives[0]! };
}

/**
 * Procesa una exposición: `(estado, firma, tiempo) → (estado', eventos[])`.
 *
 * Función pura. El `timestamp` entra como dato y el motor no lo genera jamás.
 * Orden de emisión: primero la atenuación aplicada al estímulo entrante, después
 * el registro de la exposición y, si corresponde, el salto de adaptación con su
 * contraataque inmediatamente detrás.
 */
export function process(
  state: EngineState,
  signature: StimulusSignature,
  timestamp: number,
): ProcessResult {
  const clusterId = clusterKeyOf(signature);
  const cluster = state.clusters.get(clusterId);
  const k = cluster?.exposureCount ?? 0;
  const alreadyAdapted = cluster?.adapted ?? false;

  const drafts: EventDraft[] = [
    { type: "ResistanceApplied", signature, effApplied: curveEffectiveness(state.config.curve, k), k },
  ];

  const exposureCount = k + 1;
  drafts.push({ type: "ExposureRecorded", clusterId, signature, exposureCount });

  if (!alreadyAdapted) {
    const n = requiredExposures(signature);
    if (exposureCount >= n) {
      // Salto discreto (R1): la adaptación de un cluster completa una sola vez.
      const weakness = weaknessOf(signature);
      drafts.push({ type: "AdaptationCompleted", clusterId, weakness });
      drafts.push({ type: "CounterReady", clusterId, weakness });
    } else {
      drafts.push({ type: "AdaptationProgressed", clusterId, progress: exposureCount / n });
    }
  }

  const log = append(state.log, drafts, timestamp);
  const emitted = log.events.slice(state.log.events.length);
  return {
    state: Object.freeze({
      config: state.config,
      roomId: state.roomId,
      log,
      clusters: emitted.reduce(applyEvent, state.clusters),
      now: timestamp,
    }),
    events: emitted,
  };
}

// --- Selectores -------------------------------------------------------------

/** Cluster canónico al que mapea una firma (ADR 0002: función pura de la firma). */
export function clusterIdOf(_state: EngineState, signature: StimulusSignature): ClusterId {
  return clusterKeyOf(signature);
}

/**
 * Resistencia adaptada contra un cluster (R1): 0 hasta el salto, `adaptedResistance`
 * después. Escalón puro — la generalización de R6 se lee aparte, con
 * `generalizedInitialResistance`, justamente para no convertir esto en una rampa.
 */
export function resistanceOf(state: EngineState, clusterId: ClusterId): number {
  return state.clusters.get(clusterId)?.adapted ? adaptedResistance(state.config.curve) : 0;
}

/** Efectividad `eff(k)` que tendría la PRÓXIMA exposición de esa firma (R5). */
export function effectiveness(state: EngineState, signature: StimulusSignature): number {
  const k = state.clusters.get(clusterKeyOf(signature))?.exposureCount ?? 0;
  return curveEffectiveness(state.config.curve, k);
}

/**
 * Confianza sobre un cluster (R4). Decae con el tiempo sin refuerzo solo bajo
 * política "decaimiento"; la resistencia ya alcanzada nunca se toca.
 */
export function confidenceOf(state: EngineState, clusterId: ClusterId): number {
  const cluster = state.clusters.get(clusterId);
  if (cluster === undefined) return 0;
  return confidenceAt(state.config, Math.max(0, state.now - cluster.lastReinforcedAt));
}

/** `transfer(c)`: cuánta resistencia puede prestar un cluster adaptado (R6). */
function transferOf(state: EngineState, clusterId: ClusterId): number {
  return resistanceOf(state, clusterId) * confidenceOf(state, clusterId);
}

/** Clusters ya adaptados, con su transferencia actual. */
function adaptedClusters(state: EngineState): AdaptedCluster[] {
  const out: AdaptedCluster[] = [];
  for (const [clusterId, cluster] of state.clusters) {
    if (!cluster.adapted) continue;
    out.push({ signature: cluster.signature, transfer: transferOf(state, clusterId) });
  }
  return out;
}

/** `R₀(s) = max_c [sim(s,c) × transfer(c)]`: resistencia heredada por generalización (R6). */
export function generalizedInitialResistance(
  state: EngineState,
  signature: StimulusSignature,
): number {
  return generalizedResistance(state.config, signature, adaptedClusters(state));
}
