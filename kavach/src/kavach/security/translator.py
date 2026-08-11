"""translator.py — el puerto `StimulusTranslator` del dominio de seguridad.

Convierte un request en una firma canónica. Es el único lugar donde vive el
conocimiento de que existe HTTP.

Contiene además el **medidor de tasa**, que es la pieza que resuelve la tensión
entre un mundo continuo (el tráfico llega cuando quiere) y un motor discreto: el
ritmo se cuantiza a tres tramos —`normal`, `sustained`, `burst`— antes de cruzar
la frontera. El motor nunca ve marcas de tiempo crudas de tráfico; ve la forma
del ritmo, que es lo único reproducible entre despliegues distintos.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass

from ..signature import Signature, canonicalize
from .features import Features, Request, extract


@dataclass(frozen=True)
class RateThresholds:
    """Tramos del medidor. Son dominio, no motor: se calibran por servicio."""

    window_ms: float = 10_000.0
    #: Umbrales holgados a propósito: un usuario real hace ráfagas (una página
    #: que dispara varias llamadas a la API), y tratar eso como señal produce
    #: falsos positivos por diseño. El ritmo acompaña; no acusa solo.
    burst_per_window: int = 25
    sustained_per_window: int = 12
    #: Ventana larga para detectar goteo: lento pero persistente.
    slow_window_ms: float = 10 * 60 * 1000.0
    slow_per_window: int = 25


class RateMeter:
    """Mide el ritmo por origen y lo cuantiza a un tramo.

    Guarda marcas de tiempo por origen en dos ventanas. La ventana larga existe
    para el caso que los rate limiters clásicos no ven: un atacante que va más
    lento que la ventana corta es invisible para ellos, pero acumula presencia en
    la larga.

    Es estado del ADAPTADOR, no del motor: el núcleo sigue siendo puro.
    """

    def __init__(self, thresholds: RateThresholds = RateThresholds()) -> None:
        self.thresholds = thresholds
        self._recent: dict[str, deque[float]] = {}
        self._long: dict[str, deque[float]] = {}

    def observe(self, source: str, timestamp_ms: float) -> str:
        recent = self._recent.setdefault(source, deque())
        long = self._long.setdefault(source, deque())
        recent.append(timestamp_ms)
        long.append(timestamp_ms)

        while recent and timestamp_ms - recent[0] > self.thresholds.window_ms:
            recent.popleft()
        while long and timestamp_ms - long[0] > self.thresholds.slow_window_ms:
            long.popleft()

        if len(recent) >= self.thresholds.burst_per_window:
            return "burst"
        if len(recent) >= self.thresholds.sustained_per_window:
            return "sustained"
        if len(long) >= self.thresholds.slow_per_window:
            # Poco volumen instantáneo pero presencia sostenida durante minutos:
            # el patrón que un contador de ventana corta nunca llega a ver.
            return "sustained"
        return "normal"

    def reset(self) -> None:
        self._recent.clear()
        self._long.clear()


class SecurityTranslator:
    """Request → `Signature`. El puerto que el motor consume."""

    def __init__(self, rate_meter: RateMeter | None = None) -> None:
        self.rate_meter = rate_meter or RateMeter()

    def features_of(self, request: Request) -> Features:
        rate = self.rate_meter.observe(request.source, request.timestamp_ms)
        return extract(request, rate=rate)

    def translate(self, request: Request) -> tuple[Signature, Features]:
        """Devuelve la firma y los rasgos que la produjeron.

        Los rasgos se devuelven aparte porque la explicación para humanos los
        necesita, pero el motor solo recibe la firma: no hay forma de que una
        decisión del núcleo dependa de algo que no esté en ella.
        """
        features = self.features_of(request)
        signature = canonicalize(features.to_primitives(), intensity=1.0)
        return signature, features
