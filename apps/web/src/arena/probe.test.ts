// probe.test.ts — los hallazgos de la sonda, congelados como aserciones.
//
// Estos tests NO protegen una implementación: protegen un DIAGNÓSTICO. Cada uno
// es un hecho medido sobre la carrera del ADR 0011 que hasta ahora nadie había
// medido, y que el ADR 0012 tiene que citar en vez de intuir.
//
// El más importante es también el más incómodo: la mecánica de interrupción, por
// sí sola, NO cambia el desenlace de un jugador competente. Es correcta en
// dirección y muy chica en magnitud, y el motivo se mide acá abajo — el ente
// alcanza a disparar cinco o siete veces en toda la corrida.
//
// Si alguno de estos tests se pone en verde por el lado contrario (por ejemplo,
// si el jugador competente empieza a recibir daño), es que el balance cambió y
// el diagnóstico del ADR 0012 hay que releerlo, no borrar el test.

import { describe, expect, it } from "vitest";

import { PLAYER } from "./balance.js";
import { probe } from "./probe.js";

const inteligente = { order: "inteligente", policy: "calculador" } as const;

describe("la mitad de presión no existe (el agujero que el ADR 0011 no midió)", () => {
  it("hoy un jugador competente gana SIN RECIBIR UN SOLO PUNTO DE DAÑO", () => {
    // Este es el playtest del autor del 2026-07-19 reproducido en la sonda, y la
    // razón de que la corrida "no tenga tensión": no es que sea poco daño, es
    // que con atención constante es exactamente cero. Lo único entre el jugador
    // y la invulnerabilidad es mirar la pantalla, nunca una decisión.
    const r = probe({ ...inteligente, interruption: false });

    expect(r.outcome).toBe("victory");
    expect(r.hitsTaken).toBe(0);
    expect(r.playerHp).toBe(PLAYER.maxHp);
  });

  it("el ente alcanza a disparar menos de diez veces en toda la corrida", () => {
    // La causa raíz. Con ~60 ataques del jugador y un puñado de contraataques,
    // el golpe del ente es un evento anecdótico: ninguna mecánica de interacción
    // puede generar tensión con esta densidad, por buena que sea.
    const r = probe({ ...inteligente, interruption: false });

    expect(r.shots).toBeLessThan(10);
    expect(r.attacks).toBeGreaterThan(50);
  });

  it("el 80 % del daño que decide la carrera se inflige EN FRÍO", () => {
    // La medición que ordena el ADR 0012. No es que la presión sea poca: es que
    // llega cuando la partida ya está jugada. Ningún dial de densidad tardía
    // arregla esto — amontonar golpes al final es agregar presión donde ya no
    // queda carrera que decidir. Por eso el tercer dial (amenaza basal) existe.
    const r = probe({ ...inteligente, interruption: false });

    expect(r.coldDamageFraction).toBeGreaterThan(0.7);
  });

  it("y jugar BIEN aumenta la fracción en frío: la inversión perversa", () => {
    // El hallazgo más incómodo de la sonda. El orden ingenuo tarda más, así que
    // le da tiempo al ente a despertarse y pelea ~65 % de su daño bajo amenaza.
    // El competente termina antes de que eso pase. Hoy, jugar bien no es
    // sobrevivir a la presión: es esquivarla cerrando la carrera en frío.
    const competente = probe({ ...inteligente, interruption: false });
    const ingenuo = probe({ order: "ingenuo", policy: "calculador", interruption: false });

    expect(competente.coldDamageFraction).toBeGreaterThan(ingenuo.coldDamageFraction);
  });

  it("el ente recién empieza a contraatacar pasada la mitad de la corrida", () => {
    // El arsenal del ente arranca vacío y solo se llena con `AdaptationCompleted`,
    // así que su reloj ni siquiera corre hasta la primera adaptación. La presión
    // aparece cuando la carrera ya está casi resuelta.
    const r = probe({ ...inteligente, interruption: false });

    expect(r.firstShotMs).not.toBeNull();
    expect(r.firstShotMs! / r.elapsedMs).toBeGreaterThan(0.5);
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
