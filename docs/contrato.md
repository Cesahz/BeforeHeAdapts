# Contrato canónico del motor de adaptación

Semántica de referencia del núcleo. `packages/core/src/contract.test.ts` es su forma ejecutable; si divergen, se discute con el autor — nunca se resuelve la divergencia en silencio (ver `packages/core` y la Ley de arquitectura).

## Definiciones

- **Estímulo:** evento crudo del dominio (un ataque en la arena, un patrón de error en logs). El núcleo nunca lo ve directamente.
- **Firma de estímulo (`StimulusSignature`):** forma canónica del estímulo producida por el puerto `StimulusTranslator`. Vector de primitivas + intensidad + metadatos. La canonicalización garantiza que composiciones equivalentes producen la misma firma sin importar el orden de construcción.
- **Granularidad de firma:** el dial de dificultad del sistema. Demasiado fina → nada se repite, el ente nunca adapta. Demasiado gruesa → todo colapsa a pocas firmas, adapta en minutos. Es parámetro de `policy`, no constante.
- **Exposición procesada:** el estímulo completó su efecto observable sobre el ente. Estímulos truncados aportan información parcial a la firma pero NO incrementan el contador de exposiciones (ajustable por política).
- **Complejidad `c`:** número de dimensiones activas de la firma + distancia de novedad respecto a clusters conocidos.
- **Cluster:** grupo de firmas cercanas según `SignatureSpace.sim()`. La adaptación se contabiliza por cluster, no por firma exacta.

## Las 6 reglas

### R1 — Adaptación discreta
La resistencia contra un cluster solo cambia en saltos, al emitirse `AdaptationCompleted`. Property test: la serie temporal de resistencia es una función escalonada; entre eventos de adaptación, constante.

R1 y R5 son capas distintas del mismo ciclo ([ADR 0001](adr/0001-conciliar-curva-y-salto-discreto.md)): la curva de R5 es el "durante" (atenúa el *estímulo* mientras `k < N(c)`); este salto de *resistencia* es el "después" (en `k = N(c)`). No confundir `eff(k)` (magnitud del estímulo) con la resistencia adaptada del ente. `contract.test.ts` debe incluir un **test combinado R1+R5** que verifique ambas fases juntas, no solo cada regla por separado.

### R2 — Complejidad determina exposiciones
`N(c)` es monótona creciente. `N(c_mínima) = 1`. Property test: para todo par `c1 < c2`, `N(c1) ≤ N(c2)`.

### R3 — Contraataque
Al completarse una adaptación, el motor emite `CounterReady(cluster, debilidad)`. El motor NUNCA sabe qué es una contramedida concreta — eso lo implementa el dominio vía el puerto `CounterSynthesizer`. Test: todo `AdaptationCompleted` va seguido de exactamente un `CounterReady` en el mismo procesamiento.

### R4 — Memoria según política
- `permanente`: replay de cualquier prefijo del log nunca reduce una resistencia alcanzada (property test de monotonicidad).
- `por-sesion`: el estado muere con la sala; ningún dato cruza logs de salas distintas.
- `decaimiento`: decae la *confianza* (peso de la generalización), nunca la memoria del cluster en sí.

### R5 — Curva decreciente, nunca interruptor
Efectividad del estímulo tras `k` exposiciones procesadas: `eff(k) = asymptote + (base − asymptote) × r^k`, con `0 < r < 1` y asíntota `asymptote > 0` como piso explícito de la curva ([ADR 0003](adr/0003-forma-de-eff-con-piso-explicito.md)). Prohibido: efectividad 0 antes de `AdaptationCompleted`. Property test: `eff(k) > 0` para todo `k < N(c)` y `eff` estrictamente decreciente.

`base`, `r` y la asíntota son parámetros de `policy` (un dominio puede configurar la curva casi plana), pero la restricción `eff > 0` pre-adaptación es dura: es lo que impide la inmunidad binaria y mata la estrategia degenerada del counter puro. Ver R1 y ADR 0001.

### R6 — Generalización (adaptarse a lo desconocido)
Resistencia inicial contra firma nueva `s`: `R₀(s) = max_c [ sim(s,c) × transfer(c) ]` sobre clusters ya adaptados. Con radio de generalización configurable en `policy`. Test: una firma idéntica a un cluster adaptado hereda `transfer(c)` completo; una firma totalmente disímil hereda 0.

## Catálogo de eventos

Todos los eventos: `{ v: number, roomId, seq, timestamp, ...payload }`. `timestamp` es dato de entrada, nunca generado dentro del núcleo.

| Evento | Payload clave | Cuándo |
|---|---|---|
| `ExposureRecorded` | signature, clusterId, exposureCount | Exposición procesada registrada |
| `AdaptationProgressed` | clusterId, progress (count/N(c)) | Contador avanzó sin completar |
| `AdaptationCompleted` | clusterId, weakness | Contador llegó a N(c) — salto discreto |
| `CounterReady` | clusterId, weakness | Inmediatamente tras AdaptationCompleted |
| `ResistanceApplied` | signature, effApplied, k | El motor atenuó un estímulo entrante |

## Reglas para escribir código del núcleo

1. `process(estado, estímulo) → { estado', eventos[] }` — función pura. Nada de efectos.
2. Todo comportamiento nuevo entra primero como test (del contrato si es regla, unitario si es detalle).
3. Ante ambigüedad semántica (¿esto cuenta como exposición? ¿estas firmas son el mismo cluster?): no decidir en silencio — proponer opciones al autor con sus consecuencias sobre el balance.
