// Tests del modelo del HUD (ADR 0009 §§1-4).
//
// Se testea `hudModelOf`, no la clase `Hud`: el modelo es puro y decide QUÉ se
// muestra; la clase solo pinta. Ese corte es lo que permite verificar que la
// barra de vida y los cooldowns digan la verdad sin montar un DOM.
//
// Lo que el HUD muestra son afirmaciones sobre el motor y sobre la sesión, así
// que son falsables — el mismo criterio que ya se le aplica a las notas de los
// prefabs.

import { describe, expect, it } from "vitest";

import { ELEMENTS, cooldownOf } from "@beforeheadapts/arena-dsl";

import { PLAYER } from "../arena/balance.js";
import { CombatSession } from "../arena/combat.js";
import { AMBIENT_ELEMENT } from "../arena/ambient.js";
import { compositionFor, type GesturePoint } from "../gesture/recognize.js";
import { GESTURES, hudModelOf } from "./hud.js";

function trazoRecto(t0: number): readonly GesturePoint[] {
  return Array.from({ length: 24 }, (_, i) => {
    const r = i / 23;
    return { x: r * 400, y: 0, t: t0 + r * 400 };
  });
}

describe("modelo del HUD", () => {
  it("arranca con la vida llena y sin nada aprendido", () => {
    const model = hudModelOf(new CombatSession(), 0);
    expect(model.hp).toBe(PLAYER.maxHp);
    expect(model.hpFraction).toBe(1);
    expect(model.defeated).toBe(false);
    expect(model.arsenal).toBe(0);
    expect(model.lastGesture).toBeUndefined();
  });

  it("muestra los 8 elementos jugables y nunca `ambient`", () => {
    // El ruido no es un ataque: si `ambient` apareciera en el selector, el
    // jugador podría lanzarlo y el canal perdería su significado.
    const model = hudModelOf(new CombatSession(), 0);
    expect(model.elements).toEqual(ELEMENTS);
    expect(model.elements as readonly string[]).not.toContain(AMBIENT_ELEMENT);
  });

  it("muestra los cuatro gestos, disponibles al empezar", () => {
    const model = hudModelOf(new CombatSession(), 0);
    expect(model.gestures.map((g) => g.gesture)).toEqual(GESTURES);
    expect(model.gestures.every((g) => g.ready)).toBe(true);
    expect(model.gestures.every((g) => g.progress === 1)).toBe(true);
  });

  it("el cooldown avanza de 0 a 1 y el gesto vuelve a estar listo", () => {
    const session = new CombatSession();
    session.attemptGesture(trazoRecto(0), 0);
    const total = cooldownOf(compositionFor("straight", session.element));

    const recien = hudModelOf(session, 0).gestures.find((g) => g.gesture === "straight")!;
    expect(recien.ready).toBe(false);
    expect(recien.progress).toBeCloseTo(0, 3);
    expect(recien.remainingSeconds).toBeCloseTo(total / 1000, 1);

    const mitad = hudModelOf(session, total / 2).gestures.find((g) => g.gesture === "straight")!;
    expect(mitad.progress).toBeCloseTo(0.5, 3);

    const listo = hudModelOf(session, total).gestures.find((g) => g.gesture === "straight")!;
    expect(listo.ready).toBe(true);
    expect(listo.progress).toBe(1);
    expect(listo.remainingSeconds).toBe(0);
  });

  it("el cooldown mostrado es el del elemento ARMADO, no el del gesto solo", () => {
    // `elem:ember|vec:projectile` y `elem:frost|vec:projectile` son clusters
    // distintos. Si el HUD mostrara el cooldown del gesto sin el elemento,
    // mentiría en cuanto el jugador rota elementos — que es media estrategia.
    const session = new CombatSession();
    session.attemptGesture(trazoRecto(0), 0);
    expect(hudModelOf(session, 100).gestures.find((g) => g.gesture === "straight")!.ready).toBe(
      false,
    );
    session.arm("frost");
    expect(hudModelOf(session, 100).gestures.find((g) => g.gesture === "straight")!.ready).toBe(
      true,
    );
  });

  it("el último gesto se muestra en español", () => {
    const session = new CombatSession();
    session.attemptGesture(trazoRecto(0), 0);
    expect(hudModelOf(session, 0).lastGesture).toBe("recto");
  });

  it("la vida baja y la derrota se refleja", () => {
    const session = new CombatSession();
    session.hurt(PLAYER.maxHp / 2);
    const medio = hudModelOf(session, 0);
    expect(medio.hpFraction).toBeCloseTo(0.5, 6);
    expect(medio.defeated).toBe(false);

    session.hurt(PLAYER.maxHp);
    const muerto = hudModelOf(session, 0);
    expect(muerto.hp).toBe(0);
    expect(muerto.hpFraction).toBe(0);
    expect(muerto.defeated).toBe(true);
  });

  it("el arsenal cuenta los contraataques armados", () => {
    const session = new CombatSession();
    const espera = cooldownOf(compositionFor("straight", session.element));
    session.attemptGesture(trazoRecto(0), 0);
    session.attemptGesture(trazoRecto(espera), espera);
    expect(hudModelOf(session, espera).arsenal).toBe(1);
  });

  it("la agitación se refleja antes de que haya emisión", () => {
    const session = new CombatSession();
    for (let t = 0; t <= 2000; t += 8) {
      const fase = Math.floor(t / 8) % 3;
      session.observePointer(200 + fase * 120, 300 + (fase === 1 ? 90 : 0), t);
    }
    const model = hudModelOf(session, 2000);
    expect(model.erraticity).toBeGreaterThan(0);
    expect(model.agitated).toBe(true);
  });
});

describe("la derrota congela la corrida", () => {
  it("con la corrida terminada ningún gesto entra al log", () => {
    const session = new CombatSession();
    session.hurt(PLAYER.maxHp);
    const antes = session.room.log.events.length;
    expect(session.attemptGesture(trazoRecto(0), 0).kind).toBe("rejected");
    expect(session.room.log.events.length).toBe(antes);
  });

  it("con la corrida terminada el ruido tampoco entra", () => {
    // Si no, el replay exportado incluiría el movimiento del cursor de alguien
    // mirando la pantalla de derrota, y dejaría de ser exactamente la corrida.
    const session = new CombatSession();
    session.hurt(PLAYER.maxHp);
    for (let t = 0; t <= 30_000; t += 8) {
      const fase = Math.floor(t / 8) % 3;
      session.observePointer(200 + fase * 120, 300 + (fase === 1 ? 90 : 0), t);
      session.pollNoise(t);
    }
    expect(session.room.log.events).toHaveLength(0);
  });

  it("la vida nunca baja de 0", () => {
    const session = new CombatSession();
    session.hurt(PLAYER.maxHp * 10);
    expect(session.hp).toBe(0);
  });
});

describe("la carrera en el HUD (ADR 0011)", () => {
  it("el contador de firmas está en pantalla desde el primer cuadro", () => {
    // Requisito (b) del ADR 0011 §2 bis: revelar el recurso a mitad de corrida
    // es lo que haría sentir injusta la derrota por agotamiento. Tiene que
    // estar antes del primer golpe, no aparecer cuando ya es tarde.
    const model = hudModelOf(new CombatSession(), 0);

    expect(model.viable).toBeGreaterThan(0);
    expect(model.weakened).toBe(0);
    expect(model.act).toBe(1);
    expect(model.outcome).toBe("ongoing");
  });

  it("la vida del ente arranca llena y baja al golpearlo", () => {
    const session = new CombatSession();
    expect(hudModelOf(session, 0).enteHpFraction).toBe(1);

    session.attack({ element: "ember", vector: "projectile" }, 0);

    const model = hudModelOf(session, 0);
    expect(model.enteHpFraction).toBeLessThan(1);
    expect(model.enteHp).toBe(session.enteHp);
  });

  it("el titular baja y las debilitadas suben cuando el ente adapta", () => {
    const session = new CombatSession();
    const antes = hudModelOf(session, 0);

    let now = 0;
    for (let i = 0; i < 6; i += 1) {
      now = session.attack({ element: "frost", vector: "projectile" }, now).readyAt;
    }
    const despues = hudModelOf(session, now);

    expect(despues.viable).toBeLessThan(antes.viable);
    expect(despues.weakened).toBeGreaterThan(0);
    // El total no cambia: las firmas no desaparecen, se debilitan.
    expect(despues.viable + despues.weakened).toBe(antes.viable + antes.weakened);
  });

  it("distingue las dos derrotas, porque son lecciones opuestas", () => {
    const muerto = new CombatSession();
    muerto.hurt(PLAYER.maxHp);
    expect(hudModelOf(muerto, 0).outcome).toBe("defeat-slain");
  });
});
