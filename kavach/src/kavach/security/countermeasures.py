"""countermeasures.py — el puerto `CounterSynthesizer` del dominio.

El motor nunca sabe qué es una contramedida concreta: emite `CounterReady` con
la debilidad detectada y acá se decide qué significa eso en HTTP.

Dos principios que rigen todo el módulo:

1. **Respuesta graduada, no interruptor.** La escalera va de observar a poner en
   cuarentena. Un patrón nuevo jamás se bloquea: bloquear con una sola
   observación es lo que permite envenenar un sistema con un request fabricado.
2. **Toda contramedida caduca.** Sin TTL, un falso positivo es permanente. Con
   TTL, el peor caso está acotado en el tiempo y el sistema se recupera solo.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import IntEnum

from ..explain import Explanation


class Action(IntEnum):
    """La escalera de respuesta, de menor a mayor intrusión.

    Es `IntEnum` a propósito: las acciones se comparan y se toman máximos, y el
    orden es parte del diseño.
    """

    ALLOW = 0
    MONITOR = 1
    THROTTLE = 2
    CHALLENGE = 3
    QUARANTINE = 4

    @property
    def label(self) -> str:
        return {
            Action.ALLOW: "permitir",
            Action.MONITOR: "observar",
            Action.THROTTLE: "ralentizar",
            Action.CHALLENGE: "desafiar",
            Action.QUARANTINE: "cuarentena",
        }[self]

    @property
    def is_disruptive(self) -> bool:
        """Si el usuario legítimo lo notaría. Lo que cuenta para el freno duro."""
        return self >= Action.CHALLENGE


@dataclass(frozen=True)
class Countermeasure:
    """Lo que el dominio propone hacer. Todavía no es lo que se hace: eso lo
    decide el gobernador, que puede vetarla."""

    action: Action
    cluster_id: str
    weakness: str | None
    threat_score: float
    ttl_ms: float
    issued_at_ms: float
    reason: str
    #: Cuánto ralentizar, en milisegundos de retardo. Solo para THROTTLE.
    delay_ms: float = 0.0

    @property
    def expires_at_ms(self) -> float:
        return self.issued_at_ms + self.ttl_ms

    def active_at(self, timestamp_ms: float) -> bool:
        return timestamp_ms < self.expires_at_ms

    def to_dict(self) -> dict:
        return {
            "action": self.action.name,
            "label": self.action.label,
            "cluster_id": self.cluster_id,
            "weakness": self.weakness,
            "threat_score": round(self.threat_score, 4),
            "ttl_ms": self.ttl_ms,
            "issued_at_ms": self.issued_at_ms,
            "expires_at_ms": self.expires_at_ms,
            "reason": self.reason,
            "delay_ms": self.delay_ms,
        }


@dataclass(frozen=True)
class SynthesizerConfig:
    """Umbrales de la escalera. Son el dial de agresividad del despliegue."""

    monitor_at: float = 0.05
    throttle_at: float = 0.20
    challenge_at: float = 0.45
    quarantine_at: float = 0.70
    #: Por debajo de esta malicia no se interviene, pase lo que pase. Es el
    #: piso que protege a la línea de base: familiar no es lo mismo que hostil.
    benign_floor: float = 0.15
    #: TTL base; se multiplica según la gravedad de la acción.
    base_ttl_ms: float = 5 * 60 * 1000.0
    max_delay_ms: float = 2_000.0
    #: Una firma que nunca completó adaptación no puede pasar de acá, por más
    #: que herede sospecha: sin evidencia propia no se corta el tráfico.
    max_action_without_adaptation: Action = Action.THROTTLE


class CounterSynthesizer:
    """Traduce una explicación del motor a una contramedida concreta."""

    def __init__(self, config: SynthesizerConfig = SynthesizerConfig()) -> None:
        self.config = config

    def synthesize(
        self,
        explanation: Explanation,
        timestamp_ms: float,
        malice: float = 1.0,
        familiarity: float | None = None,
    ) -> Countermeasure:
        """Decide la respuesta combinando los dos ejes.

        `explanation.threat_score` es **familiaridad**: cuán consolidado está el
        patrón según el motor. `malice` es cuánta pinta de ataque tiene, y lo
        aporta el dominio (`threat.malice_of`). Se multiplican porque las dos
        condiciones son necesarias: lo nuevo no se corta aunque sea horrible —
        todavía no hay evidencia—, y lo benigno no se corta aunque se repita
        para siempre.

        El default `malice=1.0` conserva el comportamiento de un dominio donde
        todo estímulo es hostil, que es el caso del motor original.
        """
        cfg = self.config
        if familiarity is None:
            familiarity = explanation.threat_score
        score = familiarity * malice

        if malice < cfg.benign_floor:
            return Countermeasure(
                action=Action.ALLOW,
                cluster_id=explanation.cluster_id,
                weakness=explanation.weakness,
                threat_score=score,
                ttl_ms=0.0,
                issued_at_ms=timestamp_ms,
                reason=(
                    f"patrón sin indicios de ataque (malicia {malice:.2f}): "
                    "familiar no es lo mismo que hostil"
                ),
            )

        if score >= cfg.quarantine_at:
            action, reason = Action.QUARANTINE, "amenaza consolidada y de alta confianza"
        elif score >= cfg.challenge_at:
            action, reason = Action.CHALLENGE, "patrón adaptado: se exige prueba de humanidad"
        elif score >= cfg.throttle_at:
            action, reason = Action.THROTTLE, "sospecha suficiente para encarecer el intento"
        elif score >= cfg.monitor_at:
            action, reason = Action.MONITOR, "señal débil: se registra sin intervenir"
        else:
            action, reason = Action.ALLOW, "sin señal previa contra este patrón"

        # El techo por falta de evidencia propia. Es la defensa contra el
        # envenenamiento: por más que un patrón se parezca a algo malo, hasta que
        # no acumule SUS exposiciones no se lo puede cortar.
        if not explanation.adapted and action > cfg.max_action_without_adaptation:
            action = cfg.max_action_without_adaptation
            reason = (
                "sospecha heredada de un patrón vecino, sin evidencia propia todavía: "
                "se limita la respuesta"
            )

        ttl = cfg.base_ttl_ms * (1 + int(action))
        delay = cfg.max_delay_ms * min(1.0, score) if action == Action.THROTTLE else 0.0

        return Countermeasure(
            action=action,
            cluster_id=explanation.cluster_id,
            weakness=explanation.weakness,
            threat_score=score,
            ttl_ms=ttl,
            issued_at_ms=timestamp_ms,
            reason=reason,
            delay_ms=delay,
        )
