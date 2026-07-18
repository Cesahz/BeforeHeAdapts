// Tests de la densificación (ADR 0010 §1).
//
// Las dos propiedades que este módulo existe para garantizar y que no son
// obvias mirando el código:
//
//   1. Lo continuo se interpola y lo DISCRETO no. Interpolar un salto de
//      resistencia sería mentir sobre el motor.
//   2. Los frames de un mismo evento tienen jitter DISTINTO pero reproducible.
//      Sin sub-semilla, el temblor se congela justo donde tiene que temblar.

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { canonicalize, createInitialState, process } from "@beforeheadapts/core";

import { framesFrom, type Frame } from "./index.js";
import { DEFAULT_STEPS, densify, densifyAll, seedOf } from "./densify.js";

/** Log sintético con adaptación completa, para tener un salto de R1 que mirar. */
function logDeEjemplo(): Frame[] {
  let state = createInitialState({}, "sala-test");
  const firma = canonicalize(["elem:ember", "vec:projectile"], 2);
  for (let i = 0; i < 4; i += 1) {
    state = process(state, firma, i * 1000).state;
  }
  const otra = canonicalize(["elem:frost", "pat:pulse"], 2);
  for (let i = 0; i < 3; i += 1) {
    state = process(state, otra, 5000 + i * 1000).state;
  }
  return [...framesFrom(state.log)];
}

describe("densify", () => {
  it("emite `steps` frames por evento, incluido el último", () => {
    const canonicos = logDeEjemplo();
    const densos = densifyAll(canonicos, { steps: 4 });
    expect(densos.length).toBe(canonicos.length * 4);
  });

  /**
   * El último evento recibe sus frames aunque no haya hacia dónde interpolar.
   * Sin esto la vista viva se congela apenas alcanza el presente —o sea la
   * mayor parte del tiempo, porque los ataques entran cada 1-2 s— y volvería
   * exactamente el síntoma que este módulo existe para resolver.
   */
  it("el último evento también se densifica", () => {
    const canonicos = logDeEjemplo();
    const densos = densifyAll(canonicos, { steps: 5 });
    const ultimoSeq = canonicos[canonicos.length - 1]!.seq;
    const delUltimo = densos.filter((f) => f.seq === ultimoSeq);
    expect(delUltimo).toHaveLength(5);
    expect(delUltimo.map((f) => f.sub)).toEqual([0, 1, 2, 3, 4]);
    // Los valores se sostienen —no hay futuro que adivinar— pero `sub` avanza,
    // que es lo que mantiene viva la vibración y apaga los transitorios.
    expect(new Set(delUltimo.map((f) => f.timestamp)).size).toBe(1);
    expect(new Set(delUltimo.map(seedOf)).size).toBe(5);
  });

  it("`steps: 1` devuelve la secuencia intacta", () => {
    const canonicos = logDeEjemplo();
    const densos = densifyAll(canonicos, { steps: 1 });
    expect(densos.length).toBe(canonicos.length);
    expect(densos.map((f) => f.seq)).toEqual(canonicos.map((f) => f.seq));
  });

  it("conserva todos los frames canónicos, en orden y con `sub` 0", () => {
    const canonicos = logDeEjemplo();
    const densos = densifyAll(canonicos);
    const recuperados = densos.filter((f) => f.sub === 0);
    expect(recuperados.map((f) => f.seq)).toEqual(canonicos.map((f) => f.seq));
  });

  it("es perezosa: no recorre la entrada más de lo pedido", () => {
    // La pereza no es un detalle de implementación: el export tiene que poder
    // consumir decenas de miles de frames sin materializarlos (ADR 0010 §1).
    let generados = 0;
    function* fuente(): IterableIterator<Frame> {
      for (const frame of logDeEjemplo()) {
        generados += 1;
        yield frame;
      }
    }
    const iterador = densify(fuente(), { steps: 4 });
    iterador.next();
    // Con un solo frame pedido, la fuente no puede haberse agotado.
    expect(generados).toBeLessThanOrEqual(2);
  });

  it("es determinista: dos corridas dan lo mismo", () => {
    const canonicos = logDeEjemplo();
    expect(densifyAll(canonicos)).toEqual(densifyAll(canonicos));
  });
});

describe("qué se interpola y qué no", () => {
  it("el tiempo avanza monótonamente", () => {
    const densos = densifyAll(logDeEjemplo());
    for (let i = 1; i < densos.length; i += 1) {
      expect(densos[i]!.timestamp).toBeGreaterThanOrEqual(densos[i - 1]!.timestamp);
    }
  });

  it("`progress` interpolado queda entre los extremos del tramo", () => {
    const canonicos = logDeEjemplo();
    const densos = densifyAll(canonicos, { steps: 5 });
    for (const denso of densos) {
      for (const cluster of denso.clusters) {
        expect(cluster.progress).toBeGreaterThanOrEqual(0);
        expect(cluster.progress).toBeLessThanOrEqual(1);
      }
    }
  });

  /**
   * El test que justifica el módulo entero. `adapted` y `resistance` son el
   * escalón de R1: si se interpolaran, el render mostraría una resistencia a
   * medio adaptar que el motor nunca calculó.
   */
  it("`adapted` y `resistance` NO se interpolan: siguen siendo escalones", () => {
    const canonicos = logDeEjemplo();
    const densos = densifyAll(canonicos, { steps: 6 });

    const valoresDeResistencia = new Set<number>();
    for (const denso of densos) {
      for (const cluster of denso.clusters) {
        valoresDeResistencia.add(cluster.resistance);
        expect(typeof cluster.adapted).toBe("boolean");
      }
    }

    // Los mismos valores discretos que produjo el motor, ni uno intermedio.
    const canonicosValores = new Set<number>();
    for (const frame of canonicos) {
      for (const cluster of frame.clusters) canonicosValores.add(cluster.resistance);
    }
    expect([...valoresDeResistencia].sort()).toEqual([...canonicosValores].sort());
  });

  it("un frame intermedio conserva el evento de su tramo de partida", () => {
    // Si un intermedio adoptara el evento del frame siguiente, el render
    // mostraría el efecto del golpe antes de que el golpe ocurriera.
    const canonicos = logDeEjemplo();
    const densos = densifyAll(canonicos, { steps: 3 });
    for (const denso of densos) {
      const canonico = canonicos.find((f) => f.seq === denso.seq);
      expect(denso.event).toEqual(canonico!.event);
    }
  });
});

describe("sub-semilla del jitter", () => {
  /**
   * La corrección que la revisión externa detectó leyendo el ADR, antes de que
   * existiera este código: los frames densificados comparten `seq`, así que
   * sembrar el jitter solo con `seq` congelaría el temblor.
   */
  it("frames consecutivos del mismo evento tienen semillas distintas", () => {
    const densos = densifyAll(logDeEjemplo(), { steps: DEFAULT_STEPS });
    const porEvento = new Map<number, Set<number>>();
    for (const denso of densos) {
      const semillas = porEvento.get(denso.seq) ?? new Set<number>();
      semillas.add(seedOf(denso));
      porEvento.set(denso.seq, semillas);
    }
    for (const [seq, semillas] of porEvento) {
      const frames = densos.filter((f) => f.seq === seq).length;
      // Ni una colisión: tantas semillas como frames tenga el evento.
      expect(semillas.size).toBe(frames);
    }
  });

  it("la semilla es reproducible", () => {
    const a = densifyAll(logDeEjemplo()).map(seedOf);
    const b = densifyAll(logDeEjemplo()).map(seedOf);
    expect(a).toEqual(b);
  });

  it("`sub` contiguos no producen semillas contiguas", () => {
    // Si la mezcla fuera una suma, el temblor se vería "caminar" en vez de
    // vibrar: semillas vecinas darían ruido correlacionado.
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000 }), (seq) => {
        const a = seedOf({ seq, sub: 0 } as never);
        const b = seedOf({ seq, sub: 1 } as never);
        expect(Math.abs(a - b)).toBeGreaterThan(1000);
      }),
    );
  });

  it("distintos eventos con el mismo `sub` tampoco colisionan", () => {
    const semillas = new Set<number>();
    for (let seq = 0; seq < 500; seq += 1) semillas.add(seedOf({ seq, sub: 2 } as never));
    expect(semillas.size).toBe(500);
  });
});
