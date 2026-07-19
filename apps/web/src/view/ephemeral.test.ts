// Tests de la capa efímera (ADR 0010 §§2-3).
//
// El test rector es el de la corrección de la revisión externa: **la dirección
// da forma al viaje, nunca al destino**. Un ataque que se viera fallar mientras
// el motor aplica el daño sería el render mintiendo sobre la mecánica, y es la
// clase de error que este proyecto no comete.

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { ELEMENTS } from "@beforeheadapts/arena-dsl";

import { EPHEMERAL } from "../arena/balance.js";
import {
  progressOf,
  pruneTracers,
  renderEphemeral,
  type EphemeralState,
  type Tracer,
} from "./ephemeral.js";
import type { GestureKind } from "../gesture/recognize.js";

const CENTER = { x: 320, y: 320 };
const CORE = 90;

function estado(tracers: readonly Tracer[], extra: Partial<EphemeralState> = {}): EphemeralState {
  return {
    tracers,
    cursor: undefined,
    erraticity: 0,
    agitated: false,
    center: CENTER,
    coreRadius: CORE,
    ...extra,
  };
}

function trazador(overrides: Partial<Tracer> = {}): Tracer {
  return {
    kind: "straight",
    origin: { x: 40, y: 40 },
    aim: { x: 1, y: 0 },
    element: "ember",
    eff: 0.8,
    bornAt: 0,
    ...overrides,
  };
}

/**
 * Todas las coordenadas del markup, como pares.
 *
 * Cubre los tres modos en que cada gesto dibuja: atributos sueltos (`line`,
 * `circle`) y la lista de `points` del `polyline` del zigzag. La primera
 * versión de este helper ignoraba `polyline` y hacía fallar el test rector con
 * cero puntos — el helper mentía, no el render.
 */
function puntosDe(markup: string): { x: number; y: number }[] {
  const pares: { x: number; y: number }[] = [];
  for (const m of markup.matchAll(/(?:x1|x2|cx)="(-?[\d.]+)"\s+(?:y1|y2|cy)="(-?[\d.]+)"/g)) {
    pares.push({ x: Number(m[1]), y: Number(m[2]) });
  }
  for (const lista of markup.matchAll(/points="([^"]+)"/g)) {
    for (const par of lista[1]!.trim().split(/\s+/)) {
      const [x, y] = par.split(",");
      pares.push({ x: Number(x), y: Number(y) });
    }
  }
  return pares;
}

const distanciaAlCentro = (p: { x: number; y: number }): number =>
  Math.hypot(p.x - CENTER.x, p.y - CENTER.y);

describe("la dirección da forma al viaje, nunca al destino", () => {
  const KINDS: readonly GestureKind[] = ["straight", "hold", "circle", "zigzag"];

  /**
   * LA propiedad del ADR 0010 §3. Sea cual sea la puntería —incluso apuntando
   * exactamente en dirección opuesta al ente— el ataque tiene que terminar
   * resolviendo sobre el ente. El motor ya aplicó el daño; el render no puede
   * contar otra historia.
   */
  it("todo ataque resuelve sobre el ente, apunte donde apunte", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: Math.PI * 2, noNaN: true }),
        fc.constantFrom(...KINDS),
        (angulo, kind) => {
          const tracer = trazador({
            kind,
            aim: { x: Math.cos(angulo), y: Math.sin(angulo) },
          });
          // Al final del viaje, el frente del ataque está sobre el ente.
          const markup = renderEphemeral(estado([tracer]), EPHEMERAL.tracerMs * 0.99);
          const puntos = puntosDe(markup);
          expect(puntos.length).toBeGreaterThan(0);
          const masCercano = Math.min(...puntos.map(distanciaAlCentro));
          // "Sobre el ente" = dentro del radio, con margen para el grosor.
          expect(masCercano).toBeLessThanOrEqual(CORE + 2);
        },
      ),
    );
  });

  it("la puntería SÍ cambia por dónde pasa el ataque", () => {
    // La contracara: si la dirección no cambiara nada, la regla se cumpliría
    // trivialmente dibujando siempre una recta, y la puntería sería decorativa
    // hasta para el render.
    const alCentro = trazador({ aim: { x: 1, y: 1 } });
    const alCostado = trazador({ aim: { x: -1, y: -1 } });
    const medio = EPHEMERAL.tracerMs * 0.5;
    expect(renderEphemeral(estado([alCentro]), medio)).not.toBe(
      renderEphemeral(estado([alCostado]), medio),
    );
  });

  it("el ataque nace donde terminó el trazo", () => {
    const origin = { x: 123, y: 456 };
    const markup = renderEphemeral(estado([trazador({ origin })]), 1);
    const puntos = puntosDe(markup);
    const cercaDelOrigen = puntos.some(
      (p) => Math.hypot(p.x - origin.x, p.y - origin.y) < 30,
    );
    expect(cercaDelOrigen).toBe(true);
  });
});

describe("penetración por eff (R5)", () => {
  /**
   * El feedback que el §4 del diseño pide desde la Fase 3a: el mismo ataque
   * repetido tiene que verse llegar cada vez más superficial. Es la curva
   * `eff(k)` hecha imagen, sin un solo número en pantalla.
   */
  it("a `eff` alto penetra más que a `eff` bajo", () => {
    const final = EPHEMERAL.tracerMs * 0.99;
    const profundo = puntosDe(renderEphemeral(estado([trazador({ eff: 1 })]), final));
    const superficial = puntosDe(renderEphemeral(estado([trazador({ eff: 0.01 })]), final));
    expect(Math.min(...profundo.map(distanciaAlCentro))).toBeLessThan(
      Math.min(...superficial.map(distanciaAlCentro)),
    );
  });

  it("es monótona: más `eff`, más profundo, siempre", () => {
    const final = EPHEMERAL.tracerMs * 0.99;
    let anterior = Infinity;
    for (const eff of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
      const d = Math.min(
        ...puntosDe(renderEphemeral(estado([trazador({ eff })]), final)).map(distanciaAlCentro),
      );
      expect(d).toBeLessThanOrEqual(anterior + 0.001);
      anterior = d;
    }
  });
});

describe("ciclo de vida de los trazadores", () => {
  it("`progressOf` va de 0 a 1 a lo largo de `tracerMs`", () => {
    const t = trazador({ bornAt: 1000 });
    expect(progressOf(t, 1000)).toBe(0);
    expect(progressOf(t, 1000 + EPHEMERAL.tracerMs)).toBe(1);
  });

  it("los vencidos se descartan", () => {
    const vivos = pruneTracers([trazador({ bornAt: 0 })], EPHEMERAL.tracerMs + 1);
    expect(vivos).toHaveLength(0);
  });

  it("hay un tope duro de trazadores simultáneos", () => {
    // El cooldown ya los limita, pero un tope que se apoya en otra mecánica no
    // es un tope.
    const muchos = Array.from({ length: 100 }, () => trazador({ bornAt: 0 }));
    expect(pruneTracers(muchos, 1).length).toBeLessThanOrEqual(EPHEMERAL.maxTracers);
  });

  it("un trazador vencido no se dibuja", () => {
    const markup = renderEphemeral(estado([trazador({ bornAt: 0 })]), EPHEMERAL.tracerMs + 100);
    expect(markup).not.toContain("<line");
    expect(markup).not.toContain("<polyline");
  });
});

describe("halo de agitación y retículo", () => {
  it("sin agitación no dibuja halo", () => {
    expect(renderEphemeral(estado([]), 0)).toBe("");
  });

  it("el halo crece con la erraticidad", () => {
    const radioDe = (markup: string): number =>
      Number(/r="([\d.]+)"/.exec(markup)?.[1] ?? 0);
    const bajo = radioDe(renderEphemeral(estado([], { erraticity: 0.3 }), 0));
    const alto = radioDe(renderEphemeral(estado([], { erraticity: 0.9 }), 0));
    expect(alto).toBeGreaterThan(bajo);
  });

  it("el retículo sigue al cursor", () => {
    const markup = renderEphemeral(estado([], { cursor: { x: 200, y: 150 } }), 0);
    expect(markup).toContain('cx="200"');
    expect(markup).toContain('cy="150"');
  });
});

describe("propiedades del render efímero", () => {
  it("es puro: mismo estado y mismo instante dan el mismo markup", () => {
    const s = estado([trazador({ kind: "zigzag" })], { erraticity: 0.4, cursor: { x: 10, y: 10 } });
    expect(renderEphemeral(s, 200)).toBe(renderEphemeral(s, 200));
  });

  it("los 8 elementos producen markup válido y de colores distintos", () => {
    const colores = new Set(
      ELEMENTS.map((element) => {
        const markup = renderEphemeral(estado([trazador({ element })]), 100);
        return /stroke="(#[0-9a-f]{6})"/.exec(markup)?.[1];
      }),
    );
    expect(colores.size).toBe(ELEMENTS.length);
  });

  it("nunca emite coordenadas no finitas", () => {
    // Un NaN en un atributo rompe el SVG entero en silencio: el navegador
    // descarta el elemento y no avisa.
    fc.assert(
      fc.property(
        fc.double({ min: -1, max: 1, noNaN: true }),
        fc.double({ min: -1, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (ax, ay, p) => {
          const markup = renderEphemeral(
            estado([trazador({ aim: { x: ax, y: ay }, origin: CENTER })]),
            EPHEMERAL.tracerMs * p,
          );
          expect(markup).not.toMatch(/NaN|Infinity/);
        },
      ),
    );
  });
});
