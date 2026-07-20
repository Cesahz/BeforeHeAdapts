# Dominios del motor y capacidades del núcleo

**Estado:** exploratorio, NO normativo. Mismo embudo que `roadmap-avanzado.md`: nada sale hacia implementación sin ADR, y toda capacidad nueva del núcleo respeta la Ley §1 (puro, determinista, sin I/O) y el contrato R1–R6.

Este documento responde dos preguntas distintas y las separa a propósito:

1. **Cómo se fortalece el motor** (capacidades del núcleo — "esteroides").
2. **Dónde se enchufa** (dominios, ordenados por publicabilidad).

Principio rector: **el motor es el activo, los dominios son demostraciones.** La arena web es el primer dominio, no el producto. Cuando el juego pese emocionalmente, el trabajo puede continuar por el lado de los dominios sin tocarlo.

---

## Parte A — Cómo fortalecer el núcleo

Ordenadas por relación valor/costo. Todas viven dentro del contrato; ninguna lo modifica.

### A1. Adaptadores de referencia (`packages/adapters-*`) — **máxima prioridad**

Hoy el motor tiene un solo dominio real. El argumento "agnóstico de dominio" se demuestra con el segundo, no con el primero. Cada adaptador de referencia es un par `StimulusTranslator` + `CounterSynthesizer` en su propio paquete, pequeño y testeado.

Valor: convierte una afirmación de arquitectura en evidencia. Es lo que separa "diseñé bien" de "lo probé".

### A2. Estrategias de firma intercambiables

Hoy la identidad de cluster es clave canónica exacta y `sim()` es Jaccard (ADR 0002). Los dominios no composicionales (texto, tráfico, vectores) necesitan otras métricas. Extraer `SignatureSpace` como estrategia inyectable — con Jaccard como implementación por defecto — permite enchufar coseno sobre vectores u otras distancias **sin tocar el motor**.

Es además el prerrequisito limpio del ítem de embeddings del roadmap: la inferencia vive en el adaptador, el vector viaja como dato en la firma, el núcleo solo hace matemática pura.

### A3. Explicabilidad: `explain(state, signature)`

Una función pura que responde *por qué* el motor reaccionó así: qué cluster, cuántas exposiciones, qué resistencia heredada de qué vecinos, cuánto falta para el salto. Devuelve datos estructurados, no texto.

Es barato (todo el dato ya existe en el estado) y es lo que vuelve al motor **auditable** — requisito real en seguridad, fraude y cualquier contexto donde una decisión automática deba justificarse. También alimenta el HUD del juego y la sección `/engine` de la web.

### A4. Batch e ingesta de alto volumen

Un dominio de seguridad recibe miles de estímulos por segundo; la arena recibe uno cada segundo. Una API de proceso por lotes (`processMany`) con las mismas garantías de determinismo, más benchmarks publicados, hace la diferencia entre "juguete elegante" y "motor usable".

### A5. Persistencia y snapshots del log

El log es append-only e infinito; reproducirlo entero no escala. Snapshots versionados (estado + índice de evento) con la regla de que **el snapshot es caché, nunca fuente de verdad** (siempre reconstruible desde el log) permiten sesiones largas y memoria histórica sin romper la Ley §3.

### A6. Observabilidad del propio motor

Métricas derivadas del log: tasa de adaptación, cobertura del espacio de firmas, distribución de `eff`, clusters más golpeados. Puro, opcional, y es el insumo de cualquier panel — del juego o de un dominio serio.

---

## Parte B — Dominios, por publicabilidad

Criterio de orden: cuánto material publicable produce por unidad de esfuerzo, y qué tan defendible es el claim.

### B1. Defensa adaptativa de la propia web — *ya decidido, ADR 0005*

**Estímulo:** patrones agregados de requests. **Contramedida:** rate limit, challenge, cuarentena temporal.
**Por qué es el primero:** ya está aprobado, tiene ADR con condiciones de seguridad (instancia aislada, modo sombra, frenos duros, kill-switch), y el titular se escribe solo: *el mismo motor que la comunidad intenta vencer defiende el sitio donde lo intentan*.
**Publicable como:** writeup "mismo motor, dos dominios" + gráficos del log de defensa en el mismo visualizador.
**Regla de honestidad:** se presenta como demostración de arquitectura adaptativa, nunca como producto de seguridad, y sin claims de protección a terceros.

### B2. Detección de anomalías en logs / observabilidad

**Estímulo:** plantilla canónica de un error o evento (tipo, ruta, forma del payload). **Contramedida:** agrupar, silenciar ruido conocido, escalar lo genuinamente nuevo.
**Por qué rinde:** es el problema real de "fatiga de alertas" que sufre todo equipo de operaciones, y la semántica del motor calza natural — lo repetido se atenúa, lo nuevo destaca. Datos sintéticos abundantes, cero riesgo, implementación chica.
**Publicable como:** demo con logs simulados + comparación contra un umbral fijo tradicional.

### B3. Rate limiting / anti-bot adaptativo como librería aparte

Es B1 empaquetado como middleware reutilizable (Express/Fastify/edge). Un paquete instalable con README claro es el artefacto más "adoptable" del proyecto: la gente puede probarlo sin leer nada tuyo.
**Cuidado:** no prometer seguridad garantizada; posicionar como capa heurística complementaria.

### B4. Dificultad adaptativa / tutor adaptativo

**Estímulo:** patrón de intento o error del usuario. **Contramedida:** ajustar el siguiente ejercicio o desafío.
**Por qué está acá:** es el mismo motor visto desde el lado amable — en vez de resistir, *se adapta al aprendiz*. Es un giro narrativo muy publicable ("el mismo sistema que hace un jefe implacable hace un tutor paciente") y conecta con ciencia de datos/educación.

### B5. Anti-fraude / abuso en sistemas transaccionales

Alto valor comercial, alta exigencia: datos reales sensibles, sesgos, explicabilidad obligatoria (de ahí A3), y claims delicados. Se mantiene como caso de estudio en papel — mapeo de puertos y diseño — sin implementación real hasta que exista un contexto legítimo con datos.

### B6. Testing adversarial / fuzzing guiado

**Estímulo:** familia de entradas de prueba. **Contramedida:** priorizar lo no explorado.
Nicho, pero con audiencia técnica muy receptiva y demo autocontenida.

---

## Parte C — Secuencia sugerida

1. **A3 (`explain`)** — barato, sirve a todos los dominios y al juego. Buen trabajo de bajo desgaste.
2. **B2 (anomalías en logs)** — el segundo dominio más barato de demostrar, con datos sintéticos y sin riesgo.
3. **A1 + A2** — los adaptadores de referencia y las firmas intercambiables se descubren haciendo B2.
4. **B1 (auto-defensa, ADR 0005)** — cuando exista la web desplegada.
5. Recién después: A4, A5, B3.

La arena queda como está hasta que el autor quiera retomarla. Si el juego no avanza más, el motor sigue creciendo por este camino y el portafolio no depende de él.
