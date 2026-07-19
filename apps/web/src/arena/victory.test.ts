// victory.test.ts — la carrera del ADR 0011: HP del ente, actos y las dos derrotas.
//
// Lo que estos tests protegen no es "el HP baja", sino las decisiones que se
// pueden romper sin que nada explote: que el HP no entre al log, que matar al
// ente con la última firma cuente como VICTORIA y no como agotamiento, y que el
// objetivo de calibración se siga cumpliendo si alguien toca el catálogo.

import { describe, expect, it } from "vitest";
import type { Composition } from "@beforeheadapts/arena-dsl";

import { VICTORY } from "./balance.js";
import { CombatSession, type RunOutcome } from "./combat.js";
import { damageFor, intervalFor } from "./counter.js";

/** Golpea hasta agotar el vocabulario, eligiendo con la estrategia dada. */
function jugarSesion(elegir: (s: CombatSession) => Composition | undefined): CombatSession {
  const session = new CombatSession();
  let now = 0;
  for (let golpes = 0; golpes < 3000 && !session.finished; golpes += 1) {
    const composition = elegir(session);
    if (composition === undefined) break;
    now = session.attack(composition, now).readyAt;
  }
  return session;
}

/** Siempre la firma más efectiva disponible: al preferir lo fresco, espacia familias. */
function ordenInteligente(session: CombatSession): Composition | undefined {
  const mejor = [...session.vocabulary.entries].sort(
    (a, b) => b.expectedEffectiveness - a.expectedEffectiveness,
  )[0];
  return mejor !== undefined && mejor.expectedEffectiveness > 0.02 ? mejor.composition : undefined;
}

/** Recorre el vocabulario en orden, quemando parientes consecutivos: regala daño por R6. */
function ordenIngenuo(session: CombatSession): Composition | undefined {
  return session.vocabulary.entries.find((e) => e.expectedEffectiveness > 0.02)?.composition;
}

describe("HP del ente", () => {
  it("arranca lleno y baja con el daño real de cada golpe", () => {
    const session = new CombatSession();
    expect(session.enteHp).toBe(VICTORY.enteMaxHp);

    const outcome = session.attack({ element: "ember", vector: "projectile" }, 0);

    expect(outcome.damage).toBeGreaterThan(0);
    expect(session.enteHp).toBeCloseTo(VICTORY.enteMaxHp - outcome.damage, 6);
  });

  it("NO entra al log: el log es lo que el ente aprendió, no un marcador", () => {
    const session = new CombatSession();
    let now = 0;
    for (let i = 0; i < 3; i += 1) {
      now = session.attack({ element: "frost", vector: "projectile" }, now).readyAt;
    }

    const tipos = [...new Set(session.room.log.events.map((e) => e.type))];
    expect(tipos.some((t) => /hp|damage|health|score/i.test(t))).toBe(false);
    expect(session.enteHp).toBeLessThan(VICTORY.enteMaxHp);
  });

  it("no baja de cero", () => {
    const session = jugarSesion(ordenInteligente);
    expect(session.enteHp).toBeGreaterThanOrEqual(0);
  });
});

describe("actos", () => {
  it("se derivan del HP del ente y solo avanzan", () => {
    // El acto no es estado: es una lectura del HP. Que solo avance es
    // consecuencia de que el HP solo baja.
    const session = new CombatSession();
    expect(session.act).toBe(1);

    let previo = session.act;
    let now = 0;
    for (let i = 0; i < 40 && !session.finished; i += 1) {
      const composition = ordenInteligente(session);
      if (composition === undefined) break;
      now = session.attack(composition, now).readyAt;
      expect(session.act).toBeGreaterThanOrEqual(previo);
      previo = session.act;
    }
    // Con el HP calibrado, una sesión bien jugada cruza al menos un umbral.
    expect(previo).toBeGreaterThan(1);
  });

  it("suben la presión del contraataque sin tocar el motor", () => {
    expect(intervalFor(3, 2)).toBeLessThan(intervalFor(3, 1));
    expect(intervalFor(3, 3)).toBeLessThan(intervalFor(3, 2));
    expect(damageFor(3, 2)).toBeGreaterThan(damageFor(3, 1));
    expect(damageFor(3, 3)).toBeGreaterThan(damageFor(3, 2));
  });

  it("el piso de cadencia sigue siendo duro en el Acto III", () => {
    expect(intervalFor(50, 3)).toBeGreaterThanOrEqual(2500);
  });
});

describe("desenlaces", () => {
  it("arranca en curso", () => {
    const session = new CombatSession();
    expect(session.outcome).toBe("ongoing");
    expect(session.finished).toBe(false);
  });

  it("el jugador sin HP pierde por muerte", () => {
    const session = new CombatSession();
    session.hurt(1000);
    expect(session.outcome).toBe("defeat-slain");
    expect(session.finished).toBe(true);
  });

  it("con la corrida terminada el log se congela", () => {
    const session = new CombatSession();
    session.hurt(1000);
    const largo = session.room.log.events.length;

    expect(session.attemptGesture([], 0).kind).toBe("rejected");
    expect(session.pollNoise(10_000)).toBeUndefined();
    expect(session.room.log.events.length).toBe(largo);
  });
});

describe("objetivo de calibración (ADR 0011 §6)", () => {
  // Esta es la compuerta que hace falsable "el spam pierde, la secuenciación
  // gana". Si alguien toca el catálogo del ADR 0008 o los umbrales y el HP deja
  // de estar entre las dos estrategias, el juego se vuelve invencible o trivial
  // y hay que RE-MEDIR, no ajustar a ojo. El primer valor propuesto de
  // `enteMaxHp` era invencible por un factor de tres y solo se supo midiendo.
  const dañoDe = (session: CombatSession): number => VICTORY.enteMaxHp - session.enteHp;

  it("el orden inteligente extrae más daño que el ingenuo", () => {
    const inteligente = dañoDe(jugarSesion(ordenInteligente));
    const ingenuo = dañoDe(jugarSesion(ordenIngenuo));

    expect(inteligente).toBeGreaterThan(ingenuo);
  });

  it("el orden inteligente gana y el ingenuo pierde por agotamiento", () => {
    const inteligente = jugarSesion(ordenInteligente);
    const ingenuo = jugarSesion(ordenIngenuo);

    const desenlaces: readonly RunOutcome[] = [inteligente.outcome, ingenuo.outcome];
    expect(desenlaces[0]).toBe("victory");
    expect(desenlaces[1]).toBe("defeat-exhausted");
  });

  it("matar al ente gana aunque sea con la última firma viable", () => {
    // El orden de evaluación de `outcome` importa: victoria antes que
    // agotamiento. Invertirlo haría que el golpe que gana la partida la pierda.
    const session = jugarSesion(ordenInteligente);

    expect(session.enteHp).toBe(0);
    expect(session.outcome).toBe("victory");
  });
});
