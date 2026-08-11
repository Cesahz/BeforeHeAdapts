"""sentinel.py — el orquestador: de un request a una decisión auditable.

Une las piezas sin agregar lógica propia:

    request → traductor → firma → motor → explicación → contramedida → gobernador

Cada paso tiene un dueño y ninguno invade al otro. Si algo de acá tuviera que
saber cómo funciona la curva de adaptación, estaría mal ubicado.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from ..engine import Engine, EngineState
from ..explain import Explanation, explain
from ..ledger import EventLog
from ..policy import DEFAULT_POLICY, Policy
from .complexity import ambiguity, weakness_of
from .countermeasures import Action, CounterSynthesizer, Countermeasure, SynthesizerConfig
from .features import Features, Request
from .governor import Decision, Governor, GovernorConfig, Mode
from .threat import hostile_familiarity, malice_of
from .translator import RateMeter, SecurityTranslator


@dataclass(frozen=True)
class Observation:
    """Todo lo que pasó con un request. Es la unidad de auditoría."""

    request: Request
    features: Features
    explanation: Explanation
    countermeasure: Countermeasure
    decision: Decision
    seq: int

    @property
    def applied(self) -> Action:
        return self.decision.applied

    def to_dict(self) -> dict[str, Any]:
        return {
            "seq": self.seq,
            "timestamp_ms": self.request.timestamp_ms,
            "request": {
                "method": self.request.method,
                "path": self.request.path,
                "source": self.request.source,
                "user_agent": self.request.user_agent,
                "status": self.request.status,
            },
            "features": {
                "method": self.features.method,
                "path": self.features.path_template,
                "ua": self.features.ua_family,
                "payload": self.features.payload,
                "entropy": self.features.entropy,
                "status": self.features.status,
                "rate": self.features.rate,
            },
            "signature": self.explanation.cluster_id,
            "explanation": self.explanation.to_dict(),
            "summary": self.explanation.summary(),
            "decision": self.decision.to_dict(),
        }


class Sentinel:
    """Defensa adaptativa sobre un stream. Una instancia por servicio protegido.

    **Aislamiento estricto:** un Sentinel no comparte estado con otro. Lo que un
    servicio aprendió no contamina a otro — es una garantía de arquitectura, no
    una configuración.
    """

    def __init__(
        self,
        stream_id: str = "default",
        policy: Policy = DEFAULT_POLICY,
        governor_config: GovernorConfig = GovernorConfig(),
        synthesizer_config: SynthesizerConfig = SynthesizerConfig(),
        mode: Mode = Mode.SHADOW,
        rate_meter: RateMeter | None = None,
    ) -> None:
        self.engine = Engine(
            policy=policy,
            complexity=ambiguity,
            weakness=weakness_of,
        )
        self.translator = SecurityTranslator(rate_meter=rate_meter)
        self.synthesizer = CounterSynthesizer(synthesizer_config)
        self.governor = Governor(governor_config, mode=mode)
        self.state: EngineState = self.engine.initial_state(stream_id)
        self.log = EventLog(stream_id)
        self.observations: list[Observation] = []

    # --- El ciclo ------------------------------------------------------------

    def observe(self, request: Request) -> Observation:
        """Procesa un request y devuelve la decisión, con su justificación."""
        signature, features = self.translator.translate(request)

        # La explicación se calcula ANTES de procesar: la decisión sobre ESTE
        # request tiene que basarse en lo que se sabía al recibirlo, no en lo que
        # se aprendió gracias a él. Si no, el sistema se estaría justificando
        # con información del futuro.
        explanation = explain(self.engine, self.state, signature)

        result = self.engine.process(
            self.state, signature, request.timestamp_ms, self.log.next_seq
        )
        self.state = result.state
        self.log = self.log.append(*result.events)

        # Los dos ejes: el motor aporta familiaridad, el dominio aporta malicia.
        # Ver `threat.py` — separarlos es lo que impide cortar tráfico legítimo
        # solo por ser frecuente.
        malice = malice_of(signature)
        familiarity = hostile_familiarity(
            explanation, benign_floor=self.synthesizer.config.benign_floor
        )
        countermeasure = self.synthesizer.synthesize(
            explanation, request.timestamp_ms, malice=malice, familiarity=familiarity
        )
        decision = self.governor.decide(
            countermeasure,
            path=request.path,
            source=request.source,
            timestamp_ms=request.timestamp_ms,
        )

        observation = Observation(
            request=request,
            features=features,
            explanation=explanation,
            countermeasure=countermeasure,
            decision=decision,
            seq=observation_seq(self.observations),
        )
        self.observations.append(observation)
        return observation

    # --- Lectura -------------------------------------------------------------

    def replay(self) -> EngineState:
        """Reconstruye el estado desde el log. Debe coincidir con el vivo."""
        return self.engine.replay(self.log)

    def clusters_snapshot(self) -> list[dict[str, Any]]:
        """Lo que el motor aprendió, ordenado por relevancia para el panel."""
        rows = []
        for cluster in self.state.clusters.values():
            rows.append(
                {
                    "cluster_id": cluster.cluster_id,
                    "primitives": list(cluster.signature.primitives),
                    "exposures": cluster.exposure_count,
                    "required": cluster.required,
                    "progress": round(cluster.progress, 3),
                    "adapted": cluster.adapted,
                    "weakness": cluster.weakness,
                    "resistance": round(
                        self.engine.resistance_of(self.state, cluster.cluster_id), 4
                    ),
                    "confidence": round(
                        self.engine.confidence_of(self.state, cluster.cluster_id), 4
                    ),
                    "next_eff": round(
                        self.engine.effectiveness(self.state, cluster.signature), 4
                    ),
                    "first_seen_ms": cluster.first_seen_ms,
                    "last_seen_ms": cluster.last_seen_ms,
                }
            )
        rows.sort(key=lambda r: (r["adapted"], r["progress"], r["exposures"]), reverse=True)
        return rows

    def stats(self) -> dict[str, Any]:
        """Métricas agregadas de la corrida."""
        total = len(self.observations)
        applied = [o.applied for o in self.observations]
        proposed = [o.countermeasure.action for o in self.observations]
        return {
            "requests": total,
            "clusters": len(self.state.clusters),
            "adapted": sum(1 for c in self.state.clusters.values() if c.adapted),
            "events": len(self.log),
            "applied_disruptive": sum(1 for a in applied if a.is_disruptive),
            "proposed_disruptive": sum(1 for a in proposed if a.is_disruptive),
            "suppressed": sum(1 for o in self.observations if o.decision.suppressed),
            "by_action": {
                action.name: sum(1 for a in applied if a is action) for action in Action
            },
        }

    def export_log(self) -> dict[str, Any]:
        """Export del log, con la política: sin ella el replay no es reproducible."""
        data = self.log.to_dict()
        data["policy"] = {
            "curve": {
                "base": self.engine.policy.curve.base,
                "ratio": self.engine.policy.curve.ratio,
                "floor": self.engine.policy.curve.floor,
            },
            "memory": self.engine.policy.memory,
            "generalization_radius": self.engine.policy.generalization_radius,
            "max_required_exposures": self.engine.policy.max_required_exposures,
        }
        return data


def observation_seq(existing: list[Observation]) -> int:
    return len(existing)
