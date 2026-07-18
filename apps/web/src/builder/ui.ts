// ui.ts — el Builder: componer un ataque, guardarlo, compartirlo.
//
// Las dos capas del §2 se mantienen separadas también en la pantalla: arriba la
// composición mecánica (lo que el motor ve, con su costo y su N(c) a la vista),
// abajo la expresión visual, marcada explícitamente como que no afecta nada.
// Que el jugador entienda esa separación es parte del diseño, no un detalle.

import {
  ELEMENTS,
  MODIFIERS,
  PATTERNS,
  VECTORS,
  cooldownOf,
  costOf,
  toSignature,
  type Composition,
  type Element,
  type Modifier,
  type Pattern,
  type Vector,
} from "@beforeheadapts/arena-dsl";
import { requiredExposures } from "@beforeheadapts/core";

import { defaultVisual, makeBuild, type Build, type VisualExpression } from "./build.js";
import { BuildCodeError, decodeBuild, encodeBuild } from "./code.js";
import { loadBuilds, removeBuild, saveBuilds, upsertBuild, type KeyValueStore } from "./storage.js";

export interface BuilderCallbacks {
  /** El jugador quiere lanzar esta build ya mismo. */
  onLaunch(build: Build): void;
  /** Aviso para la bitácora de la arena. */
  onNotice(message: string): void;
}

export class Builder {
  #composition: Composition = { element: "ember", modifiers: [] };
  #visual: VisualExpression = defaultVisual;
  #builds: Build[];

  readonly element: HTMLElement;
  #lista!: HTMLUListElement;
  #resumen!: HTMLParagraphElement;
  #codigo!: HTMLInputElement;

  constructor(
    private readonly store: KeyValueStore,
    private readonly callbacks: BuilderCallbacks,
  ) {
    this.#builds = loadBuilds(store);
    this.element = document.createElement("section");
    this.element.className = "builder";
    this.#montar();
    this.#refrescar();
  }

  get builds(): readonly Build[] {
    return this.#builds;
  }

  #montar(): void {
    const titulo = document.createElement("h2");
    titulo.textContent = "Builder";

    // --- Capa mecánica -------------------------------------------------------
    const mecanica = document.createElement("div");
    mecanica.className = "capa capa-mecanica";
    const mecanicaTitulo = document.createElement("h3");
    mecanicaTitulo.textContent = "Composición";
    const mecanicaNota = document.createElement("p");
    mecanicaNota.className = "nota";
    mecanicaNota.textContent = "Lo único que el ente percibe. Define la firma.";
    mecanica.append(mecanicaTitulo, mecanicaNota);

    mecanica.append(
      this.#selector("Elemento", ELEMENTS, "ember", (valor) => {
        this.#composition = { ...this.#composition, element: valor as Element };
      }),
      this.#selector("Vector", VECTORS, "", (valor) => {
        const { vector: _, ...resto } = this.#composition;
        this.#composition = valor === "" ? resto : { ...resto, vector: valor as Vector };
      }),
      this.#selector("Patrón", PATTERNS, "", (valor) => {
        const { pattern: _, ...resto } = this.#composition;
        this.#composition = valor === "" ? resto : { ...resto, pattern: valor as Pattern };
      }),
      this.#modificadores(),
    );

    this.#resumen = document.createElement("p");
    this.#resumen.className = "resumen";
    mecanica.append(this.#resumen);

    // --- Capa visual ---------------------------------------------------------
    const visual = document.createElement("div");
    visual.className = "capa capa-visual";
    const visualTitulo = document.createElement("h3");
    visualTitulo.textContent = "Expresión visual";
    const visualNota = document.createElement("p");
    visualNota.className = "nota";
    visualNota.textContent = "Libre. NO afecta la firma: dos builds que solo difieren acá son el mismo ataque para el ente.";
    visual.append(visualTitulo, visualNota);

    visual.append(
      this.#deslizador("Matiz", 0, 359, defaultVisual.hue, (v) => {
        this.#visual = { ...this.#visual, hue: v };
      }),
      this.#deslizador("Estela", 0, 100, defaultVisual.trail * 100, (v) => {
        this.#visual = { ...this.#visual, trail: v / 100 };
      }),
      this.#deslizador("Giro", -100, 100, defaultVisual.spin * 100, (v) => {
        this.#visual = { ...this.#visual, spin: v / 100 };
      }),
    );

    // --- Acciones ------------------------------------------------------------
    const acciones = document.createElement("div");
    acciones.className = "acciones";

    const nombre = document.createElement("input");
    nombre.type = "text";
    nombre.placeholder = "nombre de la build";
    nombre.maxLength = 40;

    const guardar = document.createElement("button");
    guardar.textContent = "Guardar";
    guardar.addEventListener("click", () => {
      const titulo = nombre.value.trim() || "sin nombre";
      const build: Build = {
        ...makeBuild(crypto.randomUUID(), titulo, this.#composition),
        visual: this.#visual,
      };
      this.#builds = upsertBuild(this.#builds, build);
      saveBuilds(this.store, this.#builds);
      nombre.value = "";
      this.callbacks.onNotice(`build "${titulo}" guardada`);
      this.#refrescar();
    });

    acciones.append(nombre, guardar);

    // --- Import / export -----------------------------------------------------
    const compartir = document.createElement("div");
    compartir.className = "compartir";

    this.#codigo = document.createElement("input");
    this.#codigo.type = "text";
    this.#codigo.placeholder = "pegá un código de build";

    const importar = document.createElement("button");
    importar.textContent = "Importar";
    importar.addEventListener("click", () => {
      try {
        const build = decodeBuild(this.#codigo.value);
        this.#builds = upsertBuild(this.#builds, build);
        saveBuilds(this.store, this.#builds);
        this.#codigo.value = "";
        this.callbacks.onNotice(`build "${build.name}" importada`);
        this.#refrescar();
      } catch (error) {
        this.callbacks.onNotice(
          error instanceof BuildCodeError ? `no se pudo importar: ${error.message}` : "error al importar",
        );
      }
    });

    compartir.append(this.#codigo, importar);

    this.#lista = document.createElement("ul");
    this.#lista.className = "builds";

    this.element.append(titulo, mecanica, visual, acciones, compartir, this.#lista);
  }

  #selector(
    etiqueta: string,
    valores: readonly string[],
    inicial: string,
    alCambiar: (valor: string) => void,
  ): HTMLElement {
    const fila = document.createElement("label");
    fila.className = "campo";
    fila.append(document.createTextNode(etiqueta));

    const select = document.createElement("select");
    // El vacío solo existe para los ejes opcionales; el elemento es obligatorio.
    if (inicial === "") select.append(new Option("—", ""));
    for (const valor of valores) select.append(new Option(valor, valor));
    select.value = inicial;
    select.addEventListener("change", () => {
      alCambiar(select.value);
      this.#refrescar();
    });

    fila.append(select);
    return fila;
  }

  #modificadores(): HTMLElement {
    const grupo = document.createElement("div");
    grupo.className = "campo campo-mods";
    grupo.append(document.createTextNode("Modificadores"));

    for (const modificador of MODIFIERS) {
      const etiqueta = document.createElement("label");
      const casilla = document.createElement("input");
      casilla.type = "checkbox";
      casilla.addEventListener("change", () => {
        const actuales = new Set(this.#composition.modifiers ?? []);
        if (casilla.checked) actuales.add(modificador);
        else actuales.delete(modificador);
        this.#composition = {
          ...this.#composition,
          modifiers: MODIFIERS.filter((m) => actuales.has(m)) as Modifier[],
        };
        this.#refrescar();
      });
      etiqueta.append(casilla, document.createTextNode(modificador));
      grupo.append(etiqueta);
    }

    return grupo;
  }

  #deslizador(
    etiqueta: string,
    min: number,
    max: number,
    inicial: number,
    alCambiar: (valor: number) => void,
  ): HTMLElement {
    const fila = document.createElement("label");
    fila.className = "campo";
    fila.append(document.createTextNode(etiqueta));

    const rango = document.createElement("input");
    rango.type = "range";
    rango.min = String(min);
    rango.max = String(max);
    rango.value = String(inicial);
    rango.addEventListener("input", () => alCambiar(Number(rango.value)));

    fila.append(rango);
    return fila;
  }

  /** Redibuja lo que depende del estado: el resumen y la lista de builds. */
  #refrescar(): void {
    const signature = toSignature(this.#composition);
    this.#resumen.textContent =
      `firma: ${signature.primitives.join(" · ")} — ` +
      `N(c) ${requiredExposures(signature)} · costo ${costOf(this.#composition)} · ` +
      `cooldown ${(cooldownOf(this.#composition) / 1000).toFixed(1)}s`;

    this.#lista.replaceChildren(
      ...this.#builds.map((build) => {
        const item = document.createElement("li");

        const etiqueta = document.createElement("span");
        etiqueta.textContent = `${build.name} — N(c) ${requiredExposures(toSignature(build.composition))}`;

        const lanzar = document.createElement("button");
        lanzar.textContent = "Lanzar";
        lanzar.addEventListener("click", () => this.callbacks.onLaunch(build));

        const copiar = document.createElement("button");
        copiar.textContent = "Copiar código";
        copiar.addEventListener("click", () => {
          const code = encodeBuild(build);
          void navigator.clipboard?.writeText(code);
          this.#codigo.value = code;
          this.callbacks.onNotice(`código de "${build.name}" copiado`);
        });

        const borrar = document.createElement("button");
        borrar.textContent = "×";
        borrar.title = "borrar";
        borrar.addEventListener("click", () => {
          this.#builds = removeBuild(this.#builds, build.id);
          saveBuilds(this.store, this.#builds);
          this.#refrescar();
        });

        item.append(etiqueta, lanzar, copiar, borrar);
        return item;
      }),
    );
  }
}
