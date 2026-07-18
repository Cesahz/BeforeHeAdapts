// prefabs.ts — ataques de fábrica, para poder jugar sin pasar por el Builder.
//
// El set está elegido para que se note el contrato, no para estar balanceado:
// hay una firma mínima (adapta al primer golpe, R2), dos emparentadas que sí
// alcanzan el radio de generalización, una de control y una máxima.
//
// Ojo con el par emparentado: `sim` es Jaccard sobre las primitivas y el radio
// por defecto es 0.5, así que **compartir el elemento no alcanza**. Dos firmas de
// tres primitivas que solo comparten el elemento dan `sim = 0.2` y no se
// transfieren nada. Acá comparten dos de tres primitivas (`sim = 0.667`), que es
// lo que hace visible a R6. Si se tocan estas composiciones, recalcular la
// similitud — `prefabs.test.ts` la verifica justamente para que no vuelva a pasar.

import type { Composition } from "@beforeheadapts/arena-dsl";

export interface Prefab {
  readonly id: string;
  readonly name: string;
  /** Qué muestra este ataque del contrato. Se lee en la UI. */
  readonly note: string;
  readonly composition: Composition;
}

export const PREFABS: readonly Prefab[] = [
  {
    id: "chispa",
    name: "Chispa",
    note: "firma mínima: el ente la adapta al primer golpe",
    composition: { element: "ember" },
  },
  {
    id: "lanza-helada",
    name: "Lanza helada",
    note: "3 exposiciones; emparentada con Esquirla (sim 0.667)",
    composition: { element: "frost", vector: "projectile", pattern: "burst" },
  },
  {
    id: "esquirla",
    name: "Esquirla",
    note: "2 exposiciones; al adaptar Lanza helada, esta hereda resistencia (R6)",
    composition: { element: "frost", vector: "projectile" },
  },
  {
    id: "descarga",
    name: "Descarga",
    note: "4 exposiciones, sin parentesco: el ente arranca de cero contra ella",
    composition: {
      element: "current",
      vector: "beam",
      pattern: "pulse",
      modifiers: ["piercing"],
    },
  },
  {
    id: "colapso",
    name: "Colapso",
    note: "composición máxima: 7 exposiciones, pero 5,5 s de cooldown",
    composition: {
      element: "void",
      vector: "field",
      pattern: "escalating",
      modifiers: ["piercing", "splitting", "homing", "unstable"],
    },
  },
];
