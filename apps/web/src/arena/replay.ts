// replay.ts — export del log de la sesión conforme al ADR 0006.
//
// El formato del archivo exportado es API pública del proyecto: se lo consume el
// visualizador, los fixtures golden y cualquier análisis de balance posterior.
// Por eso la cabecera no es decorativa — sin `policyConfig` el replay no es
// reproducible, porque el mismo log con otra policy da otro estado final.
//
// Puro: arma el objeto y lo serializa. Bajarlo al disco es cosa de `download.ts`.

import { CONTRACT_VERSION, resolvePolicy, type EngineEvent, type PolicyConfig } from "@beforeheadapts/core";

import type { Room } from "./room.js";

/**
 * Versión del motor que generó el replay.
 *
 * No es lo mismo que `schemaVersion`: el esquema versiona el FORMATO de los
 * eventos (y solo salta con migrador + fixture, ADR 0006), mientras que esto
 * versiona el código que los produjo. Sirve para rastrear un replay raro hasta
 * la build que lo generó.
 */
export const ENGINE_VERSION = "0.2.0";

/** Archivo de replay tal como se exporta. Ver ADR 0006 punto 4. */
export interface ReplayFile {
  readonly schemaVersion: typeof CONTRACT_VERSION;
  readonly engineVersion: string;
  readonly policyConfig: PolicyConfig;
  readonly roomId: string;
  readonly events: readonly EngineEvent[];
}

/** Arma el replay de una sala. */
export function toReplayFile(room: Room): ReplayFile {
  return {
    schemaVersion: CONTRACT_VERSION,
    engineVersion: ENGINE_VERSION,
    // Se exporta la policy YA RESUELTA, no la parcial que escribió el dominio:
    // los defaults tienen que viajar explícitos o un cambio futuro de default
    // cambiaría en silencio cómo se reproduce un replay viejo.
    policyConfig: resolvePolicy(room.state.config),
    roomId: room.log.roomId,
    events: room.log.events,
  };
}

/** Serializa el replay. Indentado a propósito: estos archivos se leen a mano. */
export function serializeReplay(room: Room): string {
  return JSON.stringify(toReplayFile(room), null, 2);
}

/** Nombre de archivo sugerido. Sin caracteres que Windows rechace. */
export function replayFileName(room: Room): string {
  const safeRoom = room.log.roomId.replace(/[^a-zA-Z0-9_-]/g, "-");
  return `replay-${safeRoom}-${room.log.events.length}ev.json`;
}
