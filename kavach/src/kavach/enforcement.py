"""enforcement.py - el gobernador, generico sobre cualquier escalera de accion.

la capa que impide que el sistema se haga dano a si mismo. un motor con
capacidad de intervenir mas un bug de politica son, juntos, una denegacion de
servicio contra uno mismo -y con credenciales de administrador-.

vive en la raiz porque **el mecanismo no depende del dominio**: modo sombra,
freno duro con histeresis, kill switch y exenciones significan lo mismo si lo
que se corta es una peticion http, un turno de conversacion o cualquier otra
cosa. lo unico especifico de cada dominio es *que acciones existen*, y eso entra
como parametro (`Ladder`).

nacio dentro de `security/governor.py` y se extrajo al aparecer el segundo
dominio que lo necesitaba. duplicarlo habria significado dos implementaciones de
las mismas cuatro garantias de seguridad, divergiendo en silencio. ver ADR 005.

cuatro garantias, todas verificables por test:

1. **modo sombra.** al desplegar, el motor observa y propone, pero no aplica. la
   promocion a modo activo es una decision humana explicita, no el estado
   inicial.
2. **freno duro.** nunca se afecta mas de una fraccion del trafico en una
   ventana. con histeresis: un freno que titila es peor que ninguno.
3. **kill switch.** apaga la aplicacion de contramedidas sin apagar la
   observacion: se deja de intervenir, no de aprender.
4. **exenciones.** los objetivos criticos jamas se tocan, pase lo que pase.

sin I/O, sin reloj, sin azar: el tiempo entra como parametro, igual que en el
motor.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from enum import Enum
from typing import Any, Generic, Protocol, TypeVar, runtime_checkable


class Mode(str, Enum):
    """modo de operacion del gobernador."""

    SHADOW = "shadow"
    ENFORCING = "enforcing"


@runtime_checkable
class ActionLike(Protocol):
    """lo que el gobernador necesita saber de una accion.

    deliberadamente minimo: ordenable -para poder degradar- y capaz de decir si
    el usuario legitimo la notaria. cada dominio define su propia escalera; el
    gobernador no sabe cuales son ni cuantas hay.
    """

    @property
    def is_disruptive(self) -> bool: ...

    def __lt__(self, other: Any) -> bool: ...


A = TypeVar("A", bound=ActionLike)


@runtime_checkable
class CountermeasureLike(Protocol):
    """lo que el gobernador necesita de una contramedida propuesta."""

    action: Any
    cluster_id: str

    def active_at(self, timestamp_ms: float) -> bool: ...

    def to_dict(self) -> dict: ...


@dataclass(frozen=True)
class Ladder(Generic[A]):
    """las tres acciones que el gobernador necesita nombrar de cada dominio.

    - `allow`: la accion neutra, la que aplica cuando se decide no intervenir
    - `degraded`: a que se degrada una accion disruptiva cuando el freno actua.
      degradar y no apagar es deliberado: se sigue respondiendo, con menos dano
      potencial
    - `monitor`: el umbral por encima del cual una contramedida se registra como
      vigente
    """

    allow: A
    degraded: A
    monitor: A


@dataclass(frozen=True)
class GovernorConfig:
    """limites operativos. valores por defecto conservadores a proposito."""

    #: fraccion maxima del trafico que puede recibir una accion disruptiva.
    max_disruptive_fraction: float = 0.15
    #: ventana del freno, en cantidad de observaciones.
    brake_window: int = 200
    #: minimo de muestras antes de que el freno tenga sentido.
    brake_warmup: int = 40
    #: histeresis: una vez activado, el freno no suelta hasta bajar a esta
    #: fraccion del techo. sin esto el freno oscila -activa, la fraccion baja,
    #: suelta, la fraccion sube- y el trafico ve un comportamiento intermitente
    #: que ni un operador ni un cliente pueden interpretar.
    brake_release_ratio: float = 0.6
    #: objetivos exentos por prefijo. que es un "objetivo" lo define el dominio:
    #: una ruta http, un identificador de flujo, lo que corresponda.
    exempt_targets: tuple[str, ...] = ()
    #: origenes exentos (monitoreo interno, clientes criticos).
    exempt_sources: tuple[str, ...] = ()


@dataclass(frozen=True)
class Decision(Generic[A]):
    """que se hizo, que se hubiera hecho, y por que difieren."""

    applied: A
    proposed: A
    countermeasure: Any
    mode: Mode
    reason: str
    #: `True` si el freno duro degrado la accion propuesta.
    braked: bool = False
    exempt: bool = False
    killed: bool = False

    @property
    def suppressed(self) -> bool:
        """la propuesta no se aplico tal cual, por el motivo que sea."""
        return self.applied != self.proposed

    def to_dict(self) -> dict:
        return {
            "applied": self.applied.name,
            "applied_label": getattr(self.applied, "label", self.applied.name),
            "proposed": self.proposed.name,
            "proposed_label": getattr(self.proposed, "label", self.proposed.name),
            "mode": self.mode.value,
            "reason": self.reason,
            "braked": self.braked,
            "exempt": self.exempt,
            "killed": self.killed,
            "suppressed": self.suppressed,
            "countermeasure": self.countermeasure.to_dict(),
        }


class Governor(Generic[A]):
    """decide que se aplica de verdad. es la ultima palabra antes del efecto."""

    def __init__(
        self,
        ladder: Ladder[A],
        config: GovernorConfig = GovernorConfig(),
        mode: Mode = Mode.SHADOW,
    ) -> None:
        self.ladder = ladder
        self.config = config
        self.mode = mode
        self.kill_switch = False
        self._window: deque[bool] = deque(maxlen=config.brake_window)
        self._active: dict[str, Any] = {}
        self._braking = False

    #--- controles de operacion ---------------------------------------------

    def enforce(self) -> None:
        """promueve a modo activo. decision explicita y reversible."""
        self.mode = Mode.ENFORCING

    def shadow(self) -> None:
        self.mode = Mode.SHADOW

    def kill(self) -> None:
        """corta la aplicacion de contramedidas. la observacion sigue."""
        self.kill_switch = True

    def revive(self) -> None:
        self.kill_switch = False

    #--- estado del freno ----------------------------------------------------

    @property
    def disruptive_fraction(self) -> float:
        if not self._window:
            return 0.0
        return sum(self._window) / len(self._window)

    @property
    def brake_engaged(self) -> bool:
        """estado del freno, con histeresis.

        activa al tocar el techo y no suelta hasta bajar bien por debajo. es una
        lectura con efecto: actualizar el estado aca -y no en `decide`- mantiene
        una sola definicion de "el freno esta puesto".
        """
        if len(self._window) < self.config.brake_warmup:
            self._braking = False
            return False
        fraction = self.disruptive_fraction
        if self._braking:
            release_at = self.config.max_disruptive_fraction * self.config.brake_release_ratio
            if fraction <= release_at:
                self._braking = False
        elif fraction >= self.config.max_disruptive_fraction:
            self._braking = True
        return self._braking

    def active_countermeasures(self, timestamp_ms: float) -> list[Any]:
        """las contramedidas vigentes, purgando las vencidas."""
        alive = {key: cm for key, cm in self._active.items() if cm.active_at(timestamp_ms)}
        self._active = alive
        return sorted(alive.values(), key=lambda c: c.action, reverse=True)

    #--- la decision ---------------------------------------------------------

    def decide(
        self,
        countermeasure: Any,
        *,
        target: str,
        source: str,
        timestamp_ms: float,
    ) -> Decision[A]:
        proposed = countermeasure.action

        if self._is_exempt(target, source):
            self._window.append(False)
            return Decision(
                applied=self.ladder.allow,
                proposed=proposed,
                countermeasure=countermeasure,
                mode=self.mode,
                reason="objetivo u origen exento: nunca se interviene",
                exempt=True,
            )

        if self.kill_switch:
            self._window.append(False)
            return Decision(
                applied=self.ladder.allow,
                proposed=proposed,
                countermeasure=countermeasure,
                mode=self.mode,
                reason="kill switch activo: se observa, no se aplica",
                killed=True,
            )

        if self.mode is Mode.SHADOW:
            self._window.append(False)
            return Decision(
                applied=self.ladder.allow,
                proposed=proposed,
                countermeasure=countermeasure,
                mode=self.mode,
                reason="modo sombra: la contramedida queda registrada, no aplicada",
            )

        #modo activo: el freno puede degradar, nunca escalar.
        if proposed.is_disruptive and self.brake_engaged:
            self._window.append(False)
            return Decision(
                applied=self.ladder.degraded,
                proposed=proposed,
                countermeasure=countermeasure,
                mode=self.mode,
                reason=(
                    f"freno duro: ya se esta afectando el "
                    f"{self.disruptive_fraction:.0%} del trafico "
                    f"(techo {self.config.max_disruptive_fraction:.0%})"
                ),
                braked=True,
            )

        self._window.append(proposed.is_disruptive)
        if proposed > self.ladder.monitor:
            self._active[countermeasure.cluster_id] = countermeasure
        return Decision(
            applied=proposed,
            proposed=proposed,
            countermeasure=countermeasure,
            mode=self.mode,
            reason=countermeasure.reason,
        )

    #--- internos ------------------------------------------------------------

    def _is_exempt(self, target: str, source: str) -> bool:
        if source in self.config.exempt_sources:
            return True
        clean = target.split("?", 1)[0].rstrip("/") or "/"
        return any(
            clean == prefix.rstrip("/") or clean.startswith(prefix)
            for prefix in self.config.exempt_targets
        )

    def snapshot(self, timestamp_ms: float) -> dict:
        """estado operativo, para el panel y para auditoria."""
        return {
            "mode": self.mode.value,
            "kill_switch": self.kill_switch,
            "disruptive_fraction": round(self.disruptive_fraction, 4),
            "brake_engaged": self.brake_engaged,
            "brake_threshold": self.config.max_disruptive_fraction,
            "window_size": len(self._window),
            "active_countermeasures": [
                cm.to_dict() for cm in self.active_countermeasures(timestamp_ms)
            ],
        }
