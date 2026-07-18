# Diseño del adaptador web (arena) — Fases 3a / 3b

**Estado:** guía de diseño aceptada. Deriva de la propuesta del autor (2026-07) y su revisión técnica. Las decisiones con impacto arquitectónico viven en [ADR 0004](adr/0004-frontera-de-cuantizacion-de-entrada.md) y [ADR 0005](adr/0005-adaptador-de-autodefensa-del-sitio.md); este documento fija el diseño de producto y render.

## 0. Principio rector

**Nada de este documento toca `packages/core`.** Todo lo aquí descrito es adaptador: si implementar algo de esta guía requiere modificar el núcleo o el contrato, la implementación está mal planteada — detenerse y discutir.

## 1. División de la Fase 3

| Sub-fase | Contenido | Criterio de cierre |
|---|---|---|
| **3a** | Builder de ataques + ataques prefabricados + render abstracto + persistencia local | Jugable y publicable por sí sola |
| **3b** | Combate por cursor (hitbox + HUD) + ruido ambiental + deformación del ente | Se apoya en 3a ya estable |

Si 3b se atrasa o se recorta, 3a ya existe y se muestra. Multijugador: **formalmente en pausa** (no diseñar a cuenta de él). Cuentas de usuario: pospuestas (ver §3).

## 2. Builder: dos capas estrictamente separadas

- **Capa de firma mecánica (acotada):** toda composición compila a una firma canónica del DSL. Es lo único que ve el motor.
- **Capa de expresión visual (libre):** trayectorias, disposición, timing visual, color. Libertad tipo editor de Geometry Dash; al motor no le importa.

Regla dura: dos composiciones con distinta expresión visual pero igual composición mecánica **son la misma firma**. La creatividad visual no crea firmas nuevas; solo las primitivas del DSL lo hacen. Esto mantiene el espacio de firmas sano y el balance analizable.

## 3. Persistencia local (Fase 3a — sin cuentas)

La experiencia single-player anónima no pierde estado al refrescar:

- **`localStorage` como base** para las composiciones del DSL del Builder. Son JSON chicos; alcanza y sobra para el MVP.
- **Esquema versionado**: cada composición guardada lleva campo `v`, igual que los eventos del motor. Cuando existan cuentas (futuro), la migración local → servidor es una migración de versiones más, no un rediseño.
- **Export/import por código**: toda composición se puede exportar como string compacto (JSON comprimido/base64) e importar en otro navegador. Esto da *compartir builds* entre jugadores sin necesitar cuentas ni servidor — la dinámica comunitaria de descubrir estrategias empieza acá.
- **Umbral de migración**: si las colecciones crecen (decenas de builds o assets visuales pesados), pasar a IndexedDB. No antes: complejidad diferida hasta que haga falta.

## 4. Render abstracto y feedback de la Regla 5

Estética abstracta, fría y minimalista: partículas, geometría dinámica, color por elemento. Sin sprites ni ilustraciones. Y una obligación de diseño central:

**La atenuación pre-adaptación (`eff(k)`, R5) debe ser perceptible antes de que ocurra el salto.** El jugador tiene que *sentir* que su ataque rinde cada vez menos, no enterarse de golpe cuando el ente ya adaptó. Vocabulario de feedback, todo proporcional a `eff(k)` leído del estado:

- **Penetración de partículas:** las partículas del ataque penetran menos profundo en la figura del ente a medida que `eff` cae; a `eff` alto atraviesan y estallan, a `eff` bajo rebotan superficialmente.
- **Impacto amortiguado:** brillo/onda del impacto y volumen/timbre del golpe escalan con `eff` (agudo y seco a eff alto → sordo y apagado cerca del piso).
- **Anticipación del salto:** cuando `k` se acerca a `N(c)`, la zona de impacto del cluster "cristaliza" sutilmente (shimmer/endurecimiento visual) — el aviso de que la ventana se cierra, la carrera de tempo hecha imagen.
- **El salto (R1):** la adaptación completada es el único cambio brusco: deformación del ente (§5) + señal clara de `CounterReady`. Contraste deliberado: curva suave antes, salto discreto después — el contrato del motor, legible a simple vista.

Regla técnica: todo el feedback se calcula de datos ya presentes en el log/estado (`eff(k)`, `k/N(c)`, clusters adaptados). Nada de estado visual paralelo con lógica propia: el render es función del log, y los replays del visualizador reproducen exactamente lo que el jugador vio.

## 5. Deformación del ente — simple por diseño

El ente es **una sola figura base**. Nada de rigging ni animación compleja:

- Al completarse una adaptación (`AdaptationCompleted`), la figura puede **modificarse discretamente**, con magnitud según la complejidad `c` del cluster adaptado: complejidad baja → cambio superficial (endurecimiento de color/textura de una zona); complejidad alta → cambio estructural (p. ej. subdividirse en múltiples partes para evadir esa familia de ataques, reordenar su geometría).
- Las modificaciones **se acumulan**: el cuerpo del ente se vuelve un registro visible de todo lo que aprendió. Un ente muy adaptado se *ve* distinto — su historia es legible en su forma.
- Determinismo: la elección de deformación es función pura de los eventos (semilla incluida como dato del evento, Ley §1). Mismo log → misma forma final, también en el visualizador.
- La "evasión procedural" de 3b es esta misma mecánica aplicada en vivo: la figura reacciona ante firmas ya adaptadas usando la deformación que ya tiene, no genera geometría nueva por frame.

## 6. Contraataques y efectos de navegador — límites duros

Los contraataques pueden alterar la experiencia (oscurecer pantalla, distorsión del canvas, sonido), con estas reglas:

1. **Todo dentro del contenedor del juego.** Prohibido abrir ventanas/popups (bloqueadores + hostilidad percibida).
2. **Sonido tras interacción:** el audio se desbloquea con el primer clic del usuario (limitación del navegador); diseñar asumiendo que puede estar mudo.
3. **Accesibilidad:** sin flashes de alta frecuencia (riesgo epilepsia); ofrecer toggle de "efectos reducidos".
4. **Escalado no repetitivo:** la intensidad y variedad del efecto se derivan del estado de adaptación (nº de clusters adaptados, `k/N` del cluster atacante) — datos que ya están en el log. Un ente poco adaptado apenas reacciona; uno muy adaptado responde con efectos compuestos. La selección concreta usa la semilla del evento: variada pero determinista.

## 7. Presupuesto de rendimiento

- **Un solo canvas WebGL para todo el juego** (partículas, ente, ataques, deformación). DOM/CSS únicamente para UI (HUD, builder, menús) y los efectos raros de contraataque (filtros sobre el contenedor). **Jamás animar el juego con DOM.**
- Partículas: instanciadas, tope duro configurable (~10–20k). Deformación del ente: en vertex shader sobre la figura base.
- Colisión cursor-geometría: matemática de punto contra formas (barata, en CPU).
- El motor procesa **eventos discretos, no frames**: el game loop de render nunca llama al motor por frame. La cuantización de entrada (ADR 0004) es la única puerta de entrada.
- Objetivo: 60 fps en hardware modesto. Si algo no entra en presupuesto, se recorta densidad visual, nunca la legibilidad del feedback de §4.

## 8. Fuera de alcance (explícito)

Multijugador y salas online (pausado — Fase 4 sigue existiendo en el plan pero no condiciona 3a/3b). Cuentas de usuario y sync en servidor (§3 las reemplaza por export/import local). Sprites/arte ilustrado (la estética abstracta es decisión, no carencia). Cualquier cambio en `packages/core`.
