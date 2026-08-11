"""dominio de seguridad de llm: tercer adaptador enchufado al mismo motor.

nada de lo que hay aca vive en el nucleo, y nada del nucleo sabe que esto
existe. la tesis que demuestra: el mismo contrato de seis reglas que gobierna
una arena de juego y el trafico http tambien gobierna la deteccion de prompt
injection y jailbreaks.

estado: en construccion. por ahora solo la normalizacion (`features.py`).
"""

from .features import (
    ATTACK_CLASSES,
    CLOSED_VOCABULARY,
    RESPONSE_CLASSES,
    PromptFeatures,
    PromptRequest,
    classify_attack,
    classify_response,
    density_bucket,
    extract,
    instruction_density,
    length_bucket,
    skeleton_of,
    vocabulary_violations,
)
from .lexicon import CONCEPTS, concepts_in, matched_spans
from .obfuscation import techniques, unmask

__all__ = [
    "ATTACK_CLASSES",
    "CLOSED_VOCABULARY",
    "CONCEPTS",
    "PromptFeatures",
    "PromptRequest",
    "RESPONSE_CLASSES",
    "classify_attack",
    "classify_response",
    "concepts_in",
    "density_bucket",
    "extract",
    "instruction_density",
    "length_bucket",
    "matched_spans",
    "skeleton_of",
    "techniques",
    "unmask",
    "vocabulary_violations",
]
