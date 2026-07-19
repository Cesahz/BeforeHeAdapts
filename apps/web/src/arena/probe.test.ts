// probe.test.ts — la sonda: primero el diagnóstico, ahora la compuerta.
//
// Estos tests nacieron protegiendo un DIAGNÓSTICO: hechos medidos sobre la
// carrera del ADR 0011 que nadie había medido, y que el ADR 0012 cita en vez de
// intuir. Ese ADR fijó además cinco objetivos de calibración explícitos y
// falsables (§4), con la orden de calibrar cada dial CONTRA LA SONDA, nunca a
// ojo. A medida que los diales se implementan, cada hallazgo se da vuelta y pasa
// a ser su objetivo — el número medido queda documentado al lado.
//
// Un objetivo que todavía no se cumple se deja escrito y ROJO al revés: se
// asienta lo que hoy mide la sonda y se nombra el dial que falta. No se afloja
// un objetivo del ADR para que la suite quede verde.

import { describe, expect, it } from "vitest";

import { PLAYER } from "./balance.js";
import { probe } from "./probe.js";

const inteligente = { order: "inteligente", policy: "calculador" } as const;

describe("dial 3 del ADR 0012: la amenaza basal contra el arranque en frío", () => {
  it("objetivo 1 — el daño en frío baja del 35 %", () => {
    // ERA 0,80: el 80 % del daño que decidía la carrera se infligía antes del
    // primer contraataque, porque el arsenal del ente arranca vacío y su reloj
    // no corría hasta la primera `AdaptationCompleted`. La presión llegaba
    // cuando la partida ya estaba jugada, y ningún dial de densidad tardía
    // arreglaba eso. Con la amenaza basal andando: 0,23.
    //
    // Es la métrica que valida si la presión temprana funcionó. Si vuelve a
    // subir, la carrera se resuelve sola otra vez.
    const r = probe({ ...inteligente, interruption: false });

    expect(r.coldDamageFraction).toBeLessThan(0.35);
  });

  it("la amenaza aparece en el primer cuarto de la corrida, no pasada la mitad", () => {
    // ERA 0,70. El ente ya no espera a aprender algo para existir: la basal
    // tiene reloj propio desde el segundo cero. Hoy: 0,15.
    const r = probe({ ...inteligente, interruption: false });

    expect(r.firstShotMs).not.toBeNull();
    expect(r.firstShotMs! / r.elapsedMs).toBeLessThan(0.25);
  });

  it("el golpe del ente deja de ser anecdótico", () => {
    // ERAN 5 a 7 disparos contra ~62 ataques del jugador. Hoy: 15, de los cuales
    // 10 son basales — o sea que la mayor parte de la presión existe justamente
    // donde antes no había ninguna.
    //
    // ⚠️ Esto NO es todavía el objetivo de "recurrente" del ADR 0012 §2: ese es
    // el dial de densidad, que se re-calibra después y contra esta misma sonda.
    const r = probe({ ...inteligente, interruption: false });

    expect(r.shots).toBeGreaterThan(10);
    expect(r.basalShots).toBeGreaterThan(0);
    expect(r.attacks).toBeGreaterThan(50);
  });

  it("los contraataques DIRIGIDOS siguen siendo la recompensa de adaptar", () => {
    // La tesis, custodiada donde puede romperse sin que se note: si la basal se
    // comiera toda la presión, adaptar dejaría de tener consecuencia visible y
    // el ente pasaría a ser ruido con reloj. Tiene que haber golpes dirigidos, y
    // tienen que ser una porción real del total.
    const r = probe({ ...inteligente, interruption: false });

    expect(r.shots - r.basalShots).toBeGreaterThan(0);
    expect(r.basalShots / r.shots).toBeLessThan(0.85);
  });

  it("objetivo 4 — la compuerta del ADR 0011 sigue en pie", () => {
    // El límite duro del ADR 0012: la presión no puede volver invencible al
    // ente. Si esto se rompiera, el dial está mal, no la compuerta — y NO se
    // arregla moviendo `enteMaxHp`, que está medido y congelado.
    expect(probe({ ...inteligente, interruption: false }).outcome).toBe("victory");
    expect(probe({ order: "ingenuo", policy: "calculador", interruption: false }).outcome).toBe(
      "defeat-exhausted",
    );
  });
});

describe("lo que la amenaza basal NO alcanza a arreglar sola", () => {
  it("objetivo 2 — la inversión perversa quedó al borde, pero no desapareció", () => {
    // ERA 0,80 contra 0,34: jugar bien no era sobrevivir a la presión, era
    // ESQUIVARLA cerrando la carrera antes de que el ente despertara. Cuanto
    // mejor jugabas, menos juego había.
    //
    // Con la basal la brecha se derrumbó de +0,46 a +0,02 (0,23 vs 0,21), que es
    // casi todo el camino. Pero el objetivo del ADR es que la fracción del
    // competente **deje de ser mayor**, y todavía lo es por un pelo. Se asienta
    // el estado real: la brecha colapsó, el signo no se dio vuelta.
    const competente = probe({ ...inteligente, interruption: false });
    const ingenuo = probe({ order: "ingenuo", policy: "calculador", interruption: false });

    const brecha = competente.coldDamageFraction - ingenuo.coldDamageFraction;
    expect(brecha).toBeLessThan(0.05);
    // ⚠️ Todavía positiva. Se da vuelta con los diales 1 y 2 (interrupción y
    // densidad), que son los que castigan al que pelea más tiempo bajo amenaza.
    expect(brecha).toBeGreaterThan(0);
  });

  it("objetivo 3 — el jugador competente TODAVÍA gana intacto", () => {
    // El objetivo del ADR es que ganar sin recibir un solo golpe deje de ser el
    // resultado por defecto. La amenaza basal sola no lo consigue, y era
    // previsible: la basal es esquivable con atención, igual que el dirigido, y
    // este jugador simulado tiene atención perfecta.
    //
    // Lo que falta es exactamente el dial 1: sin interrupción de gestos, dibujar
    // y esquivar siguen siendo actividades independientes que nunca compiten.
    // Este test es el recordatorio de que el ADR 0012 no está terminado.
    const r = probe({ ...inteligente, interruption: false });

    expect(r.outcome).toBe("victory");
    expect(r.hitsTaken).toBe(0);
    expect(r.playerHp).toBe(PLAYER.maxHp);
  });
});

describe("la interrupción crea decisiones, pero no alcanza sola", () => {
  it("obliga a abandonar trazos: la decisión que hoy no existe", () => {
    // La mecánica SÍ funciona en dirección. Un jugador que hoy dibuja lo que
    // quiere, cuando quiere, ahora tiene que resignar trazos.
    const r = probe({ ...inteligente, interruption: true });

    expect(r.abandoned).toBeGreaterThan(0);
  });

  it("pero el jugador competente sigue ganando intacto", () => {
    // El hallazgo que corrige la magnitud esperada del ADR 0012. Abandonar sale
    // casi gratis: con el ente disparando siete veces, resignar seis trazos no
    // pone en riesgo nada. La mecánica es NECESARIA y NO SUFICIENTE.
    const r = probe({ ...inteligente, interruption: true });

    expect(r.outcome).toBe("victory");
    expect(r.playerHp).toBe(PLAYER.maxHp);
  });

  it("castiga de verdad al que ignora el aviso", () => {
    // El único perfil al que la mecánica ya le cambia la vida es el que no mira.
    // Es la mitad que sí funciona: el spam temerario muere.
    const r = probe({ order: "inteligente", policy: "temerario", interruption: true });

    expect(r.outcome).toBe("defeat-slain");
    expect(r.interrupted).toBeGreaterThan(0);
  });

  it("el orden ingenuo pierde por agotamiento, con o sin la mecánica", () => {
    // La compuerta del ADR 0011 sigue en pie: la interrupción no la rompe.
    for (const interruption of [false, true]) {
      const r = probe({ order: "ingenuo", policy: "calculador", interruption });
      expect(r.outcome).toBe("defeat-exhausted");
    }
  });
});
