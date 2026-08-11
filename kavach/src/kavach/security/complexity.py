"""complexity.py — complejidad como AMBIGÜEDAD.

Acá está la decisión conceptual más importante del dominio, y vale entenderla
antes de leer el resto.

El contrato dice: `N(c)` es monótona creciente en la complejidad `c`, y
`N(c_mínima) = 1`. **Qué significa `c` lo define el dominio.** En un juego, `c`
es la riqueza de la composición: un ataque complejo es más difícil de adaptar y
exige más exposiciones. En defensa, la intuición se invierte:

- Una firma **muy específica** —agente `sqlmap`, payload de inyección, ruta de
  login— casi no puede ser otra cosa que un ataque. Esperar más evidencia es
  regalarle exposiciones gratis al atacante.
- Una firma **vaga** —solo `method:GET` y una ruta común— matchea muchísimo
  tráfico legítimo. Comprometerse rápido con ella es garantizar un incidente
  propio.

Entonces en defensa `c = ambigüedad`: cuánta cosa distinta puede caer bajo esa
firma. La regla del contrato se cumple al pie de la letra —a más ambigüedad, más
exposiciones exigidas— y el resultado semántico es el correcto:

    **el umbral de evidencia es proporcional al daño de equivocarse.**

Esto es exactamente lo que demuestra que el contrato es agnóstico de dominio: no
hubo que tocarlo, hubo que darle la métrica que el dominio necesita.
"""

from __future__ import annotations

from ..signature import Signature

#: Cuánto "acusa" cada eje, en [0, 1]. Un valor alto significa que ver ese rasgo
#: reduce mucho el universo de cosas que podrían haberlo producido.
#:
#: Los números no son sagrados: son el dial de calibración del dominio, y se
#: ajustan con datos de tráfico real. Lo que no se mueve es el ORDEN.
_SPECIFICITY: dict[str, float] = {
    "payload": 0.92,   # un patrón de inyección casi no aparece por accidente
    "entropy": 0.55,   # ofuscación: sospechoso, pero también lo son los tokens
    "ua": 0.45,        # las herramientas se anuncian; los navegadores se falsifican
    "rate": 0.30,      # ráfagas y goteos son forma, no contenido: acompañan
    "status": 0.35,    # muchos 404 seguidos dicen algo; uno solo no
    "path": 0.25,      # la ruta acota, pero la comparten legítimos y atacantes
    "method": 0.10,    # casi no discrimina por sí solo
}

#: Cuánto acusa un valor puntual, por encima de lo que acusa su eje. Ver
#: `sqlmap` no es lo mismo que ver `browser`.
_VALUE_SPECIFICITY: dict[str, float] = {
    "ua:sqlmap": 0.97,
    "ua:nikto": 0.96,
    "ua:nmap": 0.95,
    "ua:masscan": 0.95,
    "ua:nuclei": 0.95,
    "ua:hydra": 0.95,
    "ua:dirbuster": 0.93,
    "ua:gobuster": 0.93,
    "ua:browser": 0.05,
    "ua:unknown": 0.30,
    "ua:absent": 0.60,
    "status:missing": 0.55,
    "status:denied": 0.60,
    "status:ok": 0.05,
    "rate:burst": 0.35,
    "rate:sustained": 0.22,
    "rate:normal": 0.05,
    "method:GET": 0.02,
}


def specificity_of(primitive: str) -> float:
    """Cuánto acusa una primitiva sola, en [0, 1]."""
    if primitive in _VALUE_SPECIFICITY:
        return _VALUE_SPECIFICITY[primitive]
    kind = primitive.split(":", 1)[0]
    return _SPECIFICITY.get(kind, 0.20)


def signature_specificity(signature: Signature) -> float:
    """Especificidad combinada de la firma, en [0, 1).

    Se combina con la regla del complemento: `1 − Π(1 − sᵢ)`. Cada rasgo nuevo
    solo puede sumar sospecha, nunca restarla, y la suma satura suavemente en 1
    en vez de dispararse. Es la misma forma que usa la probabilidad de que
    ocurra al menos uno de varios eventos independientes — acá los rasgos no son
    independientes de verdad, pero la forma se comporta como se necesita: dos
    rasgos fuertes bastan, y diez rasgos débiles nunca alcanzan a uno fuerte.
    """
    remaining = 1.0
    for primitive in signature.primitives:
        remaining *= 1.0 - specificity_of(primitive)
    return 1.0 - remaining


def ambiguity(signature: Signature) -> float:
    """`c` del contrato: cuánto tráfico distinto podría caer bajo esta firma.

    Es el complemento de la especificidad. Va directo a `required_exposures`.
    """
    return max(0.0, min(1.0, 1.0 - signature_specificity(signature)))


def weakness_of(signature: Signature) -> str:
    """Qué rasgo se señala como la debilidad al completar una adaptación.

    Se elige **la primitiva más específica**, no la primera alfabética: es la que
    de verdad identifica al ataque y la que una contramedida puede explotar. Que
    sea determinista importa, porque viaja en el payload de `AdaptationCompleted`
    y cualquier cambio afectaría replays viejos.

    El desempate es la clave canónica, para que dos rasgos igual de específicos
    siempre se resuelvan igual.
    """
    return max(signature.primitives, key=lambda p: (specificity_of(p), p))
