import { describe, it, expect } from "vitest";
import fc from "fast-check";

// ============================================================================
// Contrato de aceptación del motor de adaptación — las 6 reglas (R1–R6).
//
// Spec canónica: docs/contrato.md. Este archivo ES la forma ejecutable.
//
// Fase 0: NO hay implementación. Los tipos de abajo son la especificación de la
// superficie del núcleo; la conducta se referencia vía placeholders que lanzan
// `Error(NOT_IMPLEMENTED)`. Por eso TODOS los tests deben estar en ROJO: ese
// rojo es el hito de la Fase 0. En la Fase 1 se reconectan estos placeholders a
// los módulos reales (signature/ ledger/ policy/ engine/) y se implementa hasta
// ponerlos en verde. Prohibido debilitar un test del contrato para pasarlo.
// ============================================================================

// --- Tipos del dominio del núcleo (especificación) --------------------------

type Primitive = string;

interface StimulusSignature {
  readonly primitives: readonly Primitive[];
  readonly intensity: number;
}

type ClusterId = string;

interface Weakness {
  readonly dimension: Primitive;
}

type MemoryPolicy = "permanente" | "por-sesion" | "decaimiento";

interface PolicyConfig {
  readonly memory: MemoryPolicy;
  readonly curve: { readonly base: number; readonly r: number; readonly asymptote: number };
  readonly generalizationRadius: number;
}

interface ExposureRecorded {
  readonly type: "ExposureRecorded";
  readonly v: number;
  readonly clusterId: ClusterId;
  readonly signature: StimulusSignature;
  readonly exposureCount: number;
}
interface AdaptationProgressed {
  readonly type: "AdaptationProgressed";
  readonly v: number;
  readonly clusterId: ClusterId;
  readonly progress: number;
}
interface AdaptationCompleted {
  readonly type: "AdaptationCompleted";
  readonly v: number;
  readonly clusterId: ClusterId;
  readonly weakness: Weakness;
}
interface CounterReady {
  readonly type: "CounterReady";
  readonly v: number;
  readonly clusterId: ClusterId;
  readonly weakness: Weakness;
}
interface ResistanceApplied {
  readonly type: "ResistanceApplied";
  readonly v: number;
  readonly signature: StimulusSignature;
  readonly effApplied: number;
  readonly k: number;
}

type EngineEvent =
  | ExposureRecorded
  | AdaptationProgressed
  | AdaptationCompleted
  | CounterReady
  | ResistanceApplied;

// Estado opaco: el test nunca inspecciona su interior, solo lo pasa y lee vía selectores.
interface EngineState {
  readonly __brand: "EngineState";
}

interface ProcessResult {
  readonly state: EngineState;
  readonly events: readonly EngineEvent[];
}

// --- Superficie del núcleo (placeholders — Fase 1 la implementa) ------------

const NOT_IMPLEMENTED = "motor no implementado — Fase 1";
function notImplemented(): never {
  throw new Error(NOT_IMPLEMENTED);
}

/** Estado inicial de una sala/ente para una configuración de política dada. */
function createInitialState(_config: PolicyConfig): EngineState {
  return notImplemented();
}

/** Función pura del contrato: (estado, estímulo, tiempo) → (estado', eventos[]). */
function process(_state: EngineState, _signature: StimulusSignature, _timestamp: number): ProcessResult {
  return notImplemented();
}

/** Resistencia adaptada actual contra un cluster (magnitud escalonada — R1). */
function resistanceOf(_state: EngineState, _clusterId: ClusterId): number {
  return notImplemented();
}

/** Efectividad `eff(k)` de la PRÓXIMA exposición de esa firma (curva — R5). */
function effectiveness(_state: EngineState, _signature: StimulusSignature): number {
  return notImplemented();
}

/** Confianza de la generalización sobre un cluster (decae en política "decaimiento" — R4). */
function confidenceOf(_state: EngineState, _clusterId: ClusterId): number {
  return notImplemented();
}

/** `N(c)`: exposiciones requeridas para completar la adaptación a esa firma (R2). */
function requiredExposures(_signature: StimulusSignature): number {
  return notImplemented();
}

/** Cluster canónico al que mapea una firma en un estado dado. */
function clusterIdOf(_state: EngineState, _signature: StimulusSignature): ClusterId {
  return notImplemented();
}

/** `R₀(s) = max_c [sim(s,c) × transfer(c)]`: resistencia heredada por generalización (R6). */
function generalizedInitialResistance(_state: EngineState, _signature: StimulusSignature): number {
  return notImplemented();
}

// --- Helpers de test (lógica real; nunca se ejecuta porque los placeholders lanzan antes) ---

/** Construye una firma canónica (primitivas ordenadas para independencia del orden). */
function sig(primitives: readonly Primitive[], intensity = 1): StimulusSignature {
  return { primitives: [...primitives].sort(), intensity };
}

interface Run {
  readonly states: readonly EngineState[]; // longitud n+1 (incluye el estado inicial)
  readonly events: readonly EngineEvent[]; // todos los eventos, en orden
  readonly perStep: readonly (readonly EngineEvent[])[]; // eventos emitidos por cada exposición
}

/** Corre `n` exposiciones de la misma firma y devuelve estados + eventos. */
function run(config: PolicyConfig, signature: StimulusSignature, n: number): Run {
  const states: EngineState[] = [createInitialState(config)];
  const events: EngineEvent[] = [];
  const perStep: EngineEvent[][] = [];
  for (let i = 0; i < n; i++) {
    const r = process(states[i]!, signature, i);
    states.push(r.state);
    perStep.push([...r.events]);
    events.push(...r.events);
  }
  return { states, events, perStep };
}

function isNonDecreasing(xs: readonly number[]): boolean {
  return xs.every((x, i) => i === 0 || x >= xs[i - 1]!);
}
function isStrictlyDecreasing(xs: readonly number[]): boolean {
  return xs.every((x, i) => i === 0 || x < xs[i - 1]!);
}

const defaultConfig: PolicyConfig = {
  memory: "permanente",
  curve: { base: 1, r: 0.5, asymptote: 0.05 },
  generalizationRadius: 0.5,
};
const sesionConfig: PolicyConfig = { ...defaultConfig, memory: "por-sesion" };
const decaimientoConfig: PolicyConfig = { ...defaultConfig, memory: "decaimiento" };

// Arbitrarios para property testing.
const primitiveArb = fc.constantFrom("fuego", "corte", "presion", "sonido", "rayo", "hielo");
const signatureArb: fc.Arbitrary<StimulusSignature> = fc
  .uniqueArray(primitiveArb, { minLength: 1, maxLength: 4 })
  .map((ps) => sig(ps));

// ============================================================================
// R1 — Adaptación discreta
// ============================================================================
describe("R1 — Adaptación discreta", () => {
  it("la resistencia de un cluster sólo cambia en la exposición que emite AdaptationCompleted", () => {
    const s = sig(["fuego"]);
    const n = requiredExposures(s) + 2;
    const { states, perStep } = run(defaultConfig, s, n);
    const cluster = clusterIdOf(states[0]!, s);

    for (let i = 0; i < perStep.length; i++) {
      const before = resistanceOf(states[i]!, cluster);
      const after = resistanceOf(states[i + 1]!, cluster);
      const completed = perStep[i]!.some(
        (e) => e.type === "AdaptationCompleted" && e.clusterId === cluster,
      );
      if (!completed) {
        expect(after).toBe(before); // sin salto ⇒ constante (nunca rampa)
      }
    }
  });

  it("la resistencia nunca cambia de forma gradual entre adaptaciones", () => {
    const s = sig(["corte"]);
    const { states } = run(defaultConfig, s, requiredExposures(s) - 1); // nunca completa
    const cluster = clusterIdOf(states[0]!, s);
    const series = states.map((st) => resistanceOf(st, cluster));
    expect(new Set(series).size).toBe(1); // constante: un solo valor distinto
  });
});

// ============================================================================
// R2 — Complejidad determina exposiciones
// ============================================================================
describe("R2 — Complejidad determina exposiciones", () => {
  it("N(c) es monótona creciente: agregar una dimensión no reduce las exposiciones", () => {
    fc.assert(
      fc.property(signatureArb, primitiveArb, (base, extra) => {
        const complex = sig([...base.primitives, extra]);
        return requiredExposures(complex) >= requiredExposures(base);
      }),
    );
  });

  it("una firma de complejidad mínima requiere exactamente 1 exposición", () => {
    expect(requiredExposures(sig(["fuego"]))).toBe(1);
  });
});

// ============================================================================
// R3 — Contraataque
// ============================================================================
describe("R3 — Contraataque", () => {
  it("cada AdaptationCompleted va seguido de exactamente un CounterReady (mismo cluster y debilidad)", () => {
    const s = sig(["fuego", "rapido"]);
    const { events } = run(defaultConfig, s, requiredExposures(s) + 1);

    const completed = events.filter((e) => e.type === "AdaptationCompleted");
    const counters = events.filter((e) => e.type === "CounterReady");
    expect(counters.length).toBe(completed.length);

    for (let i = 0; i < events.length; i++) {
      const e = events[i]!;
      if (e.type === "AdaptationCompleted") {
        const next = events[i + 1];
        expect(next?.type).toBe("CounterReady");
        expect((next as CounterReady).clusterId).toBe(e.clusterId);
        expect((next as CounterReady).weakness).toEqual(e.weakness);
      }
    }
  });
});

// ============================================================================
// R4 — Memoria según política
// ============================================================================
describe("R4 — Memoria según política", () => {
  it("permanente: la resistencia de un cluster nunca decrece al crecer el log", () => {
    const s = sig(["fuego"]);
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 12 }), (n) => {
        const { states } = run(defaultConfig, s, n);
        const cluster = clusterIdOf(states[0]!, s);
        return isNonDecreasing(states.map((st) => resistanceOf(st, cluster)));
      }),
    );
  });

  it("por-sesion: una sala nueva no hereda la resistencia adaptada de otra", () => {
    const s = sig(["fuego"]);
    const salaA = run(sesionConfig, s, requiredExposures(s) + 1).states.at(-1)!;
    const salaB = createInitialState(sesionConfig);

    expect(resistanceOf(salaA, clusterIdOf(salaA, s))).toBeGreaterThan(0);
    expect(resistanceOf(salaB, clusterIdOf(salaB, s))).toBe(0);
  });

  it("decaimiento: sin refuerzo decae la confianza, no la memoria del cluster", () => {
    const s = sig(["fuego"]);
    const adapted = run(decaimientoConfig, s, requiredExposures(s) + 1).states.at(-1)!;
    const cluster = clusterIdOf(adapted, s);

    // Pasa el tiempo sin reforzar `s` (se exponen firmas lejanas con timestamps posteriores).
    const alien = sig(["sonido"]);
    let later = adapted;
    for (let t = 100; t < 110; t++) later = process(later, alien, t).state;

    expect(resistanceOf(later, cluster)).toBe(resistanceOf(adapted, cluster)); // memoria intacta
    expect(confidenceOf(later, cluster)).toBeLessThan(confidenceOf(adapted, cluster)); // confianza decae
  });
});

// ============================================================================
// R5 — Curva decreciente, nunca interruptor
// ============================================================================
describe("R5 — Curva decreciente, nunca interruptor", () => {
  it("eff(k) > 0 para toda exposición previa a completar la adaptación", () => {
    const s = sig(["fuego"]);
    const n = requiredExposures(s);
    const { states } = run(defaultConfig, s, n);
    for (let k = 0; k < n; k++) {
      expect(effectiveness(states[k]!, s)).toBeGreaterThan(0);
    }
  });

  it("eff es estrictamente decreciente exposición a exposición", () => {
    const s = sig(["corte"]);
    const n = requiredExposures(s);
    const { states } = run(defaultConfig, s, n);
    const effs = states.slice(0, n).map((st) => effectiveness(st, s));
    expect(isStrictlyDecreasing(effs)).toBe(true);
  });

  it("R1+R5 (ADR 0001): la curva atenúa durante k<N(c) y la resistencia salta sólo en k=N(c)", () => {
    const s = sig(["presion", "rafaga"]);
    const n = requiredExposures(s);
    const { states, events } = run(defaultConfig, s, n + 1);
    const cluster = clusterIdOf(states[0]!, s);
    const base = resistanceOf(states[0]!, cluster);

    // "Durante": resistencia constante y efectividad positiva mientras no completa.
    for (let k = 0; k < n; k++) {
      expect(resistanceOf(states[k]!, cluster)).toBe(base);
      expect(effectiveness(states[k]!, s)).toBeGreaterThan(0);
    }
    // "Después": salto discreto exactamente al completar la N-ésima exposición.
    expect(resistanceOf(states[n]!, cluster)).toBeGreaterThan(resistanceOf(states[n - 1]!, cluster));
    expect(events.some((e) => e.type === "AdaptationCompleted" && e.clusterId === cluster)).toBe(true);
  });
});

// ============================================================================
// R6 — Generalización (adaptarse a lo desconocido)
// ============================================================================
describe("R6 — Generalización", () => {
  it("una firma idéntica a un cluster adaptado hereda su transferencia completa (R₀ > 0)", () => {
    const s = sig(["fuego", "rapido"]);
    const adapted = run(defaultConfig, s, requiredExposures(s) + 1).states.at(-1)!;
    const twin = sig(["fuego", "rapido"]); // misma firma canónica
    expect(generalizedInitialResistance(adapted, twin)).toBeGreaterThan(0);
  });

  it("una firma totalmente disímil no hereda resistencia (R₀ = 0)", () => {
    const s = sig(["fuego", "rapido"]);
    const adapted = run(defaultConfig, s, requiredExposures(s) + 1).states.at(-1)!;
    const alien = sig(["hielo"]);
    expect(generalizedInitialResistance(adapted, alien)).toBe(0);
  });
});
