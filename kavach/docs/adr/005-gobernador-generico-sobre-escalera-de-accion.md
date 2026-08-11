# ADR 005 — Gobernador generico sobre una escalera de accion

**Estado:** Aceptada · **Origen:** anticipado por el autor al encargar el adaptador de LLM (2026-07-19)

## Contexto

El gobernador ([ADR 003](003-modo-sombra-frenos-y-kill-switch.md)) implementa
las cuatro garantias que hacen desplegable al sistema: modo sombra, freno duro
con histeresis, kill switch y exenciones. Vivia dentro de `security/governor.py`
porque ese era el unico dominio que intervenia sobre trafico.

El adaptador de LLM necesita exactamente las mismas cuatro garantias. Un
sistema que puede cortar una conversacion tiene el mismo modo de falla que uno
que puede cortar una peticion: bloquear a los usuarios propios.

La pregunta es si el gobernador es generico. Medido antes de decidir: toda la
dependencia con el dominio HTTP cabia en **cinco referencias** al enum `Action`
—`ALLOW` en tres ramas de no intervencion, `THROTTLE` como destino de la
degradacion por freno, y `MONITOR` como umbral de registro— mas el nombre del
parametro `path`.

O sea: el mecanismo es generico y solo estaba escrito contra una escalera
concreta.

## Decision

**El gobernador se extrae a `kavach/enforcement.py`, parametrizado por una
`Ladder`.**

```python
@dataclass(frozen=True)
class Ladder(Generic[A]):
    allow: A       #la accion neutra
    degraded: A    #a que se degrada una disruptiva bajo freno
    monitor: A     #umbral por encima del cual se registra la contramedida
```

Cada dominio define su propia escalera y la mapea a esos tres papeles. HTTP:
`ALLOW / THROTTLE / MONITOR`. LLM tendra la suya —`ALLOW / REDACT / MONITOR`—
sin tocar una linea del mecanismo.

El gobernador pide de las acciones lo minimo: que sean ordenables (para poder
degradar) y que sepan decir si el usuario legitimo las notaria
(`is_disruptive`). Eso es todo, y esta declarado como `Protocol`.

Nomenclatura: el parametro generico se llama `target`, no `path`. Que es un
objetivo lo define el dominio —una ruta, un flujo de conversacion, lo que
corresponda—. `security/governor.py` queda como un enlace fino que fija la
escalera HTTP y renombra `target` a `path`, preservando su API publica **exacta**
para no tocar el codigo ni los tests que ya existian.

## Alternativas descartadas

- **Duplicar el gobernador en cada dominio.** Es lo que pasa por defecto si nadie
  frena. Significaria dos implementaciones de las mismas cuatro garantias de
  seguridad, divergiendo en silencio: la histeresis del freno se arreglaria en
  una y no en la otra, y nadie lo notaria hasta un incidente. Las garantias
  operativas son justamente lo que no debe existir por duplicado.
- **Escalera unica compartida entre dominios.** Un solo enum con todas las
  acciones posibles de todos los dominios. Mas simple de tipar y semanticamente
  falso: `THROTTLE` no significa nada en una conversacion y `REDACT` no
  significa nada en una peticion HTTP. Ademas obligaria a tocar el enum
  compartido cada vez que aparece un dominio.
- **Composicion en vez de herencia** (el dominio instancia el gobernador
  generico y le pasa la escalera, sin subclase). Es igual de valido y quizas mas
  limpio. Se eligio la subclase fina porque permite conservar el nombre del
  parametro del dominio (`path`) sin envoltorios, y porque preserva la API
  publica anterior sin cambiar una sola llamada.

## Consecuencias

**Positivas**

- Las cuatro garantias operativas existen una sola vez. Un arreglo las mejora en
  todos los dominios a la vez.
- El tercer dominio no tuvo que escribir su gobernador: solo declara su escalera.
  Es la prueba mas concreta de que la arquitectura hexagonal esta haciendo su
  trabajo.
- La raiz gana un modulo que no participa del contrato pero respeta sus
  restricciones: puro, determinista, sin reloj.

**Negativas**

- Los genericos agregan ruido de tipos a un codigo que era directo de leer.
  Mitigado manteniendo el `Protocol` en lo minimo indispensable.
- `security/governor.py` sobrevive como capa de compatibilidad. Es deuda chica y
  deliberada: el precio de no tocar 129 tests que ya funcionaban.
- El `Decision.to_dict` generico usa `getattr(..., "label", ...)` para el nombre
  legible, porque no puede exigirle a toda escalera que tenga etiqueta. Es un
  punto blando de tipado a cambio de no imponer mas superficie al protocolo.
