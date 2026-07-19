import { describe, expect, it } from "vitest";
import { defaultTheme } from "@beforeheadapts/visualizer";
import { ARENA_SIZE, arenaTheme } from "./theme.js";

// Estos tests fijan la razón de existir del tema de arena, no sus números.
// El defecto que corrigen —"el ente tapa casi toda el área útil, los ataques no
// tienen recorrido"— es de proporción, así que lo que se testea es la
// proporción: si mañana alguien agranda el ente o achica el lienzo hasta volver
// a taparlo todo, esto se pone rojo antes que el playtest.

describe("tema de la arena", () => {
  it("deja arrabal entre la órbita exterior y el borde del lienzo", () => {
    const mitad = arenaTheme.size / 2;
    const arrabal = mitad - arenaTheme.orbitOuter;
    // Al menos un radio de ente de aire por fuera de la órbita: es el espacio
    // por donde un ataque puede verse VIAJAR antes de tocar nada.
    expect(arrabal).toBeGreaterThanOrEqual(arenaTheme.coreRadius);
  });

  it("le da al ente menos de un quinto del ancho del lienzo", () => {
    const ocupacion = (arenaTheme.coreRadius * 2) / arenaTheme.size;
    expect(ocupacion).toBeLessThan(0.2);
    // Y es estrictamente más aire que el tema de export, que está calibrado
    // para un gif donde el ente ES el encuadre.
    const ocupacionExport = (defaultTheme.coreRadius * 2) / defaultTheme.size;
    expect(ocupacion).toBeLessThan(ocupacionExport);
  });

  it("no toca el tema de export", () => {
    // La Ley de arquitectura §3: los fixtures golden están calibrados contra el
    // default. El tema de arena es un tema APARTE, nunca una mutación del otro.
    expect(defaultTheme.size).toBe(600);
    expect(arenaTheme.size).toBe(ARENA_SIZE);
    expect(arenaTheme).not.toBe(defaultTheme);
  });

  it("escala la onda del snap con el lienzo", () => {
    // Sin esto el salto discreto —el evento que la arena existe para mostrar—
    // queda como un destello chico en el medio en vez de barrer la pantalla.
    expect(arenaTheme.shockwaveRadius).toBeGreaterThan(arenaTheme.orbitOuter);
  });
});
