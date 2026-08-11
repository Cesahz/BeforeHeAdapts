"""text_utils.py - medidas de texto compartidas entre dominios.

vive en la raiz y no en un dominio porque no pertenece a ninguno: la entropia de
shannon no sabe si mide un query string o un prompt. estaba en
`security/features.py` por accidente historico -fue el primer dominio que la
necesito- y `llmsec` la importaba desde ahi, creando un acoplamiento silencioso
entre dominios hermanos.

el riesgo concreto que eso tenia: cambiar los tramos pensando en trafico http
habria movido el comportamiento del dominio de llm sin que nadie lo notara.

sigue siendo nucleo en el sentido que importa: puro, determinista, sin I/O, sin
reloj y sin azar. no participa del contrato -no es una regla del motor- pero
respeta sus mismas restricciones.

ver ADR 004.
"""

from __future__ import annotations

import math

#: cortes de los tramos de entropia, en bits por caracter.
#:
#: los valores salen de la distribucion tipica del texto: prosa natural ronda
#: 3.5-4.5, un identificador o token ronda 4.5-5.5, y datos codificados o
#: cifrados superan 5.5. son un dial de dominio compartido, no una constante
#: sagrada.
_ENTROPY_EDGES: tuple[tuple[float, str], ...] = (
    (2.5, "low"),
    (4.0, "medium"),
    (5.0, "high"),
)


def shannon_entropy(text: str) -> float:
    """entropia de shannon en bits por caracter.

    delata contenido ofuscado o codificado: el texto natural es redundante y da
    valores bajos, mientras que base64, cifrado o basura aleatoria se acercan al
    maximo teorico.
    """
    if not text:
        return 0.0
    counts: dict[str, int] = {}
    for char in text:
        counts[char] = counts.get(char, 0) + 1
    total = len(text)
    return -sum((count / total) * math.log2(count / total) for count in counts.values())


def entropy_bucket(text: str) -> str:
    """discretiza la entropia. el motor agrupa por tramos, no por decimales.

    la discretizacion no es una perdida de precision: es lo que hace que dos
    payloads parecidos caigan en el mismo cluster en vez de en dos clusters
    distintos separados por la tercera cifra decimal.
    """
    value = shannon_entropy(text)
    for edge, name in _ENTROPY_EDGES:
        if value < edge:
            return name
    return "extreme"


#: los tramos que `entropy_bucket` puede devolver. sirve para que los dominios
#: validen su vocabulario cerrado sin duplicar la lista.
ENTROPY_BUCKETS: frozenset[str] = frozenset({"low", "medium", "high", "extreme"})
