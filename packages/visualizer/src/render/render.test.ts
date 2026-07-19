// Especificación de `renderFrames`.
//
// Lo que se verifica acá no es "que dibuje lindo" —eso lo juzga el ojo— sino
// que **el dibujo no mienta sobre el motor**. Cada regla del contrato tiene una
// manifestación visual comprometida en el ADR 0007, y cada una es aseverable
// leyendo el SVG: la curva de R5 es la opacidad del vector entrante, el salto de
// R1 es la onda y el vértice nuevo, R4 es la distancia del nodo al centro.
//
// El otro eje es el determinismo: mismo log, mismo string byte a byte. Es lo
// que hace que el gif exportado y lo que se ve en pantalla no puedan divergir.

import { describe, expect, it } from "vitest";
import {
  canonicalize,
  createInitialState,
  process,
  requiredExposures,
  type StimulusSignature,
} from "@beforeheadapts/core";
import { framesFrom, type Frame } from "../frames/index.js";
import { renderFrame, renderFrames } from "./index.js";
import { defaultTheme } from "./theme.js";

const fuego = canonicalize(["fuego"], 1);
const compuesta = canonicalize(["fuego", "hielo", "rayo"], 1);

/** Frames de una sala donde se procesan las firmas dadas, en orden. */
function framesOf(...steps: readonly StimulusSignature[]): readonly Frame[] {
  let state = createInitialState({}, "sala-render");
  steps.forEach((signature, i) => {
    state = process(state, signature, 1_000 + i * 100).state;
  });
  return framesFrom(state.log);
}

function repeat(signature: StimulusSignature, times: number): readonly StimulusSignature[] {
  return Array.from({ length: times }, () => signature);
}

/**
 * Elementos que llevan una clase dada.
 *
 * Compara contra la lista de clases separada por espacios, no por substring:
 * `node` no puede colar un match sobre `node node-adapted`.
 */
function elementsOf(svg: string, className: string): readonly string[] {
  return (svg.match(/<[a-z]+[^>]*?\/?>/g) ?? []).filter((element) => {
    const classes = /class="([^"]*)"/.exec(element)?.[1];
    return classes !== undefined && classes.split(" ").includes(className);
  });
}

/** Valor de un atributo del primer elemento con esa clase. */
function attrOf(svg: string, className: string, attr: string): string | undefined {
  const element = elementsOf(svg, className)[0];
  return element === undefined
    ? undefined
    : new RegExp(`${attr}="([^"]*)"`).exec(element)?.[1];
}

function countOf(svg: string, className: string): number {
  return elementsOf(svg, className).length;
}

describe("renderFrames — forma general", () => {
  it("da un SVG por frame", () => {
    const frames = framesOf(...repeat(compuesta, 2));
    expect(renderFrames(frames)).toHaveLength(frames.length);
  });

  it("da vacío sin frames", () => {
    expect(renderFrames([])).toEqual([]);
  });

  it("emite SVG bien formado, con raíz y namespace", () => {
    for (const out of renderFrames(framesOf(compuesta))) {
      expect(out.startsWith("<svg ")).toBe(true);
      expect(out.endsWith("</svg>")).toBe(true);
      expect(out).toContain('xmlns="http://www.w3.org/2000/svg"');
      // Etiquetas abiertas y cerradas balanceadas a nivel de conteo.
      expect(out.match(/</g)!.length).toBe(out.match(/>/g)!.length);
    }
  });

  it("etiqueta cada frame con su seq", () => {
    const frames = framesOf(...repeat(compuesta, 2));
    renderFrames(frames).forEach((out, i) => {
      expect(out).toContain(`data-seq="${frames[i]!.seq}"`);
    });
  });

  it("renderFrame coincide con el elemento correspondiente de renderFrames", () => {
    const frames = framesOf(...repeat(compuesta, 3));
    const todos = renderFrames(frames);
    frames.forEach((_, i) => {
      expect(renderFrame(frames, i)).toBe(todos[i]!);
    });
  });

  it("rechaza un índice fuera de rango", () => {
    const frames = framesOf(fuego);
    expect(() => renderFrame(frames, -1)).toThrow();
    expect(() => renderFrame(frames, frames.length)).toThrow();
    expect(() => renderFrame(frames, 1.5)).toThrow();
  });
});

describe("renderFrames — determinismo", () => {
  // Sin esto no hay replay: dos reproducciones del mismo log tienen que dar
  // el mismo dibujo, incluida la vibración.
  it("da el mismo string byte a byte para el mismo log", () => {
    const frames = framesOf(...repeat(compuesta, 4));
    expect(renderFrames(frames)).toEqual(renderFrames(frames));
  });

  // Dos logs construidos por separado con los mismos estímulos y los mismos
  // timestamps tienen que renderizar igual: nada del entorno se cuela.
  it("no depende de nada fuera del log", () => {
    expect(renderFrames(framesOf(...repeat(compuesta, 3)))).toEqual(
      renderFrames(framesOf(...repeat(compuesta, 3))),
    );
  });
});

describe("R5 — la curva se ve como un ataque que se apaga", () => {
  it("dibuja el vector entrante solo en los frames de ResistanceApplied", () => {
    const frames = framesOf(...repeat(compuesta, 2));
    renderFrames(frames).forEach((out, i) => {
      const esperado = frames[i]!.event.type === "ResistanceApplied";
      expect(countOf(out, "incoming") > 0).toBe(esperado);
    });
  });

  // El corazón de R5: sin un solo número en pantalla, el ataque llega más
  // pálido y más flaco en cada exposición.
  it("apaga el vector monótonamente en exposiciones sucesivas", () => {
    const frames = framesOf(...repeat(compuesta, requiredExposures(compuesta)));
    const opacidades = renderFrames(frames)
      .map((out) => attrOf(out, "incoming", "stroke-opacity"))
      .filter((v): v is string => v !== undefined)
      .map(Number);

    expect(opacidades.length).toBeGreaterThan(1);
    for (let i = 1; i < opacidades.length; i += 1) {
      expect(opacidades[i]!).toBeLessThan(opacidades[i - 1]!);
    }
  });

  it("adelgaza el vector junto con la opacidad", () => {
    const frames = framesOf(...repeat(compuesta, 3));
    const anchos = renderFrames(frames)
      .map((out) => attrOf(out, "incoming", "stroke-width"))
      .filter((v): v is string => v !== undefined)
      .map(Number);

    for (let i = 1; i < anchos.length; i += 1) {
      expect(anchos[i]!).toBeLessThanOrEqual(anchos[i - 1]!);
    }
  });

  // El ataque tiene rumbo fijo por firma: se deriva del clusterId, no del nodo,
  // porque en el primer golpe el cluster todavía no existe en el layout.
  it("hace llegar la misma firma siempre desde la misma dirección", () => {
    const frames = framesOf(...repeat(compuesta, 3));
    const origenes = renderFrames(frames)
      .map((out) => attrOf(out, "incoming", "x1"))
      .filter((v): v is string => v !== undefined);

    expect(origenes.length).toBeGreaterThan(1);
    expect(new Set(origenes).size).toBe(1);
  });
});

// La enmienda P3 del ADR 0010. El bug que corrige era visible jugando: un
// ataque por gesto se dibujaba DOS VECES en vivo —el trazador efímero volando
// hacia el ente y, encima, el vector canónico apareciendo de golpe con otra
// dirección—. La regla es "cada capa es dueña de un tramo": la efímera del
// viaje, la canónica del impacto.
describe("dueños de tramo — ephemeralOwnedSeqs", () => {
  /** Los `seq` de los frames donde el motor atenuó algo. */
  function seqsDeResistencia(frames: readonly Frame[]): readonly number[] {
    return frames.filter((f) => f.event.type === "ResistanceApplied").map((f) => f.seq);
  }

  it("suprime el viaje de los seq que la capa efímera materializa", () => {
    const frames = framesOf(...repeat(compuesta, 2));
    const owned = new Set(seqsDeResistencia(frames));
    expect(owned.size).toBeGreaterThan(0);

    for (const out of renderFrames(frames, { ephemeralOwnedSeqs: owned })) {
      expect(countOf(out, "incoming")).toBe(0);
    }
  });

  // La otra mitad de la regla, y la que impide que la supresión se coma el
  // evento entero: el destino siempre se dibuja.
  it("dibuja el impacto igual en los seq cedidos", () => {
    const frames = framesOf(...repeat(compuesta, 2));
    const owned = new Set(seqsDeResistencia(frames));

    const conImpacto = renderFrames(frames, { ephemeralOwnedSeqs: owned }).filter(
      (out) => countOf(out, "impact") > 0,
    );
    expect(conImpacto.length).toBe(owned.size);
  });

  it("no toca los seq que la capa efímera no reclamó", () => {
    const frames = framesOf(...repeat(compuesta, 2));
    const seqs = seqsDeResistencia(frames);
    // Se cede solo el primero: el segundo tiene que seguir dibujando el viaje.
    const owned = new Set([seqs[0]!]);

    const conViaje = renderFrames(frames, { ephemeralOwnedSeqs: owned }).filter(
      (out) => countOf(out, "incoming") > 0,
    );
    expect(conViaje.length).toBe(seqs.length - 1);
  });

  // El punto no negociable: la capa efímera NO se graba, así que si el replay
  // también se callara el viaje, ese tramo no lo dibujaría nadie nunca.
  it("el replay sin opciones dibuja el viaje completo, como siempre", () => {
    const frames = framesOf(...repeat(compuesta, 2));
    const seqs = seqsDeResistencia(frames);

    const conViaje = renderFrames(frames).filter((out) => countOf(out, "incoming") > 0);
    expect(conViaje.length).toBe(seqs.length);
  });

  // La divergencia entre vivo y replay vive DECLARADA en las opciones: con las
  // mismas opciones, el string sigue siendo el mismo byte a byte.
  it("sigue siendo puro: mismas opciones, mismo SVG", () => {
    const frames = framesOf(...repeat(compuesta, 2));
    const owned = new Set(seqsDeResistencia(frames));
    expect(renderFrames(frames, { ephemeralOwnedSeqs: owned })).toEqual(
      renderFrames(frames, { ephemeralOwnedSeqs: new Set(owned) }),
    );
  });

  it("hunde el impacto en proporción a eff", () => {
    const frames = framesOf(...repeat(compuesta, requiredExposures(compuesta)));
    // `x2` es la punta de la cuña. Con eff cayendo, la punta se va quedando
    // cada vez más cerca de la superficie: la resistencia se ve como profundidad.
    const puntas = renderFrames(frames)
      .map((out) => attrOf(out, "impact", "x2"))
      .filter((v): v is string => v !== undefined)
      .map(Number);

    expect(puntas.length).toBeGreaterThan(1);
    expect(new Set(puntas).size).toBeGreaterThan(1);
  });
});

describe("R1 — el salto se ve como un snap", () => {
  const n = requiredExposures(compuesta);

  it("dispara la onda expansiva en el frame de AdaptationCompleted", () => {
    const frames = framesOf(...repeat(compuesta, n));
    const snap = frames.findIndex((f) => f.event.type === "AdaptationCompleted");
    expect(snap).toBeGreaterThan(0);

    const svgs = renderFrames(frames);
    expect(countOf(svgs[snap]!, "shockwave")).toBe(1);
    // El frame anterior todavía no la tiene: la onda es consecuencia del salto.
    expect(countOf(svgs[snap - 1]!, "shockwave")).toBe(0);
  });

  it("expande la onda y la apaga en los frames siguientes", () => {
    const frames = framesOf(...repeat(compuesta, n + 2));
    const snap = frames.findIndex((f) => f.event.type === "AdaptationCompleted");
    const svgs = renderFrames(frames);

    const posteriores = svgs
      .slice(snap, snap + defaultTheme.shockwaveSpan)
      .map((out) => ({
        r: Number(attrOf(out, "shockwave", "r")),
        opacity: Number(attrOf(out, "shockwave", "stroke-opacity")),
      }));

    expect(posteriores.length).toBeGreaterThan(1);
    for (let i = 1; i < posteriores.length; i += 1) {
      expect(posteriores[i]!.r).toBeGreaterThan(posteriores[i - 1]!.r);
      expect(posteriores[i]!.opacity).toBeLessThan(posteriores[i - 1]!.opacity);
    }
  });

  // Asimilación estructural: la silueta del ente cambia y no vuelve atrás.
  it("suma un vértice al ente al asimilar", () => {
    const frames = framesOf(...repeat(compuesta, n));
    const svgs = renderFrames(frames);
    const verticesDe = (out: string) =>
      attrOf(out, "core", "points")!.split(" ").length;

    expect(verticesDe(svgs[0]!)).toBe(defaultTheme.baseVertices);
    expect(verticesDe(svgs.at(-1)!)).toBe(defaultTheme.baseVertices + 1);
  });

  it("marca el nodo asimilado con la clase de advertencia", () => {
    const frames = framesOf(...repeat(compuesta, n));
    const svgs = renderFrames(frames);
    expect(countOf(svgs[0]!, "node-adapted")).toBe(0);
    expect(countOf(svgs.at(-1)!, "node-adapted")).toBe(1);
  });
});

describe("R6 — la red de similitud", () => {
  it("dibuja un hilo entre firmas parecidas y ninguno entre ajenas", () => {
    const parecida = canonicalize(["fuego", "hielo"], 1);
    const ajena = canonicalize(["viento"], 1);

    const conHilo = renderFrames(framesOf(fuego, parecida)).at(-1)!;
    const sinHilo = renderFrames(framesOf(fuego, ajena)).at(-1)!;

    expect(countOf(conHilo, "thread")).toBe(1);
    expect(countOf(sinHilo, "thread")).toBe(0);
  });
});

describe("el ente golpeado", () => {
  it("se contrae al recibir una exposición y recupera después", () => {
    const frames = framesOf(...repeat(compuesta, 3));
    const svgs = renderFrames(frames);

    // El radio se lee de la distancia del primer vértice al centro. En el
    // frame del impacto el ente está encogido respecto de su reposo.
    const radioDe = (out: string) => {
      const [x, y] = attrOf(out, "core", "points")!.split(" ")[0]!.split(",").map(Number);
      return Math.hypot(x! - defaultTheme.size / 2, y! - defaultTheme.size / 2);
    };

    const golpe = frames.findIndex((f) => f.event.type === "ExposureRecorded");
    expect(radioDe(svgs[golpe]!)).toBeLessThan(defaultTheme.coreRadius);
  });
});

describe("inyección — clusterId hostil", () => {
  // Los clusterId derivan de firmas que en la arena vienen de usuarios y
  // terminan como atributos en un SVG montado en el DOM.
  it("escapa un clusterId con markup dentro", () => {
    const hostil = canonicalize(['"><script>alert(1)</script>'], 1);
    const svgs = renderFrames(framesOf(hostil));

    // Ningún frame puede dejar pasar la etiqueta cruda.
    for (const out of svgs) {
      expect(out).not.toContain("<script>");
    }

    // El primer frame es `ResistanceApplied`, que se emite *antes* de que el
    // cluster exista, así que todavía no hay nodo donde aparezca el id. Es en
    // el último donde el id hostil llega efectivamente al atributo.
    const conNodo = svgs.at(-1)!;
    expect(conNodo).toContain("&lt;script&gt;");
    expect(attrOf(conNodo, "node-adapted", "data-cluster")).toContain("&lt;script&gt;");
  });
});

/**
 * Cristalización (§4 del diseño del adaptador web): el aviso de que `k` se
 * acerca a `N(c)`. Es feedback obligatorio de R5 — sin esto el jugador se
 * entera del salto cuando ya ocurrió.
 */
describe("cristalización", () => {
  /** Log con una firma de 3 primitivas golpeada `hits` veces. */
  const conGolpes = (hits: number) => {
    const signature = canonicalize(["a", "b", "c"], 1);
    let state = createInitialState();
    for (let i = 0; i < hits; i++) {
      state = process(state, signature, i * 1000).state;
    }
    return framesFrom(state.log);
  };

  const crystalOpacity = (svg: string): number | null => {
    const match = /class="crystal"[^>]*stroke-opacity="([\d.]+)"/.exec(svg);
    return match === null ? null : Number(match[1]);
  };

  it("no dibuja cristal antes de la primera exposición", () => {
    const frames = conGolpes(1);
    // El primer frame es `ResistanceApplied`: el cluster todavía no existe.
    expect(crystalOpacity(renderFrame(frames, 0))).toBeNull();
  });

  it("se endurece a medida que k se acerca a N(c)", () => {
    const unGolpe = renderFrames(conGolpes(1)).at(-1)!;
    const dosGolpes = renderFrames(conGolpes(2)).at(-1)!;

    const a = crystalOpacity(unGolpe);
    const b = crystalOpacity(dosGolpes);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(b!).toBeGreaterThan(a!);
  });

  it("desaparece al completarse la adaptación", () => {
    // Tres golpes sobre una firma de tres primitivas: el salto ya ocurrió.
    const adaptado = renderFrames(conGolpes(3)).at(-1)!;
    expect(adaptado).toContain("node-adapted");
    expect(crystalOpacity(adaptado)).toBeNull();
  });

  it("el cristal se cierra del todo en el frame anterior al salto", () => {
    // `ExposureRecorded` ya dejó `progress = 1`, pero `AdaptationCompleted`
    // todavía no se aplicó: hay exactamente un frame donde el cluster está
    // cristalizado al máximo y aún no adaptó. Es el instante previo al salto, y
    // se ve como tal — el cristal termina de cerrarse y se rompe.
    const frames = conGolpes(3);
    const svgs = renderFrames(frames);

    const indiceSalto = frames.findIndex((f) => f.event.type === "AdaptationCompleted");
    expect(indiceSalto).toBeGreaterThan(0);

    expect(crystalOpacity(svgs[indiceSalto - 1]!)).toBeCloseTo(defaultTheme.crystalOpacity, 10);
    expect(crystalOpacity(svgs[indiceSalto]!)).toBeNull();
  });

  it("una firma mínima solo cristaliza en ese frame previo, nunca antes", () => {
    // N(c) = 1: no hay ventana que anunciar, así que el aviso no existe hasta
    // el instante mismo del salto.
    let state = createInitialState();
    state = process(state, canonicalize(["solo"], 1), 0).state;
    const frames = framesFrom(state.log);
    const svgs = renderFrames(frames);
    const indiceSalto = frames.findIndex((f) => f.event.type === "AdaptationCompleted");

    for (let i = 0; i < indiceSalto - 1; i++) {
      expect(crystalOpacity(svgs[i]!)).toBeNull();
    }
    expect(crystalOpacity(svgs.at(-1)!)).toBeNull();
  });

  it("sigue siendo determinista byte a byte", () => {
    const frames = conGolpes(2);
    expect(renderFrames(frames)).toEqual(renderFrames(frames));
  });
});
