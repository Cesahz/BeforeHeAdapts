// Especificación del planificador de contraataques (ADR 0009 §4).
//
// El arsenal de estos tests lo arma el MOTOR, no un objeto literal: el hallazgo
// de los fixtures sintéticos —un gesto con 100 % de tests verdes que nunca
// funcionó— fue exactamente esto, verificar contra datos inventados que se
// parecen a los reales sin serlo. Acá se juega la sala hasta que el ente adapta
// de verdad y recién ahí se mira qué hace el planificador.

import { describe, expect, it } from "vitest";
import { cooldownOf, type Composition } from "@beforeheadapts/arena-dsl";

import { COUNTER } from "./balance.js";
import { CombatSession } from "./combat.js";
import {
  CounterScheduler,
  damageFor,
  intervalFor,
  selectCounter,
  telegraphFor,
} from "./counter.js";
import { Room } from "./room.js";

const compuesta: Composition = { element: "frost", vector: "beam", pattern: "pulse" };

/** Una sesión con al menos un cluster ya adaptado: el ente tiene con qué golpear. */
function sesionConArsenal(): CombatSession {
  const session = new CombatSession(new Room("test"));
  const cd = cooldownOf(compuesta);
  // Se golpea hasta que el motor emite `CounterReady`. El tope es guarda contra
  // un bucle infinito si alguna vez cambiara N(c), no una expectativa.
  for (let i = 0; i < 200 && session.arsenal.length === 0; i += 1) {
    session.attack(compuesta, i * cd);
  }
  return session;
}

const ORIGEN = { x: 0, y: 0 };
const CENTRO = { x: 500, y: 500 };

describe("escalada del contraataque", () => {
  it("acelera la cadencia con cada cluster adaptado y respeta el piso", () => {
    const intervalos = [1, 2, 4, 8, 20].map(intervalFor);
    for (let i = 1; i < intervalos.length; i += 1) {
      expect(intervalos[i]!).toBeLessThanOrEqual(intervalos[i - 1]!);
    }
    expect(Math.min(...intervalos)).toBeGreaterThanOrEqual(COUNTER.minIntervalMs);
  });

  it("sube el daño sin techo: la ventana se cierra", () => {
    expect(damageFor(1)).toBe(COUNTER.baseDamage);
    expect(damageFor(8)).toBeGreaterThan(damageFor(1));
    expect(damageFor(20)).toBeGreaterThan(damageFor(8));
  });

  it("acorta el aviso previo pero nunca por debajo de lo esquivable", () => {
    expect(telegraphFor(1)).toBe(COUNTER.baseTelegraphMs);
    expect(telegraphFor(8)).toBeLessThan(telegraphFor(1));
    expect(telegraphFor(50)).toBeGreaterThanOrEqual(COUNTER.minTelegraphMs);
  });

  it("con arsenal vacío no hay cadencia ni daño", () => {
    expect(intervalFor(0)).toBe(Infinity);
    expect(damageFor(0)).toBe(0);
  });
});

describe("selección determinista", () => {
  it("no usa Math.random: mismo arsenal y mismo disparo, misma elección", () => {
    const arsenal = sesionConArsenal().arsenal;
    expect(arsenal.length).toBeGreaterThan(0);
    for (let shot = 0; shot < 10; shot += 1) {
      expect(selectCounter(arsenal, shot)).toEqual(selectCounter(arsenal, shot));
    }
  });

  it("recorre el arsenal en vez de repetir siempre la misma entrada", () => {
    // Se arma a mano SOLO acá, porque lo que se testea es la función de
    // selección sobre un arsenal de varias entradas, no cómo se llena.
    const arsenal = [
      { weakness: "elem:frost" as const, clusterId: "a", armedAtSeq: 3 },
      { weakness: "elem:ember" as const, clusterId: "b", armedAtSeq: 7 },
      { weakness: "elem:spark" as const, clusterId: "c", armedAtSeq: 11 },
    ];
    const elegidos = new Set(
      Array.from({ length: 6 }, (_, shot) => selectCounter(arsenal, shot)?.clusterId),
    );
    expect(elegidos.size).toBe(arsenal.length);
  });

  it("sin arsenal no elige nada", () => {
    expect(selectCounter([], 0)).toBeUndefined();
  });
});

describe("anatomía de un impacto", () => {
  it("sin arsenal el ente no golpea nunca", () => {
    const scheduler = new CounterScheduler();
    for (let t = 0; t < 120_000; t += 100) {
      expect(scheduler.poll(t, [], ORIGEN, CENTRO)).toBeUndefined();
    }
    expect(scheduler.shots).toBe(0);
  });

  it("avisa antes de golpear: telegraph primero, resolución después", () => {
    const arsenal = sesionConArsenal().arsenal;
    const scheduler = new CounterScheduler();

    let telegraphVisto = false;
    let resolucion;
    for (let t = 0; t < 60_000 && resolucion === undefined; t += 16) {
      const r = scheduler.poll(t, arsenal, ORIGEN, CENTRO);
      if (scheduler.phase.kind === "telegraph") telegraphVisto = true;
      if (r !== undefined) resolucion = r;
    }

    expect(telegraphVisto).toBe(true);
    expect(resolucion).toBeDefined();
  });

  it("fija el punto al empezar el aviso y no persigue al cursor", () => {
    const arsenal = sesionConArsenal().arsenal;
    const scheduler = new CounterScheduler();

    let fijado;
    for (let t = 0; t < 60_000; t += 16) {
      // El cursor se mueve todo el tiempo: si el punto persiguiera, cambiaría.
      scheduler.poll(t, arsenal, { x: t % 900, y: 100 }, CENTRO);
      const fase = scheduler.phase;
      if (fase.kind === "telegraph") {
        if (fijado === undefined) fijado = fase.at;
        else expect(fase.at).toEqual(fijado);
      }
      if (fase.kind === "strike") break;
    }
    expect(fijado).toBeDefined();
  });

  it("lastima al que se queda quieto en el punto fijado", () => {
    const arsenal = sesionConArsenal().arsenal;
    const scheduler = new CounterScheduler();

    let resolucion;
    for (let t = 0; t < 60_000 && resolucion === undefined; t += 16) {
      resolucion = scheduler.poll(t, arsenal, ORIGEN, CENTRO);
    }

    expect(resolucion?.hit).toBe(true);
    expect(resolucion?.damage).toBe(damageFor(arsenal.length));
  });

  it("no lastima al que sale del disco a tiempo", () => {
    const arsenal = sesionConArsenal().arsenal;
    const scheduler = new CounterScheduler();

    let resolucion;
    for (let t = 0; t < 60_000 && resolucion === undefined; t += 16) {
      // En cuanto empieza el aviso, el jugador se va lejos del punto fijado.
      const escapando = scheduler.phase.kind === "telegraph";
      resolucion = scheduler.poll(
        t,
        arsenal,
        escapando ? { x: 5_000, y: 5_000 } : ORIGEN,
        CENTRO,
      );
    }

    expect(resolucion?.hit).toBe(false);
    expect(resolucion?.damage).toBe(0);
  });

  it("esquivar es cuestión de atención, no de destreza", () => {
    // La afirmación de diseño del ADR: salir del disco en el tiempo del aviso
    // es trivial SI estás mirando. Si esto se pusiera rojo, el contraataque
    // habría pasado a competir por habilidad mecánica, que es lo que no quiere.
    const pxNecesarios = COUNTER.strikeRadiusPx;
    const msDisponibles = COUNTER.minTelegraphMs;
    expect(pxNecesarios / msDisponibles).toBeLessThan(0.5);
  });

  it("respeta el intervalo entre golpes sucesivos", () => {
    const arsenal = sesionConArsenal().arsenal;
    const scheduler = new CounterScheduler();
    const momentos: number[] = [];

    for (let t = 0; t < 180_000; t += 16) {
      if (scheduler.poll(t, arsenal, ORIGEN, CENTRO) !== undefined) momentos.push(t);
    }

    expect(momentos.length).toBeGreaterThan(2);
    const minimo = intervalFor(arsenal.length);
    for (let i = 1; i < momentos.length; i += 1) {
      // El hueco es intervalo + aviso: la cadencia se reagenda desde la
      // resolución, así que el intervalo es respiro y no incluye el telegraph.
      expect(momentos[i]! - momentos[i - 1]!).toBeGreaterThanOrEqual(minimo);
    }
  });
});

describe("contraataque de ruido", () => {
  it("no dispara si el ente todavía no adaptó la agitación", () => {
    const arsenal = sesionConArsenal().arsenal;
    const tieneAmbient = arsenal.some((entry) => entry.weakness === "elem:ambient");
    const scheduler = new CounterScheduler();
    expect(scheduler.triggerAmbient(0, arsenal, ORIGEN)).toBe(tieneAmbient);
  });

  it("dispara fuera de cadencia cuando el ruido está en el arsenal", () => {
    const arsenal = [{ weakness: "elem:ambient" as const, clusterId: "ruido", armedAtSeq: 1 }];
    const scheduler = new CounterScheduler();

    expect(scheduler.triggerAmbient(1_000, arsenal, ORIGEN)).toBe(true);
    expect(scheduler.phase.kind).toBe("telegraph");
  });

  it("tiene rate-limit propio: agitarse no invoca un golpe por cuadro", () => {
    const arsenal = [{ weakness: "elem:ambient" as const, clusterId: "ruido", armedAtSeq: 1 }];
    const scheduler = new CounterScheduler();

    let disparos = 0;
    for (let t = 0; t < 10_000; t += 16) {
      if (scheduler.triggerAmbient(t, arsenal, ORIGEN)) disparos += 1;
      scheduler.poll(t, arsenal, { x: 5_000, y: 5_000 }, CENTRO);
    }

    const techo = Math.ceil(10_000 / COUNTER.ambientCooldownMs);
    expect(disparos).toBeGreaterThan(0);
    expect(disparos).toBeLessThanOrEqual(techo);
  });

  it("no se superpone con un golpe ya en curso", () => {
    const arsenal = [{ weakness: "elem:ambient" as const, clusterId: "ruido", armedAtSeq: 1 }];
    const scheduler = new CounterScheduler();

    scheduler.triggerAmbient(0, arsenal, ORIGEN);
    // Ya hay telegraph: un segundo aviso sobre la misma pantalla es ilegible.
    expect(scheduler.triggerAmbient(0, arsenal, { x: 900, y: 900 })).toBe(false);
  });
});
