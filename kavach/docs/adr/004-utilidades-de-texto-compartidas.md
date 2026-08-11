# ADR 004 — Utilidades de texto compartidas en la raiz

**Estado:** Aceptada · **Origen:** revision del autor sobre el adaptador de LLM (2026-07-19)

## Contexto

`shannon_entropy` y `entropy_bucket` nacieron dentro de `security/features.py`
porque el dominio HTTP fue el primero que las necesito. Al construir el
adaptador de seguridad de LLM aparecio la misma necesidad: la entropia delata
payloads ofuscados igual en un query string que en un prompt.

La primera version del adaptador de LLM las importaba directo:

```python
from ..security.features import entropy_bucket, shannon_entropy
```

Funciona, y respeta la instruccion de no reimplementar. Pero crea un
**acoplamiento silencioso entre dominios hermanos**, que es peor que un
acoplamiento explicito porque nadie lo ve al modificar el codigo.

El riesgo concreto, planteado por el autor y correcto: si maniana se ajustan los
tramos de entropia pensando en trafico HTTP —una decision perfectamente local a
ese dominio— se mueve el comportamiento del dominio de LLM sin que nadie lo
note. Dos dominios que deberian ser independientes quedan atados por una
constante que ninguno de los dos considera suya.

## Decision

**Las medidas de texto puras se extraen a `kavach/text_utils.py`, en la raiz.**

Los dos dominios importan de ahi. `security/features.py` las reexporta para no
romper a quien ya las importaba desde ese modulo.

El criterio de que va a la raiz: **si no pertenece a ningun dominio, no puede
vivir en uno**. La entropia de Shannon no sabe si mide una URL o un prompt.

`text_utils.py` no participa del contrato —no es una regla del motor— pero
respeta sus mismas restricciones: puro, determinista, sin I/O, sin reloj y sin
azar. La guardia de pureza del contrato lo cubre por estar en la raiz.

Se agrega `ENTROPY_BUCKETS` como conjunto exportado, para que los dominios
validen su vocabulario cerrado sin duplicar la lista de tramos —que era otra
forma del mismo problema—.

## Alternativas descartadas

- **Dejar el import cruzado entre dominios.** Cero trabajo y funciona hoy. Se
  descarta por lo dicho arriba: el acoplamiento es real y no es visible desde
  ninguno de los dos lados. Un cambio local en un dominio rompe al otro.
- **Duplicar la funcion en cada dominio.** Elimina el acoplamiento y crea uno
  peor: dos implementaciones de la misma medida divergiendo en silencio. La
  entropia de un texto no puede depender de quien la mida.
- **Un paquete `shared/` con submodulos.** Mas ordenado si hubiera muchas
  utilidades. Hoy son dos funciones; un paquete entero seria estructura sin
  contenido. Se hara si crece.

## Consecuencias

**Positivas**

- Los dominios vuelven a ser independientes entre si: los dos dependen de la
  raiz, ninguno del otro.
- Los tramos de entropia pasan a ser una decision compartida y explicita, con su
  justificacion escrita en un solo lugar.
- El vocabulario cerrado de entropia deja de estar duplicado.

**Negativas**

- La raiz crece. Era el precio esperado: el nucleo pasa de cinco a siete modulos,
  y hay que sostener el criterio de que solo entra lo que no pertenece a ningun
  dominio, o la raiz se convierte en el basurero de todo lo compartido.
- `security/features.py` mantiene un reexport que es deuda menor: existe solo
  por compatibilidad y algun dia habria que quitarlo.
