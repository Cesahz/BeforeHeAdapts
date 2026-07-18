# 0004 — Frontera de cuantización de entrada continua en el adaptador

**Estado:** Aceptada

## Contexto

La Fase 3b introduce combate en vivo: el cursor como hitbox del jugador, ataques trazados con el mouse y "lectura de ruido ambiental" (el ente percibe el movimiento previo al ataque). El mouse emite entrada continua (~60–120 eventos/segundo), pero el núcleo es event-sourced, discreto y determinista: todo estado es `reduce(log)` y los replays deben producir siempre el mismo resultado (Ley §2 y §3).

Si el movimiento crudo del cursor entrara al log de eventos: (a) el log explota en volumen y deja de ser replayable con sentido; (b) los fixtures golden se vuelven inmanejables; (c) el "ruido" del hardware (sampling rate distinto por dispositivo) rompe el determinismo entre cliente y servidor. Además, la vida del jugador y su hitbox son conceptos de la arena, no del motor: el núcleo no debe conocerlos (Ley §5, invertida: lógica de dominio de la arena tampoco vive en el núcleo).

## Decisión

**Toda entrada continua se cuantiza en el adaptador web, antes de la frontera del núcleo. El movimiento crudo del cursor jamás llega al motor ni al log.**

1. Un **reconocedor de gestos** client-side convierte trazos del mouse en **pocos eventos discretos** con firma canónica del DSL (p. ej. "trazo circular rápido" → primitivas `[circular, rapido]` + `intensity`). El reconocedor emite el evento solo al completarse el gesto.
2. La **lectura de ruido ambiental** se modela como exposiciones de **baja intensidad**: movimiento errático pre-ataque → evento de estímulo con `intensity` baja y firma de "ruido". El concepto `intensity` ya existe en el contrato — no se agrega nada al núcleo.
3. Los **parámetros de cuantización** (umbral de gesto, ventana de muestreo, sensibilidad del ruido) viven en la configuración del adaptador web, nunca en `packages/core`.
4. **Vida del jugador, hitbox del cursor y HUD** son estado del dominio arena, gestionado por el adaptador. El núcleo no los conoce.

## Alternativas descartadas

- **Stream crudo del cursor al log.** Volumen inmanejable, replays sin sentido semántico, determinismo dependiente del hardware. Viola el espíritu de "log como fixture golden".
- **Motor con tick por frame** (acoplar el engine al render loop). Convertiría el núcleo event-driven en un game loop, acoplando `packages/core` al navegador. Rompe la pureza y el segundo adaptador (auto-defensa, ADR 0005) no tiene frames.
- **Cuantizar en el server.** Duplica el tráfico (enviar movimiento crudo por red) y agrega latencia al feedback del gesto. La cuantización es cómputo barato y determinista dado el trazo: pertenece al cliente.

## Consecuencias

**Positivas:** el log se mantiene chico, legible y replayable; los gestos son testeables como unidad (trazo sintético → firma esperada); el mismo motor sirve sin cambios; el visualizador reproduce combates de cursor igual que cualquier otro log.

**Negativas:** la calidad del reconocedor define el "feel" del combate — un reconocedor malo se siente laggy o injusto, y es un componente nuevo a testear con cuidado. Hay latencia inherente entre inicio del gesto y emisión del evento (aceptada: el gesto ES el ataque, no cada pixel del trazo).

## Impacto en la Ley de arquitectura / contrato canónico

Ninguno. Esta decisión existe precisamente para proteger las Leyes §2 y §3 sin tocar el contrato. No cambia ningún test.
