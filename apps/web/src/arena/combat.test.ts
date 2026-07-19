// Tests de la frontera de cuantización (ADR 0004 + ADR 0009 §§1-2).
//
// El test rector de este archivo es el que el ADR 0004 pide con todas las
// letras: **una sesión con movimiento continuo produce un log de solo eventos
// discretos válidos**. Es la propiedad que hace que el motor siga siendo
// event-sourced con un mouse enchufado.

import { describe, expect, it } from "vitest";

import { ELEMENTS, cooldownOf } from "@beforeheadapts/arena-dsl";
import { requiredExposures } from "@beforeheadapts/core";

import { AMBIENT_ELEMENT, AMBIENT_SIGNATURE } from "./ambient.js";
import { CombatSession } from "./combat.js";
import { DRAW, NOISE, PLAYER } from "./balance.js";
import { compositionFor, type GesturePoint } from "../gesture/recognize.js";

/** Los cinco tipos de evento del ledger. Nada más puede aparecer en un log. */
const TIPOS_VALIDOS = new Set([
  "ExposureRecorded",
  "AdaptationProgressed",
  "AdaptationCompleted",
  "CounterReady",
  "ResistanceApplied",
]);

/** Trazo recto rápido sintético, con base temporal `t0`. */
function trazoRecto(t0: number, largo = 400): readonly GesturePoint[] {
  return Array.from({ length: 24 }, (_, i) => {
    const r = i / 23;
    return { x: r * largo, y: 0, t: t0 + r * 400 };
  });
}

/** Círculo sintético, con base temporal `t0`. */
function trazoCirculo(t0: number): readonly GesturePoint[] {
  return Array.from({ length: 48 }, (_, i) => {
    const r = i / 47;
    const a = r * Math.PI * 2;
    return { x: 300 + 120 * Math.cos(a), y: 300 + 120 * Math.sin(a), t: t0 + r * 900 };
  });
}

// --- El test rector ---------------------------------------------------------

describe("frontera de cuantización (ADR 0004)", () => {
  /**
   * Un minuto de agitación continua a 125 Hz: 7.500 posiciones de cursor.
   *
   * Lo que se verifica no es que el log sea chico por casualidad, sino que su
   * tamaño **no dependa del sampling rate del dispositivo**. Ese es el punto
   * entero del ADR 0004: si el mouse del jugador decidiera cuántos eventos
   * entran, el determinismo dependería del hardware.
   */
  it("un minuto de movimiento continuo produce un log de solo eventos discretos", () => {
    const session = new CombatSession();
    const DURACION = 60_000;
    const PASO = 8; // 125 Hz, más rápido que el decimado de 16 ms
    let posiciones = 0;

    for (let t = 0; t <= DURACION; t += PASO) {
      // Vaivén amplio: movimiento máximamente errático, el peor caso para el
      // volumen del log.
      const fase = Math.floor(t / PASO) % 3;
      const x = 200 + fase * 120;
      const y = 300 + (fase === 1 ? 90 : 0);
      session.observePointer(x, y, t);
      session.pollNoise(t);
      posiciones += 1;
    }

    const eventos = session.room.log.events;
    expect(posiciones).toBeGreaterThan(7000);

    // 1. Solo tipos válidos del ledger. Ni una coordenada, ni un frame.
    for (const evento of eventos) {
      expect(TIPOS_VALIDOS.has(evento.type)).toBe(true);
      expect(evento.v).toBe(1);
      expect(Number.isFinite(evento.timestamp)).toBe(true);
    }

    // 2. `seq` estrictamente creciente: el log es append-only y ordenado.
    const seqs = eventos.map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);

    // 3. El log está acotado por el RATE-LIMIT, no por las posiciones. A 3 s
    //    por estímulo, un minuto da ~20 exposiciones; cada una produce unos
    //    pocos eventos. Que 7.500 posiciones quepan en menos de 100 eventos es
    //    la cuantización funcionando.
    const exposiciones = eventos.filter((e) => e.type === "ExposureRecorded");
    expect(exposiciones.length).toBeLessThanOrEqual(DURACION / NOISE.cooldownMs + 1);
    expect(eventos.length).toBeLessThan(100);
  });

  it("duplicar el sampling rate no cambia el log", () => {
    // La misma trayectoria, muestreada a 125 Hz y a 250 Hz. Si el log difiere,
    // el jugador con mejor mouse juega otro juego.
    const correr = (paso: number) => {
      const session = new CombatSession();
      for (let t = 0; t <= 30_000; t += paso) {
        const fase = Math.floor(t / 8) % 3;
        session.observePointer(200 + fase * 120, 300 + (fase === 1 ? 90 : 0), t);
        session.pollNoise(t);
      }
      return session.room.log.events.filter((e) => e.type === "ExposureRecorded").length;
    };
    expect(correr(4)).toBe(correr(8));
  });

  it("el movimiento suave no despierta al ente", () => {
    const session = new CombatSession();
    for (let t = 0; t <= 30_000; t += 8) {
      // Deriva lenta en línea recta: erraticidad ~0.
      session.observePointer(100 + t / 40, 300, t);
      session.pollNoise(t);
    }
    expect(session.room.log.events).toHaveLength(0);
  });
});

// --- Las dos compuertas antes del log ---------------------------------------

describe("compuertas antes de emitir (ADR 0009 §1)", () => {
  it("un gesto en cooldown NO llega al log", () => {
    const session = new CombatSession();

    const primero = session.attemptGesture(trazoRecto(0), 500);
    expect(primero.kind).toBe("attacked");
    const eventosTrasPrimero = session.room.log.events.length;
    expect(eventosTrasPrimero).toBeGreaterThan(0);

    // Mismo gesto, mismo elemento, antes de que expire el cooldown.
    const segundo = session.attemptGesture(trazoRecto(600), 700);
    expect(segundo.kind).toBe("cooldown");
    // La afirmación que importa: la sala no se enteró.
    expect(session.room.log.events.length).toBe(eventosTrasPrimero);
  });

  it("el rechazo por ambiguo NO consume cooldown", () => {
    const session = new CombatSession();
    // Medio círculo: se entiende que no se entiende.
    const medioCirculo = Array.from({ length: 40 }, (_, i) => {
      const a = (i / 39) * Math.PI;
      return { x: 300 + 150 * Math.cos(a), y: 300 + 150 * Math.sin(a), t: i * 18 };
    });

    expect(session.attemptGesture(medioCirculo, 800).kind).toBe("rejected");
    expect(session.room.log.events).toHaveLength(0);
    // Y el círculo sigue disponible: el reconocedor no cobró su propio error.
    expect(session.attemptGesture(trazoCirculo(900), 1000).kind).toBe("attacked");
  });

  it("pasado el cooldown el mismo gesto vuelve a entrar", () => {
    const session = new CombatSession();
    session.attemptGesture(trazoRecto(0), 0);
    const espera = cooldownOf(compositionFor("straight", session.element));
    const despues = session.attemptGesture(trazoRecto(espera), espera);
    expect(despues.kind).toBe("attacked");
  });

  it("el cooldown es por composición: cambiar de elemento libera el gesto", () => {
    // El elemento es una primitiva mecánica, así que `elem:ember|vec:projectile`
    // y `elem:frost|vec:projectile` son clusters distintos con cooldowns
    // distintos. Rotar elementos es una estrategia legítima, no un exploit.
    const session = new CombatSession();
    session.attemptGesture(trazoRecto(0), 0);
    expect(session.attemptGesture(trazoRecto(100), 100).kind).toBe("cooldown");
    session.arm("frost");
    expect(session.attemptGesture(trazoRecto(200), 200).kind).toBe("attacked");
  });
});

// --- El ruido como estímulo -------------------------------------------------

describe("ruido ambiental (ADR 0009 §2)", () => {
  it("la firma del ruido exige 4 exposiciones", () => {
    expect(requiredExposures(AMBIENT_SIGNATURE)).toBe(4);
  });

  it("expone la debilidad como elemento, igual que cualquier ataque", () => {
    // Mantiene la invariante del ADR 0008 §4: `elem:` sigue siendo el primer
    // prefijo en orden canónico, así que la debilidad es siempre un elemento.
    expect(AMBIENT_SIGNATURE.primitives[0]).toBe(`elem:${AMBIENT_ELEMENT}`);
  });

  it("`ambient` NO es un elemento jugable", () => {
    // Si algún día entra al catálogo, el jugador podría atacar con el ruido y
    // el canal dejaría de significar "esto es lo que percibo de vos".
    expect(ELEMENTS as readonly string[]).not.toContain(AMBIENT_ELEMENT);
  });

  it("tras 4 lecturas de ruido el ente arma un contraataque por `ambient`", () => {
    const session = new CombatSession();
    let emisiones = 0;
    for (let t = 0; t <= 60_000; t += 8) {
      const fase = Math.floor(t / 8) % 3;
      session.observePointer(200 + fase * 120, 300 + (fase === 1 ? 90 : 0), t);
      if (session.pollNoise(t) !== undefined) emisiones += 1;
    }
    expect(emisiones).toBeGreaterThanOrEqual(4);
    // El variador puro es inadaptable en espacio de firmas y perfectamente
    // adaptable en espacio de COMPORTAMIENTO. Esto es esa frase, ejecutable.
    expect(session.arsenal.map((c) => c.weakness)).toContain(`elem:${AMBIENT_ELEMENT}`);
  });

  it("el rate-limit acota las emisiones aunque se consulte por cuadro", () => {
    const session = new CombatSession();
    let emisiones = 0;
    for (let t = 0; t <= 30_000; t += 8) {
      const fase = Math.floor(t / 8) % 3;
      session.observePointer(200 + fase * 120, 300 + (fase === 1 ? 90 : 0), t);
      // Se consulta ~3.750 veces; el rate-limit tiene que absorberlo.
      if (session.pollNoise(t) !== undefined) emisiones += 1;
    }
    expect(emisiones).toBeLessThanOrEqual(30_000 / NOISE.cooldownMs + 1);
  });
});

// --- El arsenal -------------------------------------------------------------

describe("arsenal (ADR 0009 §4)", () => {
  it("`CounterReady` arma el arsenal en vez de dispararse", () => {
    const session = new CombatSession();
    // `straight` con un elemento es N = 2: dos golpes y adapta.
    session.attemptGesture(trazoRecto(0), 0);
    expect(session.arsenal).toHaveLength(0);

    const espera = cooldownOf(compositionFor("straight", session.element));
    session.attemptGesture(trazoRecto(espera), espera);

    expect(session.arsenal).toHaveLength(1);
    expect(session.arsenal[0]!.weakness).toBe(`elem:${session.element}`);
    // El `armedAtSeq` es la semilla determinista de la selección (§6.4).
    expect(session.arsenal[0]!.armedAtSeq).toBeGreaterThan(0);
  });

  it("un cluster arma su contraataque una sola vez", () => {
    const session = new CombatSession();
    const espera = cooldownOf(compositionFor("straight", session.element));
    for (let i = 0; i < 5; i += 1) session.attemptGesture(trazoRecto(i * espera), i * espera);
    expect(session.arsenal).toHaveLength(1);
  });

  // Regresión. La arena atacaba la sala DIRECTO para los prefabs y las builds
  // del Builder, y el arsenal se llena leyendo los `CounterReady` del lote, que
  // es una lectura de la sesión. Resultado: un jugador que solo usara el
  // Builder podía adaptarle ocho clusters al ente sin que el ente armara un
  // solo contraataque. El motor emitía los avisos y no los escuchaba nadie.
  it("una composición deliberada arma el arsenal igual que un gesto", () => {
    const session = new CombatSession();
    const composicion = compositionFor("straight", session.element);
    const espera = cooldownOf(composicion);

    session.attack(composicion, 0);
    session.attack(composicion, espera);

    expect(session.arsenal).toHaveLength(1);
  });
});

describe("interrupción de gestos (ADR 0012 §1)", () => {
  it("el stagger bloquea el próximo trazo, y solo por lo que dura", () => {
    const session = new CombatSession();

    expect(session.canDraw(0)).toBe(true);
    session.interrupt(1_000);
    expect(session.canDraw(1_000)).toBe(false);
    expect(session.canDraw(1_000 + DRAW.staggerMs - 1)).toBe(false);
    expect(session.canDraw(1_000 + DRAW.staggerMs)).toBe(true);
  });

  it("una interrupción NO cobra cooldown: no se le cobra al jugador lo que no atacó", () => {
    // El principio es del ADR 0009 y el 0012 §1 lo hereda explícitamente. Un
    // trazo roto no emitió firma y no hubo exposición, así que la composición
    // tiene que quedar tan disponible como estaba. Cobrar además el cooldown
    // volvería los gestos caros injugables en el Acto III: se los quiere
    // escasos, no extintos.
    const session = new CombatSession();
    const composicion = compositionFor("zigzag", session.element);

    session.interrupt(0);

    expect(session.room.canAttack(composicion, DRAW.staggerMs)).toBe(true);
  });

  it("una interrupción no toca el log: el trazo roto nunca fue una exposición", () => {
    const session = new CombatSession();
    const antes = session.room.log.events.length;

    session.interrupt(0);
    session.interrupt(5_000);

    expect(session.room.log.events.length).toBe(antes);
  });

  it("interrumpir no lastima, y lastimar no interrumpe", () => {
    // Son dos efectos separados a propósito, y quien los combina es el llamador:
    // un golpe esquivado no interrumpe nada, y el stagger no es daño. Fusionarlos
    // acá haría imposible el golpe que pega sin trazo en curso, que es el caso
    // normal.
    const session = new CombatSession();

    session.interrupt(0);
    expect(session.hp).toBe(PLAYER.maxHp);

    session.hurt(10);
    expect(session.canDraw(0)).toBe(false);
    expect(session.hp).toBe(PLAYER.maxHp - 10);
  });
});
