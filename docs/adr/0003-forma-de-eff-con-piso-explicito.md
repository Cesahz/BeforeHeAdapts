# 0003 — Dar a `eff(k)` un piso explícito con asíntota configurable

**Estado:** Aceptada

## Contexto

Antes de implementar `policy/` (Hueco 3 de la Fase 1) hay que fijar la forma exacta de la curva de R5. El contrato la enuncia como `eff(k) = base × r^k`, con `0 < r < 1` y **asíntota `> 0`** mientras la adaptación no complete; y `PolicyConfig` (fijado en `contract.test.ts`) trae un campo `curve.asymptote` junto a `base` y `r`. Las dos piezas no encajan del todo: `base × r^k` puro tiene asíntota exactamente 0, así que o el campo `asymptote` es un piso real de la fórmula, o es otra cosa (una cota de validación) y la fórmula queda literal.

Lo que está en juego es el corazón de R5 —"curva decreciente, nunca interruptor"— en el límite. Con la exponencial pura y los parámetros por defecto (`base = 1`, `r = 0.5`), a `k = 10` la efectividad es ~0.001: formalmente `> 0`, prácticamente inmunidad binaria. Eso es justo la estrategia degenerada que R5 y el [ADR 0001](0001-conciliar-curva-y-salto-discreto.md) existen para impedir. Además el límite importa de verdad acá: los clusters de complejidad baja tienen `N(c)` chico ([ADR 0002](0002-identidad-de-cluster-y-formula-de-N.md), `N` lineal), pero nada impide seguir golpeando el mismo cluster mucho después de completar la adaptación, y ahí `k` crece sin techo.

Es una ambigüedad semántica del contrato, del tipo que `docs/contrato.md` §"Reglas para escribir código del núcleo" (regla 3) obliga a resolver con el autor y no en silencio.

## Decisión

**1. `eff(k)` tiene piso explícito:**

```
eff(k) = asymptote + (base − asymptote) × r^k
```

Estrictamente decreciente en `k`, con `eff(0) = base` y `lím eff(k) = asymptote > 0`. El campo `curve.asymptote` es el piso real de la curva, no una cota de validación.

**2. El piso por defecto es el más bajo de la convención: `asymptote = 0.01`.**

La convención del proyecto es un piso en `[0.01, 0.05]`, y el default se planta en el extremo bajo: suficiente para que un estímulo muy repetido siga arañando (nunca interruptor), suficientemente chico para que la adaptación se *sienta* casi total. Los dominios que quieran un ente más blando suben el piso hacia 0.05 desde `policy`.

**3. `policy/` valida los parámetros de la curva en vez de tolerarlos:** `0 < r < 1`, `base > 0`, `0 < asymptote < base`. Una curva con `asymptote ≥ base` no es decreciente y una con `asymptote ≤ 0` viola R5; ambas son error de configuración del dominio, no algo que el núcleo deba absorber.

El `defaultConfig` de `contract.test.ts` (`asymptote = 0.05`) queda válido y dentro de la convención: es el extremo alto del rango, útil para que los tests vean la atenuación sin acercarse al piso.

## Alternativas descartadas

- **Exponencial pura `base × r^k`, con `asymptote` como cota de validación** (assert de que la curva no cruce el piso antes de `N(c)`). Es la lectura literal del contrato y la más simple, pero deja el campo `asymptote` sin efecto sobre el comportamiento observable y convierte la garantía "eff > 0" en algo nominal: a `k` grande la efectividad es indistinguible de cero para cualquier jugador o consumidor del motor. Descartada porque cumple la letra de R5 y no su espíritu.
- **Piso duro por recorte: `eff(k) = max(asymptote, base × r^k)`.** Da el mismo límite, pero deja de ser *estrictamente* decreciente en cuanto toca el piso, lo que rompe el property test de R5 ("`eff` estrictamente decreciente"). Debilitar ese test para acomodar la fórmula está prohibido (Ley §6), así que la fórmula es la que se acomoda.
- **Piso dependiente de la complejidad** (`asymptote` mayor para firmas ricas, para que los combos nunca se apaguen del todo). Interesante para balance, pero mete la firma dentro de la curva y acopla `policy/` a `signature/` sin necesidad todavía. Queda para Fase 2 con su propio ADR si la arena lo pide.

## Consecuencias

**Positivas:**
- `asymptote` pasa a ser un dial de balance real y legible: el único parámetro que responde "¿cuánto sigue doliendo un ataque ya masticado?".
- La garantía de R5 se sostiene también en el límite, no solo para `k` chico: no hay `k` que produzca inmunidad de facto.
- La curva es estrictamente decreciente en todo su dominio, así que el property test de R5 pasa sin excepciones ni casos borde.

**Negativas:**
- Con `asymptote = 0.01` y `base = 1`, la diferencia entre `k = 8` y `k = 12` es numéricamente ínfima. Contra ruido de punto flotante el test de "estrictamente decreciente" sigue pasando (los valores son distintos), pero cualquier comparación con tolerancia que se agregue más adelante tiene que tenerlo en cuenta.
- El piso es un ingreso garantizado para el atacante que spamea: martillar un cluster ya adaptado nunca es *inútil*, solo muy poco rentable. Es deliberado, pero significa que el balance de la arena no puede apoyarse en "esto deja de funcionar"; tiene que hacer que el costo de oportunidad haga el trabajo.
- `base` deja de ser la magnitud sobre la que decae todo: ahora decae `base − asymptote`. Es un detalle chico que confunde si se lee la fórmula de memoria.

## Impacto en la Ley de arquitectura / contrato canónico

**Sí hay impacto — requiere confirmación antes de aplicarlo.** Este ADR no cambia ninguna de las 6 reglas, pero sí precisa la fórmula que R5 escribe de forma literal. Propuesta de actualización, **no aplicada** hasta tu OK:

1. `docs/contrato.md` §R5: reemplazar `eff(k) = base × r^k` por `eff(k) = asymptote + (base − asymptote) × r^k`, manteniendo el resto del texto (incluida la prohibición de efectividad 0 pre-adaptación) y agregando la referencia a este ADR.
2. `CLAUDE.md` §"Contrato canónico (resumen)", punto 5: mismo reemplazo en la fórmula del resumen.

Ni `contract.test.ts` ni ningún test cambian: los tests de R5 nunca dependieron de la forma exacta de la curva, solo de `eff > 0` y del decrecimiento estricto — que es exactamente como debe ser.
