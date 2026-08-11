# ADR 002 — Dos ejes: familiaridad y malicia

**Estado:** Aceptada · **Origen:** un fallo real encontrado corriendo la primera
simulación completa (2026-07-19)

## Contexto

La primera versión del dominio usaba una sola señal para decidir: el
`threat_score` que devuelve el motor, o sea cuánta resistencia consolidada tiene
un patrón. La lógica parecía obvia — cuanto más adaptado, más se acciona.

La primera simulación completa mostró el problema con toda claridad: **241
ralentizaciones sobre tráfico legítimo** de 400 requests. Los usuarios reales
repetían las mismas rutas, el motor las consolidaba como patrones familiares, y
el sistema los trataba como amenazas.

La causa no era calibración. Era conceptual:

> En un juego, todo estímulo es un ataque, así que familiaridad **es** amenaza.
> En defensa, la mayoría del tráfico es benigno. Un patrón legítimo repetido
> también se vuelve familiar. Adaptarse a lo normal debe significar *"esto ya lo
> conozco, es la línea de base"*, que es exactamente lo contrario de bloquear.

## Decisión

**Dos ejes independientes, y se interviene solo en la intersección.**

```
familiaridad  ← el motor    (¿está consolidado este patrón?)
malicia       ← el dominio  (¿es un problema que lo esté?)

amenaza = familiaridad × malicia
```

Se corta lo que es **persistente Y malicioso**:

- Lo **nuevo** no se corta: todavía no es persistente, no hay evidencia.
- Lo **benigno** no se corta: por más que se repita mil veces, malicia cero
  multiplica a cero.

La malicia vive en `security/threat.py` y sale de los rasgos: clase de payload,
familia del agente, clase de respuesta, entropía, rutas sensibles. La línea de
base —navegador pidiendo una ruta pública con respuesta 200— da **exactamente
cero**, no "poquito". Ese cero es deliberado: si la línea de base pudiera
acumular sospecha, con suficiente tráfico terminaría accionándose.

Además hay un **piso benigno** (`benign_floor = 0.15`): por debajo de esa
malicia no se interviene, pase lo que pase.

### Corrección adicional: la sospecha solo se hereda de parientes hostiles

Al medir de nuevo apareció un segundo caso: un goteo lento se accionaba en su
**primera** aparición. El motor generaliza por parecido (R6) y el goteo heredaba
familiaridad de la línea de base de navegadores —mismo método, mismo agente,
mismo ritmo—. Parecerse a lo normal no es evidencia de nada.

El motor no puede arreglarlo: no sabe —ni debe saber— qué vecinos son hostiles.
Se corrige del lado del dominio, en `threat.hostile_familiarity`: se toma la
evidencia propia del cluster, y de la heredada solo la que viene de vecinos que
**ellos mismos** tenían pinta de ataque.

## Alternativas descartadas

- **Bajar los umbrales del sintetizador.** Fue lo primero que se probó. Reduce
  los falsos positivos pero también la detección: es mover el problema, no
  resolverlo. Con un solo eje, cualquier umbral es un compromiso entre molestar
  usuarios y dejar pasar ataques.
- **Meter la malicia dentro del motor.** Habría simplificado el llamado, y
  habría roto lo único que hace valioso al motor: dejaría de ser agnóstico de
  dominio. "Malicia" no significa nada en una arena de juego.
- **Una lista de patrones legítimos conocidos (allowlist).** Funciona y es lo
  que hace mucha gente. Descartada como mecanismo principal porque no escala: hay
  que mantenerla a mano y falla contra tráfico legítimo que nadie anticipó.
  Sobrevive como red de seguridad en el gobernador, para rutas críticas.

## Consecuencias

**Positivas**

- Falsos positivos medidos: **0%** de acciones disruptivas sobre tráfico
  legítimo, con varias semillas y con el sitio bajo ataque simultáneo
  (`tests/test_scenarios.py::TestFalsosPositivos`).
- El envenenamiento deja de ser viable *por construcción*: tráfico fabricado
  para parecer legítimo tiene malicia cero, así que ninguna cantidad de
  repetición lo convierte en una contramedida contra usuarios reales. Medido:
  382 requests de envenenamiento, cero efecto.
- La decisión se vuelve explicable en dos frases: "lo vi muchas veces" y "tiene
  pinta de ataque". Un operador entiende eso; un score único, no.

**Negativas**

- Los pesos de malicia son juicio experto, igual que los de especificidad. Un
  ataque que no dispare ninguno de los rasgos conocidos —sin payload
  reconocible, con agente de navegador, sobre rutas normales— tendrá malicia
  baja y no se accionará. Es una limitación real: este sistema no reemplaza a un
  WAF ni pretende detectar lo que no tiene forma reconocible.
- Son dos conjuntos de pesos que mantener en vez de uno.
- La multiplicación es una elección de forma entre varias posibles (mínimo,
  media geométrica, etc.). Se eligió el producto porque hace que cualquiera de
  los dos ejes en cero anule la decisión, que es la propiedad que se buscaba.
