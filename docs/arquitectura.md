# BeforeHeAdapts — Arquitectura y ruta de desarrollo

**Autor del concepto:** Cezah · **Fecha:** 2026-07-17
**Basado en:** "Motor de adaptación — intención y arquitectura de referencia" (documento fuente)

---

## 0. Conclusión ejecutiva

Cinco decisiones que resuelven los cuatro puntos abiertos del documento fuente:

1. **El proyecto no es un juego ni una web: es una biblioteca.** El motor de adaptación se construye como un núcleo puro, agnóstico de dominio, con arquitectura hexagonal (puertos y adaptadores). Los dominios son adaptadores enchufables. Esto es lo que lo convierte en pieza de portafolio de arquitectura y no en un fan-project.
2. **Dominio vitrina: la arena web** ("ataquen al ente"). El problema de "no tiene sentido atacar con cosas ya programadas" se resuelve con un **DSL composicional de ataques**: las primitivas están programadas, pero el espacio de combinaciones es enorme y emergente. Los usuarios no escriben código — componen.
3. **Event sourcing en el núcleo.** Cada exposición y adaptación es un evento inmutable en un log. Reproducir el log = visualización = gifs = tests deterministas. Esto resuelve directamente el sueño de "representar los ciclos de adaptación de forma gráfica".
4. **Adaptarse a lo desconocido = generalización por similitud.** Una firma nunca vista hereda resistencia parcial de los clusters ya adaptados según su cercanía. El ente nunca parte de cero absoluto contra algo que se parece a lo conocido.
5. **(Opcional, multiplicador de portafolio)** Un segundo adaptador "serio" (logs/anomalías de servidor) que demuestra que el mismo núcleo funciona en dos dominios sin tocar una línea del motor.

---

## 1. Crítica del concepto actual

Lo que ya está bien resuelto:

- La separación problema conceptual / producto final. Es la decisión más importante y ya está tomada.
- La curva decreciente de resistencia en vez de inmunidad binaria (evita la estrategia degenerada).
- El contrato canónico reducido a 4 reglas verificables.

Los huecos que el documento fuente trata como pendientes menores pero son centrales:

**Hueco 1 — La firma de estímulo ES el problema, no un ítem del catálogo.**
Contar exposiciones es trivial. Lo difícil es canonicalizar un estímulo arbitrario en una firma comparable: decidir cuándo dos ataques son "el mismo" y cuándo son distintos. Todo el diseño del motor gira alrededor de esto. Si la firma es demasiado fina, nada se repite y el ente nunca adapta; si es demasiado gruesa, todo colapsa a pocas firmas y adapta en minutos. La granularidad de la firma es el dial de dificultad real del sistema.

**Hueco 2 — "Complejidad" sin métrica.**
El contrato dice que estímulos complejos requieren más exposiciones, pero no define complejidad. Hace falta una función `N(c)`: complejidad → exposiciones requeridas. Propuesta: complejidad = número de dimensiones activas de la firma + distancia de novedad respecto a clusters conocidos.

**Hueco 3 — "Contraataque" no está definido fuera del juego.**
En el núcleo debe ser un puerto (interfaz `CounterSynthesizer`): el motor detecta y reporta la debilidad; cada dominio decide qué significa explotarla (en la arena: un castigo mecánico; en logs: una regla de mitigación generada).

**Hueco 4 — Memoria permanente en dominios reales causa lock-in.**
Si el ente adapta contra un patrón mal clasificado, queda envenenado para siempre. La memoria debe ser una **política intercambiable**: permanente (canon), por sesión (salas de la arena), o con decaimiento de confianza (dominios reales). El documento fuente ya intuye esto ("depende del proyecto puede ser por sesión") — hay que elevarlo a decisión de arquitectura.

**Hueco 5 — Qué cuenta como "exposición procesada".**
¿Un estímulo interrumpido cuenta? ¿Cuenta parcial? Definir explícitamente: una exposición se registra cuando el estímulo completó su efecto observable sobre el ente. Estímulos truncados aportan información parcial a la firma pero no incrementan el contador (regla ajustable por política).

**Riesgo mayor — el meta de spam de novedad.**
Si la novedad siempre gana, la estrategia óptima de los atacantes es aleatorizar combinaciones sin coherencia. Es la versión inversa del colapso "velocidad/burst" de tus intentos previos. Mitigación doble: (a) economía de ataque — la complejidad encarece el ataque tanto como retrasa la adaptación; (b) generalización — firmas cercanas heredan resistencia, así que aleatorizar dentro de una zona ya cubierta no funciona.

---

## 2. Análisis de dominios

| Dominio | Valor portafolio | Demo visual | Riesgo técnico | Veredicto |
|---|---|---|---|---|
| Arena web comunitaria | Alto (viral, comunidad) | Altísimo | Medio (el DSL lo domestica) | **Vitrina — elegido** |
| Servidor adaptativo a errores/logs | Alto (serio, backend) | Medio | Bajo–medio | **Segundo adaptador — opcional** |
| Anti-fraude / WAF | Alto pero delicado | Bajo | Alto (datos reales, afirmaciones de seguridad) | Descartado por ahora |
| Juego por turnos puro | Ya explorado | Alto | Conocido (colapsa) | Producto no; queda como simulador de tests |

La clave: elegir la arena **no te casa con "es un juego"**. La arena es un adaptador; el motor es el proyecto. Si mañana la arena no funciona como producto, el motor sigue intacto y el segundo adaptador lo demuestra.

---

## 3. El contrato del motor (especificación ejecutable)

Las reglas canónicas del documento fuente, más dos derivadas, convertidas en invariantes testeables. **Este contrato se escribe como suite de tests de aceptación antes de implementar nada** — es la especificación viva del proyecto.

1. **Adaptación discreta.** La resistencia contra una firma solo cambia en saltos, al completarse una adaptación. Property test: la función resistencia-en-el-tiempo es escalonada, nunca continua.
2. **Complejidad → exposiciones.** `N(c)` es monótona creciente. Firma simple: 1 exposición. Firma compuesta: varias.
3. **Contraataque.** Al completar una adaptación, el motor emite `CounterReady(firma, debilidad_detectada)`. El dominio la materializa. El motor nunca sabe qué es un contraataque concreto.
4. **Memoria según política.** Con política "permanente": reproducir cualquier prefijo del log de eventos nunca reduce una resistencia ya alcanzada. Con "por sesión": el estado muere con la sala. Con "decaimiento": la confianza (no la memoria) decae sin refuerzo.
5. **Curva decreciente, nunca interruptor** (derivada del doc fuente §3). Efectividad del estímulo tras k exposiciones: `eff(k) = asymptote + (base − asymptote) × r^k`, con `asymptote > 0` como piso explícito de la curva ([ADR 0003](adr/0003-forma-de-eff-con-piso-explicito.md)). Sin inmunidad instantánea ni inmunidad de facto en el límite.
6. **Generalización** (nueva — resuelve "adaptarse a lo que desconoce totalmente"). Resistencia inicial contra firma nueva `s`: `R₀(s) = max sobre clusters adaptados c de [ sim(s,c) × transfer(c) ]`. Lo desconocido se enfrenta con lo aprendido de lo parecido.

---

## 4. Arquitectura del núcleo

Hexagonal (puertos y adaptadores) + event sourcing. El núcleo es una función pura sin I/O, sin reloj propio (el tiempo entra como dato del evento), 100% determinista.

```
                    ┌─────────────────────────────────────────┐
                    │                DOMINIO                  │
                    │  (arena web / logs / lo que sea)        │
                    └───────┬─────────────────────▲───────────┘
                            │ estímulo crudo      │ contramedida
                    ┌───────▼─────────┐   ┌───────┴───────────┐
     PUERTOS        │ StimulusTranslator│ │ CounterSynthesizer │
                    └───────┬─────────┘   └───────▲───────────┘
                            │ StimulusSignature   │ CounterReady
        ┌───────────────────▼─────────────────────┴─────────────┐
        │                      NÚCLEO (puro)                    │
        │                                                       │
        │  signature/  canonicalización + SignatureSpace (sim)  │
        │  policy/     N(c), curva, memoria, generalización     │
        │  engine/     (estado, estímulo) → (estado', eventos)  │
        │  ledger/     log de eventos inmutable                 │
        └───────────────────────┬───────────────────────────────┘
                                │ eventos
                    ┌───────────▼───────────┐
                    │  EventSink (puerto)   │──► persistencia
                    │                       │──► visualizador / gifs
                    └───────────────────────┘
```

### Módulos

**`signature/`** — El corazón (Hueco 1).
`StimulusSignature`: vector de primitivas canónicas + intensidad + metadatos. La canonicalización garantiza que "fuego+rápido+ráfaga" produce la misma firma sin importar el orden de construcción. `SignatureSpace`: métrica de similitud entre firmas (distancia ponderada sobre primitivas) — alimenta la generalización y el clustering.

**`ledger/`** — Event sourcing.
Eventos del dominio del motor: `ExposureRecorded`, `AdaptationProgressed`, `AdaptationCompleted`, `CounterReady`, `ResistanceApplied`. El estado del ente es siempre una función de reducir el log. Nunca se muta estado directamente.

**`policy/`** — Todas las reglas como estrategias puras e intercambiables.
`N(c)`, forma de la curva de resistencia, política de memoria, radio de generalización. Mismo motor, distintas configuraciones = distintos "Mahoragas" (uno agresivo que adapta rápido, uno lento pero de memoria eterna...). Esto también es lo que balanceás con datos reales de las salas.

**`engine/`** — Orquestación.
`AdaptationEngine.process(estado, estímulo) → (estado', eventos[])`. Función pura. Toda la asincronía, red y persistencia viven fuera, en los adaptadores.

### Por qué event sourcing es la decisión clave

- **Visualización:** el visualizador no mira el sistema en vivo — reproduce el log y lo renderiza como animación. Los gifs de "ciclos de adaptación y armonía" salen de acá.
- **Tests:** logs golden reproducibles; property testing sobre secuencias de eventos.
- **Balance:** los logs de salas reales de la arena te dicen exactamente qué estrategias dominan el meta.
- **Demostrabilidad:** aunque una adaptación no se pueda "representar", siempre se puede **demostrar** reproduciendo el log — que es exactamente lo que pedía la nota del autor.

---

## 5. Adaptador vitrina: la arena web

### El DSL de ataques (resuelve "ataques ya programados")

Un ataque es una **composición de primitivas** en ~4 ejes:

| Eje | Ejemplos | Cardinalidad orientativa |
|---|---|---|
| Elemento/tipo | fuego, corte, presión, sonido... | ~8 |
| Vector de entrega | directo, área, retardado, persistente... | ~6 |
| Patrón temporal | ráfaga, sostenido, alternado, crescendo... | ~5 |
| Modificadores | finta, eco, perforante, inestable (combinables) | ~2⁴ |

≈ 3.800 firmas base antes de contar intensidades y secuencias. Los usuarios no escriben código (cero problema de sandboxing): **componen**, como cartas de Magic. La novedad es combinatoria y emergente — suficiente espacio para que comunidades descubran estrategias reales, que es exactamente la visión de "personas organizándose para vencer a Mahoraga".

### Economía de ataque (mata el spam de novedad)

- La complejidad de un ataque encarece su costo/cooldown en la misma proporción en que retrasa la adaptación del ente.
- La estrategia óptima deja de ser aleatorizar y pasa a ser: **coordinar diversidad coherente y explotar la ventana antes de que la adaptación complete** — la carrera de tempo del documento fuente, ahora como mecánica social.

### Salas

- Un ente por sala, memoria **por sesión** (política del canon aplicada a nivel sala).
- Raid comunitario: vencer al ente antes de que cierre todas las ventanas de adaptación.
- Contraataque en este dominio: el ente castiga la rama dominante del meta de la sala — sube el costo de ese eje, refleja parte del efecto, o bloquea temporalmente el eje explotado.
- Leaderboard: "primera sala en vencerlo", historial de estrategias ganadoras (extraído del log de eventos).

---

## 6. Segundo adaptador (opcional): servidor adaptativo a errores

- **Estímulo:** patrón de error / tráfico anómalo. **Firma:** plantilla canónica (tipo de error, ruta, forma del payload). **Contramedida sintetizada:** circuit breaker, rate limit, cuarentena de endpoint.
- **Demo:** un script de chaos-injection ataca un servicio de juguete; el motor adapta en vivo; el **mismo visualizador** muestra el ciclo.
- **Valor:** dos dominios, cero cambios en el núcleo. Es el argumento de arquitectura más fuerte que puede tener el portafolio.

---

## 7. Stack — DECIDIDO: TypeScript

**TypeScript monorepo (pnpm workspaces):**

```
packages/core        → motor puro, CERO dependencias. Vitest + fast-check (property testing)
packages/visualizer  → replay del log → canvas/SVG animado; export gif/webm (headless + ffmpeg)
apps/server          → Node/Bun + WebSocket (salas), SQLite/Postgres para logs de eventos
apps/web             → cliente (React o Svelte): builder de ataques + vista del ente
```

Justificación: un solo lenguaje del núcleo al navegador; el motor corre **idéntico** en server y cliente (replay local, predicción); la visualización es nativa web.

**Rust no se descarta — se pospone a la Fase 6.** La escalabilidad de este sistema no vive en el lenguaje: vive en la arquitectura (salas independientes, event sourcing, escalado horizontal). Cuando el motor esté en verde y la arena viva, el núcleo se reescribe en Rust→WASM contra la misma suite de tests del contrato, sin tocar nada más. Aprender Rust contra un sistema real y verificado, no contra un proyecto frágil en arranque.

### Tres reglas de diseño para escala (desde el día uno)

1. **Log de eventos append-only con esquema versionado.** Nunca se muta ni borra; cada tipo de evento lleva versión para poder migrar el formato sin romper replays viejos.
2. **Nada compartido entre salas.** Cada sala = un motor + un log, aislados. Shardear salas entre procesos/máquinas es entonces trivial.
3. **Server como capa fina.** El server solo enruta mensajes hacia el motor y difunde eventos; toda la lógica vive en `packages/core`. Si el server no tiene lógica, cambiar de runtime (Node → Bun → workers) no cuesta nada.

---

## 8. Ruta de desarrollo

| Fase | Qué | Duración orientativa | Hito |
|---|---|---|---|
| **0 — Contrato** | Las 6 reglas del §3 escritas como tests de aceptación ejecutables, antes de implementar. Ese archivo ES la spec. | ~1 semana | Spec ejecutable en verde parcial |
| **1 — Núcleo** | `signature` + `ledger` + `policy` + `engine`. Puro, property tests. CLI de simulación: script de ataques (JSON) → log de eventos. | 2–3 semanas | Contrato 100% en verde |
| **2 — Visualizador** | Log → animación: curvas de resistencia por firma, saltos de adaptación, red de similitud entre clusters. | 1–2 semanas | **Primer material publicable: gifs de simulaciones, sin web todavía** |
| **3 — Arena local** | DSL + builder + ente en el navegador, single-player, todo client-side (el motor corre en el navegador). | 2–3 semanas | **Segundo hito publicable: demo jugable** |
| **4 — Salas online** | Server autoritativo, WebSocket, salas, persistencia, deploy. | 3–4 semanas | El sueño comunitario en producción |
| **5 — Auto-defensa del sitio** | El mismo motor supervisa la seguridad operativa de la arena (rate limiting, mitigación de bots) como segundo dominio real, en instancia y log separados. Modo sombra primero. + writeup "mismo motor, dos dominios". | ~2 semanas (opcional) | Argumento de arquitectura completo, demostrado en producción |
| **6 — Núcleo en Rust** | Reescribir `packages/core` en Rust→WASM contra la misma suite del contrato. Cero cambios fuera del núcleo. | opcional, sin apuro | Writeup: "mismo contrato, dos implementaciones" + aprendizaje de Rust sobre sistema real |

La Fase 5 fue redefinida por [ADR 0005](adr/0005-adaptador-de-autodefensa-del-sitio.md): el adaptador de logs/anomalías de juguete se reemplaza por la auto-defensa del sitio, con condiciones no negociables (instancia y log aislados, traducción por puertos, modo sombra antes que modo activo, frenos duros y kill-switch).

Nota sobre el orden: la Fase 2 va **antes** que cualquier web a propósito. Tenés material para redes al mes de empezar, y cada fase posterior reutiliza el visualizador. Nunca hay un período largo sin nada que mostrar.

### Qué mostrar en el portafolio

README con el contrato canónico y su origen conceptual, ADRs (decisiones de arquitectura registradas: por qué event sourcing, por qué hexagonal, granularidad de firma), cobertura y property tests del núcleo, gifs del visualizador, link a la arena, y el writeup de dos dominios.

---

## 9. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Meta degenerado de spam de novedad | Economía de costos (§5) + generalización (§3.6): aleatorizar dentro de una zona cubierta no rinde |
| "Se siente fácil una vez resuelto" (el problema original de tus prototipos) | Contraataque dinámico + generalización crean contrajuego móvil; el balance fino se hace con datos: los logs de salas reales revelan qué domina |
| Scope creep de la arena | Fases 3 y 4 separadas; el motor nunca depende de la arena |
| Granularidad de firma mal calibrada (Hueco 1) | Es un parámetro de `policy`, no una constante: se ajusta con simulaciones de la Fase 1 antes de tocar la web |
| "No se puede representar gráficamente" | El visualizador trabaja sobre el log, no sobre el sistema vivo: siempre es posible al menos demostrar reproduciendo eventos |

---

## 10. Primer paso concreto

Crear el repo con `packages/core` vacío y un solo archivo: `contract.test.ts` con las 6 reglas del §3 como tests que fallan. Todo lo demás del proyecto existe para ponerlos en verde.