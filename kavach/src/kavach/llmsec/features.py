"""features.py - de un prompt crudo a rasgos canonicos.

es la frontera entre el texto libre y el motor, y el analogo directo de
`security/features.py`: todo lo variable, irrepetible o identificable se
normaliza aca, y lo que cruza son formas, no contenido.

la decision de diseno central esta en `lexicon.py`: la normalizacion es **por
concepto, no por superficie**. dos redacciones distintas de la misma intencion
producen los mismos conceptos, que es lo que permite que una campana de
jailbreak con mutaciones caiga en firmas vecinas.

garantia de privacidad, mas fuerte que la del dominio http: **la firma se
construye enteramente sobre vocabularios cerrados**. no hay un solo campo donde
pueda filtrarse texto del usuario -conceptos, clases de ataque, tecnicas de
ofuscacion y tramos son todos enumeraciones definidas en el codigo-. en http la
plantilla de ruta si arrastra segmentos literales; aca no queda nada.

nota de dependencia: `entropy_bucket` se reusa de `security/features.py` en vez
de reimplementarse. es matematica de texto pura y no tiene nada de http, pero
crea un acoplamiento entre dos dominios hermanos que conviene resolver
extrayendola a un modulo compartido. queda anotado para ADR.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Mapping

from ..security.features import entropy_bucket, shannon_entropy
from .lexicon import CONCEPTS, concepts_in
from .obfuscation import fold_homoglyphs, strip_zero_width, unmask

#: cuantos conceptos entran al esqueleto ordenado. el tope existe porque un
#: prompt largo puede disparar diez conceptos y una firma de veinte primitivas
#: no se parece a nada: jaccard contra una firma corta daria casi cero y la
#: generalizacion dejaria de funcionar justo cuando mas hace falta.
MAX_SKELETON = 6

#: separador del esqueleto. no puede ser `|`: ese es el separador de cluster del
#: nucleo y `canonicalize` rechaza primitivas que lo contengan.
SKELETON_SEP = ">"


#--- clases de ataque --------------------------------------------------------
#
#una firma lleva una sola clase, la de mayor gravedad, igual que `payload:*` en
#http. las clases son un vocabulario cerrado.

ATTACK_CLASSES: frozenset[str] = frozenset(
    {
        "sysprompt-extraction",
        "exfiltration",
        "injection-delimiter",
        "jailbreak-role",
        "crescendo",
        "obfuscation",
        "clean",
    }
)

#: orden de gravedad, de mayor a menor. define cual gana cuando hay varias.
_SEVERITY: tuple[str, ...] = (
    "sysprompt-extraction",
    "exfiltration",
    "injection-delimiter",
    "jailbreak-role",
    "crescendo",
    "obfuscation",
)


def classify_attack(concepts: list[str], obfuscations: list[str]) -> str:
    """clase de ataque a partir de los conceptos ya detectados.

    corre sobre el texto DESENMASCARADO, no sobre el original: un jailbreak en
    base64 y el mismo en texto plano tienen que dar la misma clase. la
    ofuscacion queda como rasgo aparte, no como la intencion.

    limitacion declarada: `crescendo` es multi-turno por naturaleza -una
    escalada se define contra lo que paso antes-. aca solo se detecta el
    *marcador* dentro de un prompt suelto (continuidad mas pedido de ir mas
    lejos). la determinacion real necesita estado de sesion y vive en el
    traductor, que es quien lo tiene.
    """
    present = set(concepts)
    candidates: set[str] = set()

    if "sysprompt" in present and ("reveal" in present or "override" in present):
        candidates.add("sysprompt-extraction")

    if "exfiltrate" in present:
        candidates.add("exfiltration")

    if ("override" in present and ("prior" in present or "instructions" in present)) or (
        "context-close" in present
    ):
        candidates.add("injection-delimiter")

    if (
        "persona" in present
        or "role-assign" in present
        or ("unrestricted" in present and ("hypothetical" in present or "role-assign" in present))
        or ("unrestricted" in present and "override" in present)
    ):
        candidates.add("jailbreak-role")

    if "continuity" in present and "escalate" in present:
        candidates.add("crescendo")

    if obfuscations:
        candidates.add("obfuscation")

    for name in _SEVERITY:
        if name in candidates:
            return name
    return "clean"


#--- tramos ------------------------------------------------------------------

_WORD = re.compile(r"[a-zA-ZÀ-ſ]+")


def length_bucket(text: str) -> str:
    """tramo de largo. un prompt gigante no es sospechoso por si solo, pero
    cambia la forma del pedido y ayuda a separar clusters."""
    size = len(text)
    if size < 80:
        return "tiny"
    if size < 300:
        return "short"
    if size < 1200:
        return "medium"
    if size < 4000:
        return "long"
    return "huge"


def instruction_density(text: str, concepts: list[str]) -> float:
    """densidad instruccional: conceptos detectados por cada cien palabras.

    es el analogo de la tasa de peticiones en http: no acusa por si sola -un
    prompt legitimo puede pedir formato y ser urgente- pero acompana. se
    normaliza por largo para que un texto largo no acumule densidad solo por
    ser largo.
    """
    words = len(_WORD.findall(text)) or 1
    return len(concepts) * 100.0 / words


def density_bucket(value: float) -> str:
    if value < 1.5:
        return "low"
    if value < 5.0:
        return "medium"
    if value < 12.0:
        return "high"
    return "extreme"


#--- respuesta del modelo ----------------------------------------------------
#
#analogo de `status:*` en http: la reaccion del sistema protegido dice tanto
#como el pedido. una negativa repetida es la huella de una campana insistente;
#una fuga aparente es la senal mas fuerte que existe en este dominio.

RESPONSE_CLASSES: frozenset[str] = frozenset(
    {"none", "refusal", "hedged", "compliance", "leak-suspected"}
)

_REFUSAL = re.compile(
    r"\b(?:i (?:can'?t|cannot|won'?t|am not able)|i'?m (?:sorry|unable|not able)|"
    r"as an ai\b|i must decline|no puedo|lo siento, no|no voy a)\b",
    re.IGNORECASE,
)
_HEDGE = re.compile(
    r"\b(?:however|but i can|instead,? i|i can help with|en cambio|pero puedo)\b", re.IGNORECASE
)
#: marcadores de que la respuesta esta repitiendo su propia configuracion.
_LEAK = re.compile(
    r"(?:you are (?:a|an) [a-z ]{0,30}(?:assistant|model|ai)\b|"
    r"\byour (?:instructions|system prompt) (?:are|is)\b|"
    r"^\s*system\s*:|<\|?system\|?>|"
    r"\beres un[a]? [a-z ]{0,30}(?:asistente|modelo)\b)",
    re.IGNORECASE | re.MULTILINE,
)


def classify_response(response: str | None) -> str:
    """clase de la respuesta del modelo. `none` cuando todavia no hay."""
    if response is None or not response.strip():
        return "none"
    if _LEAK.search(response):
        return "leak-suspected"
    refused = _REFUSAL.search(response) is not None
    if refused:
        return "hedged" if _HEDGE.search(response) else "refusal"
    return "compliance"


#--- el prompt tal como lo ve el adaptador -----------------------------------


@dataclass(frozen=True)
class PromptRequest:
    """un turno observado. estructura minima y agnostica del proveedor."""

    prompt: str
    timestamp_ms: float
    #: identifica la conversacion. **nunca entra a la firma**: sirve para medir
    #: ritmo y para aplicar contramedidas, no para reconocer patrones.
    session_id: str = "anon"
    #: respuesta del modelo, si ya se produjo.
    response: str | None = None
    #: metadatos del proveedor. no se inspeccionan; existen para el registro.
    meta: Mapping[str, Any] = field(default_factory=dict)

    def turn_text(self) -> str:
        return self.prompt or ""


@dataclass(frozen=True)
class PromptFeatures:
    """rasgos canonicos de un turno. es lo unico que vera el motor."""

    attack: str
    concepts: tuple[str, ...]
    skeleton: str
    obfuscations: tuple[str, ...]
    length: str
    entropy: str
    density: str
    response: str
    rate: str

    def to_primitives(self) -> list[str]:
        """los rasgos como primitivas prefijadas por eje.

        criterio de que entra, igual que en http: los ejes estructurales entran
        siempre porque definen la identidad del patron; los rasgos neutros no,
        porque una firma solo debe llevar lo que la distingue.
        """
        primitives = [
            f"shape:{self.skeleton}",
            f"len:{self.length}",
            f"density:{self.density}",
            f"resp:{self.response}",
            f"rate:{self.rate}",
        ]
        if self.attack != "clean":
            primitives.append(f"attack:{self.attack}")
        #cada concepto va como primitiva propia, no concatenado: es lo que le da
        #a jaccard superficie de solape entre mutaciones que comparten intencion
        #aunque su esqueleto ordenado difiera.
        primitives.extend(f"concept:{name}" for name in self.concepts)
        primitives.extend(f"obf:{name}" for name in self.obfuscations)
        if self.entropy in ("high", "extreme"):
            primitives.append(f"entropy:{self.entropy}")
        return primitives

    def to_dict(self) -> dict[str, Any]:
        return {
            "attack": self.attack,
            "concepts": list(self.concepts),
            "skeleton": self.skeleton,
            "obfuscations": list(self.obfuscations),
            "length": self.length,
            "entropy": self.entropy,
            "density": self.density,
            "response": self.response,
            "rate": self.rate,
        }


def skeleton_of(concepts: list[str]) -> str:
    """esqueleto ordenado de conceptos, recortado al tope.

    es el ancla de identidad del patron, el equivalente de la plantilla de ruta.
    `none` cuando el prompt no dispara ningun concepto: la mayoria del trafico
    legitimo cae ahi, y que todos compartan esqueleto es correcto -son la misma
    linea de base-.
    """
    if not concepts:
        return "none"
    return SKELETON_SEP.join(concepts[:MAX_SKELETON])


def extract(request: PromptRequest, rate: str = "normal") -> PromptFeatures:
    """extrae los rasgos de un turno. `rate` lo provee el medidor de la sesion."""
    raw = request.turn_text()

    #se desenmascara ANTES de clasificar: la intencion se lee sobre el texto
    #real, no sobre el envoltorio.
    unmasked, obfuscations = unmask(raw)
    concepts = concepts_in(unmasked)

    #la entropia se mide sobre el texto normalizado de invisibles y homoglifos,
    #no sobre el decodificado: interesa la forma que llego, no la que oculta.
    surface = fold_homoglyphs(strip_zero_width(raw))

    return PromptFeatures(
        attack=classify_attack(concepts, obfuscations),
        concepts=tuple(concepts[:MAX_SKELETON]),
        skeleton=skeleton_of(concepts),
        obfuscations=tuple(obfuscations),
        length=length_bucket(raw),
        entropy=entropy_bucket(surface),
        density=density_bucket(instruction_density(unmasked, concepts)),
        response=classify_response(request.response),
        rate=rate,
    )


#: todos los valores que cada eje puede tomar. existe para que un test pueda
#: verificar que la firma sale de vocabularios cerrados sin depender de correr
#: trafico: si un eje pudiera emitir texto del usuario, esto lo delataria.
CLOSED_VOCABULARY: dict[str, frozenset[str]] = {
    "attack": ATTACK_CLASSES,
    "concept": CONCEPTS,
    "len": frozenset({"tiny", "short", "medium", "long", "huge"}),
    "density": frozenset({"low", "medium", "high", "extreme"}),
    "entropy": frozenset({"low", "medium", "high", "extreme"}),
    "resp": RESPONSE_CLASSES,
    "obf": frozenset({"zero-width", "homoglyph", "spacing", "base64", "rot13", "leetspeak"}),
}


def vocabulary_violations(primitives: list[str]) -> list[str]:
    """primitivas cuyo valor cae fuera del vocabulario cerrado de su eje.

    `shape:` y `rate:` se validan aparte: el esqueleto es una composicion de
    conceptos y el ritmo lo define el traductor.
    """
    bad: list[str] = []
    for primitive in primitives:
        axis, _, value = primitive.partition(":")
        if axis == "shape":
            if value != "none" and not all(
                part in CONCEPTS for part in value.split(SKELETON_SEP)
            ):
                bad.append(primitive)
        elif axis in CLOSED_VOCABULARY:
            if value not in CLOSED_VOCABULARY[axis]:
                bad.append(primitive)
        elif axis != "rate":
            bad.append(primitive)
    return bad


def entropy_of(text: str) -> float:  # pragma: no cover - reexport por comodidad
    return shannon_entropy(text)
