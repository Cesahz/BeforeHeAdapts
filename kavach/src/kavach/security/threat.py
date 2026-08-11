"""threat.py — malicia: el eje que el motor NO puede darte, y por qué hace falta.

Es la corrección conceptual más importante del dominio, y salió de ver la
primera simulación completa: el motor ralentizaba tráfico legítimo.

El motor mide **familiaridad**: cuán consolidado está un patrón, cuántas veces
lo vio, cuánta confianza tiene en que es real y persistente. En un juego eso
alcanza, porque todo estímulo es un ataque y familiaridad = amenaza.

En defensa la mayoría del tráfico es benigno. Un patrón legítimo repetido —los
mismos usuarios pidiendo las mismas rutas— también se vuelve familiar, y con la
familiaridad como única señal terminaría bloqueado. Adaptarse a lo normal debe
significar *"esto ya lo conozco, es la línea de base"*, que es lo contrario de
bloquear.

Entonces hacen falta dos ejes, y separarlos es lo que hace desplegable al
sistema:

    familiaridad  ← el motor (¿está consolidado este patrón?)
    malicia       ← el dominio (¿es un problema que lo esté?)

    amenaza = familiaridad × malicia

Se corta lo que es **persistente Y malicioso**. Lo nuevo no se corta porque
todavía no es persistente; lo benigno no se corta porque no es malicioso, por
más que se repita mil veces. Y de regalo, esto es lo que vuelve inútil al
envenenamiento: tráfico fabricado para parecer legítimo tiene malicia cero, así
que ninguna cantidad de repetición lo convierte en una contramedida contra los
usuarios reales.
"""

from __future__ import annotations

from ..signature import Signature

#: Cuánta malicia aporta cada rasgo, en [0, 1]. Son indicios, no pruebas: la
#: decisión final siempre exige además que el motor haya consolidado el patrón.
_MALICE: dict[str, float] = {
    # Payloads: la señal más fuerte que existe en esta capa.
    "payload:sqli": 0.97,
    "payload:cmdi": 0.97,
    "payload:xxe": 0.95,
    "payload:deserialize": 0.95,
    "payload:traversal": 0.93,
    "payload:ssti": 0.92,
    "payload:xss": 0.90,
    "payload:clean": 0.0,
    # Herramientas que se anuncian. Que se anuncien no las hace inofensivas.
    "ua:sqlmap": 0.95,
    "ua:nikto": 0.92,
    "ua:nmap": 0.90,
    "ua:masscan": 0.90,
    "ua:nuclei": 0.90,
    "ua:hydra": 0.92,
    "ua:dirbuster": 0.88,
    "ua:gobuster": 0.88,
    "ua:script": 0.25,      # automatización: común y legítima en integraciones
    "ua:curl": 0.22,
    "ua:wget": 0.22,
    "ua:headless": 0.30,
    "ua:bot": 0.15,
    "ua:absent": 0.35,
    "ua:unknown": 0.20,
    "ua:browser": 0.0,
    # Respuestas: un 404 aislado no dice nada; el patrón de 404 sí.
    "status:missing": 0.35,
    "status:denied": 0.45,
    "status:server-error": 0.30,
    "status:throttled": 0.20,
    "status:client-error": 0.10,
    "status:ok": 0.0,
    "status:redirect": 0.0,
    "status:none": 0.0,
    # Ofuscación.
    "entropy:extreme": 0.40,
    "entropy:high": 0.20,
    # El ritmo NO es malicia por sí solo: los usuarios reales también hacen
    # ráfagas. Aporta poco, y solo acompañando a otra cosa.
    "rate:burst": 0.12,
    "rate:sustained": 0.08,
    "rate:normal": 0.0,
}

#: Rutas cuya sola visita ya es una señal: nadie las pide sin buscar algo.
_SENSITIVE_PATH_HINTS: tuple[tuple[str, float], ...] = (
    ("/.env", 0.90),
    ("/.git", 0.90),
    ("/.aws", 0.90),
    ("/.svn", 0.85),
    ("/wp-admin", 0.70),
    ("/phpmyadmin", 0.75),
    ("/admin", 0.45),
    ("/actuator", 0.55),
    ("/server-status", 0.60),
    ("/cgi-bin", 0.65),
    ("/vendor", 0.55),
    ("backup", 0.60),
    (".bak", 0.65),
    ("passwd", 0.85),
)


def malice_of_primitive(primitive: str) -> float:
    """Malicia que aporta una primitiva sola."""
    if primitive in _MALICE:
        return _MALICE[primitive]
    if primitive.startswith("path:"):
        path = primitive[len("path:") :].lower()
        best = 0.0
        for hint, weight in _SENSITIVE_PATH_HINTS:
            if hint in path:
                best = max(best, weight)
        return best
    return 0.0


def malice_of(signature: Signature) -> float:
    """Cuánta pinta de ataque tiene la firma, en [0, 1].

    Combina con la regla del complemento, igual que la especificidad: cada rasgo
    solo puede sumar, la suma satura en 1, y dos indicios fuertes pesan mucho más
    que diez débiles. Un navegador pidiendo una ruta pública con respuesta 200 da
    exactamente 0 — y eso es deliberado: la línea de base tiene que ser cero, no
    "poquito".
    """
    remaining = 1.0
    for primitive in signature.primitives:
        remaining *= 1.0 - malice_of_primitive(primitive)
    return 1.0 - remaining


def is_benign(signature: Signature, threshold: float = 0.15) -> bool:
    """Firma sin indicios accionables. Puede adaptarse; nunca debería cortarse."""
    return malice_of(signature) < threshold


def malice_of_primitives(primitives: tuple[str, ...]) -> float:
    """Malicia de un conjunto de primitivas suelto, sin construir una firma."""
    remaining = 1.0
    for primitive in primitives:
        remaining *= 1.0 - malice_of_primitive(primitive)
    return 1.0 - remaining


def hostile_familiarity(explanation, benign_floor: float = 0.15) -> float:
    """Familiaridad que cuenta para decidir, en [0, 1].

    El motor generaliza por parecido y no sabe —ni debe saber— qué vecinos son
    hostiles. Sin filtrar, una firma sospechosa hereda "familiaridad" de un
    patrón perfectamente benigno solo porque comparte forma: mismo método,
    mismo agente, mismo ritmo. Eso no significa nada, y lo detectamos en la
    primera simulación completa — un goteo lento se accionaba en su primera
    aparición por parecerse a la línea de base de navegadores.

    Acá se corrige del lado del dominio, sin tocar el núcleo: se toma la
    evidencia propia del cluster, y de la heredada solo la que viene de vecinos
    que **ellos mismos** tenían pinta de ataque.
    """
    own = explanation.resistance
    inherited = 0.0
    for neighbour in explanation.neighbours:
        if malice_of_primitives(neighbour.primitives) < benign_floor:
            continue
        inherited = max(inherited, neighbour.contribution)
    return max(own, inherited)
