# ADR 001 — Complejidad como ambigüedad

**Estado:** Aceptada

## Contexto

R2 exige que `N(c)` sea monótona creciente en la complejidad `c`, con
`N(c_mínima) = 1`. El contrato deja deliberadamente abierto **qué significa
`c`**: es el dominio quien aporta la métrica.

En el motor original —un juego donde un ente se adapta a los ataques del
jugador— `c` es la riqueza de la composición: un ataque de siete primitivas es
más difícil de asimilar que uno de una, así que exige más exposiciones. La
intuición es directa: más complejo, más cuesta adaptarse.

Al portar el motor a defensa, esa intuición **se invierte**, y descubrirlo fue
lo que ordenó todo el dominio:

- Una firma **muy específica** —agente `sqlmap`, payload de inyección SQL, ruta
  `/login`, respuesta 500— casi no puede ser otra cosa que un ataque. Exigirle
  ocho exposiciones antes de actuar es regalarle siete intentos gratis al
  atacante.
- Una firma **vaga** —solo `method:GET` y una ruta común— matchea una enorme
  cantidad de tráfico legítimo. Comprometerse rápido con ella es fabricar un
  incidente propio.

## Decisión

**En el dominio de defensa, `c = ambigüedad`**: cuánto tráfico distinto puede
caer bajo esa firma. Es el complemento de la especificidad.

```
especificidad(firma) = 1 − Π (1 − especificidad(primitivaᵢ))
ambigüedad(firma)    = 1 − especificidad(firma)
N(c)                 = 1 + round(c × (N_max − 1))
```

Cada primitiva tiene un peso de especificidad —cuánto acota el universo de cosas
que pudieron producirla— y se combinan con la regla del complemento: cada rasgo
solo puede sumar, la suma satura suavemente en 1, y dos rasgos fuertes pesan
mucho más que diez débiles.

La regla del contrato se cumple al pie de la letra: `N` sigue siendo monótona
creciente en `c`. Lo que cambia es la semántica que el dominio le da a `c`, y el
resultado es el correcto:

> **el umbral de evidencia es proporcional al daño de equivocarse.**

Un ataque evidente se acciona en la primera exposición. Un patrón vago necesita
ocho antes de que el sistema se comprometa.

## Alternativas descartadas

- **Copiar `c = cantidad de primitivas` del dominio original.** Es lo más
  simple y lo que ya estaba probado. Descartada porque produce exactamente el
  comportamiento inverso al deseado: los ataques más reconocibles —que suelen
  traer muchos rasgos delatores— serían los que más tardarían en accionarse,
  mientras que un patrón genérico de dos rasgos se accionaría enseguida. Es la
  peor combinación posible: lento con lo obvio, apurado con lo dudoso.
- **Modificar R2 para que `N` sea decreciente en defensa.** Habría requerido
  tocar el contrato y romper la propiedad de que las dos implementaciones
  comparten especificación. Innecesario: el contrato ya permitía esto, solo
  había que darle la métrica correcta.
- **Umbral fijo de exposiciones para todo.** Simple y predecible, y es lo que
  hacen casi todos los sistemas de reglas. Descartada porque obliga a elegir
  entre ser lento con los ataques o agresivo con el tráfico normal: un solo
  número no puede servir a las dos cosas.

## Consecuencias

**Positivas**

- El dial de calibración del dominio queda en un solo lugar (`_SPECIFICITY` y
  `_VALUE_SPECIFICITY` en `security/complexity.py`), y se ajusta con datos de
  tráfico real sin tocar el motor.
- Demuestra que el contrato es genuinamente agnóstico de dominio: no hubo que
  modificarlo, hubo que darle la métrica que el dominio necesitaba.
- La misma función determina la **debilidad** que viaja en `AdaptationCompleted`:
  se elige la primitiva más específica, que es la que una contramedida puede
  explotar de verdad.

**Negativas**

- Los pesos de especificidad son juicio experto, no datos. Están calibrados a
  ojo para el tráfico simulado; contra tráfico real habría que medirlos. Es la
  parte más frágil del dominio y conviene decirlo de frente.
- Un atacante que conozca los pesos podría diseñar firmas deliberadamente
  ambiguas para subir su `N(c)` y ganar exposiciones. La mitigación no está acá
  sino en el otro eje: una firma ambigua *y* maliciosa sigue acumulando
  evidencia, solo que más despacio — que es exactamente el comportamiento
  prudente cuando la señal es débil.
- La especificidad nunca llega a 1 exactamente, así que `N` nunca es
  matemáticamente cero-evidencia. Es deliberado: siempre hace falta al menos
  una observación propia.
