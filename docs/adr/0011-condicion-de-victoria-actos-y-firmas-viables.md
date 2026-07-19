# 0011 — Convertir el hallazgo de balance en la condición de derrota

**Estado:** Propuesta. Requiere OK del autor antes de implementar.

Origen: respuesta de la revisión externa al reporte de dirección de Fase 3b (P1, punto 2) y la fila "Victoria multi-acto / checklist de `CounterReady`" de [`crecimiento-y-difusion.md`](../crecimiento-y-difusion.md) §2, aprobada como dirección con la nota *"decidir el subconjunto que cuenta = diseño, con ADR"*.

---

## Contexto

El veredicto del autor tras el primer playtest completo fue: *"se representa bien para demostrar la adaptación, pero siendo sincero es aburridísimo, no hay varianza en nada"*.

El diagnóstico que devolvió la revisión externa es que **el juego no tenía condición de victoria ni amenaza**. La amenaza ya se resolvió: los contraataques disparan desde el ADR 0009 §4 y la vida del jugador baja. Falta la otra mitad.

### Las tres fuerzas

**1. La degradación monótona es la tesis, no un defecto.** Confirmado por la revisión: un adversario que olvida por conveniencia dramática deja de ser el problema conceptual del proyecto, y en los dominios serios una defensa que "descansa" es una defensa rota. **El contrato no se toca.** R1 y R5 siguen congelados.

**2. El arco lo provee el dominio, no el motor.** El error de categoría fue esperar que el motor diera el arco. En los juegos el arco nunca viene de la memoria del enemigo: viene del diseño del encuentro. El motor provee la **presión**; el dominio provee el **drama**.

**3. El hallazgo de balance congelado.** Cada build muere tras `N(c)` golpes y no revive nunca; repetir es estrictamente peor que variar, siempre. Se archivó como problema de balance y se reclasificó como problema de estructura de juego.

### La observación que ordena todo

El hallazgo de balance **no es un bug que haya que arreglar: es el reloj de la carrera, y estaba sin usar.**

> tu arsenal solo puede menguar + el ente solo puede crecer
> = carrera con deadline dramático — **si existe línea de llegada**.

Faltaba la línea de llegada. Con ella, la misma mecánica que hacía el juego aburrido pasa a ser su fuente de tensión, y el título del proyecto pasa a describir literalmente la condición de derrota: **antes de que se adapte**.

---

## Decisión

Se agregan tres piezas de dominio. **Ninguna toca `packages/core`.**

### 1. El ente tiene HP. Bajarlo a cero es la victoria

El daño ya lo calcula la sala (`AttackOutcome.damage`) y hoy no se acumula en ningún lado. Se acumula: `enteHp` es estado del dominio arena, como `PLAYER.maxHp`.

No entra al log. Un golpe recibido por el ente **sí** es un estímulo percibido y ya está en el log como `ResistanceApplied`; el HP es una lectura de dominio sobre esos eventos, no un evento nuevo. El log sigue siendo lo que el ente aprendió.

### 2. Firmas viables restantes: el círculo que se cierra

Un contador derivado, puro, calculado sobre el estado del motor:

> Una composición es **viable** si su cluster todavía no está adaptado.

Es monótono decreciente por R1 (una adaptación no se deshace) y arranca en el tamaño del catálogo disponible. Se muestra en el HUD y **es el instrumento de tensión principal**: el jugador ve encogerse su propio vocabulario, golpe a golpe, sin que nadie se lo explique.

Es el círculo del battle royale, ya aprobado como dirección en el doc de retención — con la diferencia de que acá el círculo no lo mueve un temporizador arbitrario: **lo cerrás vos, atacando**.

### 3. Derrota por agotamiento

Se pierde de dos maneras:

- **HP del jugador a cero** — ya existe (ADR 0009 §3), terminal.
- **Firmas viables agotadas con el ente todavía en pie** — nuevo. Te quedaste sin vocabulario antes de matarlo.

La segunda es la que le da sentido a todo lo demás, y es el hallazgo de balance convertido en regla explícita en vez de en defecto silencioso.

### 4. Actos: umbrales de HP del ente que suben la presión

El combate se divide en actos por umbrales de HP del ente. Cruzar un umbral **no toca el motor ni fuerza adaptaciones**: escala los diales de dominio que el ADR 0009 §4 ya definió.

| | Acto I | Acto II | Acto III |
|---|---|---|---|
| HP del ente | 100 % – 66 % | 66 % – 33 % | 33 % – 0 % |
| Multiplicador de cadencia del contraataque | ×1,0 | ×0,75 | ×0,55 |
| Multiplicador de daño del contraataque | ×1,0 | ×1,25 | ×1,6 |

Los actos son el "diseño del encuentro" que la revisión señaló como fuente real del arco: fases, no memoria selectiva.

### 5. Por qué esto crea decisiones que hoy no existen

La calibración tiene un objetivo declarado y falsable: **el spam pierde, la secuenciación gana.**

- **Spamear una composición** la adapta en `N(c)` golpes. Consecuencia triple: `eff(k)` se derrumba (poco daño), la composición sale del conjunto viable (menos vocabulario) y arma un contraataque (más amenaza). Se paga tres veces por el mismo error.
- **Secuenciar** significa decidir *qué build quemo ahora y cuál guardo*, y *cuándo gasto la ventana antes de la cristalización* — el aviso visual que ya existe desde la Fase 3a. Guardar tus composiciones más dañinas para el Acto III es una apuesta real: son las que más rápido te van a hacer falta y las que peor te van a salir si llegás sin ellas.

Ahí nacen las decisiones. Ninguna requiere una mecánica nueva: todas salen de poner una línea de llegada delante de mecánicas que ya existían.

### 6. Dónde viven los números

Todos en `apps/web/src/arena/balance.ts`, bajo una clave `VICTORY` nueva, con su rango sano documentado como el resto. **Ninguno está validado**: son puntos de partida para el playtest del autor, no verdades. La calibración fina es de la fase de balance, con su suite de ~10.000 sesiones y su compuerta de regresión del 5 % (ADR 0009 §6).

---

## Alternativas descartadas

- **Que el ente olvide (decaimiento de confianza agresivo) para dar el arco.** Es la salida obvia y está descartada por la revisión externa sin ambigüedad: mata la tesis del proyecto y arruina el caso B2B, donde la memoria implacable es la feature. Además R4 ya permite políticas con decaimiento — el punto es que la arena **no** las use.

- **Victoria por checklist de `CounterReady`** (adaptarle al ente un subconjunto específico de dimensiones). Era la formulación original del doc de retención. Descartada como condición *primaria* porque invierte el incentivo: premiaría hacer que el ente se adapte, que es exactamente lo que el jugador tiene que estar evitando. Queda disponible como **objetivo secundario o modo alternativo**, no como la meta principal.

- **Temporizador real** para la carrera. Descartada: mete presión de reloj en un juego cuya presión de diseño es la atención (ADR 0009 §4), y sobre todo es *arbitraria* — el deadline que ya existe sale de la mecánica, y uno inventado encima lo taparía.

- **HP del ente como evento del motor.** Descartada por la misma razón que los disparos de contraataque (ADR 0009 §4): exigiría un tipo de evento nuevo en `packages/core` para un concepto de dominio, violando el §0 del diseño y el ADR 0006. El HP se deriva del log; no se guarda en él.

- **Meta-progresión entre corridas** (desbloquear primitivas). Descartada acá y bloqueada por gate duro: por §2.1 del doc de retención, en este juego **la paleta ES poder**, y no se diseña antes de resolver el hallazgo de balance. Este ADR usa el hallazgo, no lo resuelve.

- **Que el ente se mueva y persiga.** Fuera de alcance a propósito: es su propio ADR, ya anotado como trabajo futuro, y llega después de esto.

---

## Consecuencias

**Positivas:**

- **El hallazgo de balance deja de ser deuda y pasa a ser la mecánica central.** No hay que arreglarlo para que el juego funcione; hay que exponerlo. Es el mejor resultado posible de una consulta que empezó pidiendo permiso para tocar el contrato.
- **El título del juego describe la condición de derrota.** "BeforeHeAdapts" pasa a ser literal.
- **Riesgo de arquitectura casi nulo.** Todo es dominio de arena: `packages/core` no se toca, no se versionan eventos, `contract.test.ts` no cambia. Un parche de balance de esto sigue siendo un diff de un archivo.
- **La tensión es legible sin tutorial.** El contador de firmas viables bajando es autoexplicativo, y el jugador entiende que lo cierra él.

**Negativas:**

- **Los números son invento.** Los umbrales de acto, los multiplicadores y el HP del ente no están validados por nada. El primer playtest casi con seguridad los va a encontrar mal, y hasta la fase de balance no hay forma de saber si "el spam pierde" se cumple de verdad o es solo la intención.
- **"Firmas viables" tiene una definición discutible.** Se cuenta el catálogo de composiciones cuyo cluster no está adaptado, pero por R6 una firma nueva hereda resistencia de sus parientes: una composición "viable" puede nacer ya casi inútil. El contador va a ser **optimista**, y el jugador va a sentir que se queda sin opciones antes de que el número llegue a cero. Es un error conocido y aceptado: la alternativa (ponderar por resistencia heredada) daría un número más honesto y mucho menos legible.
- **Tres actos es una estructura impuesta.** No sale de ninguna propiedad del motor; es diseño de encuentro puro. Si el playtest dice que los saltos se sienten arbitrarios, la respuesta es rediseñarlos, no buscarles justificación en el contrato.
- **La derrota por agotamiento puede sentirse injusta la primera vez.** El jugador que gastó su vocabulario en el Acto I no tiene forma de recuperarse, y eso es correcto por diseño pero necesita comunicarse mucho antes de que ocurra — de ahí que el contador vaya en el HUD desde el primer golpe y no aparezca cuando ya es tarde.
- **Sube el acoplamiento entre la arena y el catálogo del ADR 0008.** El contador de viables necesita saber cuántas composiciones existen; si el catálogo cambia, el balance de la carrera cambia con él.

---

## Impacto en la Ley de arquitectura / contrato canónico

**Ninguno.** No cambia ninguna de las 6 reglas del contrato, no toca `packages/core`, no versiona eventos (ADR 0006 intacto) y no modifica `contract.test.ts`. R1 y R5 siguen congelados y este ADR **depende** de que sigan así: la carrera existe *porque* la adaptación es monótona e irreversible.

**No se propone ninguna actualización del `CLAUDE.md`.**

Sí conviene registrar en `docs/crecimiento-y-difusion.md` §2 que la fila "Victoria multi-acto / checklist de `CounterReady`" quedó resuelta por este ADR, con el matiz de que el checklist pasó de meta primaria a objetivo secundario.
