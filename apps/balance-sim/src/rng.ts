// rng.ts — aleatoriedad determinista con semilla explícita.
//
// El harness no es el núcleo, así que la Ley §1 no lo obliga; aun así usa RNG
// con semilla y nunca `Math.random()`. La razón es práctica: un reporte de
// balance que da distinto en cada corrida no sirve para comparar dos catálogos.

/** Generador mulberry32: barato, con estado de 32 bits, suficiente para muestrear builds. */
export function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Elemento al azar de un arreglo no vacío. */
export function pick<T>(rng: () => number, items: readonly T[]): T {
  if (items.length === 0) throw new Error("pick sobre un arreglo vacío");
  return items[Math.floor(rng() * items.length)]!;
}
