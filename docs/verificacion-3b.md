# Verificación humana de la Fase 3b

**Estado:** documento vivo. Se le agrega una sección por cada paso de la 3b que aterriza, **mientras el razonamiento está fresco** — no se reconstruye de memoria al final.

## Para qué existe

Los tests automáticos de la 3b se corren contra **trazos sintéticos generados por el mismo código que los interpreta**. Eso verifica la geometría y protege contra regresiones, pero es estructuralmente incapaz de responder la única pregunta que importa: *¿se siente bien en una mano humana?*

Este documento lista lo que **solo el autor puede falsificar**. Cada entrada tiene:

- **Qué hacer** — la acción concreta.
- **Qué tiene que pasar** — el resultado esperado, en términos observables. Si no es observable, la entrada está mal escrita.
- **Si falla** — qué constante de `apps/web/src/arena/balance.ts` se mueve y en qué dirección. Esto es lo que convierte "no me gusta" en un parche de una línea.

Regla: **ninguna entrada dice "¿se siente bien?"**. Si no se puede contestar sí o no mirando la pantalla, no va.

Prioridad: 🔴 bloqueante (si falla, no se cierra la fase) · 🟡 ajuste (se anota y se tunea) · ⚪ curiosidad (información, no veredicto).

---

## Cuándo testear

**Dos rondas, no una al final.**

| Ronda | Cuándo | Cubre | La pregunta |
|---|---|---|---|
| **1** | tras el paso 4 (HUD + cableado) | R1–R9 | ¿la capa de entrada se siente bien en la mano? |
| **2** | tras el paso 7 (combate completo) | R10+ | ¿el combate se lee y se puede jugar? |

La ronda 1 va **temprano a propósito**. Los umbrales del reconocedor son lo más frágil de la fase y son el cimiento de todo lo demás; recalibrarlos en el paso 5 es editar una línea de `balance.ts`, y en el paso 8 es revisar si todo lo construido encima sigue teniendo sentido.

Antes del paso 4 no hay nada que probar a mano: el combate existe y está testeado, pero no está cableado a la pantalla.

## Cómo reportar

```
[R2] círculo
Hice: 10 círculos naturales, tamaño mediano, sin practicar
Pasó: 4/10 reconocidos, el resto "ambiguo"
Esperaba: >=8/10
Replay: replay-sala-local-....json (adjunto)
```

Usar `[NUEVO]` en vez del número para lo que no esté en la lista. Esos importan especialmente: la lista la escribió Claude, así que arrastra sus puntos ciegos.

Tres pedidos concretos:

1. **Números, no impresiones, en R1 y R2.** "El círculo anda mal" obliga a adivinar; "4 de 10" dice cuánto mover el umbral y para qué lado.
2. **Exportar el replay si el bug toca el log.** Es lo más valioso que se puede adjuntar y es específico de este proyecto: el replay es determinista, así que la sesión se vuelve un fixture golden y el bug se reproduce exacto en un test. Con replay se arregla con certeza; sin replay, con hipótesis.
3. **Separar bugs de balance.** Si algo se siente *injusto, muy difícil o muy fácil*, eso no es un bug: es balance, y por decisión del autor no se ajusta a ojo. Marcarlo `[BALANCE]` — se anota como insumo de la suite de 10.000 sesiones y **no se toca en 3b**. Si los dos canales se mezclan, el balance termina parcheado por intuición, que es justo lo que la fase de balance existe para evitar.

---

## Paso 2 — Reconocedor de gestos

`pnpm --filter @beforeheadapts/web test` (83 verdes) cubre la geometría. Lo que **no** cubre:

### 🔴 R1. El vaivén no puede comprar un círculo

**Qué hacer:** con el botón apretado, sacudir el mouse violentamente de izquierda a derecha, en línea, unas 10 veces seguidas. Repetir en diagonal y en vertical.

**Qué tiene que pasar:** rechazo, o a lo sumo `straight`. **Jamás `circle` ni `zigzag`.**

**Por qué es bloqueante:** es un bug que ya existió y arreglé a ciegas. Un giro de 180° no tiene sentido horario ni antihorario, pero `atan2` obliga a elegir un signo, y N vaivenes acumulaban N·π de rotación falsa. Lo arreglé con `GESTURE.cuspRad` y lo cubre un property test — pero el test usa *mi* idea de cómo se sacude un mouse, no la tuya. Si esto falla, el reconocedor está regalando el ataque más caro del juego por temblar.

**Si falla:** bajar `GESTURE.cuspRad` (2,7 → 2,5). Si aun así pasa, el problema no es el umbral y hay que avisarme.

### 🔴 R2. Los cuatro gestos salen a la primera

**Qué hacer:** dibujar cada uno **10 veces, sin practicar**, como saldría en medio de una pelea:

| Gesto | Cómo | Esperado |
|---|---|---|
| Recto | manotazo rápido en cualquier dirección | `straight` |
| Círculo | un círculo natural, del tamaño que te salga | `circle` |
| Zigzag | sierra de 6–8 picos | `zigzag` |
| Hold | apretar y no moverse ~1 s | `hold` |

**Qué tiene que pasar:** **≥ 8 de 10** en cada uno. Anotá el conteo, no la impresión.

**Sospecha declarada:** creo que el **círculo y el zigzag** son los que te van a pelear. Los umbrales están calibrados contra círculos matemáticamente perfectos y sierras de amplitud constante; una mano real cierra mal los círculos y hace picos desparejos.

**Si falla el círculo:** subir `circleMaxClosure` (0,25 → 0,35) tolera círculos mal cerrados; bajar `circleMinNetTurn` (5,0 → 4,4) tolera vueltas incompletas. Bajar `circleMinExtentPx` (90 → 70) si dibujás chico.

**Si falla el zigzag:** bajar `zigzagMinAbsTurn` (4,0 → 3,5) y `zigzagMinReversals` (3 → 2) si hacés pocos picos; bajar `zigzagMinExtentPx` (200 → 150) si lo hacés compacto.

### 🟡 R3. El rechazo se entiende

**Qué hacer:** provocar los tres rechazos a propósito — un trazo recto **lento** (`lento`), medio círculo (`ambiguo`), un roce mínimo (`insuficiente`).

**Qué tiene que pasar:** los tres se distinguen entre sí en pantalla, y sabés qué corregir sin leer el código. `lento` en particular tiene que decirte "más rápido", no "no te entendí".

**Por qué importa:** el rechazo no consume cooldown a propósito (ADR 0009 §1) — un reconocedor imperfecto no te puede cobrar sus errores. Pero si el feedback es opaco, la generosidad no se nota y se siente igual de injusto.

### 🟡 R4. Recto lento: ¿molesta el piso de velocidad?

**Qué hacer:** trazar rectas cómodas, sin apurarte.

**Qué tiene que pasar:** salen `straight` la mayoría de las veces.

**Tensión declarada:** el catálogo lo llama "trazo recto **rápido**" y por eso hay piso de velocidad (`straightMinSpeedPxPerMs` = 0,4 px/ms). Si tu ritmo natural queda debajo, vas a comer rechazos `lento` todo el tiempo por una palabra del catálogo. Es el candidato más claro a que el diseño esté mal, no la constante.

**Si falla:** bajar a 0,3. Si a 0,3 sigue molestando, la decisión de diseño se revisa: puede que "rápido" tenga que salir del nombre del gesto.

### ⚪ R5. ¿Cuál es tu quinto gesto?

Mientras probás, fijate qué trazo te sale **naturalmente** que hoy no existe (¿una V? ¿una espiral? ¿un doble círculo?). El catálogo de cuatro es el mínimo viable, no un límite. Anotalo: agregar un gesto es agregar una fila a la tabla del ADR 0009 §1 y su composición.

---

## Paso 3 — Cuantización e integración

⚠️ **Estas entradas recién se pueden ejecutar cuando aterrice el paso 4**, que es el que cablea el combate a la pantalla. El paso 3 quedó verificado por tests (`combat.test.ts`, 11 tests) pero no tiene superficie visual propia.

Lo que los tests **ya garantizan** y no hace falta que revises a mano: un minuto de agitación a 125 Hz (7.500 posiciones) produce menos de 100 eventos, todos de tipos válidos del ledger; duplicar el sampling rate no cambia el log; un gesto en cooldown no llega a la sala.

### 🟡 R6. El ruido se detecta cuando corresponde

⚠️ **Corrección de alcance.** En la ronda 1 el ruido se ve **solo en el medidor de agitación del HUD**. La reacción visible del ENTE (orientarse hacia el cursor, contraerse) es vocabulario de render y llega en el paso 5, así que esa mitad se verifica en la ronda 2 — ver R14.

**Qué hacer:** mover el mouse de forma agitada (sin apretar el botón) durante ~15 segundos, mirando el medidor de agitación del HUD.

**Qué tiene que pasar:** el medidor sube al agitarte y baja al moverte suave. A los ~12 s de agitación acumulada aparece en la bitácora que el ente percibe agitación, y el contador de contraataques llega a 1.

**Si falla por sordo** (te agitás y el medidor no sube): bajar `NOISE.threshold` (0,55 → 0,45). **Si falla por sensible** (sube jugando normal): subirlo a 0,65.

### 🟡 R7. Jugar normal no debería despertar el ruido

**Qué hacer:** una sesión normal de ~2 minutos, dibujando gestos y sin agitarte a propósito.

**Qué tiene que pasar:** el ente **no** aprende `elem:ambient`. Verificable exportando el replay y buscando `ambient` en las firmas.

**Por qué importa:** el ruido está pensado como castigo a la agitación deliberada, no como impuesto al juego normal. Si aparece sin que lo provoques, el umbral está bajo y el canal pierde su significado.

### 🟡 R8. El rechazo por cooldown se distingue del rechazo por ambiguo

**Qué hacer:** lanzar el mismo gesto dos veces seguidas (el segundo cae en cooldown), y por separado dibujar algo ininteligible.

**Qué tiene que pasar:** dos feedbacks **claramente distintos**. El primero dice "todavía no"; el segundo dice "no te entendí".

**Por qué importa:** son dos fallas con remedios opuestos — esperar contra volver a dibujar. Si se ven igual, el jugador aprende la lección equivocada. Además solo uno de los dos te cobró tempo.

### ⚪ R9. Rotar elementos como estrategia

**Qué hacer:** lanzar el mismo gesto varias veces seguidas cambiando el elemento entre golpe y golpe (teclas 1-8).

**Qué tiene que pasar:** funciona — cada elemento tiene su propio cooldown, porque son clusters distintos.

**Es información, no veredicto:** esto *es* el variador puro jugable, y quiero saber si se siente como una estrategia legítima o como un exploit aburrido. La respuesta alimenta la futura fase de balance, no un cambio ahora.

## Paso 4 — HUD y cableado

**A partir de acá la ronda 1 es ejecutable.** Comando: `pnpm --filter @beforeheadapts/web dev` → http://localhost:5173

Cómo se juega: **dibujás sobre la escena** (el área del ente) manteniendo apretado el botón y soltando al terminar el trazo. El elemento se arma con las **teclas 1-8** o clickeando en el HUD. Los botones de prefabs y el Builder siguen funcionando igual que en 3a.

### 🔴 R10. El HUD no miente

**Qué hacer:** lanzar un gesto y mirar la fila de ese gesto en el HUD; después cambiar de elemento (tecla distinta) y volver a mirar.

**Qué tiene que pasar:** la barra de cooldown se llena progresivamente y la fila se marca disponible justo cuando el gesto vuelve a entrar. Al **cambiar de elemento el mismo gesto aparece disponible de nuevo** — son clusters distintos, así que es correcto, no un bug.

**Por qué es bloqueante:** un HUD que miente sobre el cooldown hace que cada rechazo se sienta arbitrario, y arruina la lectura de todo lo demás que probemos.

### 🔴 R11. El trazado no le roba clics al resto de la página

**Qué hacer:** usar los botones de prefabs, el Builder (selects, sliders, inputs) y el botón de exportar, normalmente.

**Qué tiene que pasar:** todo funciona y **ningún clic en el panel se interpreta como un trazo**. El muestreo está enganchado a la escena, no al documento, justamente para esto.

**Caso borde que me interesa:** empezar un trazo dentro de la escena y **soltar el botón fuera** (sobre el panel, o fuera de la ventana). El trazo tiene que cerrarse igual y no dejar puntos colgados que se peguen al gesto siguiente.

### 🟡 R12. Los cooldowns dejan jugar

**Qué hacer:** una sesión de ~3 minutos usando los cuatro gestos.

**Qué tiene que pasar:** hay algo que hacer casi siempre; no se siente que estés mirando barras llenarse.

**⚠️ Ojo con el canal:** si el problema es que *no da* lanzar nada, eso es un bug de integración y va como bug. Si es que *se siente lento o aburrido*, eso es `[BALANCE]` y NO se toca en 3b.

### ⚪ R13. ¿El teclado o el mouse?

Cambiar elemento con teclas 1-8 contra clickear en el HUD: ¿cuál usaste sin pensar? El diseño asume que el teclado, porque el elemento es un modo que se porta y tiene que costar una tecla. Si terminaste clickeando, la premisa está mal.

## Ronda 2 — pendientes ya identificados

### 🔴 R14. El ente reacciona visiblemente a la agitación

La mitad de R6 que necesita el paso 5. La pregunta que importa: **¿te diste cuenta de que te estaba mirando antes de saber que la mecánica existía?** Si tuviste que saberlo para notarlo, es demasiado sutil.

## Paso 5 — Deformación del ente

*(pendiente)* — la pregunta central va a ser si la deformación **se lee** como acumulación de aprendizaje o como ruido visual.

## Paso 6 — Efectos de contraataque

*(pendiente)* — incluye el toggle de efectos reducidos y el audio tras el primer clic.

## Paso 7 — Rendimiento

*(pendiente)* — medición con combate real. El presupuesto es 60 fps; en 3a se midieron 180.

---

## Lo que este documento NO cubre

El **balance** (cuánto daño, cuántas exposiciones, si el meta cierra). Eso no se verifica a ojo por decisión explícita del autor: va con la suite de ~10.000 sesiones y la compuerta del 5 % sobre la tasa de victoria (ADR 0009 §6). Acá solo se verifica que las **mecánicas funcionen y se lean**.
