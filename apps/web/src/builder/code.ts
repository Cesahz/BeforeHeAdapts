// code.ts — export/import de builds por código compacto (§3 del diseño).
//
// Compartir builds entre jugadores sin cuentas ni servidor: la dinámica
// comunitaria de descubrir estrategias empieza acá. Un código es JSON en base64
// URL-safe, para que sobreviva a un pegado en un chat o en una URL.
//
// Puro: no toca `localStorage` ni el DOM. `btoa`/`atob` son globales tanto en el
// navegador como en Node ≥18, así que esto se testea sin DOM.

import { validate } from "@beforeheadapts/arena-dsl";

import { isBuildShape, normalizeVisual, type Build } from "./build.js";

/** Falla del import: código corrupto, ajeno o de una versión que no se entiende. */
export class BuildCodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BuildCodeError";
  }
}

/**
 * Base64 URL-safe: `+/` → `-_` y sin relleno.
 *
 * El relleno `=` se pierde al pegar códigos en algunos chats y clientes de
 * correo, y `+` se convierte en espacio si el código viaja en una query string.
 */
function toUrlSafe(base64: string): string {
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromUrlSafe(code: string): string {
  const base64 = code.replace(/-/g, "+").replace(/_/g, "/");
  // `atob` sí exige el relleno, así que se repone.
  return base64 + "=".repeat((4 - (base64.length % 4)) % 4);
}

/**
 * Serializa una build a código compartible.
 *
 * El JSON pasa por UTF-8 antes de base64: `btoa` solo acepta Latin-1 y los
 * nombres de build llevan acentos y emoji con toda naturalidad.
 */
export function encodeBuild(build: Build): string {
  // Se normaliza al salir para que el código emitido y la build en memoria
  // digan lo mismo: si no, `decode(encode(b))` no sería una identidad.
  const normalizada: Build = { ...build, visual: normalizeVisual(build.visual) };
  const bytes = new TextEncoder().encode(JSON.stringify(normalizada));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return toUrlSafe(btoa(binary));
}

/**
 * Reconstruye una build desde su código.
 *
 * @throws {BuildCodeError} si el código no es base64 válido, no es JSON, no
 * tiene la forma de una build, o su composición no pertenece al catálogo.
 */
export function decodeBuild(code: string): Build {
  const limpio = code.trim();
  if (limpio.length === 0) throw new BuildCodeError("el código está vacío");

  let json: string;
  try {
    const binary = atob(fromUrlSafe(limpio));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    json = new TextDecoder().decode(bytes);
  } catch {
    throw new BuildCodeError("el código no es base64 válido");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new BuildCodeError("el código no contiene JSON válido");
  }

  if (!isBuildShape(parsed)) {
    throw new BuildCodeError("el código no tiene la forma de una build de esta versión");
  }

  // La forma puede estar bien y la composición ser inventada: un código a mano
  // podría traer `elem:plasma`. Se valida contra el catálogo antes de aceptarla.
  try {
    validate(parsed.composition);
  } catch (error) {
    throw new BuildCodeError(
      `la build usa valores fuera del catálogo: ${error instanceof Error ? error.message : ""}`,
    );
  }

  return parsed;
}
