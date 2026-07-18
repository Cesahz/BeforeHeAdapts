# 0005 — Adaptador de auto-defensa: el sitio protegido por su propio motor

**Estado:** Aceptada

## Contexto

El plan original preveía como Fase 5 un adaptador de logs/anomalías de juguete, cuyo único propósito era demostrar que el motor es agnóstico de dominio ("mismo motor, dos dominios, cero cambios en el núcleo"). Surgió una propuesta superior: que la seguridad operativa de la propia web de la arena (rate limiting, mitigación de bots) esté supervisada por una instancia del mismo motor de adaptación que los jugadores enfrentan dentro de ella.

El argumento de portafolio se vuelve imbatible y autocontenido: *el mismo cerebro que la comunidad intenta vencer defiende el sitio donde lo intentan*. Pero introduce un riesgo operativo real: un motor con capacidad de bloquear tráfico y un bug de política pueden hacerle denial-of-service al propio sitio.

## Decisión

**El adaptador de auto-defensa reemplaza al adaptador de logs como Fase 5, bajo estas condiciones no negociables:**

1. **Instancia y log separados.** El motor de defensa es una instancia propia con su propio log de eventos, sin ningún estado compartido con las salas de la arena (Ley §4 aplica también aquí: defensa y juego son "salas" distintas).
2. **Traducción por puertos, como cualquier dominio.** Estímulo = patrones de requests (frecuencia, forma, origen agregado) vía `StimulusTranslator`; contramedida = regla de mitigación (rate limit, challenge, cuarentena temporal) vía `CounterSynthesizer`. El núcleo no sabe qué es HTTP.
3. **Modo sombra primero.** Al desplegarse, el motor observa y *propone* contramedidas registrándolas en su log, pero no las aplica: un humano revisa las decisiones propuestas. La promoción a modo activo es gradual, por tipo de contramedida, empezando por las reversibles (rate limit suave) y nunca las destructivas.
4. **Frenos duros en modo activo:** tope máximo de agresividad configurado fuera del motor (p. ej. nunca bloquear más del N% del tráfico), TTL corto en toda contramedida, y kill-switch operativo que apaga la aplicación de contramedidas sin apagar la observación.
5. **Posicionamiento público:** se presenta como demostración de arquitectura adaptativa, nunca como producto de seguridad. Sin claims de protección real hacia terceros.
6. **Privacidad:** las firmas de defensa se construyen sobre patrones agregados de tráfico, no sobre identidades; no se persiste información personal en el log de defensa.

## Alternativas descartadas

- **Adaptador de logs de juguete (plan original).** Demuestra lo mismo con menos riesgo, pero es un dominio inventado: menos convincente, y nadie lo usa de verdad. La auto-defensa es un dominio real con consecuencias reales — eso es lo que prueba la arquitectura.
- **WAF de terceros sin motor propio.** Resuelve la seguridad pero renuncia a la demostración. (Compatible: puede convivir un WAF convencional como red de seguridad debajo del motor.)
- **Modo activo desde el día uno.** Riesgo de auto-DoS inaceptable por un bug de política o una firma mal calibrada. El modo sombra convierte ese riesgo en material de análisis gratis: el log de "lo que hubiera hecho" es en sí mismo contenido para el writeup.

## Consecuencias

**Positivas:** el argumento "dos dominios, cero cambios en el núcleo" se demuestra con un dominio real en producción; el log de defensa alimenta el mismo visualizador (los ciclos de adaptación de la defensa también se pueden mostrar); el modo sombra genera datos de balance y material de difusión sin riesgo.

**Negativas:** requiere métricas y observabilidad que el proyecto aún no tiene; el modo sombra implica trabajo de revisión humana periódica; si el sitio tiene poco tráfico, el motor de defensa tendrá pocas exposiciones y la demo será menos vistosa (mitigable con tráfico sintético de prueba, claramente etiquetado).

## Impacto en la Ley de arquitectura / contrato canónico

Ninguno sobre las 6 reglas ni sobre `contract.test.ts`. Refuerza la Ley §4 extendiéndola explícitamente: defensa y arena son instancias aisladas. La Fase 5 del plan (`docs/arquitectura.md` §8) queda redefinida por este ADR.
