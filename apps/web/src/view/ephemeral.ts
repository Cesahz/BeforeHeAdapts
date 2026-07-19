// view/ephemeral.ts — la capa efímera del render (ADR 0010 §2).
//
// Lo que el jugador VIVE y el replay no muestra: el ataque naciendo del cursor,
// la puntería, el retículo, el halo de agitación. Se compone encima del SVG
// canónico y **no deriva del log** — deriva de estado que solo existe en vivo.
//
// Por qué existe esta capa: la posición del cursor no está en el log y no puede
// estarlo (ADR 0004). Así que "el ataque nace donde apuntaste" es información
// que existe en el instante del gesto y no sobrevive. En vez de arrastrarlo
// como excepción, el ADR 0010 le puso nombre y contrato:
//
//   REPLAY     = capa canónica, del log, determinista, reproducible byte a byte
//   GRABACIÓN  = lo que se vivió, esta capa incluida. Todavía no existe.
//
// Un replay no es una grabación incompleta: es otro artefacto.
//
// ⚠️ LA REGLA QUE NO SE RELAJA (ADR 0010 §3):
//
//   **La dirección da forma al VIAJE, nunca al DESTINO.**
//
// Todo ataque reconocido ya fue procesado por el motor: su firma entró al log,
// `eff(k)` se aplicó, el daño ocurrió. Un proyectil que se viera fallar
// mientras el ente recibe el golpe sería el render mintiendo sobre la mecánica.
// Por eso la puntería curva la trayectoria y jamás cambia el desenlace: todo
// trazador resuelve SOBRE el ente. Si algún día fallar tiene que tener
// consecuencia, eso es mecánica y entra por el contrato, no se simula acá.
//
// El módulo es puro: recibe estado y devuelve un string SVG. Ni DOM ni reloj —
// el tiempo entra como dato, igual que en el resto del proyecto.

import type { Element } from "@beforeheadapts/arena-dsl";

import { EPHEMERAL } from "../arena/balance.js";
import type { CounterPhase } from "../arena/counter.js";
import type { GestureKind } from "../gesture/recognize.js";

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Un ataque en vuelo. Nace al reconocerse el gesto y muere solo. */
export interface Tracer {
  readonly kind: GestureKind;
  /** Dónde terminó el trazo, en coordenadas del SVG. */
  readonly origin: Point;
  /** Hacia dónde apuntaba el final del trazo. Normalizado. */
  readonly aim: Point;
  readonly element: Element;
  /** `eff(k)` del golpe: gobierna cuánto penetra (R5, §4 del diseño). */
  readonly eff: number;
  readonly bornAt: number;
}

export interface EphemeralState {
  readonly tracers: readonly Tracer[];
  readonly cursor: Point | undefined;
  /** Erraticidad vigente en `[0, 1]`. */
  readonly erraticity: number;
  readonly agitated: boolean;
  /** Centro del ente en coordenadas del SVG. */
  readonly center: Point;
  /** Radio del ente. */
  readonly coreRadius: number;
  /**
   * Qué está haciendo el ente con su arsenal. `idle` no dibuja nada.
   *
   * El contraataque vive en esta capa y no en la canónica porque **no está en el
   * log**: un golpe del ente no es un estímulo percibido (ADR 0009 §4). Un
   * replay muestra el arsenal creciendo y no muestra los disparos, y eso es una
   * consecuencia declarada, no un olvido.
   */
  readonly counter: CounterPhase;
  /** Radio del disco de impacto, en unidades del SVG. */
  readonly strikeRadius: number;
}

/**
 * Color por elemento. Es decoración pura: no entra a la firma, no afecta la
 * mecánica, y dos jugadores con paletas distintas producirían logs idénticos.
 */
const ELEMENT_COLOR: Readonly<Record<Element, string>> = {
  ember: "#e8683d",
  frost: "#7fd4e8",
  current: "#e8d33d",
  toxin: "#8de83d",
  gravity: "#9b7fe8",
  sound: "#e87fc4",
  light: "#f2f0e6",
  void: "#5a4a7a",
};

const n = (value: number): string => (Math.round(value * 1000) / 1000).toString();

/** Punto sobre una curva cuadrática de Bézier. */
function quadratic(from: Point, control: Point, to: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * from.x + 2 * u * t * control.x + t * t * to.x,
    y: u * u * from.y + 2 * u * t * control.y + t * t * to.y,
  };
}

/**
 * Punto de control de la trayectoria: el ataque **sale hacia donde apuntaste**
 * y curva hacia el ente.
 *
 * Acá es donde la corrección del ADR 0010 §3 se vuelve código. El destino
 * siempre es el ente; lo único que la puntería mueve es por dónde se pasa para
 * llegar. Apuntar bien da una trayectoria casi recta; apuntar al costado da una
 * curva amplia que igual termina en el ente.
 */
function controlPointOf(tracer: Tracer, center: Point): Point {
  const dx = center.x - tracer.origin.x;
  const dy = center.y - tracer.origin.y;
  const distance = Math.hypot(dx, dy);
  const reach = distance * EPHEMERAL.aimCurve;
  return {
    x: tracer.origin.x + tracer.aim.x * reach,
    y: tracer.origin.y + tracer.aim.y * reach,
  };
}

/**
 * Dónde resuelve el ataque: sobre la superficie del ente, o adentro si `eff` es
 * alto.
 *
 * Es el feedback de R5 que el §4 del diseño pide desde la Fase 3a: a `eff` alto
 * el ataque penetra; exposición tras exposición, el mismo golpe llega cada vez
 * más superficial hasta apenas rozar. La curva se lee sin un solo número.
 */
function impactPointOf(tracer: Tracer, center: Point, coreRadius: number): Point {
  const dx = center.x - tracer.origin.x;
  const dy = center.y - tracer.origin.y;
  const distance = Math.hypot(dx, dy) || 1;
  const penetration = coreRadius * (1 - EPHEMERAL.maxPenetration * clamp01(tracer.eff));
  return {
    x: center.x - (dx / distance) * penetration,
    y: center.y - (dy / distance) * penetration,
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Progreso del trazador en `[0, 1]`. Pasado 1, está muerto. */
export function progressOf(tracer: Tracer, now: number): number {
  return (now - tracer.bornAt) / EPHEMERAL.tracerMs;
}

/** Descarta los trazadores vencidos. Puro: devuelve una lista nueva. */
export function pruneTracers(tracers: readonly Tracer[], now: number): readonly Tracer[] {
  const vivos = tracers.filter((t) => progressOf(t, now) < 1);
  // Tope duro: con cooldowns esto no debería alcanzarse nunca, pero un tope que
  // solo se apoya en otra mecánica no es un tope.
  return vivos.length > EPHEMERAL.maxTracers ? vivos.slice(-EPHEMERAL.maxTracers) : vivos;
}

function tracerMarkup(tracer: Tracer, state: EphemeralState, now: number): string {
  const p = clamp01(progressOf(tracer, now));
  const color = ELEMENT_COLOR[tracer.element];
  const control = controlPointOf(tracer, state.center);
  const impact = impactPointOf(tracer, state.center, state.coreRadius);
  // Se desvanece sobre el final del viaje, no desde el principio: el ataque
  // tiene que leerse entero y apagarse al resolver.
  const fade = p < 0.75 ? 1 : 1 - (p - 0.75) / 0.25;

  switch (tracer.kind) {
    case "hold": {
      // Haz sostenido: no viaja, conecta. Crece en grosor y se apaga.
      return `<line x1="${n(tracer.origin.x)}" y1="${n(tracer.origin.y)}" x2="${n(impact.x)}" y2="${n(impact.y)}" stroke="${color}" stroke-width="${n(1 + 3 * (1 - p))}" stroke-opacity="${n(0.85 * fade)}" stroke-linecap="round"/>`;
    }
    case "circle": {
      // Anillo que se cierra ALREDEDOR del ente — el gesto natural que el autor
      // reportó: "tiendo a encerrar al ente".
      const from = Math.hypot(tracer.origin.x - state.center.x, tracer.origin.y - state.center.y);
      const radius = from + (state.coreRadius - from) * p;
      return `<circle cx="${n(state.center.x)}" cy="${n(state.center.y)}" r="${n(Math.max(1, radius))}" fill="none" stroke="${color}" stroke-width="${n(1.5 + 2 * tracer.eff)}" stroke-opacity="${n(0.8 * fade)}"/>`;
    }
    case "zigzag": {
      // Serie de quiebres que avanzan por la trayectoria, alternando a los
      // costados. Es el gesto dibujado, viajando.
      const puntos: string[] = [];
      const tramos = 7;
      for (let i = 0; i <= tramos; i += 1) {
        const t = clamp01(p - 0.18 + (i / tramos) * 0.18);
        const base = quadratic(tracer.origin, control, impact, t);
        // La perpendicular se calcula sobre la tangente aproximada del punto.
        const ahead = quadratic(tracer.origin, control, impact, Math.min(1, t + 0.05));
        const tx = ahead.x - base.x;
        const ty = ahead.y - base.y;
        const len = Math.hypot(tx, ty) || 1;
        const swing = (i % 2 === 0 ? 1 : -1) * 9;
        puntos.push(`${n(base.x - (ty / len) * swing)},${n(base.y + (tx / len) * swing)}`);
      }
      return `<polyline points="${puntos.join(" ")}" fill="none" stroke="${color}" stroke-width="2" stroke-opacity="${n(0.85 * fade)}" stroke-linejoin="round"/>`;
    }
    case "straight":
    default: {
      // Proyectil con estela: la estela es lo que hace legible la curva de la
      // puntería, que si no se perdería en un punto moviéndose.
      const head = quadratic(tracer.origin, control, impact, p);
      const tail = quadratic(tracer.origin, control, impact, Math.max(0, p - 0.22));
      return (
        `<line x1="${n(tail.x)}" y1="${n(tail.y)}" x2="${n(head.x)}" y2="${n(head.y)}" stroke="${color}" stroke-width="${n(1.5 + 2 * tracer.eff)}" stroke-opacity="${n(0.9 * fade)}" stroke-linecap="round"/>` +
        `<circle cx="${n(head.x)}" cy="${n(head.y)}" r="${n(2 + 2 * tracer.eff)}" fill="${color}" fill-opacity="${n(0.9 * fade)}"/>`
      );
    }
  }
}

/**
 * El color de un contraataque: el del elemento de la debilidad que lo armó.
 *
 * La debilidad es una primitiva del catálogo (`elem:frost`, `pat:pulse`…), y por
 * el ADR 0008 §4 casi siempre es un elemento — `elem:` es el primer prefijo en
 * orden lexicográfico. Cuando no lo es, o cuando es el `ambient` que el jugador
 * no puede lanzar, se cae al color de advertencia: el ente golpeando con algo
 * que no está en tu paleta tiene que leerse como ajeno.
 */
/**
 * El color de la amenaza basal: gris de piedra, fuera de la paleta de elementos.
 *
 * No es el color de ninguna debilidad porque no hay ninguna detrás — es el ente
 * mismo, no algo que aprendió. Ni siquiera cae en el ámbar de advertencia, que ya
 * significa "algo ajeno a tu paleta": la basal tiene que leerse como fondo, no
 * como novedad.
 */
const BASAL_COLOR = "#8a949c";

function counterColor(weakness: string): string {
  const element = weakness.startsWith("elem:") ? weakness.slice(5) : undefined;
  if (element !== undefined && element in ELEMENT_COLOR) {
    return ELEMENT_COLOR[element as Element];
  }
  return "#e8a33d";
}

/**
 * El contraataque: aviso convergente y después el golpe.
 *
 * El telegraph es un anillo que **se cierra** sobre el punto fijado. Se cierra y
 * no parpadea a propósito: el jugador tiene que poder leer *cuánto le queda* de
 * un vistazo periférico, mientras la atención está en dibujar el gesto. Esa es
 * toda la presión que el contraataque ejerce — compite por foco, no por
 * destreza (ADR 0009 §4).
 */
function counterMarkup(phase: CounterPhase, strikeRadius: number, now: number): string {
  if (phase.kind === "idle") return "";

  // La amenaza basal se dibuja **gris y sin trama**: el ente ocupando espacio, no
  // el ente usando lo que aprendió de vos (ADR 0012 §3). Que se distingan es
  // deliberado — si se vieran iguales, la recompensa de adaptar sería invisible.
  const basal = phase.source === "basal";
  const color = basal ? BASAL_COLOR : counterColor(phase.counter?.weakness ?? "");

  if (phase.kind === "telegraph") {
    const span = phase.strikeAt - phase.startedAt;
    const p = span <= 0 ? 1 : clamp01((now - phase.startedAt) / span);
    // Empieza ancho y termina exactamente en el disco: el radio final ES el
    // alcance real del golpe, así que el aviso no miente sobre dónde pega.
    const radius = strikeRadius * (2.6 - 1.6 * p);
    return (
      `<circle cx="${n(phase.at.x)}" cy="${n(phase.at.y)}" r="${n(radius)}" fill="none" ` +
      `stroke="${color}" stroke-width="${n(1 + 2 * p)}" stroke-opacity="${n(0.35 + 0.5 * p)}"${basal ? "" : ` stroke-dasharray="6 5"`}/>` +
      // El disco real, tenue desde el principio: dónde NO hay que estar.
      `<circle cx="${n(phase.at.x)}" cy="${n(phase.at.y)}" r="${n(strikeRadius)}" fill="${color}" fill-opacity="${n(0.06 + 0.1 * p)}"/>`
    );
  }

  // El golpe. Un fallo se dibuja igual y distinto: hueco y pálido. Ver que el
  // golpe cayó donde ya no estabas es la recompensa de haber esquivado.
  const p = clamp01((phase.until - now) / 200);
  return phase.hit
    ? `<circle cx="${n(phase.at.x)}" cy="${n(phase.at.y)}" r="${n(strikeRadius * (1 + 0.6 * (1 - p)))}" fill="${color}" fill-opacity="${n(0.55 * p)}" stroke="${color}" stroke-opacity="${n(p)}" stroke-width="3"/>`
    : `<circle cx="${n(phase.at.x)}" cy="${n(phase.at.y)}" r="${n(strikeRadius)}" fill="none" stroke="${color}" stroke-opacity="${n(0.4 * p)}" stroke-width="1" stroke-dasharray="3 4"/>`;
}

/**
 * Dibuja la capa efímera completa.
 *
 * @returns el contenido interno de un `<svg>`; quien lo monta pone el envoltorio
 * con el mismo `viewBox` que la capa canónica, para que las coordenadas de las
 * dos capas signifiquen lo mismo.
 */
export function renderEphemeral(state: EphemeralState, now: number): string {
  const piezas: string[] = [];

  for (const tracer of state.tracers) {
    if (progressOf(tracer, now) >= 1) continue;
    piezas.push(tracerMarkup(tracer, state, now));
  }

  // Halo de agitación: la reacción preventiva del ente (§4 del diseño). Crece
  // con la erraticidad y se enciende al cruzar el umbral. Es lo que hace que el
  // jugador SIENTA que lo están mirando antes de que el ente aprenda nada.
  if (state.erraticity > 0.05) {
    const radius = state.coreRadius * (1.15 + 0.35 * state.erraticity);
    piezas.push(
      `<circle cx="${n(state.center.x)}" cy="${n(state.center.y)}" r="${n(radius)}" fill="none" stroke="${state.agitated ? "#e8a33d" : "#4a6c7a"}" stroke-width="1" stroke-opacity="${n(0.15 + 0.5 * state.erraticity)}" stroke-dasharray="4 6"/>`,
    );
  }

  // El contraataque va DESPUÉS del halo y ANTES del retículo: tiene que taparlo
  // todo salvo el cursor, que es lo único que el jugador necesita no perder de
  // vista mientras esquiva.
  piezas.push(counterMarkup(state.counter, state.strikeRadius, now));

  if (state.cursor !== undefined) {
    const r = EPHEMERAL.reticlePx;
    const { x, y } = state.cursor;
    piezas.push(
      `<g stroke="#7fd4e8" stroke-opacity="0.55" stroke-width="1">` +
        `<circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}" fill="none"/>` +
        `<line x1="${n(x - r - 4)}" y1="${n(y)}" x2="${n(x - r + 2)}" y2="${n(y)}"/>` +
        `<line x1="${n(x + r - 2)}" y1="${n(y)}" x2="${n(x + r + 4)}" y2="${n(y)}"/>` +
        `</g>`,
    );
  }

  return piezas.join("");
}
