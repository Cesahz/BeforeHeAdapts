// policy/ — parámetros intercambiables del motor: curva de efectividad, política
// de memoria y radio de generalización.
//
// Todo lo que un dominio puede *calibrar* vive acá, como funciones puras de
// (config, números). Este módulo no tiene estado ni conoce el log: `engine/` le
// pasa los valores ya proyectados y usa lo que devuelve.
//
// Forma de `eff(k)`: ver ADR 0003.

import { sim, type StimulusSignature } from "../signature/index.js";

/** Parámetros de la curva de efectividad `eff(k)` (R5). */
export interface CurveConfig {
  /** Efectividad de la primera exposición, `eff(0)`. */
  readonly base: number;
  /** Razón de decaimiento por exposición, en `(0, 1)`. */
  readonly r: number;
  /** Piso explícito de la curva. Estrictamente entre 0 y `base` (ADR 0003). */
  readonly asymptote: number;
}

/** Política de memoria (R4). */
export type MemoryPolicy = "permanente" | "por-sesion" | "decaimiento";

export interface PolicyConfig {
  readonly memory: MemoryPolicy;
  readonly curve: CurveConfig;
  /** Similitud mínima para que un cluster adaptado transfiera resistencia (R6). */
  readonly generalizationRadius: number;
  /**
   * Unidades de timestamp en las que la confianza cae a la mitad, bajo memoria
   * "decaimiento". Irrelevante en las otras políticas.
   */
  readonly confidenceHalfLife: number;
}

/**
 * Configuración por defecto. El piso se planta en el extremo bajo de la
 * convención del proyecto (`[0.01, 0.05]`, ADR 0003): un estímulo muy repetido
 * sigue arañando, pero la adaptación se siente casi total.
 */
export const defaultPolicy: PolicyConfig = Object.freeze({
  memory: "permanente",
  curve: Object.freeze({ base: 1, r: 0.5, asymptote: 0.01 }),
  generalizationRadius: 0.5,
  confidenceHalfLife: 100,
});

/** Configuración parcial tal como la escribe un dominio; el resto sale del default. */
export interface PolicyInput {
  readonly memory?: MemoryPolicy;
  readonly curve?: Partial<CurveConfig>;
  readonly generalizationRadius?: number;
  readonly confidenceHalfLife?: number;
}

/**
 * Completa y **valida** una configuración. Una curva mal parametrizada es un
 * error del dominio, no algo que el núcleo deba absorber en silencio: sin estas
 * guardas es trivial escribir una `policy` que viole R5 sin que nada avise.
 */
export function resolvePolicy(input: PolicyInput = {}): PolicyConfig {
  const curve: CurveConfig = { ...defaultPolicy.curve, ...input.curve };
  const config: PolicyConfig = {
    memory: input.memory ?? defaultPolicy.memory,
    curve,
    generalizationRadius: input.generalizationRadius ?? defaultPolicy.generalizationRadius,
    confidenceHalfLife: input.confidenceHalfLife ?? defaultPolicy.confidenceHalfLife,
  };

  if (!Number.isFinite(curve.base) || curve.base <= 0) {
    throw new Error("policy inválida: curve.base debe ser un número finito positivo");
  }
  if (!Number.isFinite(curve.r) || curve.r <= 0 || curve.r >= 1) {
    throw new Error("policy inválida: curve.r debe estar en (0, 1)");
  }
  if (!Number.isFinite(curve.asymptote) || curve.asymptote <= 0) {
    throw new Error("policy inválida: curve.asymptote debe ser > 0 (R5: nunca interruptor)");
  }
  if (curve.asymptote >= curve.base) {
    throw new Error("policy inválida: curve.asymptote debe ser menor que curve.base");
  }
  if (
    !Number.isFinite(config.generalizationRadius) ||
    config.generalizationRadius < 0 ||
    config.generalizationRadius > 1
  ) {
    throw new Error("policy inválida: generalizationRadius debe estar en [0, 1]");
  }
  if (!Number.isFinite(config.confidenceHalfLife) || config.confidenceHalfLife <= 0) {
    throw new Error("policy inválida: confidenceHalfLife debe ser un número finito positivo");
  }

  return Object.freeze({ ...config, curve: Object.freeze(curve) });
}

/**
 * `eff(k) = asymptote + (base − asymptote) × r^k` (R5, ADR 0003).
 *
 * Estrictamente decreciente en `k`, con `eff(0) = base` y límite `asymptote > 0`:
 * ninguna cantidad de exposiciones apaga del todo un estímulo.
 *
 * Límite numérico conocido: en `k` grande el término `(base − asymptote)·r^k`
 * cae por debajo del epsilon relativo de `asymptote` y la suma en punto flotante
 * devuelve el piso *exacto*, así que a partir de ahí la curva es constante en vez
 * de estrictamente decreciente (con los defaults, `k ≈ 60`; con `r` chica, mucho
 * antes). No afecta al contrato: R5 solo exige decrecimiento estricto para
 * `k < N(c)`, y `N(c)` es la cantidad de primitivas de la firma (ADR 0002).
 * La garantía dura `eff(k) ≥ asymptote > 0` se mantiene siempre.
 */
export function effectiveness(curve: CurveConfig, k: number): number {
  if (!Number.isInteger(k) || k < 0) {
    throw new Error(`eff inválida: k debe ser un entero ≥ 0, recibido ${k}`);
  }
  return curve.asymptote + (curve.base - curve.asymptote) * Math.pow(curve.r, k);
}

/**
 * Resistencia que alcanza un cluster al completar su adaptación (R1: el salto).
 *
 * Es la fracción del estímulo que el ente llega a bloquear en el piso de la
 * curva, `1 − asymptote/base`: queda en `(0, 1)` por la validación de
 * `resolvePolicy`, nunca 1. La inmunidad total no existe, ni siquiera después
 * de adaptar.
 */
export function adaptedResistance(curve: CurveConfig): number {
  return 1 - curve.asymptote / curve.base;
}

/**
 * Confianza de la generalización sobre un cluster tras `elapsed` unidades de
 * tiempo sin refuerzo (R4).
 *
 * Solo la política "decaimiento" decae, y decae la *confianza*, nunca la memoria
 * del cluster: la resistencia ya alcanzada no se toca.
 */
export function confidenceAt(config: PolicyConfig, elapsed: number): number {
  if (!Number.isFinite(elapsed) || elapsed < 0) {
    throw new Error(`confianza inválida: elapsed debe ser finito y ≥ 0, recibido ${elapsed}`);
  }
  if (config.memory !== "decaimiento") return 1;
  return Math.pow(0.5, elapsed / config.confidenceHalfLife);
}

/** Un cluster ya adaptado, tal como lo proyecta `engine/` desde el log. */
export interface AdaptedCluster {
  readonly signature: StimulusSignature;
  /** `transfer(c)`: cuánta resistencia puede prestar a firmas parecidas. */
  readonly transfer: number;
}

/**
 * `R₀(s) = max_c [sim(s,c) × transfer(c)]` sobre los clusters adaptados (R6).
 *
 * Los clusters por debajo del radio de generalización no transfieren nada: sin
 * ese corte, cualquier firma heredaría una brizna de resistencia de todo lo que
 * el ente vio alguna vez, y "adaptarse a lo desconocido" dejaría de significar algo.
 */
export function generalizedResistance(
  config: PolicyConfig,
  signature: StimulusSignature,
  adapted: readonly AdaptedCluster[],
): number {
  let best = 0;
  for (const cluster of adapted) {
    const similarity = sim(signature, cluster.signature);
    if (similarity < config.generalizationRadius) continue;
    const transferred = similarity * cluster.transfer;
    if (transferred > best) best = transferred;
  }
  return best;
}
