# Roadmap avanzado — ML, Deep Learning y B2B (post-Fase 5)

**Estado:** exploratorio, NO normativo. Este documento es el embudo de ideas de largo plazo del proyecto: las ideas entran acá libremente y **solo salen hacia implementación vía ADR**. Nada de lo listado autoriza a tocar `packages/core`, el contrato ni el esquema de eventos. Cada entrada tiene un veredicto de revisión y un *gate*: la condición objetiva que debe cumplirse antes de considerar su implementación.

Origen: notas del autor (2026-07) + revisión arquitectónica externa.

---

## 1. Validación semántica de trazos con NN ligera (propuesta original: "Fase 6")

**Idea original:** CNN en el Builder (TensorFlow.js) que analiza el dibujo del usuario y fuerza la coherencia semántica (trazo puntiagudo → ataque "punzante"), impidiendo etiquetado falso.

**Veredicto: rechazada como política del Builder; reformulada como implementación del reconocedor de gestos.**

- Como validación del Builder contradice el §2 de `diseno-adaptador-web.md`: la capa visual **no aporta primitivas**. Si el dibujo determina la mecánica, las dos capas se fusionan y el espacio de firmas pierde su separación. Además, en single-player no existe a quién engañar con un etiquetado incoherente.
- Reformulación legítima: el **reconocedor de gestos del ADR 0004** (combate por cursor, Fase 3b) puede implementarse como modelo ligero **si y solo si** la heurística geométrica (curvatura, velocidad, relación de aspecto) demuestra ser insuficiente con datos.

**Gate:** Fase 3b implementada con reconocedor heurístico + evidencia medida de que la heurística no alcanza. La dependencia (varios MB de runtime de inferencia) se paga solo con esa evidencia.

---

## 2. Persistencia histórica / Event Store para B2B (propuesta original: "Fase 7")

**Idea original:** consolidar el log en una base de eventos distribuida; memoria entre sesiones para mitigar amenazas persistentes; justificación comercial como WAF heurístico.

**Veredicto: la capacidad ya existe por diseño; lo propuesto es infraestructura y producto, no arquitectura.**

- "Estímulo el lunes, atenuación el viernes" es exactamente `replayFrom` + política de memoria `permanente` + un `EventSink` que persista en disco/DB. Cero cambios de motor: el diseño actual ya lo soporta.
- Lo nuevo es operacional (event store durable, quizás distribuido) y comercial. No se construye especulativamente.
- **Precaución de posicionamiento:** "mitiga APTs" es un claim de seguridad fuerte. Presentar siempre como complemento heurístico de defensa, nunca como reemplazo de un WAF establecido, y nunca sin evidencia operativa propia.

**Gate:** Fase 5 (auto-defensa, ADR 0005) operativa en modo activo + un caso de uso o interesado real. Recién ahí, ADR de persistencia durable.

---

## 3. Pre-adaptación predictiva (propuesta original: "Fase 8")

**Idea original:** modelo secuencial (RNN/Transformer) que lee el flujo de eventos, predice la intención del atacante e inyecta eventos de pre-alerta para adaptarse antes del impacto.

**Veredicto: congelada (el propio autor la marca de baja prioridad), con alerta arquitectónica registrada.**

- Tal como está enunciada roza violar R1: la resistencia solo cambia tras exposiciones procesadas, no por anticipación. "Inyectar eventos para adaptarse antes" es mutación de resistencia disfrazada de evento.
- Forma honesta si algún día revive: el predictor es un **sensor de dominio** que emite estímulos de intención de baja intensidad (mismo mecanismo que el ruido ambiental del ADR 0004), o bien alimenta **decisiones de dominio** (subir costos preventivos vía contramedidas), jamás resistencia directa.
- Requeriría ADR propio sobre la semántica de eventos especulativos en el log (¿qué significa un evento que registra algo que *no* pasó?).

**Gate:** ninguno definido. Congelador hasta que otra rama del proyecto lo vuelva rentable.

---

## 4. Generalización por embeddings (propuesta original: "Fase 9" / idea 1)

**Idea original:** reemplazar la similitud sobre primitivas por embeddings de un modelo pequeño + distancia de coseno, para heredar resistencia ante ataques semánticamente idénticos aunque superficialmente distintos.

**Veredicto: aprobada como dirección post-Fase 5 — la mejor idea del lote — con la arquitectura corregida.**

- Motivación real: en dominios B2B las firmas no son composicionales (payloads, tráfico, código); Jaccard sobre primitivas no generaliza ahí. Los embeddings sí.
- **Arquitectura obligatoria:** la inferencia vive en el **adaptador**, jamás en el núcleo (Ley §1: cero dependencias, determinismo). El adaptador calcula el embedding y lo adjunta a la firma **como dato**, incluyendo la **versión del modelo** (cambiar el modelo cambia los vectores; el replay debe seguir siendo exacto — ADR 0006). El núcleo solo agrega matemática pura de vectores (coseno), tan determinista como Jaccard.
- Firma con vector = dato en el log = replays eternos, aún si el modelo muere o cambia.
- Tocaría la superficie de `sim()`/`SignatureSpace` (hoy fijada por ADR 0002): **discusión de contrato previa obligatoria** + ADR + posible versión de evento.

**Gate:** Fase 5 operativa (primer dominio con firmas no composicionales reales). Sin ese dominio, los embeddings no tienen qué resolver.

---

## 5. Calibración de políticas con RL (idea 3)

**Idea original:** aprendizaje por refuerzo que ajusta autónomamente asíntota, `r` y umbrales según el éxito de los contraataques.

**Veredicto: partida en dos.**

- **Offline — aprobada.** El harness de simulación de balance (ADR 0008, paso 1.5) es el gimnasio exacto para esto: un optimizador (RL o búsqueda simple, que suele alcanzar) corre miles de simulaciones y **propone configuraciones estáticas de `policy`** que el autor revisa y aplica como "parche de balance". Datos en vez de intuición, cero riesgo, cero cambios de motor.
- **Online — diferida.** Parámetros mutando en vivo: (a) rompe la legibilidad del meta — los jugadores no pueden aprender reglas móviles; (b) es inauditable para B2B ("la política de seguridad se auto-modifica" espanta auditores); (c) técnicamente exigiría eventos `PolicyChanged` versionados en el log para no romper replays. Si algún día: ADR propio.

**Gate (offline):** harness de simulación estable + métricas de éxito definidas (¿qué es "buen balance"? — esa definición es del autor, no del optimizador).

---

## 6. Crecimiento, difusión y distribución (Steam incluido)

El estudio completo vive en [`crecimiento-y-difusion.md`](crecimiento-y-difusion.md): mecánicas de retención con veredictos (HUD de progreso, expediente del ente, amague, bono de diversidad, meta-progresión de paleta con su advertencia), la sección pública de documentación del motor en la web, canales de difusión 2026, e itch.io → Steam con sus gates. Regla heredada clave: **nada jugable se publica antes de resolver el hallazgo congelado de balance**, y la decisión open/closed source del motor precede a cualquier repo público.

## Regla de salida del embudo

Para promover cualquier entrada de este documento a trabajo real: (1) su gate cumplido y verificable, (2) ADR propio aceptado, (3) si toca contrato, `sim()`, esquema de eventos o cualquier superficie del núcleo: discusión previa con el autor y la revisión externa, sin excepciones. Este documento se actualiza al agregar ideas nuevas o al promover/descartar existentes — nunca se borran entradas, se les cambia el estado.
