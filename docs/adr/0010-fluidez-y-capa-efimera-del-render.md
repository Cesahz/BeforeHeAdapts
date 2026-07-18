# 0010 — Densificar frames de forma determinista y separar una capa efímera anclada al cursor

**Estado:** Propuesta — requiere OK del autor antes de implementar.

## Contexto

La verificación humana de la ronda 1 (2026-07-18) dejó un reporte que no es un bug sino un problema de diseño del render, en palabras del autor:

> *"noto muy fofo la animación, por ejemplo los ataques no concuerdan con la dirección y no nacen del cursor"*

Y en la misma sesión, una observación sobre gestos naturales que resulta ser la otra mitad del mismo problema:

> *"tiendo a apuntar al ente. Sobre todo con el ataque recto, el zigzag. Cuando hago el círculo tiendo a encerrar al ente o hacerlo por encima."*

Las dos frases describen la misma carencia: **el gesto tiene información espacial —de dónde sale, hacia dónde apunta— que el render tira a la basura.** El jugador apunta y el ataque aparece en un lugar arbitrario. Eso es lo que se siente flojo, más que la cantidad de cuadros por segundo.

Hay tres fuerzas, y las tres empujan contra una decisión ya tomada.

**Primera: el render es frame-por-evento.** El [ADR 0007](0007-render-svg-sobre-secuencia-de-frames.md) fijó que `framesFrom` emite **un frame por evento** y que el decaimiento se mide **en frames, no en milisegundos**, precisamente para que el DOM y el export a gif/webm produzcan lo mismo píxel por píxel. La consecuencia práctica en el vivo es que `LiveView` muestra cada frame durante `FRAME_HOLD_MS = 110`: a un ataque cada 1–2 s le tocan un puñado de cuadros distintos y el resto es una imagen fija. **No es baja tasa de refresco —el medidor marca 180 fps— es baja densidad de información.** La pantalla se redibuja rapidísimo y casi siempre dibuja exactamente lo mismo.

**Segunda: la posición del cursor no está en el log, y no puede estar.** El [ADR 0004](0004-frontera-de-cuantizacion-de-entrada.md) prohíbe que el movimiento crudo cruce la frontera del motor, y el §2 del diseño establece que la capa de expresión visual **no aporta primitivas**. Así que "el ataque nace del cursor y apunta al ente" es información que existe en el instante del gesto y **no sobrevive en el log**. Un replay no puede reconstruirla.

**Tercera: `framesFrom` es O(n²).** Ya medido: 2,2 ms a 112 eventos, 43,1 ms a 812. Hoy se tolera porque solo se recalcula al entrar un evento. Cualquier decisión que multiplique la cantidad de frames tiene que no multiplicar ese costo.

El choque es directo: **la promesa del ADR 0007 es que lo que se ve es exactamente lo que se exporta, y lo que el autor pide requiere datos que el replay no tiene.** Sin resolver eso explícitamente, cualquier mejora de fluidez se paga con divergencia silenciosa entre pantalla y gif — el bug que el ADR 0007 existe para prevenir.

## Decisión

### 1. Densificación determinista: más frames, misma pureza

`framesFrom` sigue emitiendo un frame por evento. Se agrega una **pasada de interpolación pura** sobre esa secuencia:

```ts
densify(frames: readonly Frame[], opts?: DensifyOptions): readonly Frame[]
```

- Expande la secuencia a una **cadencia fija** (~60 frames por segundo de replay), interpolando las magnitudes continuas entre frames consecutivos: contracción del ente, radios orbitales, opacidades, decaimiento de la onda expansiva.
- **Lo discreto no se interpola.** La cantidad de vértices del ente, `adapted`, la resistencia: son escalones del contrato (R1) y siguen saltando. Interpolarlos sería mentir sobre el motor — el salto discreto es lo que el proyecto existe para mostrar.
- Es **pura y determinista**: `densify(frames)` da siempre lo mismo. No hay reloj, no hay estado. La línea de tiempo se vuelve más densa, no menos predecible.

Esto preserva la promesa del ADR 0007 **entera**: el export consume la misma secuencia densificada y sale idéntico a lo que se vio. La fluidez deja de estar en tensión con la pureza porque no se resuelve con un reloj, se resuelve con más datos.

Costo: `densify` es O(n×k) sobre frames ya calculados, no O(n²). No toca `framesFrom` ni vuelve a llamar al motor.

### 2. Dos capas de render, con contratos distintos

| Capa | De dónde sale | ¿Va al replay? | Qué dibuja |
|---|---|---|---|
| **Canónica** | el log, vía `framesFrom` + `densify` | **sí**, byte por byte | el ente, clusters, adaptación, atenuación R5, el snap R1 |
| **Efímera** | estado vivo del dominio arena | **no** | trazo del gesto, ataque naciendo del cursor, telegraph, esquive, agitación |

La capa efímera se compone **encima** del SVG canónico, en el mismo `<svg>`, y se recalcula por cuadro a partir de estado que solo existe en vivo.

**Consecuencia declarada, y es la parte incómoda:** un replay muestra fielmente **lo que el ente aprendió**, no **lo que el jugador vivió**. No hay trazos, no hay contraataques, no hay esquives.

No es una concesión nueva: el [ADR 0009 §4](0009-combate-en-vivo-gestos-ruido-y-contraataque.md) ya decidió que los disparos de contraataque no entran al log, por el mismo motivo (un disparo no es un estímulo percibido). Este ADR **nombra esa capa, le da un contrato y deja de tratarla como excepción**. La alternativa —meter posiciones del cursor en el log— viola el ADR 0004 y hace del log un archivo de sesión en vez de una memoria de aprendizaje.

### 3. Vocabulario direccional: el ataque nace donde el jugador lo dibujó

La capa efímera usa la geometría del gesto, que hoy se descarta apenas se clasifica el trazo:

- **Origen:** el ataque nace del **punto donde terminó el trazo**, no del borde del viewport.
- **Dirección:** el vector de los últimos puntos del trazo. Un recto apuntado al ente lo golpea de frente; uno tirado al costado pasa de largo y se disipa. **La puntería no cambia la mecánica** —la firma es idéntica, §2 del diseño— pero se ve.
- **Forma por gesto**, aprovechando los gestos naturales que el autor reportó: el recto es un proyectil que viaja; el zigzag, una serie de trazos quebrados que avanzan; el círculo, un anillo que se cierra **alrededor** del ente (que es como sale naturalmente); el hold, un haz sostenido desde el cursor mientras dura.
- **Penetración proporcional a `eff(k)`**, que es lo que el §4 del diseño ya pedía y todavía no se ve: a `eff` alto el ataque atraviesa; cerca del piso rebota en la superficie.

**Regla dura que no se relaja:** nada de esto entra a la firma ni al log. Dos jugadores con puntería opuesta y la misma composición producen logs idénticos. La capa visual es libre justamente porque es inerte.

### 4. Qué NO decide este ADR

**WebGL sigue postergado.** La medición de 3a (180 fps, `renderFrame` ~0,2 ms) no se invalida con una propuesta; se invalida con otra medición. La densificación multiplica los frames del replay pero **no** los cuadros dibujados por segundo, que ya eran 60+. Si tras implementar esto el medidor baja del presupuesto, ahí va el ADR de WebGL, con el número que lo justifique — como se hizo en 3a.

**La deformación del ente** (§5 del diseño) sigue siendo trabajo del paso 5 dentro del vocabulario del ADR 0007. Este ADR le da el marco (capa canónica, densificada) pero no la diseña.

## Alternativas descartadas

- **Interpolar con un reloj solo en la vista viva.** Es lo más directo: `LiveView` tiene `tick(now)` y podría interpolar entre frames con tiempo real. Descartada porque rompe exactamente la promesa del ADR 0007 — la pantalla quedaría más fluida que el gif exportado, y esa divergencia es invisible hasta que alguien compara. La densificación consigue lo mismo sin reloj.
- **Bajar `FRAME_HOLD_MS` de 110 a ~16.** Un parche de una línea, y no arregla nada: no hay frames intermedios que mostrar, así que el replay simplemente pasaría más rápido por los mismos pocos cuadros. El problema no es el ritmo, es que faltan datos entre evento y evento.
- **Animar con SMIL o CSS sobre el SVG.** Ya descartada por el ADR 0007 §"Alternativas" y sigue descartada: delega la línea de tiempo al navegador y el export tendría que reimplementarla. Además el §7 del diseño prohíbe animar el juego con DOM/CSS.
- **Meter posición y dirección del cursor en el log** (como payload visual de un evento). Resolvería la capa efímera de raíz: los replays mostrarían el combate completo. Descartada porque viola el ADR 0004 (el movimiento crudo no cruza la frontera), infla el log con datos que el motor no usa, y convierte el log de "lo que el ente percibió" en "grabación de sesión" — dos cosas distintas que conviene no mezclar. Si algún día se quieren replays de combate completos, es un **log de dominio separado**, paralelo al del motor, y va con su propio ADR.
- **Densificar dentro de `framesFrom`.** Menos módulos. Descartada por costo: `framesFrom` es O(n²) porque re-proyecta el motor sobre cada prefijo; multiplicar sus frames multiplicaría ese trabajo. Como pasada separada sobre frames ya calculados es O(n×k) y no vuelve a tocar el motor.
- **Que la puntería afecte el daño.** Tentador —haría la dirección "real" en vez de decorativa— y descartada sin dudar: convertiría la capa de expresión visual en mecánica, fusionando las dos capas que el §2 del diseño separa a propósito, y metería destreza mecánica en un juego cuya presión de diseño es la atención (ADR 0009 §4). Además haría que el mismo gesto produjera daños distintos con la misma firma, que es incoherente con el modelo del motor.

## Consecuencias

**Positivas:**

- La fluidez deja de estar en conflicto con la pureza: se resuelve con más datos deterministas, no con un reloj. El export sigue siendo idéntico a la pantalla, por construcción y no por cuidado.
- El ataque nace donde el jugador apuntó, que es lo que su mano ya estaba haciendo sin que el juego lo notara.
- La capa efímera queda **nombrada y acotada**. Hoy existe de hecho (los contraataques del ADR 0009) sin contrato; después de esto tiene reglas y un límite claro.
- La atenuación de R5 por fin se ve como el §4 del diseño la pidió desde el principio.
- `densify` es una función pura más: property tests como el resto (que las magnitudes interpoladas sean monótonas entre extremos, que los escalones no se interpolen).

**Negativas:**

- **Los replays quedan formalmente incompletos.** Muestran el aprendizaje del ente y nada de la mano del jugador. Es la deuda del ADR 0009 §4, ahora asumida como decisión de arquitectura en vez de arrastrada como excepción. Quien mire un replay de 3b tiene que saber qué está mirando.
- **Más frames = más memoria.** Un log de 800 eventos densificado a 60 fps son decenas de miles de frames. La ventana deslizante de `LiveView` lo acota en vivo, pero el export completo va a necesitar streaming o un tope. Es un problema nuevo que hoy no existe.
- **El costo de rasterización del export sube en proporción directa.** El ADR 0007 ya lo marcaba como el cuello de botella; esto lo multiplica.
- La capa efímera es la primera parte del render **sin cobertura de replay**, o sea que un bug visual ahí no se reproduce a partir de un log. Se testea como unidad y se mira a mano; no hay fixture golden que lo cubra.
- Tres decisiones acopladas en un ADR. Se podrían haber separado (densificación / capas / vocabulario direccional), pero las tres salen del mismo reporte y la primera sin la segunda no arregla lo que el autor señaló.

## Impacto en la Ley de arquitectura / contrato canónico

**Ninguno sobre el contrato.** No cambia ninguna de las 6 reglas, no toca `packages/core`, no versiona eventos (ADR 0006 intacto) y no modifica `contract.test.ts`.

**Sí matiza el ADR 0007**, sin reemplazarlo: su promesa de "el DOM y el export son idénticos" queda acotada a la **capa canónica**, y se declara explícitamente que existe una capa efímera fuera de esa garantía. Los puntos 1-6 del ADR 0007 siguen vigentes tal cual para todo lo que deriva del log. Si el autor prefiere, esto puede registrarse como enmienda al 0007 en vez de ADR propio; se propone separado porque introduce un concepto nuevo (la capa efímera) que va a gobernar también los contraataques y el telegraph.

**El `CLAUDE.md` no requiere actualización.**
