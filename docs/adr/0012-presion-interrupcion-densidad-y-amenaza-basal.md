# 0012 — Que la presión exista: interrupción de gestos, densidad y amenaza basal

**Estado:** Aceptada (2026-07-19). Aprobada en dirección y alcance por la revisión externa **antes** de escribirse, en dos pronunciamientos: el primero aprobó la interrupción de gestos; el segundo, tras los datos de la sonda, amplió el alcance a tres diales acoplados. **Implementación pendiente.**

Origen: playtest del autor del 2026-07-19 (*"le pude ganar, se me hizo muy fácil para lo que el objetivo promete"*) y la sonda de sesión completa que ese playtest motivó (`apps/web/src/arena/probe.ts`).

---

## Contexto

El [ADR 0011](0011-condicion-de-victoria-actos-y-firmas-viables.md) dio línea de llegada a la carrera y la calibró con una compuerta falsable: `enteMaxHp` = 150, entre los 168 de daño del orden inteligente y los 107 del ingenuo. Esa compuerta funciona y **no se toca acá**.

Pero medía una sola mitad. Su `jugarSesion` llama a `attack()` y **nunca a `hurt()`**: el jugador simulado no recibe un solo contraataque. Los 168 vs 107 miden exclusivamente la carrera de **agotamiento** — si el arsenal alcanza. La mitad de **presión** nunca se midió.

El playtest la encontró desde el otro lado: el autor ganó con el arsenal ajustado (la compuerta del 0011 acertó), **sin tensión** y en menos de 5 minutos.

### Lo que midió la sonda

Se construyó `probe.ts`: el loop completo de `main.ts`, con el planificador de contraataques andando, modelando la interrupción **antes** de implementarla. Determinista, paso de 16 ms, sin tocar `packages/core` ni `CombatSession`.

Jugador competente, orden inteligente:

| escenario | desenlace | daño | **HP jugador** | ataques | 1er golpe | **disparos del ente** | pegó | **daño en frío** |
|---|---|---|---|---|---|---|---|---|
| hoy (sin interrupción) | victoria | 150 | **100 / 100** | 62 | 70 % | **5** | 0 | **80 %** |
| con interrupción | victoria | 150 | **100 / 100** | 62 | 70 % | **7** | 0 | **80 %** |
| temerario (ignora el aviso) | muerte | 130 | 0 | 52 | 70 % | 3 | 3 | 92 % |
| ingenuo | agotamiento | 129 | 100 | 86 | 20 % | 18 | 0 | 34 % |

Cuatro hallazgos, cada uno congelado como test en `probe.test.ts`:

**1. Hoy el jugador competente gana literalmente intacto.** No es "poco daño": con atención constante es **cero**. Lo único entre el jugador y la invulnerabilidad es mirar la pantalla — nunca una decisión.

**2. El ente dispara 5 a 7 veces contra 62 ataques del jugador.** El contraataque es un evento anecdótico. Ninguna mecánica de interacción genera tensión con esta densidad, por buena que sea.

**3. El 80 % del daño que decide la carrera se inflige EN FRÍO**, antes del primer contraataque. El arsenal del ente arranca vacío y su reloj no corre hasta la primera `AdaptationCompleted`. La presión llega cuando la partida ya está jugada.

**4. La inversión perversa.** El orden **ingenuo** pelea el 66 % de su daño bajo amenaza; el competente, el 20 %. Hoy **jugar bien no es sobrevivir a la presión: es esquivarla**, cerrando la carrera antes de que el ente despierte. Cuanto mejor jugás, menos juego hay.

### El error que la sonda cazó

La revisión externa aprobó la interrupción de gestos asumiendo que había presión que interrumpir. **No la hay.** El error fue de magnitud, no de dirección — y aparece en la tabla: agregar la interrupción sube los disparos de 5 a 7, hace que el jugador resigne 6 trazos… y el desenlace no se mueve. Sigue ganando 100/100.

**Abandonar un trazo sale casi gratis cuando el ente dispara siete veces.**

Que este ADR se escribiera después de la sonda y no antes es lo que evitó publicar una mecánica correcta con una expectativa falsa.

---

## Decisión

Tres diales **acoplados**. Ninguno funciona solo, y por eso van en un solo ADR. **Ninguno toca `packages/core`.**

### 1. Interrupción de gestos

Un golpe telegrafiado que alcanza al jugador **mientras hay un trazo en curso rompe el trazo**. El trazo no se convierte en exposición: no llega al log.

Es la corrección estructural del problema de fondo — hoy `hurt()` solo resta HP (`combat.ts:211`) y no toca el estado del gesto, así que **dibujar y esquivar son actividades independientes que nunca compiten**. Con la interrupción compiten por el único recurso que este juego eligió como moneda: la atención (ADR 0009 §4, ADR 0010).

Cada gesto caro se vuelve una apuesta con el telegraph encendido. El `zigzag` (`cost 5`, ~1,2 s de trazo) deja de ser gratis.

#### La interrupción NO cobra cooldown

No se emitió firma y no hubo exposición. El ADR 0009 ya fijó el principio: **no se le cobra al jugador lo que no atacó** (un gesto rechazado por ambiguo tampoco consume cooldown). Cobrar además el cooldown volvería los gestos caros injugables en el Acto III — se los quiere **escasos, no extintos**.

El costo de ser interrumpido ya es triple y alcanza: el tiempo invertido en el trazo, la ventana de peligro en la que se estuvo expuesto, y un **stagger** breve de recuperación (`DRAW.staggerMs`, 200–500 ms) sin poder iniciar otro trazo.

#### Solo interrumpen los golpes telegrafiados

Regla de justicia, no de balance. Si algo puede interrumpir sin aviso previo esquivable, es **ruido, no dificultad**. Vale para las tres fuentes de golpe: cadencia, ruido ambiental (ADR 0009 §4) y la amenaza basal del §3 de este ADR.

#### Convergencia con el amague

Un gesto interrumpido es exactamente el **estímulo truncado** que el contrato ya define — información parcial, sin incrementar el contador de exposiciones — y que [`crecimiento-y-difusion.md`](../crecimiento-y-difusion.md) §2 aprobó con gate como mecánica de *feint*.

En este ADR el knob **arranca en cero**: la interrupción no emite nada al motor. Pero la cañería —un trazo que termina sin completarse, con su parcial— es la misma que el amague voluntario va a usar. Se deja anotado para que el futuro ADR del amague no la reinvente.

### 2. Densidad de contraataque

Cinco a siete disparos por corrida no llenan nada. La densidad sube hasta que el contraataque sea un evento **recurrente**, no anecdótico.

Los diales ya existen y viven en `balance.ts` (`COUNTER.baseIntervalMs`, `intervalAccel`, `minIntervalMs`): esto es re-calibración, no mecánica nueva. Lo que cambia es que ahora **hay con qué medirla**.

⚠️ **Subir solo este dial no arregla nada**, y la sonda lo demuestra: la densidad escala con el arsenal, y el arsenal solo existe tarde. Amontonar más golpes al final es agregar presión donde ya no queda carrera que decidir.

### 3. Amenaza basal escalante — el arranque en frío

El dial que la sonda hizo inevitable, y el único que es mecánica nueva.

**El ente ejerce una amenaza de fondo desde el segundo cero, independiente de haber adaptado nada, que escala con los clusters adaptados.**

#### Por qué no puede venir de `CounterReady`

Acá está la tensión que roza el contrato, y se resuelve explícitamente: **el ente no puede contraatacar con debilidades que todavía no aprendió.** Eso exige `AdaptationCompleted`, que exige exposiciones — R2 y R3, congelados, y está bien que lo estén.

Entonces la presión temprana **no puede** venir del arsenal. Tiene que venir de una fuente de dominio que no dependa de haber adaptado nada.

#### Qué es

Un golpe **no dirigido**: telegrafiado y esquivable como cualquier otro, pero sin dimensión de debilidad detrás, porque no hay ninguna aprendida que expresar. No es un contraataque; es el ente ocupando espacio.

- **Reloj propio**, independiente del arsenal, corriendo desde el inicio de la corrida.
- **Escala con `|arsenal|` y con el acto**, igual que los diales del ADR 0011 §4.
- **Nunca entra al log.** Un golpe del ente no es un estímulo percibido: el log registra lo que el ente aprendió, no lo que hizo (ADR 0009 §4).
- Vive en `CounterScheduler`, que ya es el dueño de la materialización del puerto `CounterSynthesizer`.

#### Por qué preserva la tesis

Los contraataques **dirigidos siguen siendo la recompensa de adaptar** — su identidad, su debilidad y su escalada no cambian. Lo que se agrega es un **piso de amenaza** que hace que atacar nunca sea gratis, ni siquiera antes del primer salto.

La tesis nunca fue "el ente está inerte hasta que aprende". Fue "el ente aprende". Un adversario que no hace absolutamente nada durante el 70 % del encuentro no ilustra la adaptación: la **posterga**.

### 4. Dónde viven los números

Todos en `apps/web/src/arena/balance.ts`, sin excepción (ADR 0009 §7). El bloque `DRAW` ya está, con los tiempos de trazo y el stagger.

⚠️ **`DRAW` es el input menos validado del archivo.** Los tiempos de trazo no salen de una medición: son estimaciones derivadas de los pisos que el propio reconocedor impone (`GESTURE.holdMinMs` = 450 es el único piso real). La sonda los barre justamente por eso. **Cuando la arena instrumente trazos reales, re-medir.**

#### Objetivo de calibración, explícito y falsable

Cada dial se calibra **contra la sonda extendida, nunca a ojo**. Los objetivos, todos verificables en `probe.test.ts`:

1. **Daño en frío < 35 %** para el jugador competente (hoy: 80 %). Es la métrica que valida si la presión temprana funcionó — si sigue alta, la carrera se resuelve en frío y ningún dial de densidad lo cambia.
2. **La inversión perversa desaparece**: la fracción en frío del competente deja de ser mayor que la del ingenuo.
3. **El jugador competente termina una corrida ganada con HP < 100.** Ganar sin recibir un solo golpe deja de ser el resultado por defecto.
4. **La compuerta del ADR 0011 sigue en pie**: el orden inteligente gana, el ingenuo pierde por agotamiento. La presión no puede volver invencible al ente — si lo hace, el dial está mal, no la compuerta.
5. **Corridas de 5–15 minutos** en tiempo real. Las duraciones de la sonda (0,7 min) no son comparables: el jugador simulado no tiene tiempo de reacción ni de decisión. Lo comparable son las proporciones.

Si (1) y (4) no se pueden satisfacer a la vez, el problema es de diseño y vuelve a revisión — no se resuelve moviendo `enteMaxHp`, que está medido y congelado.

---

## Alternativas descartadas

**Subir el daño y la cadencia del contraataque, y nada más.** Es el reflejo obvio y la sonda lo desarma: haría el juego más difícil e **igual de plano**. Con 5-7 disparos concentrados en el último tercio, subir el daño solo convierte "ganás intacto" en "ganás o morís de golpe al final", sin agregar una sola decisión.

**Bajar `enteMaxHp` para que la corrida sea más corta.** Al revés de lo que hace falta: agravaría el arranque en frío, que ya es el 80 %.

**Que la interrupción cobre cooldown.** Descartado por la revisión: vuelve los gestos caros injugables en el Acto III. Se los quiere escasos, no extintos.

**Que el ente arranque con arsenal precargado.** Violaría R2/R3 — el ente tendría debilidades que nunca aprendió. Es exactamente la trampa que la amenaza basal evita: presión sí, conocimiento no.

**Adelantar el ente móvil ([ADR futuro](../../MEMORY.md)).** Resolvería la falta de presión, pero cambia la naturaleza del combate (posicionamiento, distancia, colisión continua) y tiene su propio ADR reservado. No se adelanta.

---

## Consecuencias

**A favor:**

- La carrera tiene presión desde el primer segundo, y atacar deja de ser gratis.
- Aparecen decisiones que hoy no existen: comprometerse a un trazo caro con el aviso encendido, o resignarlo.
- Los actos cobran sentido retroactivo: en el Acto III, con la cadencia en el piso, las ventanas limpias para un `zigzag` de ~1,2 s se vuelven escasas.
- La inversión perversa se corrige: jugar bien pasa a ser sobrevivir a la presión, no esquivarla terminando antes.

**En contra / riesgos:**

- **Tres diales acoplados son más difíciles de calibrar que uno.** Mitigación: la sonda mide los tres a la vez y los objetivos son falsables.
- **La interrupción puede leerse como injusta** si el aviso no es legible. Mitigación: la regla de justicia del §1 (solo golpes telegrafiados) y el trabajo de legibilidad del ADR 0011 §4.
- **La amenaza basal puede leerse como ruido arbitrario** si no se distingue visualmente de un contraataque dirigido. Es deliberado que se distingan: uno es el ente ocupando espacio, el otro es el ente **usando lo que aprendió de vos**. Si se ven iguales, la recompensa de adaptar se vuelve invisible.
- `DRAW` sigue sin validarse contra trazos reales.

---

## Impacto en la Ley de arquitectura / contrato canónico

**Ninguno.** Todo vive en dominio.

- **R1–R6 intactos.** No se toca `packages/core`, ni el contrato, ni el esquema de eventos.
- **El log sigue siendo append-only y sigue siendo lo que el ente aprendió.** Ni la interrupción ni la amenaza basal emiten eventos. Un trazo interrumpido no llegó a ser exposición; un golpe del ente nunca lo fue.
- **Un replay viejo sigue reproduciendo el mismo estado final**, porque nada de esto entra al log.
- **`CounterSynthesizer` sigue siendo el puerto.** La amenaza basal se materializa en `CounterScheduler`, del lado del dominio, igual que la cadencia y el contraataque de ruido.
- **Enmienda menor al ADR 0009 §4:** el arsenal armado por `CounterReady` sigue siendo la única fuente de contraataques **dirigidos**. La amenaza basal es una fuente **no dirigida** y separada. El §4 decía implícitamente que sin arsenal no hay golpe; a partir de acá, sin arsenal no hay golpe *dirigido*.

Si al implementar algún dial pareciera necesitar el núcleo, **frenar y avisar**. No debería: "amenaza que no depende de lo aprendido" es precisamente lógica de dominio, no de motor.
