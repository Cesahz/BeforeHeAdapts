"""obfuscation.py - deteccion y desenmascarado de payloads codificados.

la ofuscacion no es un ataque: es un envoltorio. el modulo hace dos cosas y las
separa a proposito:

1. detecta **que tecnica** se uso -> rasgo `obf:*` de la firma
2. **decodifica** el contenido para que la clasificacion de intencion corra
   sobre el texto real

el punto 2 es el que importa de verdad. un jailbreak en base64 y el mismo
jailbreak en texto plano tienen que producir los mismos conceptos, y por lo
tanto firmas vecinas. si no se decodificara, cada codificacion seria un patron
nuevo y el atacante ganaria exposiciones gratis con solo cambiar el envoltorio.
"""

from __future__ import annotations

import base64
import binascii
import codecs
import re
import unicodedata

#: caracteres invisibles que se usan para partir palabras y evadir regex.
_ZERO_WIDTH = "​‌‍⁠﻿"

#: homoglifos cirilicos y griegos usados como latinos.
_HOMOGLYPHS: dict[str, str] = {
    "а": "a", "е": "e", "о": "o", "р": "p", "с": "c",
    "у": "y", "х": "x", "А": "A", "Е": "E", "О": "O",
    "Р": "P", "С": "C", "Х": "X", "і": "i", "ј": "j",
    "ο": "o", "α": "a", "ε": "e", "ρ": "p", "υ": "u",
    "ı": "i",
}

#: sustituciones leetspeak comunes.
_LEET: dict[str, str] = {"0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s"}

_BASE64_RUN = re.compile(r"[A-Za-z0-9+/]{16,}={0,2}")
_SPACED_LETTERS = re.compile(r"(?:\b[a-zA-Z]\s+){4,}[a-zA-Z]\b")
_LEET_WORD = re.compile(r"\b(?=[a-zA-Z]*[0-9@$])(?=[0-9@$]*[a-zA-Z])[a-zA-Z0-9@$]{4,}\b")


def _printable_ratio(text: str) -> float:
    if not text:
        return 0.0
    printable = sum(1 for char in text if char.isprintable() or char in " \n\t")
    return printable / len(text)


def strip_zero_width(text: str) -> str:
    """saca los caracteres invisibles. no es opcional: parten palabras."""
    return "".join(char for char in text if char not in _ZERO_WIDTH)


def fold_homoglyphs(text: str) -> str:
    """mapea homoglifos a su equivalente latino y normaliza el resto por NFKD."""
    mapped = "".join(_HOMOGLYPHS.get(char, char) for char in text)
    decomposed = unicodedata.normalize("NFKD", mapped)
    return "".join(char for char in decomposed if not unicodedata.combining(char))


def unspace(text: str) -> str:
    """junta secuencias de letras sueltas separadas por espacios."""

    def _join(match: re.Match[str]) -> str:
        return re.sub(r"\s+", "", match.group(0))

    return _SPACED_LETTERS.sub(_join, text)


def unleet(text: str) -> str:
    """revierte leetspeak solo en palabras que mezclan letras y digitos."""

    def _fix(match: re.Match[str]) -> str:
        return "".join(_LEET.get(char, char) for char in match.group(0))

    return _LEET_WORD.sub(_fix, text)


def try_base64(text: str) -> list[str]:
    """decodifica los tramos base64 que produzcan texto legible.

    el filtro de legibilidad evita falsos positivos: un hash, un token o un id
    largo tambien matchean el patron de base64, pero decodifican a basura.
    """
    out: list[str] = []
    for run in _BASE64_RUN.findall(text):
        padded = run + "=" * (-len(run) % 4)
        try:
            decoded = base64.b64decode(padded, validate=True).decode("utf-8", errors="strict")
        except (binascii.Error, UnicodeDecodeError, ValueError):
            continue
        if len(decoded) >= 8 and _printable_ratio(decoded) > 0.9:
            out.append(decoded)
    return out


def try_rot13(text: str) -> str | None:
    """aplica rot13 si el resultado parece mas legible que el original.

    heuristica barata y suficiente: se compara cuantas vocales tiene cada
    version. un texto en rot13 real sube su proporcion de vocales al revertirse.
    """
    if not text or len(text) < 12:
        return None
    decoded = codecs.decode(text, "rot_13")

    def _vowel_ratio(value: str) -> float:
        letters = [char for char in value.lower() if char.isalpha()]
        if not letters:
            return 0.0
        return sum(1 for char in letters if char in "aeiou") / len(letters)

    if _vowel_ratio(decoded) > _vowel_ratio(text) + 0.08:
        return decoded
    return None


def _without_base64_runs(text: str) -> str:
    """saca los tramos base64 del texto.

    hace falta porque un tramo base64 es ruido para las otras heuristicas: mezcla
    letras y digitos (dispara leetspeak) y su distribucion de vocales enganya al
    detector de rot13. sin esto, un solo prompt en base64 reportaba tres tecnicas
    en vez de una -informacion falsa en el explain y primitivas de mas que
    diluyen la firma justo cuando se la quiere comparar con la version en claro-.
    """
    return _BASE64_RUN.sub(" ", text)


def techniques(text: str) -> list[str]:
    """tecnicas de ofuscacion detectadas, en orden estable.

    las heuristicas debiles (leetspeak, rot13) corren sobre el texto **sin los
    tramos base64**, para no acumular falsos positivos sobre el mismo payload.
    """
    found: list[str] = []
    if any(char in text for char in _ZERO_WIDTH):
        found.append("zero-width")
    if fold_homoglyphs(text) != text and any(char in _HOMOGLYPHS for char in text):
        found.append("homoglyph")
    if _SPACED_LETTERS.search(text):
        found.append("spacing")

    has_base64 = bool(try_base64(text))
    if has_base64:
        found.append("base64")

    residual = _without_base64_runs(text) if has_base64 else text
    if try_rot13(residual) is not None:
        found.append("rot13")
    if _LEET_WORD.search(residual) and unleet(residual) != residual:
        found.append("leetspeak")
    return found


def unmask(text: str) -> tuple[str, list[str]]:
    """devuelve (texto desenmascarado, tecnicas detectadas).

    el texto desenmascarado concatena el original normalizado con lo que se haya
    podido decodificar. se concatena en vez de reemplazar porque un prompt puede
    traer una parte en claro y otra codificada, y las dos aportan intencion.
    """
    detected = techniques(text)

    cleaned = strip_zero_width(text)
    cleaned = fold_homoglyphs(cleaned)
    cleaned = unspace(cleaned)
    cleaned = unleet(cleaned)

    extra = try_base64(text)
    #mismo criterio que en `techniques`: rot13 no se prueba sobre lo que ya se
    #decodifico como base64.
    rot = try_rot13(_without_base64_runs(text) if extra else text)
    if rot is not None:
        extra.append(rot)

    if extra:
        cleaned = cleaned + " " + " ".join(extra)
    return cleaned, detected
