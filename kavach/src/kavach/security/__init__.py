"""Dominio de ciberseguridad: el primer adaptador enchufado al motor.

Nada de lo que hay acá vive en el núcleo, y nada del núcleo sabe que esto
existe. Cambiar de dominio es escribir otro paquete como este.
"""

from .complexity import ambiguity, signature_specificity, specificity_of, weakness_of
from .countermeasures import Action, CounterSynthesizer, Countermeasure, SynthesizerConfig
from .features import Features, Request, entropy_bucket, extract, normalize_path, payload_class
from .governor import Decision, Governor, GovernorConfig, Mode
from .sentinel import Observation, Sentinel
from .translator import RateMeter, RateThresholds, SecurityTranslator

__all__ = [
    "Action",
    "CounterSynthesizer",
    "Countermeasure",
    "Decision",
    "Features",
    "Governor",
    "GovernorConfig",
    "Mode",
    "Observation",
    "RateMeter",
    "RateThresholds",
    "Request",
    "SecurityTranslator",
    "Sentinel",
    "SynthesizerConfig",
    "ambiguity",
    "entropy_bucket",
    "extract",
    "normalize_path",
    "payload_class",
    "signature_specificity",
    "specificity_of",
    "weakness_of",
]
