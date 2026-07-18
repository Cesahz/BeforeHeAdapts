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

### 🔴 R6. El ruido se siente antes de entenderlo

**Qué hacer:** mover el mouse de forma agitada (sin apretar el botón) durante ~15 segundos seguidos, mirando al ente.

**Qué tiene que pasar:** el ente **reacciona de forma visible pero sutil** mientras te agitás — se orienta hacia el cursor y se contrae un poco. No tiene que parecer un ataque ni un bug.

**La pregunta real:** ¿te diste cuenta de que te estaba mirando **antes** de leer que existía la mecánica? Si tuviste que saberlo para notarlo, el feedback es demasiado sutil.

**Si falla por invisible:** la reacción preventiva es render, no constante — avisame y la amplifico. **Si falla por molesto** (el ente tiembla todo el tiempo mientras jugás normal): subir `NOISE.threshold` (0,55 → 0,65).

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

## Paso 4 — HUD

*(pendiente)*

## Paso 5 — Deformación del ente

*(pendiente)* — la pregunta central va a ser si la deformación **se lee** como acumulación de aprendizaje o como ruido visual.

## Paso 6 — Efectos de contraataque

*(pendiente)* — incluye el toggle de efectos reducidos y el audio tras el primer clic.

## Paso 7 — Rendimiento

*(pendiente)* — medición con combate real. El presupuesto es 60 fps; en 3a se midieron 180.

---

## Lo que este documento NO cubre

El **balance** (cuánto daño, cuántas exposiciones, si el meta cierra). Eso no se verifica a ojo por decisión explícita del autor: va con la suite de ~10.000 sesiones y la compuerta del 5 % sobre la tasa de victoria (ADR 0009 §6). Acá solo se verifica que las **mecánicas funcionen y se lean**.
