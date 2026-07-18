// storage.ts — persistencia local de las builds (§3 del diseño).
//
// `localStorage` alcanza y sobra para el MVP: son JSON chicos. El umbral de
// migración a IndexedDB es que las colecciones crezcan (decenas de builds o
// assets visuales pesados); complejidad diferida hasta que haga falta.
//
// El almacén se recibe por parámetro en vez de tomar `localStorage` del global:
// eso es lo que permite testear toda la persistencia en Node, y de paso deja la
// puerta abierta a cambiar de backend sin tocar a los que la usan.

import { isBuildShape, type Build } from "./build.js";

export const STORAGE_KEY = "beforeheadapts:builds";

/** Versión del CONTENEDOR, distinta de la versión de cada build. */
export const COLLECTION_VERSION = 1 as const;

/** Lo mínimo que se necesita de `localStorage`. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface Collection {
  readonly v: typeof COLLECTION_VERSION;
  readonly builds: readonly Build[];
}

/**
 * Lee las builds guardadas.
 *
 * **Nunca lanza.** Un `localStorage` corrupto, editado a mano o escrito por una
 * versión futura no puede dejar al jugador sin poder abrir el juego: se
 * descarta lo ilegible y se sigue. Las builds individuales se filtran una por
 * una, así que una sola build rota no se lleva puestas a las demás.
 */
export function loadBuilds(store: KeyValueStore): Build[] {
  const raw = store.getItem(STORAGE_KEY);
  if (raw === null) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (typeof parsed !== "object" || parsed === null) return [];
  const collection = parsed as Partial<Collection>;
  if (collection.v !== COLLECTION_VERSION) return [];
  if (!Array.isArray(collection.builds)) return [];

  return collection.builds.filter(isBuildShape);
}

/** Guarda la colección completa, pisando lo anterior. */
export function saveBuilds(store: KeyValueStore, builds: readonly Build[]): void {
  const collection: Collection = { v: COLLECTION_VERSION, builds };
  store.setItem(STORAGE_KEY, JSON.stringify(collection));
}

/** Agrega o reemplaza una build por `id`, conservando el orden. */
export function upsertBuild(builds: readonly Build[], build: Build): Build[] {
  const index = builds.findIndex((b) => b.id === build.id);
  if (index === -1) return [...builds, build];
  const copia = [...builds];
  copia[index] = build;
  return copia;
}

/** Quita una build por `id`. */
export function removeBuild(builds: readonly Build[], id: string): Build[] {
  return builds.filter((b) => b.id !== id);
}
