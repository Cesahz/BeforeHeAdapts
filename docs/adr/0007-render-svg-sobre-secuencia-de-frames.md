# 0007 — Renderizar SVG puro sobre la secuencia de frames, con dirección de arte geométrica

**Estado:** Aceptada

## Contexto

La Fase 2 ya tiene `framesFrom(log, config)`: un frame por evento, derivado del motor y sin estado paralelo (ver ADR 0006 para el log que consume). Falta lo que dibuja esos frames. Tres fuerzas empujan en direcciones distintas.

**Primera: pureza contra animación.** Un frame es un instante congelado, pero el contrato tiene efectos que son inherentemente temporales. La caída de `eff(k)` (R5) solo se *ve* comparando exposiciones sucesivas, y el salto discreto de R1 pide un golpe visual que dure más de un cuadro para leerse como golpe. Una función `renderFrame(frame)` de un solo frame no puede producir una onda expansiva que decae: no tiene de dónde saber cuántos eventos pasaron desde el `AdaptationCompleted`. Las salidas naturales —un reloj, un game-loop con estado, `<animate>` de SMIL con su propia línea de tiempo— rompen la determinación o hacen divergir el DOM del export a gif/webm, que es exactamente el bug que nadie encuentra hasta que el gif sale distinto de lo que se vio en pantalla.

**Segunda: el target del render.** Canvas 2D es más natural para animación fluida y para `captureStream`, pero exige un canvas (o un `ctx` mockeado) para testear, y con eso el módulo deja de ser puro y verificable como el resto del repo.

**Tercera: qué se dibuja.** El default de la industria para "mostrar progreso y magnitudes" es un dashboard: barras de `k/N`, medidores de resistencia, tablas de clusters. Es legible y es exactamente lo contrario de lo que este proyecto es. El ente no es un servicio con SLOs; el problema conceptual es la adaptación de un adversario que aprende. Un dashboard corporativo destruye eso.

**Cuarta, menor pero real:** los `clusterId` derivan de firmas que en la arena vienen de usuarios. Cualquier cosa que termine como atributo o `id` en un SVG montado en el DOM es superficie de inyección.

## Decisión

**El render es una función pura de la secuencia completa de frames a strings SVG, con una dirección de arte geométrica y abstracta.**

### 1. API sobre la secuencia, no sobre el frame suelto

```ts
renderFrames(frames: readonly Frame[], opts?: RenderOptions): readonly string[]
renderFrame(frames: readonly Frame[], index: number, opts?: RenderOptions): string
```

La primaria es `renderFrames`. Mirar hacia atrás un número acotado de frames es lo que permite efectos transitorios multi-frame (onda expansiva, vibración residual) **sin acoplarse a un reloj ni a un game-loop**. Sigue siendo puro y determinista: `renderFrames(f)[i]` es siempre el mismo string. El decaimiento se mide en frames, no en milisegundos, así que el DOM y el export producen píxel por píxel lo mismo.

### 2. SVG como string, no canvas

El render no toca DOM ni entorno: produce texto. Se testea con Vitest como cualquier módulo del núcleo. Montar el SVG (`mount(el, svg)`) y el export a gif/webm son adaptadores separados que consumen estos strings y son los únicos que hacen I/O.

### 3. `ClusterFrame` suma `signature`

Los hilos de similitud (R6) necesitan `sim(s₁, s₂)` entre firmas de clusters, y hoy `ClusterFrame` solo lleva `clusterId`. Se agrega `signature: StimulusSignature`, **leída de `cluster.signature` del estado del motor** — dato derivado, no estado acumulado por el visualizador. El invariante rector no se toca: si el render necesita un dato, se deriva del motor, nunca se recalcula ni se acumula aparte.

### 4. Dirección de arte: telemetría hostil, no dashboard

Nada de barras, medidores ni números en pantalla. Cada regla del contrato tiene una manifestación geométrica:

- **El ente** es un polígono regular centrado. Sus **vértices son `5 + clusters adaptados`**: asimilar una firma cambia la silueta del ente de forma discreta y permanente. Cada `ExposureRecorded` lo contrae bruscamente y lo hace vibrar, recuperando en los frames siguientes.
- **Los clusters** son nodos en órbita, uno por cluster, en el orden de aparición estable que ya da el `Map` del motor. El **radio orbital es `1 − confidence`**: el decaimiento de memoria (R4) se ve como el nodo alejándose hasta perderse. El tamaño del nodo escala con `N(c)`.
- **La generalización (R6)** son hilos finos entre nodos con `sim ≥ umbral`, con opacidad proporcional a la similitud. La red subyacente queda visible pero de fondo.
- **R5, el "durante"**, es un vector entrante dibujado solo en frames con `ResistanceApplied`, con opacidad y grosor proporcionales a `effApplied` —que el evento ya trae, no se recalcula—. Exposición tras exposición el mismo ataque llega más pálido y más flaco: la curva se lee sin un solo número.
- **R1, el "después"**, es un snap agresivo en `AdaptationCompleted`: onda expansiva que decae a lo largo de unos pocos frames, la línea del cluster asimilado pasa a sólida y gruesa en color de advertencia, y el ente suma su vértice. Discreto, como el salto de resistencia. La `weakness` de `CounterReady` marca el nodo con una muesca, no con texto.

### 5. Determinismo estricto, incluida la vibración

La vibración de vértices usa **jitter determinista sembrado con `seq` y el índice del vértice**. Cero `Math.random()`, cero `Date.now()`. La Ley §1 rige `packages/core`, pero el visualizador la hereda por una razón propia: un replay que se ve distinto en cada corrida no es un replay. Se testea con una guardia sobre el fuente del paquete.

### 6. Escapeo obligatorio en el serializador

El serializador SVG escapa todo valor de atributo y todo contenido de texto. Los `clusterId` derivan de entrada de usuario y terminan en el DOM.

## Alternativas descartadas

- **`renderFrame(frame)` sobre un frame aislado.** Más simple y la firma más obvia, pero limita todo efecto a exactamente un cuadro: el snap de R1 —el momento que el proyecto entero existe para mostrar— queda como un parpadeo de un frame. El costo de recibir la secuencia es una firma menos elegante; el beneficio es que el "después" se lee como un golpe.
- **Canvas 2D directo (`drawFrame(ctx, frame)`).** Mejor para animación fluida y para `captureStream`, pero exige canvas o un `ctx` mockeado para testear. El módulo dejaría de ser verificable con la misma disciplina que el núcleo, y la lógica visual quedaría enterrada en llamadas imperativas difíciles de aseverar.
- **Capa intermedia de escena (`sceneFrom(frame) -> Scene`) con backends de SVG y canvas.** Es la respuesta correcta *si alguna vez* hacen falta los dos targets. Hoy no hacen falta: se paga abstracción por un segundo backend hipotético. Si el canvas llega a ser necesario, `geometry.ts` y `layout.ts` ya son esa capa de escena sin haberla llamado así — extraer el backend es refactor mecánico, no rediseño.
- **Animación con SMIL (`<animate>`) o CSS.** Delega la línea de tiempo al navegador: el SVG deja de ser una función del frame y el export tendría que reimplementar la animación por su cuenta. Divergencia garantizada entre lo que se ve y lo que se exporta.
- **Dashboard de barras y medidores.** Legible, convencional, y contradice el proyecto. `k/N` en una barra de progreso es información sin tensión.

## Consecuencias

**Positivas:** el render se testea sin navegador ni DOM, con property tests igual que el núcleo; el DOM y el gif exportado son idénticos por construcción, no por cuidado; las reglas del contrato quedan verificables *en el render* (que la opacidad del vector decaiga monótonamente es un test de R5); la dirección de arte hace que el comportamiento del motor se lea de un vistazo sin leer un número; agregar el backend de canvas después, si hace falta, no obliga a rediseñar.

**Negativas:** `renderFrames` obliga a tener toda la secuencia en memoria, así que el streaming en vivo frame a frame no sale gratis — habrá que darle una ventana deslizante cuando la arena lo pida (mitigado: la ventana de lookback es acotada y conocida, así que es un cambio local). Serializar SVG a mano en vez de usar una librería es más código propio, incluido el escapeo, que es justamente por qué se testea. Un SVG por frame es pesado en logs largos, y la rasterización para el export va a ser el cuello de botella. Y la dirección de arte tiene un costo real de legibilidad: nadie va a poder leer el valor exacto de `k` en pantalla — deliberado, para eso está el log.

## Impacto en el CLAUDE.md

**Ninguno.** No toca la Ley de arquitectura ni el contrato canónico. La Ley §1 (pureza y determinismo) rige formalmente solo `packages/core`; este ADR se la impone al visualizador por decisión propia, sin cambiar el texto de la Ley. El punto 3 (agregar `signature` a `ClusterFrame`) es aditivo sobre un tipo interno del visualizador, no sobre el esquema del log, así que el ADR 0006 tampoco aplica.
