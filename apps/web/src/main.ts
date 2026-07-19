// main.ts — punto de entrada de la arena.
//
// Vanilla TS a propósito (ADR 0008 §5): el estado de la sala ya ES el log del
// motor, así que un framework reactivo introduciría una segunda fuente de verdad
// para el mismo estado — justo lo que la Ley de arquitectura prohíbe. Acá se
// renderiza leyendo la sala, nunca acumulando estado propio en la UI.

import { ELEMENTS, cooldownOf, costOf } from "@beforeheadapts/arena-dsl";

import "./style.css";

import { downloadText } from "./arena/download.js";
import { CombatSession, type Act, type RunOutcome } from "./arena/combat.js";
import { CounterScheduler, type CounterPhase } from "./arena/counter.js";
import { COUNTER, DRAW } from "./arena/balance.js";
import { PREFABS, type Prefab } from "./arena/prefabs.js";
import { replayFileName, serializeReplay } from "./arena/replay.js";
import { CooldownError, Room } from "./arena/room.js";
import { Builder } from "./builder/ui.js";
import { centerOf } from "@beforeheadapts/visualizer";
import { Hud, hudModelOf } from "./view/hud.js";
import { LiveView } from "./view/live.js";
import { arenaTheme } from "./view/theme.js";
import { scaleOf, toSvg, viewBoxAttr, viewBoxOf } from "./view/viewport.js";
import { attachPointer } from "./view/pointer.js";
import { pruneTracers, renderEphemeral, type Tracer } from "./view/ephemeral.js";

const root = document.querySelector<HTMLDivElement>("#arena");
if (root === null) throw new Error("falta el contenedor #arena");

const room = new Room("sala-local");
/**
 * La sesión de combate envuelve la sala: es la única puerta por la que el
 * movimiento del jugador se convierte en eventos (ADR 0004). Los prefabs y el
 * Builder siguen atacando la sala directamente — son la capa deliberada, con el
 * espacio completo de 5.376 composiciones; los gestos son la capa rápida, con
 * 32. Las dos conviven a propósito (ADR 0009 §1).
 */
const session = new CombatSession(room);

/** Reloj de la sala. Monótono y en milisegundos, como exige el ledger. */
const now = (): number => Math.round(performance.now());

// --- Estructura de la página, montada una sola vez ---------------------------
// El DOM se construye acá y después solo se ACTUALIZA. Reconstruirlo por cuadro
// mataría el foco, el hover y cualquier animación del SVG.

const escena = document.createElement("div");
escena.className = "escena";
// El pipeline del visualizador emite un frame POR EVENTO, así que con el log
// vacío no hay nada que dibujar y el ente recién aparece con el primer golpe.
// Se avisa en vez de dejar un hueco negro sin explicación.

// El lienzo canónico es un hijo de la escena, no la escena misma: la capa
// efímera se monta al lado y `LiveView` puede reescribir su innerHTML sin
// borrarla.
const lienzo = document.createElement("div");
lienzo.className = "lienzo";
lienzo.innerHTML = `<p class="vacio">el ente todavía no fue expuesto a nada — atacá para despertarlo</p>`;
escena.append(lienzo);

const panel = document.createElement("div");
panel.className = "panel";

const botonera = document.createElement("div");
botonera.className = "botonera";

const estado = document.createElement("p");
estado.className = "estado";

const medidor = document.createElement("p");
medidor.className = "medidor";

const exportarBoton = document.createElement("button");
exportarBoton.textContent = "Exportar replay";

const bitacoraLista = document.createElement("ul");
bitacoraLista.className = "bitacora";

panel.append(botonera, estado, medidor, exportarBoton);

// El HUD es DOM y vive FUERA de la escena: el §7 del diseño prohíbe animar el
// juego con DOM. El ente y sus efectos son SVG; la vida y los cooldowns, no.
const hud = new Hud((element) => {
  session.arm(element);
  log(`elemento armado: ${element}`);
});

// --- Cajón deslizable --------------------------------------------------------
// El Builder y los prefabs son la capa DELIBERADA (ADR 0009 §1): se usan entre
// combate y combate, no durante. Antes vivían en una columna fija que le comía
// el 28 % del ancho a la escena en todo momento, incluso mientras el jugador
// dibujaba gestos y no los miraba. Ahora se corren fuera de pantalla y vuelven
// con un botón: el combate se queda con la pantalla, que es de quien tiene que
// ser.
const cajon = document.createElement("aside");
cajon.className = "cajon";

const cajonBoton = document.createElement("button");
cajonBoton.className = "cajon-tirador";
cajonBoton.textContent = "⟨ arsenal";
cajonBoton.addEventListener("click", () => {
  const abierto = cajon.classList.toggle("cajon-abierto");
  cajonBoton.textContent = abierto ? "arsenal ⟩" : "⟨ arsenal";
});

const cajonCuerpo = document.createElement("div");
cajonCuerpo.className = "cajon-cuerpo";
cajonCuerpo.append(panel);

cajon.append(cajonBoton, cajonCuerpo);

root.append(escena, hud.element, bitacoraLista, cajon);

// La arena renderiza con SU tema, no con el del export: más lienzo alrededor
// del mismo ente, que es lo que abre espacio para que un ataque viaje.
const view = new LiveView(lienzo, {}, { theme: arenaTheme });

// --- Capa efímera (ADR 0010 §2) ----------------------------------------------
// Va en un SVG APARTE, encima del canónico y con el mismo viewBox, para que las
// coordenadas de las dos capas signifiquen lo mismo. Separarlas no es prolijidad:
// el SVG canónico se reescribe entero cuando cambia el frame, y mezclarlas
// obligaría a redibujar el ente a 60 fps para mover un proyectil.
//
// Esta capa NO va al replay. Es lo que el jugador vive, no lo que el ente
// aprendió — dos artefactos distintos con dos nombres distintos.
const overlay = document.createElementNS("http://www.w3.org/2000/svg", "svg");
overlay.setAttribute("class", "efimero");
escena.append(overlay);

/**
 * Las dos cajas del combate. Confundirlas ES el bug de la pared invisible:
 * la escena es toda la ventana (dónde se puede trazar), el lienzo es el
 * cuadrado centrado donde vive el ente (el sistema del visualizador).
 */
const cajas = (): { escena: DOMRect; cuadro: DOMRect } => ({
  escena: escena.getBoundingClientRect(),
  cuadro: lienzo.getBoundingClientRect(),
});

/**
 * Ajusta el `viewBox` de la capa efímera para que cubra la ventana ENTERA,
 * manteniendo el cuadro del ente en `[0, size]²` (ADR 0010 §2).
 *
 * Se recalcula al cambiar el tamaño, no por cuadro: es layout, y leerlo a 60 Hz
 * fuerza un reflow por cuadro para un valor que casi nunca cambia.
 */
function sincronizarOverlay(): void {
  const { escena: caja, cuadro } = cajas();
  overlay.setAttribute("viewBox", viewBoxAttr(viewBoxOf(caja, cuadro, arenaTheme.size)));
}

sincronizarOverlay();
new ResizeObserver(sincronizarOverlay).observe(escena);

const CENTER = centerOf(arenaTheme);

/**
 * El reloj del ente. Es la otra mitad del loop: hasta que existió, el arsenal
 * crecía y la vida del jugador no bajaba nunca.
 */
const scheduler = new CounterScheduler();

/**
 * Lo último que se narró de la carrera.
 *
 * El acto y el desenlace se DERIVAN de la sesión, así que no hacen falta acá
 * como estado — estas dos variables no son la verdad de nada, solo recuerdan
 * qué se escribió ya en la bitácora, para no repetirlo sesenta veces por
 * segundo. Si alguna vez hubiera que consultarlas para decidir algo del juego,
 * está mal y la respuesta vive en `session`.
 */
let actoPrevio: Act = 1;
let desenlacePrevio: RunOutcome = "ongoing";

/** Cómo se narra cada final. Nombra la causa: es la lección que el jugador se lleva. */
const DESENLACE: Readonly<Record<Exclude<RunOutcome, "ongoing">, string>> = {
  victory: "◆ LO TUMBASTE. antes de que se adaptara.",
  "defeat-slain": "EL ENTE SE ADAPTÓ A VOS. fin de la corrida.",
  "defeat-exhausted": "SIN FIRMAS VIABLES. te quedaste sin vocabulario y sigue en pie.",
};

/**
 * El planificador razona en **píxeles de pantalla**, no en unidades del SVG.
 *
 * No es un detalle de implementación: el ADR 0009 §4 define la esquiva como
 * "salir de 60 px en ≥ 320 ms", y eso es una cantidad de pantalla y de músculo,
 * no de viewBox. Si el disco viviera en unidades del SVG, esquivar sería más
 * fácil en un monitor grande y más difícil en uno chico — la dificultad
 * dependería del hardware, que es justo lo que el ADR 0004 no acepta.
 *
 * La consecuencia es que el punto fijado del golpe llega en píxeles y hay que
 * convertirlo para dibujarlo. Se convierte acá, en el borde, una sola vez.
 */
function faseParaDibujar(): CounterPhase {
  const fase = scheduler.phase;
  if (fase.kind === "idle") return fase;
  return { ...fase, at: aSvg(fase.at.x, fase.at.y) };
}

/** El radio del disco, en unidades del SVG. Mismo motivo que arriba. */
function radioDeImpactoSvg(): number {
  return COUNTER.strikeRadiusPx * scaleOf(cajas().cuadro, arenaTheme.size);
}
let tracers: readonly Tracer[] = [];
let cursor: { x: number; y: number } | undefined;
/** El cursor en píxeles crudos: es en lo que razona el planificador. */
let cursorPx: { x: number; y: number } | undefined;

/**
 * Píxeles relativos a la escena → unidades del SVG.
 *
 * El origen del sistema es la esquina del CUADRO DEL ENTE, no la de la escena.
 * Por eso hay que restar el desplazamiento entre las dos cajas: sin eso, un
 * ataque lanzado desde el borde izquierdo de un monitor ancho nacería corrido
 * varios cientos de unidades hacia la derecha del lugar donde el jugador
 * apuntó.
 *
 * Fuera del cuadro del ente el resultado es negativo o mayor que `size`, y eso
 * es correcto y deliberado: el viewBox extendido de la capa efímera cubre esa
 * zona.
 */
function aSvg(x: number, y: number): { x: number; y: number } {
  const { escena: caja, cuadro } = cajas();
  return toSvg({ x, y }, caja, cuadro, arenaTheme.size);
}

// --- Botones de ataque -------------------------------------------------------

const botones = PREFABS.map((prefab) => {
  const boton = document.createElement("button");
  boton.title = prefab.note;
  boton.addEventListener("click", () => lanzar(prefab));
  botonera.append(boton);
  return { prefab, boton };
});

const bitacora: string[] = [];

function log(line: string): void {
  bitacora.unshift(line);
  if (bitacora.length > 8) bitacora.pop();
  bitacoraLista.replaceChildren(
    ...bitacora.map((linea) => {
      const item = document.createElement("li");
      item.textContent = linea;
      return item;
    }),
  );
}

/** Un prefab y una build del Builder se lanzan igual: nombre + composición. */
type Lanzable = Pick<Prefab, "name" | "composition">;

function lanzar(lanzable: Lanzable): void {
  try {
    // Por la sesión y no por la sala: es lo que engancha los `CounterReady` al
    // arsenal. Atacando la sala directo, el ente adaptaba y no armaba nada.
    const outcome = session.attack(lanzable.composition, now());
    log(
      `${lanzable.name} — daño ${outcome.damage.toFixed(2)} · ` +
        `eff ${outcome.effApplied.toFixed(3)} · ` +
        `${outcome.exposures}/${outcome.requiredExposures}` +
        (outcome.adapted ? " · ADAPTADO" : ""),
    );
    // El log creció: los frames se recalculan ACÁ, no por cuadro.
    view.sync(room.log);
  } catch (error) {
    if (error instanceof CooldownError) {
      log(`${lanzable.name} — en cooldown, faltan ${((error.readyAt - now()) / 1000).toFixed(1)} s`);
    } else {
      throw error;
    }
  }
}

// --- Combate por cursor ------------------------------------------------------
// El muestreo se engancha a la escena, no al documento: el gesto es un acto
// DENTRO de la arena, y así el jugador puede usar el mouse en el panel y el
// Builder sin que cada clic cuente como un trazo.

const RECHAZO: Record<string, string> = {
  insuficiente: "trazo demasiado corto",
  lento: "trazo recto pero lento — más rápido",
  ambiguo: "no se entendió el trazo",
};

const puntero = attachPointer(escena, now, {
  // El stagger de la interrupción (ADR 0012 §1). Quien decide es el dominio; el
  // muestreador solo pregunta.
  canStart: (t) => session.canDraw(t),
  // Frecuencia alta, costo mínimo: esto NO toca el motor. Solo alimenta la
  // ventana de 32 posiciones del lector de ruido.
  onMove: (x, y, t) => {
    session.observePointer(x, y, t);
    cursor = aSvg(x, y);
    cursorPx = { x, y };
  },
  onStroke: (points, t) => {
    // El corte del log ANTES del intento: lo que entre a partir de acá es este
    // ataque, y es lo que la capa efímera va a materializar como trazador.
    const corte = room.log.events[room.log.events.length - 1]?.seq ?? -1;
    const attempt = session.attemptGesture(points, t);
    if (attempt.kind === "rejected") {
      // Un rechazo NO consume cooldown: el reconocedor no cobra sus errores.
      log(`✕ ${RECHAZO[attempt.reason] ?? attempt.reason}`);
      return;
    }
    if (attempt.kind === "cooldown") {
      // Distinto del rechazo a propósito: son dos fallas con remedios opuestos
      // —esperar contra volver a dibujar— y tienen que leerse distinto.
      log(`⧗ ${attempt.gesture} en cooldown, faltan ${((attempt.readyAt - t) / 1000).toFixed(1)} s`);
      return;
    }
    const { outcome } = attempt;
    log(
      `${attempt.gesture} · ${session.element} — daño ${outcome.damage.toFixed(2)} · ` +
        `${outcome.exposures}/${outcome.requiredExposures}` +
        (outcome.adapted ? " · ADAPTADO" : ""),
    );

    // El ataque nace donde terminó el trazo y sale hacia donde apuntaste. La
    // puntería curva el viaje; el destino es siempre el ente (ADR 0010 §3).
    const fin = points[points.length - 1]!;
    const previo = points[Math.max(0, points.length - 6)]!;
    const dx = fin.x - previo.x;
    const dy = fin.y - previo.y;
    const largo = Math.hypot(dx, dy);
    const origen = aSvg(fin.x, fin.y);
    // Sin desplazamiento (un `hold`) no hay puntería que leer: se apunta al ente.
    const aim =
      largo < 1
        ? {
            x: (CENTER.x - origen.x) / (Math.hypot(CENTER.x - origen.x, CENTER.y - origen.y) || 1),
            y: (CENTER.y - origen.y) / (Math.hypot(CENTER.x - origen.x, CENTER.y - origen.y) || 1),
          }
        : { x: dx / largo, y: dy / largo };

    tracers = [
      ...pruneTracers(tracers, t),
      {
        kind: attempt.gesture,
        origin: origen,
        aim,
        element: session.element,
        eff: outcome.effApplied,
        bornAt: t,
      },
    ];

    // Este ataque ya tiene su viaje dibujado por el trazador de arriba, así que
    // la capa canónica cede ese tramo y se queda solo con el impacto (ADR 0010,
    // enmienda P3). Los prefabs y las builds del Builder NO reclaman nada: no
    // tienen trazador, y ahí el vector canónico sigue siendo el único dueño.
    view.claimEphemeral(room.log, corte);

    view.sync(room.log);
  },
});

// Teclas 1-8: el elemento es un modo que se porta, así que cambiarlo cuesta una
// tecla y no una navegación (ADR 0009 §1).
window.addEventListener("keydown", (event) => {
  const index = Number.parseInt(event.key, 10) - 1;
  const element = ELEMENTS[index];
  if (element === undefined) return;
  session.arm(element);
  log(`elemento armado: ${element}`);
});

// El Builder persiste en el `localStorage` real; los tests le pasan otro almacén.
const builder = new Builder(window.localStorage, {
  onLaunch: (build) => lanzar(build),
  onNotice: (mensaje) => log(mensaje),
});
cajonCuerpo.append(builder.element);

exportarBoton.addEventListener("click", () => {
  downloadText(replayFileName(room), serializeReplay(room));
  log(`replay exportado (${room.log.events.length} eventos)`);
});

// --- Bucle de animación ------------------------------------------------------

function frame(): void {
  const t = now();

  // El ruido se consulta por cuadro pero emite a lo sumo cada 3 s: el
  // rate-limit vive en el `NoiseWatcher`, no acá.
  const ruido = session.pollNoise(t);
  if (ruido !== undefined) {
    log(`el ente percibe agitación (${ruido.exposures}/${ruido.requiredExposures})`);
    view.sync(room.log);
    // Si el ente ya adaptó la agitación, agitarse lo invoca: el ruido tiene
    // disparador propio, fuera de la cadencia (ADR 0009 §4).
    if (cursorPx !== undefined && scheduler.triggerAmbient(t, session.arsenal, cursorPx)) {
      log("el ente responde a tu agitación");
    }
  }

  // El reloj del ente. Devuelve algo solo en el cuadro en que un golpe resuelve.
  // El acto entra como parámetro: escala cadencia y daño sin que el
  // planificador tenga estado propio de la carrera (ADR 0011 §4).
  const golpe = scheduler.poll(t, session.arsenal, cursorPx, cursorPx ?? { x: 0, y: 0 }, session.act);
  if (golpe !== undefined) {
    // Los dos golpes se narran distinto por el mismo motivo por el que se
    // dibujan distinto (ADR 0012 §3): el dirigido dice qué aprendió de vos, la
    // amenaza basal no dice nada porque no aprendió nada. Confundirlos en el log
    // sería decirle al jugador que el ente adaptó algo que no adaptó.
    const nombre =
      golpe.counter === undefined ? "embate del ente" : `contraataque (${golpe.counter.weakness})`;
    if (golpe.hit) {
      session.hurt(golpe.damage);
      log(`✸ ${nombre} — ${golpe.damage.toFixed(0)} HP · quedan ${session.hp}`);
      // La interrupción (ADR 0012 §1): el golpe que te alcanza con un trazo en
      // curso lo rompe. El trazo no se convierte en exposición y no llega al
      // log, y no cobra cooldown — no se le cobra al jugador lo que no atacó.
      if (puntero.drawing()) {
        puntero.abort();
        session.interrupt(t);
        log(`↯ trazo interrumpido — ${(DRAW.staggerMs / 1000).toFixed(1)} s para recuperarte`);
      }
      if (session.defeated) log("EL ENTE SE ADAPTÓ A VOS. fin de la corrida.");
    } else {
      log(`✧ ${nombre} esquivado`);
    }
  }

  // El cruce de acto se narra una sola vez, en el cuadro en que ocurre. Es un
  // MOMENTO, no un dial que sube en silencio: sin esto, la escalada del
  // contraataque se siente arbitraria (enmienda P3 del ADR 0011).
  if (session.act !== actoPrevio) {
    actoPrevio = session.act;
    log(`▲ ACTO ${"I".repeat(actoPrevio)} — el ente aprieta.`);
  }

  // El desenlace se anuncia una sola vez y nombra su causa: "te mataron" y "te
  // quedaste sin vocabulario" son lecciones opuestas.
  if (desenlacePrevio === "ongoing" && session.outcome !== "ongoing") {
    desenlacePrevio = session.outcome;
    log(DESENLACE[session.outcome]);
  }

  view.tick(t);

  // La capa efímera se redibuja por cuadro: es la única parte del render que
  // depende de un reloj, y puede hacerlo justamente porque no va al replay.
  tracers = pruneTracers(tracers, t);
  const ruidoAhora = session.readNoise(t);
  overlay.innerHTML = renderEphemeral(
    {
      tracers,
      cursor,
      erraticity: ruidoAhora.erraticity,
      agitated: ruidoAhora.agitated,
      center: CENTER,
      coreRadius: arenaTheme.coreRadius,
      counter: faseParaDibujar(),
      strikeRadius: radioDeImpactoSvg(),
    },
    t,
  );

  hud.update(hudModelOf(session, t, view.stats.fps));

  for (const { prefab, boton } of botones) {
    const disponible = room.canAttack(prefab.composition, t);
    boton.disabled = !disponible;
    const restante = room.readyAt(prefab.composition) - t;
    boton.textContent = disponible
      ? `${prefab.name} · costo ${costOf(prefab.composition)}`
      : `${prefab.name} · ${(restante / 1000).toFixed(1)}s`;
  }

  estado.textContent =
    `${room.state.clusters.size} clusters · ${room.log.events.length} eventos · ` +
    `cooldown máximo ${(Math.max(...PREFABS.map((p) => cooldownOf(p.composition))) / 1000).toFixed(1)}s`;

  const { fps, lastSyncMs } = view.stats;
  medidor.textContent = `${fps.toFixed(0)} fps · último sync ${lastSyncMs.toFixed(1)} ms`;

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
