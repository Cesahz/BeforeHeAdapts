"""governor.py - el gobernador del dominio http.

el mecanismo -modo sombra, freno duro con histeresis, kill switch, exenciones-
vive en `kavach/enforcement.py` porque no depende del dominio: significa lo
mismo si lo que se corta es una peticion http o un turno de conversacion. ver
ADR 005.

lo que queda aca es lo unico especifico de http: que acciones existen, cual es
la neutra, a cual se degrada bajo freno, y que las rutas de salud jamas se
tocan. mas el nombre del objetivo -aca se llama `path`-.
"""

from __future__ import annotations

from dataclasses import dataclass, replace

from ..enforcement import Decision, Governor as BaseGovernor, GovernorConfig as BaseConfig, Ladder, Mode
from .countermeasures import Action, Countermeasure

__all__ = ["Decision", "GovernorConfig", "Governor", "Mode", "HTTP_LADDER"]

#: la escalera de http mapeada a los tres papeles que el gobernador necesita.
HTTP_LADDER: Ladder[Action] = Ladder(
    allow=Action.ALLOW,
    degraded=Action.THROTTLE,
    monitor=Action.MONITOR,
)

#: rutas que nunca reciben una contramedida. es la ultima red: si todo lo demas
#: falla, el health check sigue respondiendo y el sistema se puede diagnosticar.
DEFAULT_EXEMPT_PATHS: tuple[str, ...] = ("/health", "/healthz", "/metrics", "/status")


@dataclass(frozen=True)
class GovernorConfig(BaseConfig):
    """config del gobernador http.

    hereda los limites operativos y solo fija el default de exenciones: en este
    dominio los objetivos son rutas.
    """

    exempt_targets: tuple[str, ...] = DEFAULT_EXEMPT_PATHS

    @property
    def exempt_paths(self) -> tuple[str, ...]:
        """alias con el nombre del dominio. `exempt_targets` es el generico."""
        return self.exempt_targets

    def with_paths(self, *paths: str) -> "GovernorConfig":
        return replace(self, exempt_targets=tuple(paths))


class Governor(BaseGovernor[Action]):
    """gobernador http. fija la escalera y nombra al objetivo `path`."""

    def __init__(
        self, config: GovernorConfig = GovernorConfig(), mode: Mode = Mode.SHADOW
    ) -> None:
        super().__init__(HTTP_LADDER, config, mode)

    def decide(  # type: ignore[override]
        self,
        countermeasure: Countermeasure,
        *,
        path: str,
        source: str,
        timestamp_ms: float,
    ) -> Decision[Action]:
        """en http el objetivo de una contramedida es la ruta pedida."""
        return super().decide(
            countermeasure, target=path, source=source, timestamp_ms=timestamp_ms
        )


def exempt_defaults() -> tuple[str, ...]:  # pragma: no cover - conveniencia
    return DEFAULT_EXEMPT_PATHS
