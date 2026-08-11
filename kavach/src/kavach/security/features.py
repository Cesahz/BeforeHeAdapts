"""features.py — de un request crudo a rasgos canónicos.

Es la frontera entre el mundo sucio (HTTP) y el motor. Todo lo variable,
irrepetible o identificable se normaliza acá: si un rasgo no se repite entre
requests distintos, no sirve para reconocer un patrón y no debe cruzar.

Regla de privacidad: **ninguna IP, cookie, token ni cuerpo de request entra a
una firma.** Lo que cruza son formas, no identidades. Un log de este motor no
contiene datos personales por construcción, no por configuración.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Mapping

#la entropia vive en la raiz porque no pertenece a este dominio: la misma medida
#la usa el dominio de llm. ver ADR 004.
from ..text_utils import entropy_bucket, shannon_entropy

__all_text_utils__ = ("entropy_bucket", "shannon_entropy")

# --- Normalización de rutas --------------------------------------------------
#
# `/user/1042/orders/98` y `/user/77/orders/3` son la MISMA ruta a los ojos del
# motor. Sin esto, cada request sería un patrón nuevo y el sistema no aprendería
# nunca — es el error clásico de los detectores basados en literales.

_PATH_RULES: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"^[0-9]+$"), ":num"),
    (re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I), ":uuid"),
    (re.compile(r"^[0-9a-f]{16,}$", re.I), ":hash"),
    (re.compile(r"^[A-Za-z0-9+/]{24,}={0,2}$"), ":b64"),
)


def normalize_path(path: str, max_depth: int = 4) -> str:
    """Convierte una ruta concreta en su plantilla.

    Se recorta a `max_depth` segmentos: más profundidad no aporta señal y sí
    multiplica firmas. Un escáner que recorre `/a/b/c/d/e/f` produce el mismo
    patrón de plantilla que uno que recorre `/a/b/c/x/y/z`.
    """
    clean = path.split("?", 1)[0].split("#", 1)[0]
    segments = [s for s in clean.split("/") if s]
    out: list[str] = []
    for segment in segments[:max_depth]:
        replaced = segment
        for pattern, token in _PATH_RULES:
            if pattern.match(segment):
                replaced = token
                break
        out.append(replaced)
    if len(segments) > max_depth:
        out.append(":deep")
    return "/" + "/".join(out) if out else "/"


# --- Familias de agente ------------------------------------------------------

_UA_FAMILIES: tuple[tuple[str, str], ...] = (
    ("sqlmap", "sqlmap"),
    ("nikto", "nikto"),
    ("nmap", "nmap"),
    ("masscan", "masscan"),
    ("nuclei", "nuclei"),
    ("dirbuster", "dirbuster"),
    ("gobuster", "gobuster"),
    ("hydra", "hydra"),
    ("curl", "curl"),
    ("wget", "wget"),
    ("python-requests", "script"),
    ("go-http-client", "script"),
    ("axios", "script"),
    ("headlesschrome", "headless"),
    ("phantomjs", "headless"),
    ("bot", "bot"),
    ("crawler", "bot"),
    ("spider", "bot"),
    ("mozilla", "browser"),
)


def user_agent_family(user_agent: str) -> str:
    """Reduce el user-agent a una familia. Es una pista, nunca una prueba."""
    lowered = (user_agent or "").lower()
    if not lowered:
        return "absent"
    for needle, family in _UA_FAMILIES:
        if needle in lowered:
            return family
    return "unknown"


# --- Clases de payload -------------------------------------------------------
#
# Detección por patrón, deliberadamente simple y explicable. No pretende ser un
# WAF: pretende dar un RASGO reproducible que el motor pueda agrupar. Un falso
# positivo acá no bloquea nada por sí solo — solo cambia a qué cluster cae el
# request, y el cluster todavía tiene que acumular exposiciones.

_PAYLOAD_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("sqli", re.compile(r"(\bunion\b.{0,40}\bselect\b)|(\bor\b\s+['\"]?\d+['\"]?\s*=\s*['\"]?\d+)|(--\s*$)|(\bsleep\s*\()|(\bbenchmark\s*\()|(information_schema)", re.I | re.S)),
    ("xss", re.compile(r"(<\s*script)|(javascript\s*:)|(onerror\s*=)|(onload\s*=)|(<\s*img[^>]+src\s*=)", re.I)),
    ("traversal", re.compile(r"(\.\./)|(\.\.\\)|(%2e%2e%2f)|(/etc/passwd)|(\\windows\\system32)", re.I)),
    ("cmdi", re.compile(r"(;\s*(cat|ls|id|whoami|nc|curl|wget)\b)|(\|\s*(sh|bash)\b)|(\$\((.*?)\))|(`.*?`)", re.I)),
    ("ssti", re.compile(r"(\{\{.*?\}\})|(\$\{.*?\})|(<%=.*?%>)", re.S)),
    ("xxe", re.compile(r"(<!ENTITY)|(SYSTEM\s+[\"']file:)", re.I)),
    ("deserialize", re.compile(r"(rO0AB)|(\bO:\d+:\")|(__reduce__)", re.I)),
)


def payload_class(*fragments: str) -> str:
    """Clase de payload sospechoso presente, o `clean`.

    Devuelve la primera coincidencia en orden de gravedad. Que sean varias no
    aporta: lo que importa es que el rasgo sea estable entre requests parecidos.
    """
    haystack = " ".join(f for f in fragments if f)
    if not haystack:
        return "clean"
    for name, pattern in _PAYLOAD_PATTERNS:
        if pattern.search(haystack):
            return name
    return "clean"


#`shannon_entropy` y `entropy_bucket` se reexportan desde `text_utils` (ver el
#import de arriba y el ADR 004). se mantienen accesibles desde este modulo para
#no romper a quien ya los importaba de aca.


def status_class(status: int | None) -> str:
    """Familia del código de respuesta. `4xx` repetido es la huella de un escaneo."""
    if status is None:
        return "none"
    if 200 <= status < 300:
        return "ok"
    if 300 <= status < 400:
        return "redirect"
    if status in (401, 403):
        return "denied"
    if status == 404:
        return "missing"
    if status == 429:
        return "throttled"
    if 400 <= status < 500:
        return "client-error"
    return "server-error"


# --- El request tal como lo ve el adaptador ---------------------------------


@dataclass(frozen=True)
class Request:
    """Un request observado. Estructura mínima y agnóstica del framework."""

    method: str
    path: str
    timestamp_ms: float
    #: Identificador de origen. **Nunca entra a la firma**: sirve para aplicar
    #: contramedidas y para medir tasas, no para reconocer patrones.
    source: str = "anon"
    user_agent: str = ""
    query: str = ""
    body: str = ""
    status: int | None = None
    headers: Mapping[str, str] = field(default_factory=dict)

    def suspicious_text(self) -> str:
        """Lo que se inspecciona buscando payloads: query y cuerpo, nunca headers de sesión."""
        return f"{self.query} {self.body}".strip()


@dataclass(frozen=True)
class Features:
    """Rasgos canónicos extraídos de un request. Es lo único que verá el motor."""

    method: str
    path_template: str
    ua_family: str
    payload: str
    entropy: str
    status: str
    rate: str

    def to_primitives(self) -> list[str]:
        """Los rasgos como primitivas prefijadas por eje.

        El prefijo hace legible un log crudo sin diccionario y evita colisiones
        entre ejes que puedan compartir un valor.
        """
        primitives = [
            f"method:{self.method}",
            f"path:{self.path_template}",
            f"ua:{self.ua_family}",
            f"status:{self.status}",
            f"rate:{self.rate}",
        ]
        # Los rasgos neutros no entran: una firma solo lleva lo que la distingue.
        if self.payload != "clean":
            primitives.append(f"payload:{self.payload}")
        if self.entropy in ("high", "extreme"):
            primitives.append(f"entropy:{self.entropy}")
        return primitives


def extract(request: Request, rate: str = "normal") -> Features:
    """Extrae los rasgos de un request. `rate` lo provee el medidor temporal."""
    text = request.suspicious_text()
    return Features(
        method=request.method.upper(),
        path_template=normalize_path(request.path),
        ua_family=user_agent_family(request.user_agent),
        payload=payload_class(request.path, request.query, request.body),
        entropy=entropy_bucket(text),
        status=status_class(request.status),
        rate=rate,
    )


def as_mapping(request: Request) -> dict[str, Any]:  # pragma: no cover - utilidad
    return {
        "method": request.method,
        "path": request.path,
        "source": request.source,
        "user_agent": request.user_agent,
        "status": request.status,
    }
