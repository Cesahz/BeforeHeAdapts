import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { clusterKeyOf } from "@beforeheadapts/core";
import {
  ELEMENTS,
  MODIFIERS,
  PATTERNS,
  VECTORS,
  toSignature,
  type Composition,
} from "@beforeheadapts/arena-dsl";

import {
  BUILD_VERSION,
  isBuildShape,
  makeBuild,
  withVisual,
  type Build,
  type VisualExpression,
} from "./build.js";
import { BuildCodeError, decodeBuild, encodeBuild } from "./code.js";
import {
  COLLECTION_VERSION,
  STORAGE_KEY,
  loadBuilds,
  removeBuild,
  saveBuilds,
  upsertBuild,
  type KeyValueStore,
} from "./storage.js";

const arbComposition: fc.Arbitrary<Composition> = fc
  .record({
    element: fc.constantFrom(...ELEMENTS),
    vector: fc.option(fc.constantFrom(...VECTORS), { nil: undefined }),
    pattern: fc.option(fc.constantFrom(...PATTERNS), { nil: undefined }),
    modifiers: fc.uniqueArray(fc.constantFrom(...MODIFIERS)),
  })
  .map((raw) => ({
    element: raw.element,
    modifiers: raw.modifiers,
    ...(raw.vector === undefined ? {} : { vector: raw.vector }),
    ...(raw.pattern === undefined ? {} : { pattern: raw.pattern }),
  }));

const arbVisual: fc.Arbitrary<VisualExpression> = fc.record({
  hue: fc.integer({ min: 0, max: 359 }),
  trail: fc.float({ min: 0, max: 1, noNaN: true }),
  spin: fc.float({ min: -1, max: 1, noNaN: true }),
});

/** `localStorage` de mentira: la persistencia se testea entera sin DOM. */
function memoryStore(inicial: Record<string, string> = {}): KeyValueStore & { data: Record<string, string> } {
  const data = { ...inicial };
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

/**
 * LA REGLA DURA DEL §2: la expresión visual no crea firmas.
 *
 * Es el test que impide que las dos capas del Builder se fundan. Si algún día
 * un campo visual empezara a influir en la firma, el espacio de firmas dejaría
 * de ser analizable y el balance con él.
 */
describe("separación de capas (diseño §2)", () => {
  it("variaciones visuales de la misma composición dan la misma firma canónica", () => {
    fc.assert(
      fc.property(arbComposition, arbVisual, arbVisual, fc.string(), fc.string(), (composition, v1, v2, n1, n2) => {
        const a: Build = { v: BUILD_VERSION, id: "a", name: n1, composition, visual: v1 };
        const b: Build = { v: BUILD_VERSION, id: "b", name: n2, composition, visual: v2 };

        expect(toSignature(b.composition)).toEqual(toSignature(a.composition));
        expect(clusterKeyOf(toSignature(b.composition))).toBe(
          clusterKeyOf(toSignature(a.composition)),
        );
      }),
    );
  });

  it("cambiar la composición SÍ cambia la firma", () => {
    const base = makeBuild("x", "base", { element: "ember" });
    const otra = makeBuild("x", "base", { element: "frost" });
    expect(clusterKeyOf(toSignature(otra.composition))).not.toBe(
      clusterKeyOf(toSignature(base.composition)),
    );
  });
});

describe("código de export/import", () => {
  it("roundtrip: decode(encode(build)) === build", () => {
    fc.assert(
      fc.property(arbComposition, arbVisual, fc.string(), (composition, visual, name) => {
        // La build entra por el constructor, que normaliza el borde — igual que
        // toda build que el sistema produce de verdad. Sobre ESAS el roundtrip
        // es una identidad exacta.
        const build = withVisual(
          { ...makeBuild("id-1", name, composition) },
          visual,
        );
        expect(decodeBuild(encodeBuild(build))).toEqual(build);
      }),
    );
  });

  /**
   * Regresión de un caso que encontró el property test, no una revisión a ojo.
   *
   * `JSON.stringify(-0)` produce `"0"`, así que un `spin: -0` volvía del import
   * como `+0` y `decode(encode(b))` dejaba de ser una identidad. Se colapsa en
   * el borde: un giro negativo cero no significa nada distinto de un giro cero.
   */
  it("normaliza -0, que JSON no sabe representar", () => {
    const build = withVisual(makeBuild("i", "n", { element: "ember" }), {
      hue: 0,
      trail: -0,
      spin: -0,
    });

    expect(Object.is(build.visual.spin, -0)).toBe(false);
    expect(decodeBuild(encodeBuild(build))).toEqual(build);
  });

  it("sobrevive a nombres con acentos y emoji", () => {
    const build = makeBuild("i", "Ráfaga ártica 🧊", { element: "frost", vector: "wave" });
    expect(decodeBuild(encodeBuild(build)).name).toBe("Ráfaga ártica 🧊");
  });

  it("el código es URL-safe y sin relleno", () => {
    const build = makeBuild("i", "x".repeat(40), { element: "void", modifiers: [...MODIFIERS] });
    const code = encodeBuild(build);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("tolera espacios alrededor al pegar", () => {
    const build = makeBuild("i", "n", { element: "sound" });
    expect(decodeBuild(`  ${encodeBuild(build)}\n`)).toEqual(build);
  });

  it("rechaza códigos vacíos, corruptos y ajenos", () => {
    expect(() => decodeBuild("")).toThrow(BuildCodeError);
    expect(() => decodeBuild("!!!no-es-base64!!!")).toThrow(BuildCodeError);
    expect(() => decodeBuild(btoa("no soy json"))).toThrow(BuildCodeError);
    expect(() => decodeBuild(btoa(JSON.stringify({ hola: 1 })))).toThrow(BuildCodeError);
  });

  it("rechaza una build con valores fuera del catálogo", () => {
    const falsa = { v: BUILD_VERSION, id: "i", name: "n", composition: { element: "plasma" }, visual: { hue: 0, trail: 0, spin: 0 } };
    expect(() => decodeBuild(btoa(JSON.stringify(falsa)))).toThrow(/fuera del catálogo/);
  });
});

describe("persistencia local", () => {
  it("guarda y recupera", () => {
    const store = memoryStore();
    const builds = [makeBuild("a", "A", { element: "ember" }), makeBuild("b", "B", { element: "void" })];
    saveBuilds(store, builds);
    expect(loadBuilds(store)).toEqual(builds);
  });

  it("una colección vacía o ausente devuelve []", () => {
    expect(loadBuilds(memoryStore())).toEqual([]);
  });

  it("el esquema va versionado", () => {
    const store = memoryStore();
    saveBuilds(store, []);
    expect(JSON.parse(store.data[STORAGE_KEY]!).v).toBe(COLLECTION_VERSION);
  });

  it("nunca lanza ante datos corruptos: el jugador siempre puede abrir el juego", () => {
    expect(loadBuilds(memoryStore({ [STORAGE_KEY]: "{no es json" }))).toEqual([]);
    expect(loadBuilds(memoryStore({ [STORAGE_KEY]: "null" }))).toEqual([]);
    expect(loadBuilds(memoryStore({ [STORAGE_KEY]: '{"v":999,"builds":[]}' }))).toEqual([]);
    expect(loadBuilds(memoryStore({ [STORAGE_KEY]: '{"v":1,"builds":"nope"}' }))).toEqual([]);
  });

  it("una build rota no se lleva puestas a las sanas", () => {
    const sana = makeBuild("ok", "buena", { element: "light" });
    const store = memoryStore({
      [STORAGE_KEY]: JSON.stringify({ v: COLLECTION_VERSION, builds: [{ basura: true }, sana] }),
    });
    expect(loadBuilds(store)).toEqual([sana]);
  });

  it("upsert agrega, reemplaza y conserva el orden", () => {
    const a = makeBuild("a", "A", { element: "ember" });
    const b = makeBuild("b", "B", { element: "frost" });
    const aPrima = makeBuild("a", "A renombrada", { element: "ember" });

    expect(upsertBuild([a], b)).toEqual([a, b]);
    expect(upsertBuild([a, b], aPrima)).toEqual([aPrima, b]);
  });

  it("remove quita solo la pedida", () => {
    const a = makeBuild("a", "A", { element: "ember" });
    const b = makeBuild("b", "B", { element: "frost" });
    expect(removeBuild([a, b], "a")).toEqual([b]);
    expect(removeBuild([a, b], "inexistente")).toEqual([a, b]);
  });
});

describe("isBuildShape", () => {
  it("acepta una build bien formada y rechaza el resto", () => {
    expect(isBuildShape(makeBuild("i", "n", { element: "toxin" }))).toBe(true);
    expect(isBuildShape(null)).toBe(false);
    expect(isBuildShape({})).toBe(false);
    expect(isBuildShape({ ...makeBuild("i", "n", { element: "toxin" }), v: 99 })).toBe(false);
  });
});
