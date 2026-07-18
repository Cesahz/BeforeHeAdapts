# 0009 — Combatir en vivo con gestos cuantizados, ruido ambiental y contraataque materializado

**Estado:** Propuesta — requiere OK del autor antes de implementar.

## Contexto

La Fase 3a dejó la arena jugable pero **de un solo lado**: el jugador lanza composiciones desde botones y el ente aprende, y nada más. No hay cursor, no hay daño recibido, no hay derrota, y el `CounterReady` del contrato (R3) se emite y se pierde — el `CounterSynthesizer` de la arena no existe todavía. La Fase 3b es el otro lado.

Es el paquete de decisiones de *game design* más grande del proyecto hasta acá, y todas están acopladas: qué gestos existen determina cuánto puede variar un jugador en vivo; cuánto puede variar determina si el ente llega a adaptarse; si el ente adapta determina cuántos contraataques tiene; cuántos contraataques tiene determina cuánta atención cuesta sobrevivir. Decidirlas por separado garantiza que no cierren entre sí.

Cinco fuerzas empujan:

**Primera: el mouse es continuo y el motor es discreto.** El [ADR 0004](0004-frontera-de-cuantizacion-de-entrada.md) ya lo resolvió en principio — el movimiento crudo jamás cruza la frontera — pero no fija el catálogo de gestos, ni el umbral de ruido, ni qué firma emite el ruido. Este ADR los fija.

**Segunda: no puede haber una segunda economía.** El [ADR 0008](0008-catalogo-primitivas-dsl-arena.md) puso toda la moneda del juego en el cooldown por costo. Un gesto que esquive esa economía (daño gratis, cooldown propio, primitivas inventadas) la rompe. Un gesto tiene que **compilar a una composición del catálogo** y pagar lo mismo que si se hubiera lanzado desde el Builder.

**Tercera: el hallazgo de balance está congelado.** El variador puro —el que nunca repite firma— recibe daño real 1.000 indefinidamente, contra 0.010 del repetidor. Por instrucción directa del autor (2026-07-18) **nada de la Fase 3b intenta arreglar eso tocando R1 o R5**. Pero 3b introduce por primera vez costos que el harness nunca modeló, y callarlo sería peor que decirlo: el §5 de este ADR lo analiza sin tocar el motor.

**Cuarta: `packages/core` no se toca.** §0 de `diseno-adaptador-web.md`. Vida, hitbox, HUD, arsenal de contraataques y ruido son estado del dominio arena. El motor no los conoce y no se entera.

**Quinta: el contraataque tiene que ser *justo*.** Un efecto que aparece sin aviso no es dificultad, es ruido. El §6 del diseño ya prohíbe popups y flashes; falta lo que sí se hace.

## Decisión

### 1. Gestos: el trazo elige vector y patrón; el elemento es un estado que el jugador porta

Un gesto **no** puede expresar los 8 elementos del catálogo — un círculo no es más "ember" que "frost". Forzarlo produciría un mapeo arbitrario que nadie recuerda. La separación es otra:

- **El elemento es un modo**, seleccionado aparte (teclas `1`–`8` y un anillo en el HUD). Persiste entre ataques. Es la decisión lenta.
- **El gesto es el acto**: determina el vector de entrega y el patrón temporal. Es la decisión rápida.

Catálogo mínimo viable, cuatro gestos:

| Gesto | Compila a | Primitivas (`N`) | `cost` | Cooldown |
|---|---|---|---|---|
| Trazo recto rápido | `vec:projectile` | 2 | 2 | 1,0 s |
| Mantener presionado | `vec:beam` + `pat:sustained` | 3 | 3 | 1,5 s |
| Círculo | `vec:field` + `pat:pulse` | 3 | 3 | 1,5 s |
| Zigzag | `vec:wave` + `pat:escalating` + `mod:unstable` | 4 | 5 | 2,5 s |

(más el `elem:` armado, que es la primitiva obligatoria de toda composición.)

El costo no se inventa: sale de la fórmula del ADR 0008 §3 aplicada a la composición resultante. **El escalón de dificultad de trazo correlaciona con el costo**: el trazo recto es el jab barato que muere en dos exposiciones; el zigzag es difícil de dibujar, cuesta 5 y sobrevive cuatro. La economía es exactamente la de 3a, sin una constante nueva.

Esto abre **8 × 4 = 32 composiciones alcanzables en vivo**, un subconjunto propio de las 5.376 del catálogo. El Builder conserva el espacio completo: es la capa deliberada y lenta. Ver §5.

**Rechazo explícito, nunca firma inventada.** Un trazo que no supere el umbral de ninguna plantilla se rechaza con feedback visual y **no consume cooldown**: un reconocedor imperfecto no puede cobrarle al jugador sus propios errores. Un gesto reconocido cuya composición esté en cooldown se rechaza en la frontera, con feedback distinguible del anterior, y **no llega al log**.

### 2. Ruido ambiental: erraticidad sobre ventana deslizante

**Muestreo.** Las posiciones del cursor se decimando a un paso fijo de 16 ms (independiente del sampling rate del dispositivo, que varía entre 60 y 1000 Hz) en un buffer circular de `W = 32` muestras (~0,5 s).

**Métrica.** Giro medio absoluto por segmento, normalizado:

```
erraticity = Σ|Δθᵢ| / (π × (n − 2))        para i = 1 … n−2
```

Una recta da 0; una trayectoria que se dobla sobre sí misma tiende a 1. Es **invariante a escala y a velocidad** por construcción (solo mide ángulos), que es exactamente lo que el ADR 0004 necesita para que el determinismo no dependa del hardware.

**Compuerta de reposo.** Si el recorrido total de la ventana es menor a `MIN_PATH = 200 px`, la erraticidad se reporta 0. Sin esto, un cursor casi quieto produce ángulos basura por jitter sub-píxel y el ente "percibiría" a alguien que no se mueve.

**Umbral y rate-limit.** `erraticity ≥ 0.55` sostenida durante toda una ventana emite **un** estímulo de ruido, y después queda bloqueada `NOISE_COOLDOWN_MS = 3000`. Pico teórico: 20 estímulos de ruido por minuto de agitación continua.

**Firma del ruido.** Elemento propio, fuera de los 8 jugables:

```
elem:ambient | mod:unstable | pat:sustained | vec:field        → N = 4
intensity = 1        (el mínimo del catálogo: el ruido informa, no lastima)
```

Dos consecuencias buscadas. La primera: `elem:ambient` mantiene la invariante del ADR 0008 §4 —la debilidad expuesta sigue siendo siempre un `elem:`— sin colisionar con ningún ataque del jugador. La segunda: con `N = 4` y rate-limit de 3 s, el ente necesita **≥ 12 s de agitación acumulada** para adaptarse al ruido. No es un evento de un segundo.

**Reacción preventiva (§4 del diseño).** Mientras la erraticidad supera el umbral y antes de que se emita nada, el ente **se orienta**: la rotación del polígono deriva hacia el cursor y su contracción base sube proporcional a `erraticity`. Sutil, continuo, y legible como "te está mirando". Es puro render sobre estado de la arena — no toca el pipeline de frames, se compone encima.

### 3. Jugador físico: HP, daño y derrota

- `PLAYER_MAX_HP = 100`. El cursor **es** la hitbox: un punto, sin radio propio.
- La única fuente de daño es un contraataque que impacta (§4). No hay daño por contacto con el ente, no hay caída de vida pasiva.
- **Derrota = fin de la corrida.** A `HP ≤ 0` la sala se congela y se muestra un resumen: clusters adaptados, eventos del log, daño total infligido, duración. El log **se preserva** y sigue exportable — es el artefacto que le importa al proyecto. Un botón "nueva sala" construye un `Room` nuevo desde cero.

La sala **no se resetea al morir manteniendo el ente**, y tampoco se reencarna al jugador dejando el log corriendo. La razón es un incentivo perverso: si morir reseteara al ente, un jugador acorralado —y por el hallazgo congelado, *todo* jugador termina acorralado— se suicidaría para borrarle la adaptación. La derrota tiene que ser el final, no un botón de limpieza.

Encaja con el proyecto: por el hallazgo de balance, el DPS de una sesión está acotado por el catálogo y toda corrida termina agotada. Que el cierre sea "el ente ganó, acá está tu marca" es la lectura honesta de lo que el motor ya hace.

### 4. Contraataque: `CounterReady` arma un arsenal permanente; la arena lo dispara

El puerto `CounterSynthesizer` de la arena se materializa así:

**Arsenal.** `CounterReady` **no dispara** un contraataque: agrega su `weakness` a un arsenal (`Map<Primitive, {clusterId, armedAtSeq}>`) que es estado de la arena. El motor dice "hay un contraataque disponible por esta dimensión"; *cuándo y cómo* se materializa es decisión del dominio — que es precisamente lo que el puerto significa.

**Cadencia, escalada por nº de clusters adaptados (§6.4):**

```
interval = max(2500, 9000 / (1 + 0.35 × (|arsenal| − 1)))     ms
damage   = 8 + 3 × (|arsenal| − 1)                            HP
telegraph = max(320, 700 − 40 × (|arsenal| − 1))              ms
```

Un ente con un solo cluster adaptado golpea cada 9 s por 8 HP con 700 ms de aviso: apenas molesta. Con ocho, cada 3,1 s por 29 HP con 380 ms de aviso: mata a un jugador desatento en cuatro impactos.

**Anatomía de un impacto.** Al disparar, se **fija** la posición del cursor y se dibuja el telegraph: una figura geométrica convergente sobre ese punto, teñida con el color del elemento de la `weakness` elegida. Pasado `telegraph`, el golpe resuelve sobre un disco de `STRIKE_RADIUS = 60 px` alrededor del punto fijado, durante `STRIKE_MS = 150`. Cursor fuera del disco al resolver → falla, sin daño.

**Esquivar cuesta atención, no destreza.** Salir de 60 px en ≥ 320 ms es trivial *si estás mirando*. Ese es el diseño: el contraataque no compite por habilidad mecánica, compite por foco con la tarea de dibujar gestos. Es la única presión que ejerce, y es deliberada.

**Selección determinista.** Cuál `weakness` del arsenal se usa sale de `armedAtSeq` de las entradas y un contador de disparos, nunca de `Math.random()` (§6.4: "variada pero determinista").

**El contraataque de ruido tiene disparador propio.** Si `elem:ambient` está en el arsenal, un estímulo de ruido dispara además un contraataque inmediato, fuera de la cadencia y con su propio rate-limit de 3 s. Una vez que el ente aprendió tu agitación, agitarte lo invoca.

**Los disparos no entran al log.** El log del motor registra lo que el ente *percibió*, no lo que hizo; un contraataque no es un estímulo. Consecuencia declarada: un replay muestra el arsenal creciendo (vía `CounterReady`) pero no cada disparo. Ver Consecuencias.

### 5. Cómo §3 y §4 presionan al variador puro — sin tocar el motor

Análisis, **no** un arreglo. El hallazgo sigue congelado y `packages/core` intacto.

El variador puro domina en el harness porque **variar es gratis ahí**: el modelo es firma → daño, y no cobra nada por cambiar de firma. La Fase 3b introduce cuatro cobros, todos del lado del adaptador:

1. **El espacio en vivo es 32, no 5.376.** Un gesto expresa vector y patrón, no los cuatro ejes. Variar sin repetir se agota en 32 ataques y después obliga a repetir. El variador puro del harness **no es una estrategia alcanzable en vivo**: es un artefacto del modelo. El Builder conserva el espacio completo, pero componer una build es un acto deliberado que no se hace entre dos golpes.
2. **Variar cuesta tempo y errores.** Cambiar de composición implica cambiar de gesto, y los gestos caros son los difíciles de trazar. Un trazo ambiguo es una ventana perdida.
3. **Variar mueve mucho el mouse.** Alternar gestos y elementos sube la erraticidad. El variador puro es inadaptable en espacio de firmas y **perfectamente adaptable en espacio de comportamiento** — y el ADR 0004 ya dejó el canal legal abierto (ruido como exposición de baja intensidad). Su propio patrón de entrada le enseña al ente un cluster que sí puede cerrar.
4. **Morir corta el DPS a cero.** El harness modela daño por golpe, no daño por sesión. Con derrota terminal, el DPS real de una corrida es `DPS_nominal × P(seguir vivo) × (1 − atención gastada esquivando)`, y los dos factores nuevos son exactamente los que el variador —que ya gasta toda su atención en variar— peor paga.

**Advertencia registrada:** `apps/balance-sim` va a seguir reportando al variador puro como dominante después de la 3b, porque no modela ni ruido ni muerte. Post-3b sus números miden un subconjunto estricto del juego. Quien los lea tiene que saberlo. Extender el harness a estos dos ejes es trabajo futuro legítimo; no es requisito de la 3b.

### 6. Alcance: qué NO decide este ADR

La **deformación del ente** (§5 del diseño) es extensión del vocabulario de render del [ADR 0007](0007-render-svg-sobre-secuencia-de-frames.md) y vive en el visualizador, no acá. Si esa extensión crece más allá de unos pocos parámetros, va en un **ADR 0010** propio.

El reconocedor **heurístico** es lo único autorizado: el gate de la NN (`roadmap-avanzado.md` §1) exige la 3b implementada con heurística *más evidencia medida* de que no alcanza. No está cumplido.

Ubicación del reconocedor: **`apps/web/src/gesture/`**, módulo puro (puntos + timestamps → gesto → composición), con guardia de pureza sobre el fuente al estilo de `packages/visualizer/src/purity.test.ts` y property tests de invariancia a escala y velocidad. El muestreador del mouse —que sí toca DOM— queda afuera del módulo.

## Alternativas descartadas

- **El gesto determina el elemento.** El mapeo forma → elemento es arbitrario (¿por qué un círculo sería `frost`?), no se recuerda, y comprime 8 valores en 4 formas. El elemento como modo portado separa la decisión lenta de la rápida y deja los 8 elementos accesibles en vivo.
- **Los cuatro gestos con el mismo costo (3 cada uno).** Simétrico y fácil de explicar, pero aplana la economía: sin diferencia de tempo entre gestos, elegir gesto deja de ser una decisión. El escalón 2/3/3/5 correlacionado con la dificultad de trazo la devuelve.
- **Gestos con economía propia (daño o cooldown parametrizados aparte).** Es la segunda economía que el ADR 0008 §3 existe para evitar. Compilar a composición y heredar `cost` mantiene un solo dial de balance.
- **`CounterReady` dispara un contraataque inmediato y se consume.** Más literal respecto de R3 y más simple. Descartada porque un contraataque de una sola vez por cluster desaparece del juego a los pocos segundos, y porque desperdicia el puerto: si el dominio no decide nada sobre la materialización, el `CounterSynthesizer` es una función vacía. El arsenal permanente es lo que hace que un ente muy adaptado *se sienta* muy adaptado.
- **Morir resetea la sala conservando el ente / reencarnar al jugador dejando el log corriendo.** La primera crea el incentivo perverso del §3 (suicidarse para borrar la adaptación); la segunda vuelve la muerte una molestia sin consecuencia y anula el cobro (4) del §5. La derrota terminal es la única que mantiene ambos honestos.
- **Ruido usando el elemento armado del jugador.** Evitaría agregar un noveno elemento. Descartada: convertiría el movimiento del mouse en un alimentador gratuito de exposiciones contra los clusters propios del jugador — el ente adaptaría tus ataques sin que ataques.
- **Ruido con `N = 1` o `N = 2`.** El ente aprendería la agitación en 3–6 s y el canal quedaría resuelto casi de inmediato. `N = 4` lo mantiene como una amenaza que se construye durante la corrida.
- **Emitir los disparos de contraataque como eventos del log.** Haría replayables los contraataques, cerrando el hueco de las Consecuencias. Descartada: un disparo no es un estímulo percibido, y meterlo en el log exigiría un tipo de evento nuevo en `packages/core` — violando el §0 del diseño y el ADR 0006. Si algún día los replays tienen que mostrar contraataques, es un log de dominio *separado*, paralelo al del motor.
- **`packages/gesture` como paquete propio.** El límite de paquete haría *imposible* (no solo prohibido) importar DOM en el reconocedor. Descartada por proporción: son ~200 líneas y sería el sexto paquete del repo. Una guardia de pureza sobre el fuente da el mismo enforcement. Si el adaptador de auto-defensa (ADR 0005) o el server llegan a necesitar el reconocedor, la extracción es mecánica.
- **Cuantizar el gesto solo por forma, ignorando el tiempo.** Más simple de testear. Descartada porque "trazo recto **rápido**" y "mantener presionado" son distinciones temporales: sin timestamps, dos de los cuatro gestos colapsan.

## Consecuencias

**Positivas:**

- El mouse entra al juego sin que una sola coordenada cruce la frontera del motor. El log sigue siendo el mismo objeto chico y replayable de 3a.
- Cero constantes de economía nuevas: los cuatro gestos se pagan con la fórmula del ADR 0008.
- El `CounterSynthesizer` deja de ser un puerto sin implementación, y R3 pasa a tener consecuencia física.
- El reconocedor es testeable con la misma disciplina que el núcleo: trazo sintético → composición esperada, property tests de invariancia, rechazo explícito de lo ambiguo.
- La presión sobre el variador puro sale de mecánicas del dominio, no de retoques al contrato. El hallazgo congelado queda documentado en su contexto en vez de olvidado.

**Negativas:**

- **Los contraataques no son replayables.** El visualizador reconstruye el arsenal desde `CounterReady` pero no cada disparo ni cada esquive. Un replay de 3b es fiel a lo que el ente *aprendió*, no a lo que el jugador *vivió*. Es el precio de no meter eventos de dominio en el log del motor, y es la deuda más grande de este ADR.
- **Nueve constantes de tuneo nuevas** (`W`, umbral, `MIN_PATH`, `NOISE_COOLDOWN_MS`, cadencia, daño, telegraph, `STRIKE_RADIUS`, `PLAYER_MAX_HP`). Todas viven en el adaptador y ninguna toca el motor, pero es la superficie de balance más grande que el proyecto haya tenido, y ninguna está validada contra un jugador real todavía. Los números de arriba son puntos de partida, no verdades.
- **`apps/balance-sim` queda parcialmente obsoleto** como medida del juego real (§5). Sus números siguen siendo correctos sobre lo que modela; el riesgo es leerlos como si modelaran todo.
- **El "feel" del combate depende del reconocedor**, tal como el ADR 0004 ya advirtió. Cuatro plantillas heurísticas van a rechazar trazos que un humano considera obvios. El rechazo sin costo de cooldown lo hace tolerable, no invisible.
- **`elem:ambient` diluye el Jaccard** de todo el catálogo un poco (9 elementos en vez de 8) y agrega un cluster que el jugador no puede atacar. Es un ciudadano de segunda del catálogo, y hay que recordar excluirlo de cualquier UI que enumere elementos jugables.
- La derrota terminal es **dura**: perder a los 8 minutos manda al jugador al principio. Sin curva de progresión que lo amortigüe, puede leerse como castigo en vez de como cierre. Es el punto más probable de tener que revisar tras la verificación visual.

## Impacto en la Ley de arquitectura / contrato canónico

**Ninguno.** Ninguna de las 6 reglas del contrato cambia, `contract.test.ts` no se toca, `packages/core` no se toca y el esquema de eventos del [ADR 0006](0006-esquema-versionado-eventos.md) no se versiona. HP, hitbox, HUD, arsenal y ruido son estado del dominio arena; los gestos compilan a firmas que el motor ya entiende. **El `CLAUDE.md` no requiere actualización.**

Se declara un acoplamiento nuevo, en el mismo espíritu que el que el ADR 0008 §4 ya declaró: la arena asume que `CounterReady` trae una `weakness` con `dimension` prefijada por `elem:`, y colorea el telegraph a partir de ese prefijo. Lo sostiene el orden lexicográfico del ADR 0008 §4 y lo defiende un test de la arena que verifica que todo `CounterReady` emitido trae un elemento conocido.
