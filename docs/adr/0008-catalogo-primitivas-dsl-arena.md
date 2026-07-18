# 0008 — Catálogo de primitivas del DSL de la arena y economía por cooldown

**Estado:** Aceptada

## Contexto

La Fase 3a necesita un DSL de ataques concreto. Hasta acá el motor trabajó con primitivas de juguete (`fuego`, `rapido`, `presion`): suficientes para los tests del contrato, insuficientes para jugar. Este ADR fija el catálogo real.

No es una decisión cosmética. El [ADR 0002](0002-identidad-de-cluster-y-formula-de-N.md) dejó la granularidad de cluster del lado fino a propósito y anotó dónde está el dial de balance cuando eso duela: **"el dial a mover es la granularidad del `StimulusTranslator` (cuántas primitivas emite el dominio), no el motor"**. Este ADR *es* ese dial. Tres cosas se deciden juntas porque están acopladas:

1. **Qué primitivas existen.** Determina el tamaño del espacio de firmas y, vía Jaccard, cuánta resistencia se transfiere entre ataques parecidos (R6).
2. **Cuántas primitivas emite una composición.** Por ADR 0002, `N(c) = |primitivas|`: la forma de la composición *es* la curva de dificultad.
3. **Cuánto cuesta lanzar cada composición.** Sin un costo, la firma más compleja domina siempre — el colapso a un solo eje de contrajuego que el ADR 0001 y el 0002 ya identificaron como el modo de falla del proyecto.

Se suma una cuarta cuestión que quedó abierta desde la Fase 1: **`weaknessOf` es hoy "la primera primitiva en orden canónico"**, elegida por determinismo y no por balance, y marcada como candidata a revisión "cuando exista la arena". Este es ese momento. El agravante es que la debilidad viaja en el payload de `AdaptationCompleted`: cambiar la regla en el núcleo rompería replays guardados (Ley §3, [ADR 0006](0006-esquema-versionado-eventos.md)) y además violaría el §0 del [diseño del adaptador web](../diseno-adaptador-web.md), que prohíbe que la Fase 3 toque `packages/core`.

## Decisión

### 1. Cuatro ejes, con prefijo de eje en la primitiva

| Eje | Prefijo | Cardinalidad | Multiplicidad | Valores |
|---|---|---|---|---|
| Elemento | `elem:` | 8 | exactamente 1, **obligatorio** | `ember`, `frost`, `current`, `toxin`, `gravity`, `sound`, `light`, `void` |
| Vector de entrega | `vec:` | 6 | 0 o 1 | `projectile`, `beam`, `wave`, `field`, `melee`, `trap` |
| Patrón temporal | `pat:` | 5 | 0 o 1 | `burst`, `sustained`, `pulse`, `delayed`, `escalating` |
| Modificadores | `mod:` | 4 | 0 a 4, combinables | `piercing`, `splitting`, `homing`, `unstable` |

El espacio de firmas es 8 × 7 × 6 × 16 = **5.376 composiciones mecánicas distintas**.

El prefijo no es decoración: es lo que hace legible el log crudo, lo que evita colisiones si dos ejes quisieran alguna vez el mismo nombre, y lo que resuelve `weaknessOf` (punto 4). El separador `:` es seguro — el separador de cluster del núcleo es `|`, y `canonicalize()` ya rechaza primitivas que lo contengan.

### 2. Canonicalización composición → firma

`StimulusTranslator` (`apps/web/src/arena/`) aplica exactamente esto:

1. Una primitiva por valor seleccionado, prefijada con el código de su eje.
2. Modificadores deduplicados; su orden de selección es irrelevante.
3. **La capa de expresión visual no aporta ninguna primitiva.** Trayectoria, color, timing visual y disposición son libres y no entran a la firma (§2 del diseño). Property test obligatorio: variaciones visuales de la misma composición mecánica producen la misma firma canónica.
4. `intensity = cost` (punto 3).
5. Se delega en `canonicalize()` del núcleo, que ordena y deduplica.

Por ADR 0002, `N(c)` queda entre **1 y 7**: `elem:ember` solo es la firma mínima de R2 y el ente la adapta al primer golpe; una composición máxima (elemento + vector + patrón + los cuatro modificadores = 7 primitivas) exige 7 exposiciones.

### 3. Economía: cooldown por costo, sin monedas

```
cost     = 1 + (vector ? 1 : 0) + (patrón ? 1 : 0) + 2 × |modificadores|     // 1 … 11
cooldown = 500 ms × cost
```

Los ejes base cuestan 1; **los modificadores cuestan 2**. Suman `N` igual que un eje base pero pagan el doble de tempo: apilar los cuatro modificadores es la jugada más cara del juego, no la dominante por defecto. La única moneda de la Fase 3a es el tiempo — no hay recursos, inventario ni progresión.

El resultado es la carrera de tempo que pide el §4 del diseño: un ataque simple pega cada 0,5 s pero muere en un golpe; la composición máxima de 7 primitivas sobrevive 7 exposiciones pero solo puede lanzarse cada 5,5 s. Ninguna de las dos estrategias domina sola.

### 4. `weaknessOf` se resuelve en el adaptador, no en el núcleo

**El núcleo no se toca.** El orden lexicográfico de los prefijos es `elem:` < `mod:` < `pat:` < `vec:`, así que la regla existente del núcleo — primera primitiva en orden canónico — **selecciona siempre el elemento**, para toda composición válida (el elemento es obligatorio, y ningún otro prefijo lo precede alfabéticamente).

La debilidad expuesta es, entonces, el elemento del ataque que completó la adaptación: la lectura más legible posible para el jugador y el gancho natural del `CounterSynthesizer` de la arena. Se obtiene sin migrar eventos, sin romper replays y sin violar el §0 del diseño.

El acoplamiento es real y se declara: la arena depende de que el núcleo siga eligiendo la primera primitiva canónica. Se defiende con un test de la arena que corre `process()` sobre composiciones generadas y verifica que el `AdaptationCompleted` emitido trae el elemento. Si algún día el núcleo cambia esa regla, ese test falla y avisa.

### 5. Nota de andamiaje (decisión menor, registrada acá)

`apps/web` se arma con **Vite + TypeScript estricto, vanilla, sin framework**. El estado de la sala ya *es* el log del motor (`reduce(log)`); un framework reactivo introduciría una segunda fuente de verdad para el mismo estado, que es precisamente lo que la Ley §2 prohíbe. No amerita ADR propio.

## Alternativas descartadas

- **Exigir los tres ejes base siempre (`N` de 3 a 6).** Garantizaría que la atenuación de R5 sea perceptible antes de todo salto, que es una obligación de diseño del §4. Se descartó porque elimina del juego el caso de firma mínima de R2: que un ataque desnudo adapte al primer golpe es la mejor lección posible sobre qué hace el ente, y darla en el primer minuto vale más que suavizar la curva. El feedback de R5 se sigue viendo en cuanto el jugador compone algo, que es casi de inmediato.
- **Costo uniforme = cantidad de primitivas (`cost = N`).** Máxima legibilidad: un solo número explicaría complejidad y tempo a la vez. Descartada porque vuelve dominante apilar los cuatro modificadores — llegan a `N = 6` por el mismo precio que una composición variada, y el espacio de firmas colapsa a "elemento + todo lo demás".
- **Costo supralineal (`cost = N²`).** Mueve el castigo de la complejidad al cooldown en vez de a la forma de `N`, respetando el ADR 0002. Descartada por magnitud: 18 s de cooldown deja las composiciones ricas fuera de lo jugable, y el objetivo es que compitan, no que existan de adorno.
- **Cambiar `weaknessOf` en el núcleo** (a la primitiva de mayor peso, a la más rara, a una elegida por semilla). Todas son mejores *en abstracto* que "la primera alfabética", y todas cuestan un salto de `v` en `AdaptationCompleted` + migrador + fixture, violando además el §0 del diseño. El esquema de prefijos consigue el mismo resultado semántico a costo cero. Si en el futuro se quiere una debilidad que dependa de la composición completa y no de un eje fijo, ahí sí corresponde ADR propio y versión de evento.
- **Catálogos más grandes** (16 elementos, 10 vectores). Descartado por ahora: 5.376 firmas ya exceden lo que una sesión puede explorar, y cada valor extra diluye el Jaccard, haciendo que R6 transfiera menos y el ente se sienta más tonto. Ampliar el catálogo es aditivo y barato; recortarlo, no.

## Consecuencias

**Positivas:**
- El dial de balance que el ADR 0002 dejó anotado queda concreto y en un solo lugar: cambiar cuánto adapta el ente es cambiar cuántas primitivas emite el `StimulusTranslator`, sin tocar el motor.
- `weaknessOf` pasa de accidente alfabético a decisión de diseño, sin costo de migración y sin romper el §0.
- El prefijo hace que un log crudo se lea sin diccionario: `elem:frost|mod:homing|vec:beam` se entiende solo.
- La economía cabe en dos líneas de fórmula; balancearla es mover dos constantes, no rediseñar sistemas.

**Negativas:**
- La arena queda acoplada a una regla interna del núcleo (primera primitiva canónica) que el núcleo no promete como API. El test de la arena lo detecta, pero es una dependencia que hay que recordar que existe.
- Con el elemento siempre primero, la debilidad expuesta **nunca** depende del vector, el patrón ni los modificadores. Es legible pero pobre: dos ataques muy distintos que comparten elemento exponen la misma debilidad. Es una limitación aceptada de la Fase 3a, y el candidato natural a revisión cuando el contrajuego tenga profundidad.
- Los modificadores a costo 2 pueden resultar demasiado caros en la práctica: son el número más frágil de este ADR. Se ajusta con una constante, pero el ajuste invalida la intuición de balance acumulada hasta ese punto.
- 5.376 firmas con clusters de identidad exacta (ADR 0002) significa que un jugador que varíe mucho puede no ver adaptarse al ente jamás. Es el riesgo que el ADR 0002 ya anticipó; la arena es el primer lugar donde se va a medir de verdad.

## Impacto en la Ley de arquitectura / contrato canónico

**Ninguno.** Este ADR vive enteramente del lado del adaptador: define el catálogo que emite el `StimulusTranslator` de `apps/web` y la economía de la arena. No modifica ninguna de las 6 reglas, no toca `packages/core`, no cambia `contract.test.ts` ni el esquema de eventos del [ADR 0006](0006-esquema-versionado-eventos.md). El `CLAUDE.md` no requiere actualización.
