"""lexicon.py - vocabulario cerrado de conceptos instruccionales.

es el equivalente de la normalizacion de rutas del dominio http, y la pieza de
la que depende todo el adaptador.

el problema: en http, `/user/1042` y `/user/77` colapsan a la misma plantilla
porque las rutas tienen estructura posicional. un prompt es texto libre. si se
normaliza el texto entero, casi nada se repite y el motor no aprende nunca; si
se reduce a rasgos gruesos (largo, entropia), se pierde la identidad y todo
colapsa al mismo cluster.

la solucion: normalizar por *concepto*, no por superficie. cada familia de
sinonimos se mapea a un concepto canonico, asi dos redacciones distintas de la
misma intencion producen los mismos conceptos:

    "ignore all previous instructions"     -> override, prior, instructions
    "disregard the earlier directives"     -> override, prior, instructions

esa es la propiedad que hace que una campana de jailbreak con mutaciones caiga
en firmas identicas o vecinas, y por lo tanto que la generalizacion del motor
(R6) sirva de algo.

consecuencia de privacidad, deliberada: el vocabulario es **cerrado**. una firma
solo puede contener nombres de conceptos definidos en este archivo, nunca texto
del usuario. es una garantia mas fuerte que la del dominio http, donde la
plantilla de ruta si arrastra segmentos literales.
"""

from __future__ import annotations

import re
from typing import Iterable

#: familias de sinonimos por concepto canonico.
#:
#: los patrones son deliberadamente simples y legibles: la exhaustividad no es
#: el objetivo, la explicabilidad si. cada entrada tiene que poder justificarse
#: ante alguien que pregunte "por que marcaste esto".
#:
#: se cubren ingles y espanol porque un atacante cambia de idioma antes que de
#: intencion, y el ingles sin tildes tambien matchea el espanol sin tildes.
_CONCEPT_PATTERNS: dict[str, tuple[str, ...]] = {
    #anular lo anterior
    "override": (
        r"\bignor(?:e|es|ing|a|ar)\b", r"\bdisregard\b", r"\bforget\b", r"\boverrid\w*\b",
        r"\bbypass\b", r"\bskip\b", r"\bdiscard\b", r"\bomit\b",
        r"\bolvid(?:a|ate|ar)\b", r"\bignor(?:a|ame)\b", r"\bdesestima\b",
    ),
    #referencia a lo que vino antes
    "prior": (
        r"\bprevious\b", r"\bearlier\b", r"\bprior\b", r"\babove\b", r"\bpreceding\b",
        r"\bpast\b", r"\banterior(?:es)?\b", r"\bprevias?\b", r"\bde arriba\b",
    ),
    #el objeto que se quiere anular o extraer
    "instructions": (
        r"\binstruction(?:s)?\b", r"\bdirective(?:s)?\b", r"\brule(?:s)?\b",
        r"\bguideline(?:s)?\b", r"\bconstraint(?:s)?\b", r"\bpolic(?:y|ies)\b",
        r"\brestriction(?:s)?\b", r"\binstruccion(?:es)?\b", r"\bregla(?:s)?\b",
        r"\bdirectriz(?:es)?\b",
    ),
    #el prompt de sistema en particular
    "sysprompt": (
        r"\bsystem prompt\b", r"\bsystem message\b", r"\binitial prompt\b",
        r"\boriginal instruction(?:s)?\b", r"\byour instruction(?:s)?\b",
        r"\bprompt de sistema\b", r"\bmensaje de sistema\b", r"\bconfiguracion inicial\b",
        r"<\|?system\|?>", r"\[system\]",
    ),
    #pedir que se exponga algo
    "reveal": (
        r"\breveal\b", r"\bshow me\b", r"\bprint\b", r"\boutput\b", r"\brepeat\b",
        r"\bdisplay\b", r"\bdump\b", r"\bdisclose\b", r"\btell me (?:your|the)\b",
        r"\bverbatim\b", r"\bmuestra\b", r"\brevela\b", r"\bimprime\b", r"\brepite\b",
    ),
    #asignacion de rol
    "role-assign": (
        r"\bact as\b", r"\bpretend\b", r"\byou are now\b", r"\byou're now\b",
        r"\brole ?play\b", r"\bsimulate\b", r"\bimagine you\b", r"\bbehave as\b",
        r"\bfrom now on you\b", r"\byou will be\b",
        r"\bactua como\b", r"\bfinge\b", r"\bhaz de cuenta\b", r"\bahora eres\b",
    ),
    #personas de jailbreak conocidas
    "persona": (
        r"\bdan\b", r"\bdeveloper mode\b", r"\bdev mode\b", r"\bjailbr(?:oken|eak)\b",
        r"\bdo anything now\b", r"\bstan\b", r"\bevil (?:mode|bot|ai)\b",
        r"\bmodo desarrollador\b", r"\bsin restricciones\b",
    ),
    #pedir ausencia de limites
    "unrestricted": (
        r"\bwithout (?:any )?(?:restriction|limit|filter|rule)", r"\bno (?:filter|limit|restriction)",
        r"\bunfiltered\b", r"\bunrestricted\b", r"\banything you want\b",
        r"\bignore (?:your )?safety\b", r"\bno ethical\b", r"\bwithout censorship\b",
        r"\bsin filtro(?:s)?\b", r"\bsin limite(?:s)?\b", r"\bsin censura\b",
    ),
    #encuadre hipotetico o ficcional
    "hypothetical": (
        r"\bhypothetical\w*\b", r"\bsuppose\b", r"\bimagine\b", r"\bfictional\b",
        r"\bfor a (?:story|novel|screenplay|game)\b", r"\bwhat if\b", r"\bin a world where\b",
        r"\bhipotetic\w*\b", r"\bimagina\b", r"\bficticio\b", r"\bpara una (?:historia|novela)\b",
    ),
    #pedido de ocultamiento
    "secrecy": (
        r"\bdon'?t tell\b", r"\bdo not tell\b", r"\bsecretly\b", r"\bwithout mentioning\b",
        r"\bwithout telling\b", r"\bhide (?:this|that|it)\b", r"\bkeep (?:this )?(?:a )?secret\b",
        r"\bno le digas\b", r"\ben secreto\b", r"\bsin mencionar\b",
    ),
    #presion temporal
    "urgency": (
        r"\burgent\w*\b", r"\bimmediately\b", r"\bright now\b", r"\bquickly\b",
        r"\bas fast as\b", r"\byou must\b", r"\burgente\b", r"\bahora mismo\b",
        r"\binmediatamente\b",
    ),
    #imposicion de formato de salida
    "format-demand": (
        r"\brespond only with\b", r"\banswer only\b", r"\bstart (?:your (?:answer|response) )?with\b",
        r"\bmust begin with\b", r"\bexactly as\b", r"\boutput format\b", r"\bin json\b",
        r"\bresponde solo con\b", r"\bempieza con\b", r"\bunicamente\b",
    ),
    #referencia a un acuerdo previo de la conversacion
    "continuity": (
        r"\bas we (?:discussed|agreed|established)\b", r"\bcontinuing\b", r"\bbuilding on\b",
        r"\bearlier you said\b", r"\byou already\b", r"\bper our\b", r"\blike before\b",
        r"\bcomo (?:acordamos|dijimos|quedamos)\b", r"\bsiguiendo con\b", r"\bya dijiste\b",
    ),
    #pedido de ir mas lejos que la respuesta anterior
    "escalate": (
        r"\bgo further\b", r"\bnext step\b", r"\btake it further\b", r"\bmore detail(?:ed)?\b",
        r"\bnow (?:actually|really)\b", r"\bbe more specific\b", r"\bexpand on\b",
        r"\bve mas alla\b", r"\bmas detalle\b", r"\bahora si\b",
    ),
    #marcadores de cierre de contexto falso
    "context-close": (
        r"-{3,}\s*(?:end|fin)\b", r"#{3,}", r"</\s*system\s*>", r"\[/?INST\]",
        r"<\|im_(?:end|start)\|>", r"\bend of (?:prompt|instructions|context)\b",
        r"```\s*$", r"\bfin de (?:las )?instrucciones\b",
    ),
    #sacar datos hacia afuera
    "exfiltrate": (
        r"\bsend (?:it |this |them )?to\b", r"\bpost (?:it |this )?to\b", r"\bemail (?:it|this)\b",
        r"\bupload\b", r"\bcurl\b", r"\bfetch\(", r"\btransmit\b", r"\bexfiltrat\w*\b",
        r"\bhttps?://[^\s]+", r"\benvia(?:lo|r)? a\b",
    ),
    #pedido explicito de codificar
    "encode-request": (
        r"\bbase\s?64\b", r"\brot\s?13\b", r"\bencode\b", r"\bcipher\b", r"\bobfuscat\w*\b",
        r"\bin morse\b", r"\bcodific\w*\b", r"\bcifra\w*\b",
    ),
    #invocacion de autoridad
    "authority": (
        r"\bi am (?:the |your )?(?:developer|admin|administrator|creator|owner)\b",
        r"\bas (?:the |your )?(?:developer|admin|administrator)\b", r"\bi'?m authorized\b",
        r"\boverride code\b", r"\bsoy (?:el|tu) (?:desarrollador|administrador|creador)\b",
    ),
}

#: patrones compilados, en orden estable. el orden importa: la firma incluye el
#: esqueleto ORDENADO de conceptos, asi que tiene que ser reproducible.
_COMPILED: tuple[tuple[str, re.Pattern[str]], ...] = tuple(
    (concept, re.compile("|".join(patterns), re.IGNORECASE))
    for concept, patterns in _CONCEPT_PATTERNS.items()
)

#: todos los conceptos que este modulo puede emitir. vocabulario cerrado: si un
#: nombre no esta aca, no puede aparecer en ninguna firma.
CONCEPTS: frozenset[str] = frozenset(_CONCEPT_PATTERNS)


def concepts_in(text: str) -> list[str]:
    """conceptos presentes en el texto, en orden de primera aparicion.

    el orden es por posicion en el texto y no por el orden del diccionario, para
    que el esqueleto sea reproducible y legible en el explain.

    cuanto pesa ese orden, medido y dicho de frente: **poco, a proposito**. el
    esqueleto ordenado es una sola primitiva de once, asi que dos prompts con los
    mismos conceptos en secuencia invertida quedan a 0.83 de similitud -casi
    identicos-. es el comportamiento correcto para este dominio: reordenar
    clausulas es justamente la mutacion barata que un atacante prueba primero, y
    tratarla como un patron nuevo le regalaria exposiciones. el orden queda
    registrado para identidad y auditoria, no como discriminador fuerte.

    el caso donde el orden si es decisivo -una escalada progresiva- es
    multi-turno y no se resuelve aca: vive en el traductor, que tiene estado de
    sesion. ver la limitacion declarada en `features.classify_attack`.
    """
    if not text:
        return []
    found: list[tuple[int, str]] = []
    for concept, pattern in _COMPILED:
        match = pattern.search(text)
        if match is not None:
            found.append((match.start(), concept))
    found.sort()
    return [concept for _, concept in found]


def matched_spans(text: str) -> dict[str, tuple[int, int]]:
    """donde matcheo cada concepto. lo usa la contramedida de redaccion."""
    spans: dict[str, tuple[int, int]] = {}
    for concept, pattern in _COMPILED:
        match = pattern.search(text or "")
        if match is not None:
            spans[concept] = (match.start(), match.end())
    return spans


def is_closed_vocabulary(values: Iterable[str]) -> bool:
    """verifica que un conjunto de conceptos salga solo del vocabulario cerrado."""
    return all(value in CONCEPTS for value in values)
