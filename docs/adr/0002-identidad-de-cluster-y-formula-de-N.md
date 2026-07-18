# 0002 — Identidad de cluster por clave canónica y `N(c)` lineal

**Estado:** Aceptada

## Contexto

Al abrir la Fase 1 (implementación del núcleo) hay que fijar dos semánticas que el contrato deja deliberadamente abiertas y que `docs/contrato.md` §"Reglas para escribir código del núcleo" (regla 3) marca como ambigüedades que **no** se resuelven en silencio:

1. **¿Cuándo dos firmas son el mismo cluster?** El contrato define cluster como "grupo de firmas cercanas según `SignatureSpace.sim()`", pero no dice si la pertenencia se decide por identidad exacta o por umbral de similitud. La diferencia es el dial de granularidad descrito en §Definiciones: demasiado fina y el ente nunca adapta; demasiado gruesa y adapta en minutos.

2. **¿Qué forma tiene `N(c)`?** R2 solo exige que sea monótona creciente y que `N(c_mínima) = 1`. Infinitas funciones cumplen eso, y la elección cambia por completo el balance: decide cuánto más caro es adaptarse a un combo complejo que a una primitiva suelta.

Ambas son decisiones de balance con consecuencias fuertes, no detalles de implementación, y ninguna es reversible barata una vez que haya logs grabados: cambiar la identidad de cluster invalida el replay de logs viejos.

## Decisión

**1. La identidad de cluster es la clave canónica exacta de la firma.**

`clusterId` = primitivas ordenadas y unidas con un separador (`sig[fuego,rapido]` y `sig[rapido,fuego]` → `"fuego|rapido"`; `sig[fuego]` → `"fuego"`, un cluster distinto). Dos firmas son el mismo cluster si y solo si tienen exactamente el mismo conjunto de primitivas.

`SignatureSpace.sim()` sigue existiendo y sigue siendo canónica, pero interviene **solo en R6**, en `R₀(s) = max_c [sim(s,c) × transfer(c)]`. Es decir: la similitud no funde clusters, transfiere resistencia entre ellos.

**2. `N(c) = cantidad de primitivas de la firma.**

Crecimiento lineal: `[fuego]` → 1, `[fuego,rapido]` → 2, `[fuego,rapido,presion]` → 3. Cumple los dos tests de R2 (monótona al agregar una dimensión; `N = 1` en la firma mínima) por construcción.

## Alternativas descartadas

- **Merge de clusters por umbral de `sim()`.** Una firma nueva se absorbe al cluster existente más cercano si `sim ≥ radio` de `policy`, y si no crea uno nuevo. Es la lectura más literal de "grupo de firmas cercanas", pero el `clusterId` resultante **depende del orden histórico de llegada** de las firmas: el mismo conjunto de estímulos en orden inverso puede producir clusters distintos. Eso obliga a anclar la identidad de cada cluster en el propio log para que el replay siga siendo determinista (Ley de arquitectura §2 y §3), lo que es implementable pero es complejidad que hoy no compra nada. Queda como evolución posible de Fase 2 si el balance la pide, con su propio ADR y su versión de evento.
- **`N(c)` supralineal** (`|primitivas|²`, `2^(n-1)`). Castiga mucho más la complejidad: las firmas ricas sobreviven bastante más. Descartada por ahora porque vuelve dominante atacar siempre con el combo más complejo posible, que es exactamente el colapso a un solo eje de contrajuego que el proyecto quiere evitar (misma familia de problema que la estrategia degenerada del counter puro del [ADR 0001](0001-conciliar-curva-y-salto-discreto.md)). La curva de dificultad se puede endurecer después desde `policy` sin cambiar la forma de `N`.

## Consecuencias

**Positivas:**
- El `clusterId` es una función pura de la firma, independiente de la historia: `clusterIdOf(state, s)` no necesita el estado para ser determinista, y el replay de cualquier log produce siempre los mismos clusters.
- Se pueden testear R1–R5 sin acoplarlos a la implementación de `sim()`, que queda aislada en R6.
- `N` lineal es legible y balanceable desde `policy` más adelante sin migrar eventos.

**Negativas:**
- La granularidad queda del lado "fino": firmas que difieren en una sola primitiva son clusters separados y se adaptan por separado. Si en la arena resulta que el ente nunca llega a adaptar, el dial a mover es la granularidad del `StimulusTranslator` (cuántas primitivas emite el dominio), no el motor.
- `R₀` por generalización carga todo el peso de "adaptarse a lo desconocido": si `sim()` queda mal calibrada, el sistema se sentirá o demasiado tonto o demasiado clarividente, sin nada intermedio que lo compense.
- Un cambio futuro a merge por umbral es un cambio de identidad de cluster: exige versión de evento nueva y migración, nunca edición del log existente (Ley §3).

## Impacto en la Ley de arquitectura / contrato canónico

Ninguno. Este ADR **no modifica** ninguna de las 6 reglas: elige una implementación concreta dentro del espacio que R2 y la definición de cluster ya permitían. `docs/contrato.md` queda como está.
