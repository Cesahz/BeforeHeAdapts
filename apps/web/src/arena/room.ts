// room.ts — una sala local: un engine + un log en memoria.
//
// Sin servidor y sin nada compartido con otra sala (Ley §4). La sala guarda
// estado mutable —es el objeto vivo de la sesión— pero **nunca lo calcula**:
// cada ataque delega en `process()` y el estado nuevo sale del motor.
//
// El tiempo entra siempre como parámetro. Acá no se llama a `Date.now()`: quien
// sabe qué hora es, es la UI; la sala solo lo propaga. Eso es lo que permite
// testear la sala entera con relojes de mentira y reproducir una sesión exacta.

import {
  clusterKeyOf,
  createInitialState,
  generalizedInitialResistance,
  process as expose,
  requiredExposures,
  resistanceOf,
  type EngineEvent,
  type EngineState,
  type PolicyInput,
  type RoomId,
  type StimulusSignature,
} from "@beforeheadapts/core";
import { cooldownOf, toSignature, type Composition } from "@beforeheadapts/arena-dsl";

/** Lo que la UI necesita saber después de un ataque. Todo derivado del motor. */
export interface AttackOutcome {
  readonly composition: Composition;
  readonly signature: StimulusSignature;
  readonly events: readonly EngineEvent[];
  /** `eff(k)` que el motor aplicó a este estímulo (R5). */
  readonly effApplied: number;
  /** `R₀(s)` heredada por generalización, leída ANTES de exponer (R6). */
  readonly generalizedResistance: number;
  /**
   * Daño real del golpe: `intensity × eff(k) × (1 − R₀)`.
   *
   * El motor NO combina R5 con R6 — expone `eff` en el evento y `R₀` como
   * selector aparte, porque cómo se convierten en daño es decisión del dominio.
   * Esta es esa decisión, y vive acá justamente por eso.
   */
  readonly damage: number;
  /** Exposiciones acumuladas contra el cluster tras este golpe. */
  readonly exposures: number;
  /** Exposiciones necesarias para el salto, `N(c)`. */
  readonly requiredExposures: number;
  /** El cluster quedó adaptado (el salto ocurrió en este golpe o antes). */
  readonly adapted: boolean;
  /** Instante en que esta composición vuelve a estar disponible. */
  readonly readyAt: number;
}

/** Motivo por el que un ataque no se puede lanzar todavía. */
export class CooldownError extends Error {
  constructor(readonly readyAt: number) {
    super(`la build está en cooldown hasta ${readyAt}`);
    this.name = "CooldownError";
  }
}

export class Room {
  #state: EngineState;
  readonly #readyAt = new Map<string, number>();

  constructor(roomId: RoomId = "sala-local", config: PolicyInput = {}) {
    this.#state = createInitialState(config, roomId);
  }

  get state(): EngineState {
    return this.#state;
  }

  get log() {
    return this.#state.log;
  }

  /** Instante en que la composición vuelve a estar disponible (0 si nunca se usó). */
  readyAt(composition: Composition): number {
    return this.#readyAt.get(clusterKeyOf(toSignature(composition))) ?? 0;
  }

  canAttack(composition: Composition, now: number): boolean {
    return now >= this.readyAt(composition);
  }

  /**
   * Lanza un ataque contra el ente.
   *
   * `now` es una sola línea de tiempo para toda la sala, no un reloj por build:
   * el log es append-only y el ledger rechaza un timestamp que retroceda, aunque
   * el ataque sea de otra composición.
   *
   * @throws {CooldownError} si la composición sigue en cooldown. La UI debería
   * evitar llegar acá deshabilitando el botón, pero la sala no confía en la UI:
   * el cooldown es la única economía de la Fase 3a y se hace respetar del lado
   * del modelo.
   */
  attack(composition: Composition, now: number): AttackOutcome {
    const readyAt = this.readyAt(composition);
    if (now < readyAt) throw new CooldownError(readyAt);

    const signature = toSignature(composition);
    const clusterId = clusterKeyOf(signature);

    // R6 se lee antes de exponer: es lo que la firma hereda de lo ya adaptado.
    const generalized = generalizedInitialResistance(this.#state, signature);

    const result = expose(this.#state, signature, now);
    this.#state = result.state;

    const nextReadyAt = now + cooldownOf(composition);
    this.#readyAt.set(clusterId, nextReadyAt);

    const applied = result.events.find((e) => e.type === "ResistanceApplied");
    const effApplied = applied?.type === "ResistanceApplied" ? applied.effApplied : 0;
    const cluster = this.#state.clusters.get(clusterId);

    return {
      composition,
      signature,
      events: result.events,
      effApplied,
      generalizedResistance: generalized,
      damage: signature.intensity * effApplied * (1 - generalized),
      exposures: cluster?.exposureCount ?? 0,
      requiredExposures: requiredExposures(signature),
      adapted: resistanceOf(this.#state, clusterId) > 0,
      readyAt: nextReadyAt,
    };
  }
}
