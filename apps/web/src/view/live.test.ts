import { describe, expect, it } from "vitest";

import { cooldownOf, type Composition } from "@beforeheadapts/arena-dsl";

import { Room } from "../arena/room.js";
import { FRAME_HOLD_MS, LiveView, WINDOW } from "./live.js";

const compuesta: Composition = { element: "frost", vector: "beam", pattern: "pulse" };

/** Contenedor de mentira: la vista solo necesita dónde escribir. */
const stub = () => ({ innerHTML: "" });

/** Sala con `hits` golpes ya dados, respetando cooldowns. */
function salaCon(hits: number): Room {
  const room = new Room("test");
  const cd = cooldownOf(compuesta);
  for (let i = 0; i < hits; i++) room.attack(compuesta, i * cd);
  return room;
}

describe("LiveView", () => {
  it("no dibuja nada sin eventos", () => {
    const container = stub();
    const view = new LiveView(container);
    view.tick(0);
    expect(container.innerHTML).toBe("");
  });

  it("dibuja un SVG después de sincronizar", () => {
    const container = stub();
    const view = new LiveView(container);
    view.sync(salaCon(1).log);
    view.tick(0);
    expect(container.innerHTML).toContain("<svg");
  });

  it("avanza un frame por FRAME_HOLD_MS hasta alcanzar el presente", () => {
    const view = new LiveView(stub());
    const room = salaCon(3);
    view.sync(room.log);

    // Arranca en el frame 0 y va avanzando; el playhead alcanza el final.
    let now = 0;
    for (let i = 0; i < room.log.events.length + 2; i++) {
      now += FRAME_HOLD_MS;
      view.tick(now);
    }
    expect(view.stats.frames).toBe(room.log.events.length);
  });

  it("no reescribe el DOM si el dibujo no cambió", () => {
    let escrituras = 0;
    let valor = "";
    const container = {
      get innerHTML() {
        return valor;
      },
      set innerHTML(v: string) {
        escrituras++;
        valor = v;
      },
    };

    const view = new LiveView(container);
    view.sync(salaCon(1).log);
    view.tick(0);
    const tras1 = escrituras;

    // Varios ticks sin avanzar el playhead: mismo dibujo, cero escrituras.
    view.tick(1);
    view.tick(2);
    view.tick(3);
    expect(escrituras).toBe(tras1);
  });

  it("la ventana acota el pasado que ve el render, no el estado", () => {
    // Muchos más eventos que WINDOW: el ente tiene que seguir mostrando TODOS
    // sus clusters, aunque el render solo mire hacia atrás una cola acotada.
    const room = new Room("test");
    const cd = cooldownOf(compuesta);
    let now = 0;
    const otra: Composition = { element: "ember" };
    room.attack(otra, now);
    for (let i = 0; i < WINDOW + 10; i++) {
      now += cd;
      room.attack(compuesta, now);
    }

    const container = stub();
    const view = new LiveView(container);
    view.sync(room.log);
    // Avanzar hasta el presente.
    for (let i = 0, t = 0; i < room.log.events.length + 2; i++) {
      t += FRAME_HOLD_MS;
      view.tick(t);
    }

    // Los dos clusters siguen dibujados pese a que el primero quedó fuera de la
    // ventana: el estado sale del motor, la ventana solo limita los efectos.
    for (const clusterId of room.state.clusters.keys()) {
      expect(container.innerHTML).toContain(clusterId);
    }
  });

  it("mide el tiempo de sync y reporta fps", () => {
    const view = new LiveView(stub());
    view.sync(salaCon(4).log);
    expect(view.stats.lastSyncMs).toBeGreaterThanOrEqual(0);

    let now = 0;
    for (let i = 0; i < 60; i++) {
      now += 16;
      view.tick(now);
    }
    expect(view.stats.fps).toBeGreaterThan(0);
  });

  it("sirve igual para un replay importado que para una sala en vivo", () => {
    // La vista no conoce la sala: recibe un log y ya.
    const room = salaCon(3);
    const log = JSON.parse(JSON.stringify(room.log)) as typeof room.log;

    const container = stub();
    const view = new LiveView(container);
    view.sync(log);
    view.tick(0);
    expect(container.innerHTML).toContain("<svg");
  });
});
