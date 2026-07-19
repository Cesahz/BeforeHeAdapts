// balance.ts — TODAS las constantes de jugabilidad de la arena, en un solo lugar.
//
// ADR 0009 §7. Esto no es una carpeta de constantes por prolijidad: es un
// requisito de arquitectura. El balance es candidato a fase propia, con una
// suite de ~10.000 sesiones simuladas y una compuerta de regresión del 5 % sobre
// la tasa de victoria (ADR 0009 §6). Para que esa fase sea viable, dos cosas:
//
//   1. El diff de un parche de balance tiene que ser UN archivo. Ningún módulo
//      de la arena lleva números de balance propios: los importa de acá.
//   2. La suite tiene que poder barrer un parámetro sin editar código en varios
//      lados — de ahí que sea un objeto y no constantes sueltas.
//
// El principio que lo ordena (autor, 2026-07-18): **el motor tiene que ser lo
// mejor posible; el balance es solo ajuste de jugabilidad.** Un parche de
// balance JAMÁS modifica `packages/core`. Si alguna vez pareciera que hace
// falta, el problema está mal diagnosticado.
//
// Cada número lleva al lado su rango razonable y qué se siente al moverlo.
// Ninguno está validado todavía: son puntos de partida para la verificación a
// mano del autor, no verdades.

import { COOLDOWN_MS_PER_COST, MODIFIER_COST } from "@beforeheadapts/arena-dsl";

/**
 * Congela un grupo de constantes **y borra sus tipos literales**.
 *
 * `Object.freeze({ maxHp: 100 })` infiere `readonly maxHp: 100`, y un tipo
 * literal en una constante de tuneo es una mentira: le dice al compilador que
 * el valor es parte del contrato cuando el propósito entero de este archivo es
 * que cambie. Con literales, cambiar un número rompe compilación en otro lado
 * — exactamente la fricción que la fase de balance no puede permitirse.
 */
function tuning<T extends Record<string, number>>(values: T): Readonly<Record<keyof T, number>> {
  return Object.freeze(values);
}

/**
 * Re-exportadas, NO mudadas. La economía de costo/cooldown sigue viviendo en
 * `packages/arena-dsl` (ADR 0008 §3), que es su fuente de verdad. Aparecen acá
 * para que exista un solo lugar donde *leer* el balance completo.
 */
export const ECONOMY = tuning({
  cooldownMsPerCost: COOLDOWN_MS_PER_COST,
  modifierCost: MODIFIER_COST,
});

/** Reconocimiento de gestos (ADR 0009 §1). */
export const GESTURE = tuning({
  /**
   * Muestras equidistantes a las que se re-muestrea todo trazo antes de medir
   * ángulos. Es lo que da invariancia a escala y velocidad: al repartir el
   * recorrido por arco, la cadencia del dispositivo deja de importar.
   * Rango sano: 24–48. Más bajo pierde curvatura fina; más alto no aporta.
   */
  resampleCount: 32,

  /** Mínimo de muestras crudas para intentar reconocer. Menos es un clic, no un trazo. */
  minPoints: 6,

  /** Recorrido mínimo (px) para considerar que hubo trazo. Por debajo → `hold` o rechazo. */
  minPathPx: 48,

  /**
   * `hold`: el puntero se mantuvo quieto. Umbral en px absolutos a propósito —
   * "no se movió" no es invariante a escala, es una cantidad de pantalla.
   * Rango sano: 24–64. Muy alto y un trazo corto real se lee como hold.
   */
  holdMaxPathPx: 40,

  /** `hold`: milisegundos mínimos de presión sostenida. Rango sano: 350–700. */
  holdMinMs: 450,

  /**
   * `straight`: rectitud = desplazamiento neto / recorrido. 1 es una recta
   * perfecta. Rango sano: 0,85–0,95. Bajarlo acepta arcos suaves como rectas.
   */
  straightMinRatio: 0.9,

  /**
   * `straight`: velocidad media mínima en px/ms. El catálogo lo llama "trazo
   * recto RÁPIDO" y este es el piso de esa palabra. Rango sano: 0,3–0,8.
   * Un trazo recto pero lento se rechaza con motivo `lento`, no se mapea a otra
   * cosa: el feedback tiene que ser accionable, no misterioso.
   */
  straightMinSpeedPxPerMs: 0.4,

  /**
   * `circle`: giro con SIGNO acumulado, en radianes. Un círculo completo son
   * 2π ≈ 6,28; se pide ~0,8 de vuelta para tolerar cierres imperfectos.
   * Rango sano: 4,4–5,6.
   */
  circleMinNetTurn: 5.0,

  /**
   * `circle`: cierre = distancia(fin, inicio) / recorrido. Un círculo vuelve
   * sobre sí mismo, así que el cociente es chico. Rango sano: 0,15–0,35.
   */
  circleMaxClosure: 0.25,

  /**
   * `circle`: diagonal mínima del bounding box (px) ≈ un radio de 32 px.
   *
   * Se mide la EXTENSIÓN, no el recorrido: un lazo cerrado de 26×19 px es
   * geométricamente un círculo perfecto, pero como gesto es jitter — y el
   * recorrido no lo distingue, porque 40 muestras temblando en una caja de
   * 30 px acumulan cientos de píxeles de camino. La diagonal del bounding box
   * no depende de cuántas muestras entregue el dispositivo, que es justo lo
   * que el ADR 0004 pide. Rango sano: 70–140.
   */
  circleMinExtentPx: 90,

  /**
   * `zigzag`: giro ABSOLUTO acumulado mínimo, en radianes. Alto como el del
   * círculo — la diferencia es el signo, no la cantidad. Rango sano: 3,5–5,0.
   */
  zigzagMinAbsTurn: 4.0,

  /**
   * `circle`: cambios de sentido MÁXIMOS. Un círculo gira siempre para el mismo
   * lado. Rango sano: 0–2.
   *
   * Es el discriminador primario contra el zigzag, y llegó tarde: hasta que el
   * autor lo probó a mano, el círculo no miraba los cambios de sentido, así que
   * una sierra dibujada en arco —que es como sale naturalmente— acumulaba giro
   * suficiente y se clasificaba como círculo. Separarlos por esta medida en vez
   * de endurecer `circleMinNetTurn` es lo que permite arreglar el zigzag sin
   * volver más difícil el círculo, que ya estaba bien calibrado (10/10).
   */
  circleMaxReversals: 1,

  /**
   * `zigzag`: diagonal mínima del bounding box (px). Gemelo de
   * `circleMinExtentPx`. Un zigzag es un gesto GRANDE: recorre pantalla. Sin
   * este piso, jitter en una caja chica acumula giro absoluto y cambios de
   * sentido de sobra y compra el ataque más caro del juego (cost 5) sin que el
   * jugador lo haya dibujado. Rango sano: 150–280.
   */
  zigzagMinExtentPx: 200,

  /**
   * `zigzag`: cambios de sentido de giro mínimos. Evita que una S —que también
   * cancela— cuente como zigzag. Rango sano: 3–5.
   *
   * Junto con `circleMaxReversals` es lo que hace a los dos gestos disjuntos:
   * mientras este valor sea mayor, ningún trazo puede ser ambos. Ya no se
   * acotan por giro neto — un zigzag dibujado en arco tiene giro acumulado alto
   * y sigue siendo un zigzag.
   */
  zigzagMinReversals: 3,

  /** Giro por segmento (rad) por debajo del cual no se cuenta como cambio de sentido. */
  turnDeadzoneRad: 0.25,

  /**
   * Giro (rad) a partir del cual un quiebre se considera **cúspide** y deja de
   * aportar al giro con signo. Rango sano: 2,5–2,9 (π ≈ 3,14).
   *
   * No es un dial de gusto, es geometría: un vaivén de 180° invierte el sentido
   * de la marcha **sin tener handedness** — no gira ni a favor ni en contra del
   * reloj. Como `atan2` obliga a elegir, π se normaliza siempre al mismo signo,
   * y sin esta salvedad N vaivenes acumulaban N·π de giro "con signo": agitar
   * el mouse de ida y vuelta se leía como un círculo perfecto. La cúspide sí
   * suma al giro absoluto y sí cuenta como cambio de sentido, que es lo que
   * realmente es.
   */
  cuspRad: 2.7,
});

/** Ruido ambiental (ADR 0009 §2). */
export const NOISE = tuning({
  /** Muestras de la ventana deslizante. A paso de 16 ms, 32 son ~0,5 s. Rango sano: 24–48. */
  windowSize: 32,

  /**
   * Paso fijo de decimado en ms. FIJO a propósito: los dispositivos muestrean
   * entre 60 y 1000 Hz y el ADR 0004 exige que el determinismo no dependa del
   * hardware. No tocar sin releer ese ADR.
   */
  sampleStepMs: 16,

  /**
   * Erraticidad (giro medio absoluto por segmento, normalizado a [0,1]) a
   * partir de la cual el ente percibe ruido. Rango sano: 0,45–0,7.
   * Bajarlo hace que el ente reaccione al movimiento normal; subirlo lo vuelve
   * sordo salvo a la agitación deliberada.
   */
  threshold: 0.55,

  /**
   * Recorrido mínimo (px) de la ventana para que la erraticidad cuente. Sin
   * esto, un cursor casi quieto produce ángulos basura por jitter sub-píxel y
   * el ente "percibiría" a alguien que no se mueve. Rango sano: 120–320.
   */
  minPathPx: 200,

  /** Milisegundos entre estímulos de ruido. Pico: 20/min. Rango sano: 2000–5000. */
  cooldownMs: 3000,

  /** Intensidad del estímulo de ruido. El mínimo del catálogo: el ruido informa, no lastima. */
  intensity: 1,
});

/** Jugador físico (ADR 0009 §3). */
export const PLAYER = tuning({
  /** Puntos de vida. La derrota es terminal: fin de corrida, log preservado. */
  maxHp: 100,
});

/**
 * La carrera: HP del ente, actos y el umbral del contador honesto (ADR 0011).
 *
 * Ninguno de estos números está validado. El objetivo de calibración de la fase
 * de balance es explícito y falsable (ADR 0011 §6): `enteMaxHp` va **entre** el
 * daño extraíble secuenciando bien (gana ajustado) y el extraíble con orden
 * ingenuo, que quema parientes consecutivos (pierde). Si los dos ganan, está
 * bajo; si los dos pierden, está alto.
 */
export const VICTORY = tuning({
  /**
   * Vida del ente. Bajarla a cero es la única victoria.
   *
   * Calibrada a ojo para una run de 5-15 min (ADR 0011 §2 bis (a)): agotarse en
   * el Acto I de una run de 10 minutos es una lección; en una de 40, un
   * rage-quit. Rango sano: 300–900.
   */
  enteMaxHp: 500,

  /**
   * Efectividad esperada por debajo de la cual una firma deja de contar como
   * viable y pasa a "debilitada".
   *
   * Es el dial de la enmienda P2 y el más delicado del archivo: no sale de
   * ninguna propiedad del motor y gobierna lo que el jugador **cree** que le
   * queda. Muy alto y el titular se desploma de golpe; muy bajo y no se mueve
   * nunca, que es la versión optimista que la revisión rechazó. Rango sano:
   * 0,15–0,4.
   */
  viableThreshold: 0.25,

  /** Efectividad por debajo de la cual una firma se muestra como "casi inútil". */
  spentThreshold: 0.08,

  /** Fracción de HP del ente donde empieza el Acto II. Rango sano: 0,6–0,75. */
  actTwoAt: 0.66,

  /** Fracción de HP del ente donde empieza el Acto III. Rango sano: 0,25–0,4. */
  actThreeAt: 0.33,

  /** Multiplicador de cadencia del contraataque en el Acto II (menor = más seguido). */
  actTwoIntervalScale: 0.75,

  /** Multiplicador de cadencia del contraataque en el Acto III. */
  actThreeIntervalScale: 0.55,

  /** Multiplicador de daño del contraataque en el Acto II. */
  actTwoDamageScale: 1.25,

  /** Multiplicador de daño del contraataque en el Acto III. */
  actThreeDamageScale: 1.6,
});

/** Contraataque materializado (ADR 0009 §4). */
export const COUNTER = tuning({
  /** Cadencia base en ms con UN cluster adaptado. Rango sano: 7000–12000. */
  baseIntervalMs: 9000,

  /** Piso de cadencia: por rápido que adapte, nunca golpea más seguido que esto. */
  minIntervalMs: 2500,

  /**
   * Cuánto acelera la cadencia por cluster adaptado extra:
   * `interval = base / (1 + accel × (|arsenal| − 1))`.
   * Rango sano: 0,2–0,5. Es el dial de "cuánto se siente que el ente aprendió".
   */
  intervalAccel: 0.35,

  /** Daño base en HP del primer contraataque. Rango sano: 6–12. */
  baseDamage: 8,

  /** HP extra por cluster adaptado adicional. Rango sano: 2–5. */
  damagePerCluster: 3,

  /** Aviso previo en ms con un solo cluster. Es la ventana para esquivar. Rango sano: 550–900. */
  baseTelegraphMs: 700,

  /** Piso del aviso previo. Por debajo de ~300 ms deja de ser esquivable con atención. */
  minTelegraphMs: 320,

  /** Ms que se recorta el aviso por cluster adaptado adicional. Rango sano: 30–60. */
  telegraphShrinkMs: 40,

  /** Duración de la resolución del golpe en ms. */
  strikeMs: 150,

  /**
   * Radio (px) del disco de impacto alrededor del punto fijado al empezar el
   * telegraph. Salir de 60 px en ≥ 320 ms es trivial SI estás mirando: el
   * contraataque compite por foco, no por destreza. Rango sano: 45–80.
   */
  strikeRadiusPx: 60,

  /**
   * Rate-limit propio del contraataque de ruido, en ms (ADR 0009 §4).
   *
   * Independiente de la cadencia: una vez que el ente adaptó `elem:ambient`,
   * agitarse lo invoca fuera de turno. Sin este piso, un jugador nervioso
   * recibiría un golpe por cuadro. Rango sano: 2500–5000.
   */
  ambientCooldownMs: 3000,
});

/** Capa efímera del render: lo que se ve en vivo y no va al replay (ADR 0010 §2). */
export const EPHEMERAL = tuning({
  /**
   * Cuánto vive un trazador de ataque, en ms. Es el viaje del cursor al ente.
   * Rango sano: 260–600. Muy corto no se lee; muy largo se acumulan y ensucian.
   */
  tracerMs: 420,

  /**
   * Cuánto se aparta la curva hacia donde apuntaste, como fracción de la
   * distancia al ente. 0 sería una recta al ente (la puntería no se vería);
   * 1 sale casi perpendicular. Rango sano: 0,3–0,8.
   *
   * ⚠️ Esto curva el VIAJE, nunca el destino: todo ataque reconocido resuelve
   * sobre el ente (ADR 0010 §3). Un ataque que se viera fallar mientras el
   * motor aplica el daño sería el render mintiendo sobre la mecánica.
   */
  aimCurve: 0.55,

  /**
   * Cuánto penetra el ataque en el ente a `eff = 1`, como fracción del radio.
   * Con `eff` cerca del piso apenas roza la superficie: es el feedback de R5
   * que el §4 del diseño pide desde la Fase 3a. Rango sano: 0,3–0,9.
   */
  maxPenetration: 0.6,

  /** Radio del retículo del cursor, en unidades del SVG. */
  reticlePx: 9,

  /** Trazadores simultáneos como máximo. Tope duro contra la acumulación. */
  maxTracers: 12,
});
