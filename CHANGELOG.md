# Changelog

## [0.3.0] — 2026-07-18

Cierre de la **Fase 3a (Arena local)**. El motor deja de ser una biblioteca con un visualizador y pasa a ser algo que se juega: se componen ataques, se lanzan contra el ente, y se ve adaptarse en vivo. Todo corre en el navegador, sin servidor — una sala local es un motor y un log en memoria.

### Añadido

- **El DSL de ataques** (`packages/arena-dsl`). Cuatro ejes componibles —elemento, vector de entrega, patrón temporal y modificadores— que dan 5.376 ataques distintos a partir de 23 primitivas. El jugador no escribe código: compone. La complejidad de lo que compone es exactamente lo que le cuesta al ente adaptarse.
- **La arena** (`apps/web`). Sala local, cinco ataques de fábrica para jugar sin pasar por el builder, bitácora de daño y export del replay a JSON.
- **Vista del ente en vivo**, sobre el mismo pipeline que ya reproducía los replays grabados. Lo que se ve jugando y lo que sale en un replay exportado son el mismo dibujo, porque son el mismo código.
- **Builder de ataques con dos capas separadas**: la composición mecánica, que es lo único que el ente percibe, y la expresión visual, que es libre y no crea firmas nuevas. Dos ataques que solo difieren en cómo se ven son el mismo ataque para el ente — y la pantalla lo dice explícitamente.
- **Builds guardadas y compartibles.** Persisten en el navegador con esquema versionado, y se exportan como un código de texto que otro jugador puede pegar. Compartir estrategias no necesita cuentas ni servidor.
- **Cristalización del cluster** en el visualizador: un ataque a medio adaptar endurece visiblemente su nodo a medida que se acerca el salto. Faltaba la mitad del aviso — se veía el ataque perder fuerza, pero no que la ventana se estaba cerrando.
- **Harness de simulación de balance** (`apps/balance-sim`). Tres arquetipos de jugador contra el ente, con reporte de adaptaciones, efectividad y generalización. Sirve para responder preguntas de balance con datos en vez de con intuición, y ya respondió la primera: la resistencia heredada entre ataques parecidos no se mueve tocando su radio.
- **README público** y **ADR 0008**, que fija el catálogo de primitivas y la economía por cooldown.

### Cambiado

- **La debilidad que expone el ente al adaptarse ahora es siempre el elemento del ataque.** Antes salía de un accidente alfabético. Se resolvió desde el catálogo, sin tocar el motor ni invalidar un solo replay existente.
- **La única moneda de la arena es el tiempo.** Un ataque simple se lanza cada medio segundo pero el ente lo adapta enseguida; uno complejo aguanta siete exposiciones pero deja al jugador cinco segundos y medio sin poder repetirlo. No hay recursos ni progresión: solo esa tensión.
- **El render SVG se queda, WebGL se posterga.** Se midió antes de decidir: dibujar un cuadro cuesta dos décimas de milisegundo y el juego corre a 180 fps, muy por encima del objetivo. La decisión queda registrada con sus números para que no se rediscuta sin datos nuevos.

### Corregido

- **Los códigos de build no sobrevivían intactos a un caso límite.** Un valor de giro de "cero negativo" volvía del import como cero a secas, así que exportar e importar una build no siempre devolvía exactamente la misma build. Lo encontró un property test generando el caso; se normaliza en el borde.

`packages/core` no cambió: como la 0.2.0, esta versión es enteramente aditiva sobre el motor de la 0.1.0.


## [0.2.0] — 2026-07-18

Cierre de la **Fase 2 (Visualizador)**. La adaptación deja de ser una suite de tests y pasa a verse: cualquier log del motor se convierte ahora en una secuencia de imágenes que muestra las seis reglas del contrato sin escribir un solo número en pantalla.

### Añadido

- **`packages/visualizer`** — el replay del log a animación, en tres capas separadas a propósito: derivar frames, dibujarlos y grabarlos. Las tres son puras salvo la última, y la última es la única que toca el entorno.
- **Derivación de frames.** Un frame por evento del log, leído del motor sobre el prefijo correspondiente. El visualizador no lleva estado propio ni reimplementa el núcleo: si un frame y el motor discrepan, el que está mal es el frame.
- **Render a SVG.** El lenguaje visual completo: el ente como polígono que suma un vértice por cada cluster asimilado, el ataque entrante cuyo grosor *es* la efectividad de la curva, la onda expansiva del salto de adaptación, los nodos de memoria en órbitas según confianza y los hilos de similitud entre firmas emparentadas.
- **Guion temporal del replay**, independiente de los timestamps del log. Una sala donde nadie atacó por diez minutos no debe tener diez minutos de nada; el salto de adaptación, en cambio, se sostiene en pantalla porque es el momento que el replay existe para mostrar.
- **Export con el puerto `FrameSink`**, con la orquestación pura de un lado y el adaptador que graba con canvas del otro. Importar el paquete desde Node nunca arrastra el DOM.
- **Script de demo** (`pnpm --filter @beforeheadapts/visualizer demo`): arma un log sintético con el motor real, lo renderiza a SVG numerados y genera una página autocontenida que los reproduce en secuencia. Sirve para mirar el motor con los ojos, que es algo que los tests no hacen.
- **ADR 0007** — por qué el render se define sobre la secuencia completa de frames y no sobre un frame suelto.

### Cambiado

- **`ClusterFrame` expone la firma del cluster**, que es lo que le permite al render calcular la similitud y dibujar los hilos de generalización. Es derivar un dato del motor, no acumular estado propio.
- **La aleatoriedad visual es determinista.** La vibración del ente tras un impacto se siembra con el número de secuencia del evento: el mismo log produce el mismo dibujo, byte a byte, en cada corrida. Con aleatoriedad real dos reproducciones del mismo log serían imágenes distintas, y eso ya no sería un replay.
- **Las ventanas de los efectos se miden en frames, no en milisegundos.** Por eso lo que se ve en el navegador y lo que sale grabado en video son idénticos por construcción, sin relojes de por medio.

`packages/core` no cambió: esta versión es enteramente aditiva sobre el motor de la 0.1.0.

## [0.1.0] — 2026-07-18

Cierre de la **Fase 1 (Núcleo)**. El motor de adaptación existe, es puro y determinista, y cumple el contrato canónico completo. Todavía no hay nada que jugar: esta versión es el cimiento sobre el que se construye el resto.

### Añadido

- **Contrato de aceptación ejecutable (R1–R6).** Las seis reglas del motor escritas como tests antes de cualquier implementación. Ese archivo *es* la especificación; el código existe para ponerlo en verde.
- **`signature/`** — identidad de un estímulo: canonicalización, clave de cluster, complejidad, exposiciones requeridas `N(c)` y similitud entre firmas. Es lo que decide cuándo dos ataques "son el mismo" a los ojos del ente.
- **`ledger/`** — el log de eventos append-only y versionado, aislado por sala. Toda la historia del sistema vive acá; el estado siempre se deriva plegando el log, nunca se guarda aparte.
- **`policy/`** — los parámetros de adaptación como datos configurables, no como constantes escondidas: la curva de efectividad, la resistencia tras adaptar, la memoria y la generalización a firmas nuevas.
- **`engine/`** — el motor propiamente dicho: una función pura que recibe estado y estímulo y devuelve eventos, más el reductor que los proyecta a estado y los selectores para consultarlo. Reproducir el mismo log da siempre el mismo resultado.
- **Andamiaje del monorepo** — pnpm workspaces, TypeScript en modo estricto y Vitest con property tests (fast-check) para los invariantes del núcleo.
- **Decisiones de arquitectura registradas (ADR 0001–0006):** conciliación entre la curva decreciente y el salto discreto; identidad de cluster y forma de `N(c)`; curva de efectividad con piso explícito; frontera de cuantización de entrada; adaptador de auto-defensa del sitio; esquema versionado del log exportado.
- **Guía de diseño del adaptador web** para las fases 3a–3b.

### Cambiado

- **La curva de efectividad tiene un piso explícito.** Antes tendía a cero y volvía inútil cualquier ataque repetido lo suficiente; ahora la asíntota es un parámetro con valor por defecto `0.01`. La adaptación degrada, nunca apaga del todo: un ataque conocido sigue haciendo algo. (ADR 0003)
- **La Fase 5 del plan es ahora la auto-defensa del sitio**, en lugar de un adaptador de logs de juguete. El mismo motor que la comunidad enfrenta dentro de la arena supervisa la seguridad operativa de la web que la aloja — en instancia y log separados, y en modo sombra antes de aplicar nada. (ADR 0005)
- `docs/concepto-original.md` dejó de ser normativo: la fuente de verdad son `docs/` y los ADRs.
- Fin de línea normalizado con `.gitattributes` (`* text=auto`), para que las diferencias CRLF/LF no ensucien los diffs.
