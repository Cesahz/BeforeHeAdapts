# Changelog

## [0.1.0] — 2026-07-18

Cierre de la **Fase 1 (Núcleo)**. El motor de adaptación existe, es puro y determinista, y cumple el contrato canónico completo. Todavía no hay nada que jugar: esta versión es el cimiento sobre el que se construye el resto.

### Añadido

- **Contrato de aceptación ejecutable (R1–R6).** Las seis reglas del motor escritas como tests antes de cualquier implementación. Ese archivo *es* la especificación; el código existe para ponerlo en verde.
- **`signature/`** — identidad de un estímulo: canonicalización, clave de cluster, complejidad, exposiciones requeridas `N(c)` y similitud entre firmas. Es lo que decide cuándo dos ataques "son el mismo" a los ojos del ente.
- **`ledger/`** — el log de eventos append-only y versionado, aislado por sala. Toda la historia del sistema vive acá; el estado siempre se deriva plegando el log, nunca se guarda aparte.
- **`policy/`** — los parámetros de adaptación como datos configurables, no como constantes escondidas: la curva de efectividad, la resistencia tras adaptar, la memoria y la generalización a firmas nuevas.
- **`engine/`** — el motor propiamente dicho: una función pura que recibe estado y estímulo y devuelve eventos, más el reductor que los proyecta a estado y los selectores para consultarlo. Reproducir el mismo log da siempre el mismo resultado.
- **Andamiaje del monorepo** — pnpm workspaces, TypeScript en modo estricto y Vitest con property tests (fast-check) para los invariantes del núcleo.
- **Decisiones de arquitectura registradas (ADR 0001–0006):** conciliación entre la curva decreciente y el salto discreto; identidad de cluster y forma de `N(c)`; curva de efectividad con piso explícito; frontera de cuantización de entrada; adaptador de auto-defensa del sitio; esquema versionado del log exportado.
- **Guía de diseño del adaptador web** para las fases 3a–3b.

### Cambiado

- **La curva de efectividad tiene un piso explícito.** Antes tendía a cero y volvía inútil cualquier ataque repetido lo suficiente; ahora la asíntota es un parámetro con valor por defecto `0.01`. La adaptación degrada, nunca apaga del todo: un ataque conocido sigue haciendo algo. (ADR 0003)
- **La Fase 5 del plan es ahora la auto-defensa del sitio**, en lugar de un adaptador de logs de juguete. El mismo motor que la comunidad enfrenta dentro de la arena supervisa la seguridad operativa de la web que la aloja — en instancia y log separados, y en modo sombra antes de aplicar nada. (ADR 0005)
- `docs/concepto-original.md` dejó de ser normativo: la fuente de verdad son `docs/` y los ADRs.
- Fin de línea normalizado con `.gitattributes` (`* text=auto`), para que las diferencias CRLF/LF no ensucien los diffs.
