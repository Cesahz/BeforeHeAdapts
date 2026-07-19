# Crecimiento, difusión y distribución

**Estado:** exploratorio, NO normativo. Deriva de la investigación de retención/difusión (2026-07; texto completo en `docs/privado/investigacion-retencion-difusion.md` — contiene datos personales del autor y no se publica) + revisión arquitectónica externa. Este documento es su destilado público y la única versión normativa de sus veredictos. Mismo régimen que `roadmap-avanzado.md`: las ideas salen hacia implementación **solo vía ADR**, y nada de este documento autoriza tocar `packages/core`, el contrato ni el esquema de eventos. Lo personal/operativo del autor vive en `docs/privado/`, no acá.

---

## 1. Identidad de producto: el motor es el activo, el juego es el escaparate

Principio ordenador de todo lo demás, fijado por el autor:

- **`packages/core` es el activo real del proyecto** — arquitectura seria con múltiples caminos (juego, auto-defensa/ciberseguridad, detección de anomalías, sistemas adaptativos en general). Se sigue blindando: pureza, contrato, cero dependencias, y control del autor sobre su evolución.
- **La arena web es un derivado** — el más vistoso, el que genera comunidad y material, pero uno entre varios. Ninguna decisión de producto/marketing del juego puede comprometer al motor.
- **El pitch de una frase** (validado por la investigación): *en un souls-like el jugador aprende los patrones del jefe; acá el jefe te aprende a vos.* Precedente de mercado directo: "el alien aprende de vos" fue el gancho central del marketing de Alien: Isolation. Con una ventaja honesta: nuestro ente no es teatro de behavior tree — es estado real, determinista y reproducible. Ese rigor es argumento tanto para jugadores como para reclutadores.

## 2. Mecánicas de retención — veredictos

Heredados de la síntesis de la investigación, con ajustes de la revisión:

| Mecánica | Veredicto | Nota de la revisión |
|---|---|---|
| HUD de progreso por cluster (k/N visible) | **Aprobada** | Ya existe la cristalización (3a); esto la completa. Riesgo cero: visualiza eventos ya emitidos. |
| "Expediente del ente" (resumen narrativo de sesión) | **Aprobada** | El mejor activo de marketing orgánico (precedentes Nemesis/Dwarf Fortress: la gente comparte historias, no stats). Screenshoteable/linkeable desde el día uno. |
| Victoria multi-acto / checklist de `CounterReady` | **Superada por el [ADR 0011](adr/0011-condicion-de-victoria-actos-y-firmas-viables.md)** | La meta primaria pasó a ser HP del ente + derrota por firmas viables agotadas. El checklist **sobrevive como objetivo secundario / score** ("forzaste 4 saltos y aun así ganaste"): como meta primaria invertía el incentivo, premiando alimentar la adaptación. Los actos sí se conservan, con transición legible. |
| Amague/truncamiento como mecánica jugable | **Aprobada con gate real** | La investigación dice "ya especificado, falta exponerlo" — cierto en el contrato, **pero la arena aún no implementa estímulos truncados**. Exige: policy-knob de cuánta info parcial da un truncamiento + implementación en room/translator + ADR. No es gratis; es barato. |
| Bono de diversidad por eje subrepresentado | **Aprobada** | Regla de dominio/`CounterSynthesizer`. Interactúa con el hallazgo congelado de balance: revisar juntos. |
| "Cortina de humo" (ruido a demanda del jugador) | **Pendiente** | Correctamente marcada: puede tocar el `StimulusTranslator`. Chequear contra alcance del ADR 0004 antes de tratarla como aprobada. |
| Meta-progresión de paleta (primitivas nuevas, lore, cosméticos) | **Aprobada CON ADVERTENCIA — ver §2.1** | La investigación la da por riesgo cero. En este juego específico no lo es. |
| Meta-progresión de poder (buffs numéricos) | **Rechazada** | Coincidencia total: contradice el principio del proyecto y hay rechazo documentado de comunidad. |

### 2.1 Advertencia de la revisión: acá, paleta ES poder

La investigación afirma que desbloquear primitivas del DSL "no vuelve más fácil ningún encuentro individual". **En este juego eso es falso**, y lo demostró nuestra propia simulación (hallazgo congelado, `MEMORY.md`): el daño total de una sesión está **acotado por el tamaño del catálogo disponible**, no por la habilidad. Por lo tanto, más primitivas = techo de daño más alto = poder real entre sesiones — exactamente lo que la meta-progresión de paleta prometía no ser.

Consecuencia: la meta-progresión de paleta **no puede diseñarse antes de descongelar y resolver el hallazgo de balance**. Quedan libres de esta advertencia: lore, cosméticos, reconocimiento — paleta *expresiva*, no mecánica. Gate duro: hallazgo de balance resuelto → recién ahí ADR de progresión de paleta mecánica.

### 2.2 Errata de la investigación

Usa la cifra vieja de ~3.800 firmas; el catálogo real del ADR 0008 es **5.376**. Sin impacto en conclusiones.

## 3. Documentación pública del motor en la web (requisito del autor)

La web tendrá una sección de documentación del **motor** — separada del juego — que expone qué es y cómo se puede exprimir. Especificación:

- **Ruta propia** (p. ej. `/engine`), con identidad visual sobria, distinta del juego: acá la audiencia es técnica (devs, reclutadores, potenciales interesados B2B).
- **Contenido:** qué es el motor (agnóstico, hexagonal, event sourcing, contrato de 6 reglas testeables); el log como API pública (ADR 0006); el caso "mismo motor, N dominios" con la arena como demo viva y la auto-defensa (ADR 0005/Fase 5) como caso serio; **catálogo de dominios posibles**: defensa adaptativa/rate-limiting, detección de anomalías y fraude, priorización adaptativa de alertas, tutores/dificultad adaptativa, A/B testing adversarial — cada uno mapeado a los puertos (`StimulusTranslator` / `CounterSynthesizer`) para mostrar que enchufarlo es escribir dos adaptadores, no tocar el núcleo.
- **Qué NO publica:** internals de calibración de `policy` de la arena (es el balance del juego), y cualquier decisión aún no tomada sobre licenciamiento. La sección *muestra* el motor sin regalar su valor B2B: enseña la arquitectura y los contratos, no el know-how de configuración.
- **Blindaje continuado:** el juego consume el motor como dependencia versionada, igual que cualquier futuro cliente. La sección de docs debe reflejar esa relación (el juego es "powered by" el motor, no al revés).
- Gate: Fase 4 (cuando la web deje de ser demo local). El contenido puede ir redactándose antes — deriva casi todo del README y los ADRs ya escritos.

## 4. Difusión y publicidad

Síntesis de canales (datos 2026 de la investigación) + cronograma sobre nuestras fases reales:

- **Doble audiencia con el mismo material:** jugadores (clips del ente adaptándose, expediente compartible) y técnicos (README, ADRs, writeup "mismo motor, dos dominios"). La segunda audiencia juega a las fortalezas reales del proyecto y del autor — rigor y arquitectura — y no exige volverse "creador de contenido".
- **Canales:** devlog escrito + X/Twitter (conversación gamedev viva) + YouTube devlogs largos (cola larga) + Discord (comunidad) + itch.io (primera distribución jugable). **TikTok: no sobre-invertir** — la investigación documenta el colapso del alcance orgánico para devlogs en 2025-2026.
- **El marketing empieza ahora, no "cuando esté listo"** — con 14.000+ juegos/año solo en Steam, esperar es una receta para el silencio. Lo bueno: el material de las Fases 2-3 ya existe (gifs del visualizador, demo jugable local).
- **Cronograma mapeado a fases:** ahora (post-3b): reservar handles, primer post de devlog — el gancho es el rigor contrato-primero, funciona sin gameplay pulido. Cierre de 3b + balance resuelto: primeros clips del combate. Fase 3 publicada: itch.io + tablero Get Feedback. Fase 4: framing de raid comunitario, leaderboard, y pensamiento wishlist.
- **Regla de secuencia (de la revisión, ya acordada con el autor):** nada se publica jugable (itch, repo público, clips de gameplay con invitación a jugar) **antes de resolver el hallazgo congelado de balance**. La primera impresión del mundo debe ser con el meta sano.

## 5. Distribución: itch.io primero, Steam como fase posterior condicionada

### 5.1 itch.io — el paso natural e inmediato

Cliente web client-side sin instalación = encaje perfecto. Gratis, con cultura establecida de feedback (tableros Get Feedback / Playtest), sin fricción de empaquetado. Sirve además como **instrumento de medición**: retención, duración de sesión, y conversión de curiosos → jugadores recurrentes son los datos que después justifican (o descartan) Steam.

### 5.2 Steam — análisis honesto

**Lo que Steam exige que hoy no tenemos:**

- **Un build empaquetado.** La arena es web; Steam quiere ejecutable. Camino técnico: wrapper **Tauri** (preferido: liviano, Rust — y conecta con la Fase 6 del plan original) o Electron. Trabajo acotado pero real: packaging, updates, overlay/achievements opcionales.
- **Contenido que justifique la tienda.** El single-player 3b solo es delgado para Steam pago. Lo que sí es "Steam-worthy": las **salas online / raids comunitarios (Fase 4)** — el sueño original — más el expediente compartible y el meta comunitario. Steam sin Fase 4 sería llegar con medio producto.
- **US$100 de fee por título** (recuperable con ventas) + página de tienda con assets (capsule art, trailer, screenshots) — trabajo de arte/copy no trivial para estética abstracta.

**Dos ramas, decisión del autor pendiente:**

- **Rama A — Steam como vitrina gratuita:** juego free, el motor como producto real detrás (B2B/portafolio). Steam aporta descubribilidad y legitimidad; la conversión buscada es atención → comunidad → oportunidades del motor. Coherente con "el juego es un derivado".
- **Rama B — Steam como producto pago** (rango micro-indie, USD 3-8): exige estándar de contenido y pulido mayor, soporte, y la charla de monetización completa (impuestos, entidad, Steam Direct). Solo tiene sentido con retención demostrada en itch y Fase 4 operativa.

**Playbook Next Fest** (si se llega): demo publicada **semanas antes** del fest, nunca debutando en él (el fest amplifica momentum, no lo crea — Valve reporta +1.300% de wishlists diarias durante el fest *sobre la base previa*). Métrica de salud: conversión demo→wishlist 10-20% normal; <5% = algo roto; >20% = hay algo especial.

**Gates para siquiera abrir la página de Steam:** (1) hallazgo de balance resuelto, (2) Fase 4 operativa, (3) datos de retención de itch.io que lo justifiquen, (4) decisión de rama A/B tomada por el autor.

## 6. Comunidad y feedback siendo un equipo de una persona

- **Preguntas concretas, no genéricas:** "¿te resultó legible que el cluster estaba por adaptarse?" rinde; "¿qué te pareció?" no. Las decisiones abiertas de este documento (legibilidad del HUD, amague visible o descubrible) son exactamente ese tipo de pregunta.
- **El pipeline de balance es uno solo:** el harness de simulación genera candidatos de `policy`; los testers humanos validan cuáles *se sienten* bien. Tratarlos como dos etapas del mismo proceso, no como pistas separadas.
- **Construir en público = reclutar testers y colaboradores.** El mismo devlog que hace marketing arma el pool de gente dispuesta a probar builds.
- Las oportunidades locales/presenciales del autor (comunidades, talleres, universidad) viven en `docs/privado/acciones-personales.md` — accionables, con fechas, fuera del repo público.

## 7. Decisiones pendientes del autor

1. **Rama A o B de Steam** (vitrina gratuita vs producto pago) — condiciona arte, copy, entidad legal y la charla de monetización pendiente.
2. **Open source vs código cerrado del motor** — pendiente desde el roadmap; ahora con más peso: la sección `/engine` de la web (§3) cambia según la respuesta (mostrar arquitectura de un repo abierto vs documentar una caja negra con contratos públicos). Debe decidirse **antes** de hacer público el repo.
3. **Amague: ¿mecánica enseñada (HUD) o descubrible (comunidad)?** — decisión de diseño pura, sin lado técnico.
4. **Descongelamiento del hallazgo de balance** — bloquea: meta-paleta mecánica (§2.1), toda publicación jugable (§4), y Steam (§5). Es la decisión más urgente de la lista.

## 8. Regla de salida

Igual que `roadmap-avanzado.md`: gate cumplido + ADR + si toca núcleo/contrato/eventos, discusión previa obligatoria. Las entradas no se borran; cambian de estado.
