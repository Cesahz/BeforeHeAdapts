// view/hud.ts — la interfaz del combate (ADR 0009 §4 del prompt de fase, §7 del diseño).
//
// **El HUD es DOM; el juego jamás lo es.** El §7 del diseño lo dice sin
// matices: DOM/CSS solo para UI (HUD, builder, menús); el ente, los ataques y
// los efectos viven en el SVG. Si algo del juego se animara con CSS, el export
// del visualizador y la pantalla dejarían de coincidir — el bug que nadie
// encuentra hasta que el gif sale distinto de lo que se vio.
//
// El módulo está partido en dos a propósito:
//
//   hudModelOf()  qué mostrar   → puro, testeable sin navegador
//   class Hud     cómo pintarlo → DOM, delgado, sin decisiones
//
// Es el mismo corte que el resto del repo (núcleo puro + adaptador fino), y es
// lo que permite testear que la barra de vida diga la verdad sin montar un DOM.

import { ELEMENTS, type Element } from "@beforeheadapts/arena-dsl";

import { PLAYER } from "../arena/balance.js";
import type { CombatSession } from "../arena/combat.js";
import type { GestureKind } from "../gesture/recognize.js";

/** Los cuatro gestos, en el orden en que se muestran. */
export const GESTURES: readonly GestureKind[] = ["straight", "hold", "circle", "zigzag"];

/** Nombre legible de cada gesto. La UI no muestra identificadores en inglés. */
export const GESTURE_LABEL: Readonly<Record<GestureKind, string>> = {
  straight: "recto",
  hold: "sostener",
  circle: "círculo",
  zigzag: "zigzag",
};

/** Estado de un gesto en la botonera: disponible o cuánto falta. */
export interface GestureStatus {
  readonly gesture: GestureKind;
  readonly label: string;
  readonly ready: boolean;
  /** Fracción de cooldown transcurrida, en `[0, 1]`. 1 = disponible. */
  readonly progress: number;
  /** Segundos que faltan, redondeados a una decimal. 0 si está disponible. */
  readonly remainingSeconds: number;
}

/** Todo lo que el HUD muestra, derivado de la sesión. Sin estado propio. */
export interface HudModel {
  readonly hp: number;
  readonly maxHp: number;
  /** Fracción de vida en `[0, 1]`. */
  readonly hpFraction: number;
  readonly defeated: boolean;
  readonly element: Element;
  readonly elements: readonly Element[];
  readonly gestures: readonly GestureStatus[];
  readonly lastGesture: string | undefined;
  /** Erraticidad vigente, en `[0, 1]`. */
  readonly erraticity: number;
  /** El ente está percibiendo agitación ahora mismo. */
  readonly agitated: boolean;
  /** Contraataques armados. Con 0 el ente todavía no aprendió nada. */
  readonly arsenal: number;
  /**
   * Cuadros por segundo. Va en el HUD y no en el panel lateral porque es el
   * número que el autor necesita mirar MIENTRAS juega: el presupuesto del §7
   * son 60 fps, y la decisión de proponer WebGL depende de una medición con
   * combate real, no de una impresión.
   */
  readonly fps: number;
}

/**
 * Deriva qué mostrar, leyendo la sesión. Puro: no toca DOM ni reloj.
 *
 * Como todo en el proyecto, esto es una LECTURA — el HUD no acumula estado
 * propio. Si el HUD y la sesión discrepan, el que está mal es el HUD.
 */
export function hudModelOf(session: CombatSession, now: number, fps = 0): HudModel {
  const noise = session.readNoise(now);

  const gestures = GESTURES.map((gesture): GestureStatus => {
    const readyAt = session.readyAtFor(gesture);
    const total = session.cooldownFor(gesture);
    const remaining = Math.max(0, readyAt - now);
    return {
      gesture,
      label: GESTURE_LABEL[gesture],
      ready: remaining === 0,
      progress: total === 0 ? 1 : Math.min(1, 1 - remaining / total),
      remainingSeconds: Math.round(remaining / 100) / 10,
    };
  });

  return {
    hp: session.hp,
    maxHp: PLAYER.maxHp,
    hpFraction: session.hp / PLAYER.maxHp,
    defeated: session.defeated,
    element: session.element,
    // Los 8 jugables. `ambient` NO va acá: es lo que el ente percibe del
    // jugador, no algo que el jugador pueda lanzar (ADR 0009 §2).
    elements: ELEMENTS,
    gestures,
    lastGesture: session.lastGesture === undefined ? undefined : GESTURE_LABEL[session.lastGesture],
    erraticity: noise.erraticity,
    agitated: noise.agitated,
    arsenal: session.arsenal.length,
    fps,
  };
}

/**
 * El HUD montado sobre un contenedor.
 *
 * Construye su DOM una sola vez y después solo lo ACTUALIZA: reconstruirlo por
 * cuadro mataría el foco y provocaría reflow constante al lado de un SVG que se
 * redibuja a 60 fps.
 */
export class Hud {
  readonly element: HTMLElement;
  readonly #hpBar: HTMLElement;
  readonly #hpText: HTMLElement;
  readonly #elementButtons: readonly { element: Element; button: HTMLButtonElement }[];
  readonly #gestureRows: ReadonlyMap<GestureKind, { row: HTMLElement; fill: HTMLElement; text: HTMLElement }>;
  readonly #lastGesture: HTMLElement;
  readonly #agitation: HTMLElement;
  readonly #agitationFill: HTMLElement;
  readonly #arsenal: HTMLElement;
  readonly #fps: HTMLElement;

  #lastSignature = "";

  constructor(onArm: (element: Element) => void) {
    this.element = document.createElement("div");
    this.element.className = "hud";

    // --- Vida ---
    const vida = document.createElement("div");
    vida.className = "hud-vida";
    this.#hpText = document.createElement("span");
    this.#hpText.className = "hud-vida-texto";
    const barra = document.createElement("div");
    barra.className = "hud-barra";
    this.#hpBar = document.createElement("div");
    this.#hpBar.className = "hud-barra-relleno";
    barra.append(this.#hpBar);
    vida.append(this.#hpText, barra);

    // --- Elementos armados ---
    const elementos = document.createElement("div");
    elementos.className = "hud-elementos";
    this.#elementButtons = ELEMENTS.map((element, i) => {
      const button = document.createElement("button");
      button.className = "hud-elemento";
      // El número es el atajo de teclado: el elemento es un MODO que se porta,
      // así que cambiarlo tiene que costar una tecla, no una navegación.
      button.textContent = `${i + 1} ${element}`;
      button.addEventListener("click", () => onArm(element));
      elementos.append(button);
      return { element, button };
    });

    // --- Gestos y cooldowns ---
    const gestos = document.createElement("div");
    gestos.className = "hud-gestos";
    const filas = new Map<GestureKind, { row: HTMLElement; fill: HTMLElement; text: HTMLElement }>();
    for (const gesture of GESTURES) {
      const row = document.createElement("div");
      row.className = "hud-gesto";
      const fill = document.createElement("div");
      fill.className = "hud-gesto-relleno";
      const text = document.createElement("span");
      text.className = "hud-gesto-texto";
      row.append(fill, text);
      gestos.append(row);
      filas.set(gesture, { row, fill, text });
    }
    this.#gestureRows = filas;

    // --- Lectura del ente ---
    const lectura = document.createElement("div");
    lectura.className = "hud-lectura";
    this.#lastGesture = document.createElement("span");
    this.#arsenal = document.createElement("span");
    this.#fps = document.createElement("span");
    this.#fps.className = "hud-fps";
    this.#agitation = document.createElement("div");
    this.#agitation.className = "hud-agitacion";
    this.#agitationFill = document.createElement("div");
    this.#agitationFill.className = "hud-agitacion-relleno";
    this.#agitation.append(this.#agitationFill);
    lectura.append(this.#lastGesture, this.#arsenal, this.#fps, this.#agitation);

    this.element.append(vida, elementos, gestos, lectura);
  }

  /**
   * Sincroniza el HUD con el modelo.
   *
   * Se corta temprano si nada cambió. El HUD se actualiza por cuadro al lado de
   * un SVG que también se redibuja, y escribir estilos que ya tienen el valor
   * correcto es reflow gratis. La firma es un string porque el modelo es chico
   * y comparar strings es exacto, no heurístico — el mismo truco que usa
   * `LiveView` con el SVG.
   */
  update(model: HudModel): void {
    const signature = JSON.stringify(model);
    if (signature === this.#lastSignature) return;
    this.#lastSignature = signature;

    this.#hpText.textContent = model.defeated
      ? "el ente ganó"
      : `vida ${Math.ceil(model.hp)} / ${model.maxHp}`;
    this.#hpBar.style.width = `${(model.hpFraction * 100).toFixed(1)}%`;
    this.element.classList.toggle("hud-derrotado", model.defeated);

    for (const { element, button } of this.#elementButtons) {
      button.classList.toggle("hud-elemento-armado", element === model.element);
    }

    for (const status of model.gestures) {
      const row = this.#gestureRows.get(status.gesture);
      if (row === undefined) continue;
      row.fill.style.width = `${(status.progress * 100).toFixed(1)}%`;
      row.row.classList.toggle("hud-gesto-listo", status.ready);
      row.text.textContent = status.ready
        ? status.label
        : `${status.label} · ${status.remainingSeconds.toFixed(1)}s`;
    }

    this.#lastGesture.textContent =
      model.lastGesture === undefined ? "sin gestos aún" : `último: ${model.lastGesture}`;
    this.#arsenal.textContent =
      model.arsenal === 0 ? "el ente no aprendió nada" : `contraataques: ${model.arsenal}`;
    // Por debajo del presupuesto de 60 fps el número se marca: es la señal que
    // dispara la conversación sobre WebGL, y tiene que verse sin buscarla.
    this.#fps.textContent = `${model.fps.toFixed(0)} fps`;
    this.#fps.classList.toggle("hud-fps-bajo", model.fps > 0 && model.fps < 60);
    this.#agitationFill.style.width = `${(model.erraticity * 100).toFixed(0)}%`;
    this.#agitation.classList.toggle("hud-agitado", model.agitated);
  }
}
