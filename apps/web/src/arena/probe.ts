// probe.ts — sonda de sesión completa: la carrera con LAS DOS mitades.
//
// La compuerta del ADR 0011 (`victory.test.ts`) mide una sola mitad. Su
// `jugarSesion` llama a `attack()` y nunca a `hurt()`: el jugador simulado no
// recibe un solo contraataque. Los 168 vs 107 vs 150 HP miden exclusivamente la
// carrera de AGOTAMIENTO — si el arsenal alcanza. La mitad de PRESIÓN nunca se
// midió, y el playtest del autor (2026-07-19) mostró el agujero desde el otro
// lado: ganó con el arsenal ajustado, sin tensión, en menos de 5 minutos.
//
// Esta sonda cierra el agujero. Corre el loop completo —el mismo que `main.ts`
// ejecuta por cuadro— con el planificador de contraataques andando, y modela la
// interrupción de gestos del ADR 0012 ANTES de implementarla, que es el orden
// que el proyecto exige: los números del ADR salen de la sonda, no de intuiciones.
//
// **La sonda no toca `packages/core` ni modifica `CombatSession`.** Modela la
// interrupción desde afuera: si el golpe cae mientras hay un trazo en curso, el
// trazo simplemente no se convierte en `attack()`. Eso permite medir la mecánica
// propuesta contra la actual sin haber escrito todavía una línea de la mecánica.
//
// Determinista y sin reloj: paso fijo de 16 ms, cero `Math.random()`. Dos
// corridas con la misma configuración dan exactamente el mismo resultado.

import { COUNTER, DRAW, VICTORY } from "./balance.js";
import { CombatSession, type Act, type RunOutcome } from "./combat.js";
import { CounterScheduler, type Point } from "./counter.js";
import type { GestureKind } from "../gesture/recognize.js";
import type { VocabularyEntry } from "./vocabulary.js";

/** Paso del loop simulado. Es el de `NOISE.sampleStepMs`: un cuadro a 60 Hz. */
const STEP_MS = 16;

/** Tope de mundo simulado. Una corrida que llegue acá es, por definición, un problema. */
const MAX_MS = 30 * 60 * 1000;

/**
 * Dónde se ancla el golpe, y dónde se para el jugador que esquiva.
 *
 * El disco de impacto tiene `COUNTER.strikeRadiusPx` = 60 px de radio. "Esquivar"
 * en la sonda es estar lejos de ese punto; "comerse el golpe" es estar en él. No
 * se modela la trayectoria del cursor porque no hace falta: el ADR 0009 fijó que
 * el punto se FIJA al empezar el telegraph y no persigue, así que salir del disco
 * es cuestión de decidir salir, no de destreza.
 */
const ANCHOR: Point = { x: 0, y: 0 };
const SAFE: Point = { x: 10_000, y: 10_000 };

/** Cuánto tarda cada trazo. La estimación vive en `balance.ts`, no acá. */
export function drawMsFor(gesture: GestureKind): number {
  switch (gesture) {
    case "straight":
      return DRAW.straightMs;
    case "hold":
      return DRAW.holdMs;
    case "circle":
      return DRAW.circleMs;
    case "zigzag":
      return DRAW.zigzagMs;
  }
}

/**
 * Cómo decide el jugador simulado frente a un telegraph encendido.
 *
 * Las tres políticas son el punto entero de la sonda: si las tres rinden igual,
 * la mecánica del ADR 0012 no agregó ninguna decisión y no vale la pena.
 */
export type DrawPolicy =
  /** No mira el telegraph. Dibuja siempre y se come todo. El "spam" del ADR 0011. */
  | "temerario"
  /** Abandona ante cualquier telegraph. Nunca lo tocan, y desperdicia muchísimo trazo. */
  | "cauto"
  /** Calcula si llega a terminar antes del golpe. Compromete solo lo que puede cerrar. */
  | "calculador";

/** Con qué criterio elige la próxima firma. Espeja las dos estrategias del ADR 0011 §6. */
export type Order = "inteligente" | "ingenuo";

export interface ProbeOptions {
  /**
   * ¿Existe la mecánica del ADR 0012?
   *
   * `false` reproduce el juego de HOY: dibujar y esquivar son independientes, así
   * que el jugador esquiva siempre, tenga o no un trazo en curso.
   */
  readonly interruption: boolean;
  readonly policy: DrawPolicy;
  readonly order: Order;
}

export interface ProbeResult {
  readonly label: string;
  readonly outcome: RunOutcome;
  /** Duración de la corrida en el mundo simulado. El objetivo del ADR 0011 es 5–15 min. */
  readonly elapsedMs: number;
  readonly damageDealt: number;
  readonly enteHp: number;
  readonly playerHp: number;
  /** Trazos que se convirtieron en exposición. */
  readonly attacks: number;
  /** Trazos perdidos por interrupción (golpe recibido a mitad del trazo). */
  readonly interrupted: number;
  /** Trazos abandonados voluntariamente para esquivar. */
  readonly abandoned: number;
  readonly hitsTaken: number;
  readonly dodges: number;
  readonly actReached: Act;
  readonly viableLeft: number;
  /**
   * Cuándo cayó el PRIMER contraataque, o `null` si el ente nunca llegó a
   * golpear. Es la métrica que explica todo lo demás: el arsenal del ente
   * arranca vacío y solo se llena con cada `AdaptationCompleted`, así que hasta
   * ese instante la corrida no tiene amenaza de ningún tipo.
   */
  readonly firstShotMs: number | null;
  /** Golpes que el ente llegó a lanzar en toda la corrida (acertados + esquivados). */
  readonly shots: number;
  /** Clusters que el ente adaptó: el tamaño final de su arsenal. */
  readonly arsenal: number;
}

/** Mejor firma disponible: la de mayor efectividad esperada que esté fuera de cooldown. */
function pick(
  session: CombatSession,
  now: number,
  order: Order,
): VocabularyEntry | undefined {
  const usable = session.vocabulary.entries.filter(
    (e) => e.expectedEffectiveness > 0.02 && session.room.canAttack(e.composition, now),
  );
  if (usable.length === 0) return undefined;
  if (order === "ingenuo") return usable[0];
  return [...usable].sort((a, b) => b.expectedEffectiveness - a.expectedEffectiveness)[0];
}

/** Estado del jugador simulado. El trazo en curso es lo que la interrupción puede romper. */
type PlayerState =
  | { readonly kind: "idle" }
  | {
      readonly kind: "drawing";
      readonly entry: VocabularyEntry;
      readonly endsAt: number;
    }
  | { readonly kind: "stagger"; readonly until: number };

/**
 * Corre una sesión completa y devuelve qué pasó.
 *
 * El loop es el de `main.ts:393-404`, en el mismo orden: primero el planificador
 * avanza y resuelve, después el jugador decide. Invertirlo dejaría que el
 * jugador reaccionara a un golpe que todavía no cayó.
 */
export function probe(options: ProbeOptions): ProbeResult {
  const session = new CombatSession();
  const scheduler = new CounterScheduler();

  let player: PlayerState = { kind: "idle" };
  let attacks = 0;
  let interrupted = 0;
  let abandoned = 0;
  let hitsTaken = 0;
  let dodges = 0;
  let firstShotMs: number | null = null;
  let now = 0;

  while (!session.finished && now < MAX_MS) {
    const phase = scheduler.phase;
    const telegraph = phase.kind === "telegraph" ? phase : undefined;

    // ¿Dónde está el cursor? Esa posición ES la decisión del jugador, y es lo
    // único que la sonda necesita modelar.
    //
    // El jugador vive en `ANCHOR` —su posición de trabajo, pegado al ente— y
    // solo se aparta para esquivar. Importa que sea así y no al revés: el
    // telegraph se ANCLA donde está el cursor al encenderse (ADR 0009 §4), así
    // que un jugador que ya estuviera lejos haría que el golpe lo persiguiera.
    // Esquivar es apartarse DESPUÉS del aviso, que es justo lo que un trazo en
    // curso impedirá cuando exista la mecánica del ADR 0012.
    //
    // Sin esa mecánica el jugador se aparta SIEMPRE que haya aviso, tenga o no
    // un trazo a medias: hoy dibujar y esquivar son independientes, que es
    // exactamente el defecto que el ADR corrige.
    let committed = false;
    if (options.interruption && player.kind === "drawing" && telegraph !== undefined) {
      if (options.policy === "temerario") {
        committed = true;
      } else {
        // El cálculo del jugador competente: ¿llego a cerrar el trazo antes del
        // golpe? Si llega, sigue dibujando y se aparta apenas termina; si no,
        // abandona el trazo y se aparta ya.
        const llega = player.endsAt <= telegraph.strikeAt;
        if (options.policy === "calculador" && llega) {
          committed = true;
        } else {
          abandoned += 1;
          player = { kind: "idle" };
        }
      }
    }

    const cursor = committed || telegraph === undefined ? ANCHOR : SAFE;
    const resolution = scheduler.poll(now, session.arsenal, cursor, ANCHOR, session.act);

    if (resolution !== undefined) {
      firstShotMs ??= now;
      if (resolution.hit) {
        hitsTaken += 1;
        session.hurt(resolution.damage);
        // La interrupción: el golpe rompe el trazo en curso. No cobra cooldown
        // —no se emitió firma— pero cuesta el trazo entero y el stagger.
        if (options.interruption && player.kind === "drawing") {
          interrupted += 1;
          player = { kind: "stagger", until: now + DRAW.staggerMs };
        }
      } else {
        dodges += 1;
      }
    }

    if (session.finished) break;

    // El jugador decide.
    if (player.kind === "stagger" && now >= player.until) player = { kind: "idle" };

    if (player.kind === "drawing" && now >= player.endsAt) {
      session.attack(player.entry.composition, now);
      attacks += 1;
      player = { kind: "idle" };
    } else if (player.kind === "idle") {
      const entry = pick(session, now, options.order);
      if (entry !== undefined && puedeEmpezar(options, scheduler, entry, now)) {
        player = { kind: "drawing", entry, endsAt: now + drawMsFor(entry.gesture) };
      }
    }

    now += STEP_MS;
  }

  return {
    label: `${options.order}/${options.policy}${options.interruption ? "" : " (sin interrupción)"}`,
    outcome: session.outcome,
    elapsedMs: now,
    damageDealt: VICTORY.enteMaxHp - session.enteHp,
    enteHp: session.enteHp,
    playerHp: session.hp,
    attacks,
    interrupted,
    abandoned,
    hitsTaken,
    dodges,
    actReached: session.act,
    viableLeft: session.vocabulary.viable,
    firstShotMs,
    shots: scheduler.shots,
    arsenal: session.arsenal.length,
  };
}

/**
 * ¿Arranca el trazo ahora, con lo que hay en pantalla?
 *
 * Es la otra mitad de la decisión, y la que hace que los actos se sientan: en el
 * Acto III la cadencia está en el piso (`COUNTER.minIntervalMs`), así que las
 * ventanas limpias para un `zigzag` de ~1,2 s se vuelven escasas.
 */
function puedeEmpezar(
  options: ProbeOptions,
  scheduler: CounterScheduler,
  entry: VocabularyEntry,
  now: number,
): boolean {
  if (!options.interruption || options.policy === "temerario") return true;

  const phase = scheduler.phase;
  const fin = now + drawMsFor(entry.gesture);

  if (phase.kind === "telegraph") {
    return options.policy === "calculador" ? fin <= phase.strikeAt : false;
  }
  // Sin telegraph encendido, el jugador competente igual mira el reloj: si el
  // próximo golpe de cadencia cae a mitad del trazo, todavía tiene el aviso
  // previo para reaccionar, así que arrancar es razonable. El cauto no arranca
  // nada que no pueda cerrar antes del próximo golpe.
  if (options.policy === "cauto" && scheduler.nextAt !== undefined) {
    return fin <= scheduler.nextAt;
  }
  return true;
}

/** El barrido que el ADR 0012 cita: las dos mitades, las tres políticas. */
export function sweep(): readonly ProbeResult[] {
  const results: ProbeResult[] = [];
  for (const order of ["inteligente", "ingenuo"] as const) {
    for (const interruption of [false, true]) {
      for (const policy of ["temerario", "cauto", "calculador"] as const) {
        // Sin la mecánica las tres políticas son la misma corrida (nada puede
        // romper un trazo), así que se reporta una sola.
        if (!interruption && policy !== "calculador") continue;
        results.push(probe({ interruption, policy, order }));
      }
    }
  }
  return results;
}

/** Sensibilidad al input más flojo: ¿la conclusión sobrevive al rango plausible de `DRAW`? */
export const DRAW_RANGE_NOTE =
  `zigzag ${DRAW.zigzagMs} ms (plausible 950–1400), circle ${DRAW.circleMs} ms (600–900), ` +
  `stagger ${DRAW.staggerMs} ms (200–500), radio de impacto ${COUNTER.strikeRadiusPx} px`;
