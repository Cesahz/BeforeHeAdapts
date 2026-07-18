# 0001 — Conciliar la curva decreciente y el salto discreto de adaptación

**Estado:** Aceptada

## Contexto

Al convertir el documento fuente en contrato ejecutable aparecieron dos tensiones sobre el modelo de adaptación:

1. **Regla 1 (adaptación discreta) vs. Regla 5 (curva decreciente).** La R1 exige que la resistencia contra una firma *solo cambie en saltos, nunca gradualmente*. La R5 describe una efectividad que decae de forma continua (`eff(k) = base × r^k`). Leídas ingenuamente, efectividad y resistencia son inversas: si `eff` baja suave, la resistencia sube suave, lo que violaría la R1. Ninguno de los documentos escribía la conciliación de forma explícita, así que el contrato podía terminar con property tests de R1 y R5 que se contradicen entre sí. El origen de la tensión está en el propio `concepto-original.md`, que en §2 afirma "salto abrupto, no convergencia lenta" y en §3 propone justamente una convergencia (100% → 50% → 25% → asíntota).

2. **Alcance de la curva: ¿núcleo o dominio?** El documento fuente (`concepto-original.md` §3) marca la curva decreciente como "problemática en juegos" que "en arquitectura de un proyecto real se pueden omitir". Pero `arquitectura.md` §3.5 y `CLAUDE.md` regla 5 la elevan a invariante canónico no negociable. Había que decidir si la curva es una mecánica de balanceo específica de la arena (dominio) o parte del contrato del motor puro.

Las dos tensiones se resuelven juntas porque comparten la misma raíz: qué magnitud vive en qué capa.

## Decisión

**R1 y R5 no chocan: operan en capas distintas y describen fases distintas del mismo ciclo.**

- `eff(k)` es la **atenuación por exposición** del estímulo mientras `k < N(c)`: es el "durante". La efectividad decae exponencialmente exposición a exposición, pero es una magnitud del estímulo, no la resistencia adaptada del ente.
- Al alcanzar `k = N(c)` ocurre el **salto discreto de resistencia**: es el "después". Ese salto es el único cambio de la resistencia adaptada, y es abrupto, cumpliendo la R1 al pie de la letra.
- La curva es el "durante"; el salto es el "después". Son dos magnitudes separadas (`eff` del estímulo vs. `resistance` adaptada del ente) y el contrato debe tratarlas como tales.

Esto **debe quedar escrito explícitamente en `contract.test.ts` como un test combinado R1+R5**, no como dos tests aislados: la conciliación es parte de la especificación, no un detalle de implementación. El test verifica que la resistencia adaptada es escalonada (R1) *mientras* la efectividad del estímulo se atenúa de forma continua pre-adaptación (R5), y que el único salto de resistencia ocurre en `k = N(c)`.

**La curva sigue siendo canónica en el núcleo**, aunque el documento original la llame "problema de juegos". La conciliación es que sus **parámetros (`base`, `r`, asíntota) viven en `policy`**, no como constantes del engine. Un dominio real que no quiera dinámica de tempo puede configurar la curva casi plana. Pero **`eff > 0` pre-adaptación no se negocia**: es lo que impide la inmunidad instantánea binaria y, con ella, mata la estrategia degenerada del counter puro — que es el problema fundacional del proyecto (`concepto-original.md` §3). Un dominio puede aplanar la curva; no puede eliminarla convirtiéndola en un interruptor.

## Alternativas descartadas

- **Omitir la curva en el núcleo (seguir el fuente literalmente).** Descartada: dejar la curva como mecánica exclusiva del dominio arena reabre la puerta a la inmunidad binaria en cualquier otro dominio, y con ella al colapso a un solo eje de contrajuego que motivó todo el rediseño. La curva es la mitigación del problema fundacional, no un adorno de balanceo.
- **Hacer la curva una constante fija del engine.** Descartada: viola el principio de que todas las reglas son estrategias intercambiables en `policy`, y quita a los dominios reales la capacidad de aplanarla cuando la dinámica de tempo no les aporta.
- **Fusionar R1 y R5 en una sola regla "resistencia decreciente continua".** Descartada: perdería el salto discreto, que es un requisito canónico del documento fuente ("salto abrupto tras exposición procesada") y una firma característica de la adaptación de Mahoraga.

## Consecuencias

**Positivas:**
- El contrato queda sin ambigüedad interna: R1 y R5 tienen un test combinado que fija su relación de capas.
- La curva es canónica *y* configurable: mismo motor sirve a la arena (tempo agresivo) y a dominios reales (curva casi plana) sin tocar el engine.
- Se preserva la mitigación de la estrategia degenerada como invariante duro (`eff > 0` pre-adaptación).

**Negativas:**
- El contrato exige un test combinado R1+R5 más elaborado que dos property tests independientes; hay que diseñarlo con cuidado para que verifique la relación de fases y no solo cada regla por separado.
- Persiste una divergencia deliberada con el documento fuente, que dice que la curva se puede omitir. Queda saldada por este ADR, no por el texto original: hay que leerlos juntos.
- Los dominios pueden aplanar la curva pero no eliminarla; un dominio que quisiera inmunidad binaria pura queda fuera del contrato por diseño.

## Impacto en la Ley de arquitectura / contrato canónico

Este ADR **no cambia** las reglas 1 y 5 del contrato canónico de `CLAUDE.md`; las **concilia y precisa**. Propuesta de actualización, a aplicar solo tras confirmación del autor:

- En el resumen del contrato de `CLAUDE.md` (reglas 1 y 5), añadir una nota de conciliación: *"R1 y R5 operan en capas distintas: `eff(k)` atenúa el estímulo durante `k < N(c)` (el 'durante'); el salto discreto de resistencia ocurre en `k = N(c)` (el 'después'). Ver ADR 0001."*
- En la skill `contrato-adaptacion`, dejar asentado que `contract.test.ts` debe incluir un **test combinado R1+R5**, y que `base`, `r` y la asíntota son parámetros de `policy` con la restricción dura `eff > 0` pre-adaptación.

Decisiones relacionadas ya cerradas en conversación (no requieren ADR propio): la política de memoria "permanente" es una de tres políticas intercambiables (evolución aceptada del fuente); la tensión "no es un juego" vs. dominio vitrina arena se acepta conscientemente y la Fase 5 (adaptador de logs) existe para cerrarla.
