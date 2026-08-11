# ADR 003 — Modo sombra, frenos duros y kill switch

**Estado:** Aceptada

## Contexto

Un motor con capacidad de bloquear tráfico, más un bug de política, son juntos
una denegación de servicio contra uno mismo. Y a diferencia de un ataque
externo, esta viene con credenciales de administrador.

El riesgo no es hipotético: el modo de falla más común de los sistemas
automáticos de defensa no es dejar pasar un ataque, es cortar a los usuarios
propios. Un motor que aprende es especialmente peligroso acá, porque puede
aprender algo equivocado y aplicarlo consistentemente a escala.

## Decisión

Toda contramedida pasa por un **gobernador** antes de tocar el tráfico. Cuatro
garantías, todas verificables por test:

### 1. Modo sombra por defecto

Al desplegarse, el motor observa, decide y **registra qué hubiera hecho**, sin
aplicar nada. La promoción a modo activo es una decisión humana explícita, no el
estado inicial.

El log de "lo que hubiera hecho" no es solo una red de seguridad: es material de
análisis gratis. Antes de intervenir una sola vez, ya se sabe cuánto tráfico se
habría afectado y cuál.

### 2. Freno duro con histéresis

Nunca se afecta más de una fracción del tráfico (por defecto 15%) en una
ventana. Si el motor se descalibra, el freno lo contiene antes de que un humano
se entere.

**Con histéresis**: activa al tocar el techo y no suelta hasta bajar al 60% del
techo. Sin histéresis el freno oscila —activa, la fracción baja, suelta, la
fracción sube— y el tráfico ve un comportamiento intermitente imposible de
interpretar. *Un freno que titila es peor que ninguno.* (Lo encontró un test:
`test_el_freno_no_titila`.)

Cuando el freno actúa, **degrada**, no apaga: una cuarentena pasa a
ralentización. Se sigue respondiendo, con menos daño potencial.

### 3. Kill switch

Corta la aplicación de contramedidas **sin cortar la observación**. Se deja de
intervenir, no de aprender. Es la diferencia entre apagar el sistema —y perder
todo el contexto acumulado— y suspender su efecto mientras se investiga.

### 4. Lista de exención

Salud, monitoreo y orígenes críticos jamás reciben una contramedida, pase lo que
pase. Es la última red: si todo lo demás falla, el health check sigue
respondiendo y el sistema se puede diagnosticar.

### Y toda contramedida caduca

TTL obligatorio en cada una. Sin TTL, un falso positivo es permanente; con TTL,
el peor caso está acotado en el tiempo y el sistema se recupera solo.

## Alternativas descartadas

- **Desplegar directo en modo activo.** Es lo que invita la demo: se ve mejor.
  Descartada porque invierte la carga de la prueba — obliga a confiar antes de
  tener evidencia, cuando el orden correcto es al revés.
- **Freno sin histéresis (umbral simple).** Una línea menos de código. La
  oscilación que produce se detectó con un test y es peor que el problema
  original.
- **Apagar el motor entero como kill switch.** Simple, y tira el contexto
  acumulado justo cuando más se necesita para entender qué pasó.
- **Contramedidas permanentes hasta revisión manual.** Más "seguro" en
  apariencia. En la práctica garantiza que el primer falso positivo se convierta
  en un incidente que alguien tiene que ir a limpiar a mano.

## Consecuencias

**Positivas**

- El peor caso está acotado por diseño, no por confianza en la calibración.
- El modo sombra permite desplegar en producción real desde el día uno, sin
  riesgo, y recolectar evidencia con tráfico verdadero.
- Todo lo que el gobernador veta queda registrado: `Decision` guarda qué se
  aplicó, qué se proponía y por qué difieren.

**Negativas**

- Un atacante que sepa del freno podría generar tráfico hostil desde muchas
  fuentes para saturarlo y conseguir que sus ataques se degraden a ralentización.
  Es un compromiso consciente: se prefiere ese riesgo antes que la posibilidad
  de cortar masivamente a usuarios legítimos.
- El modo sombra tiene un costo real: mientras dura, los ataques pasan. Es
  deliberado, y por eso la promoción a activo debería ser rápida una vez
  revisado el log.
- Cuatro mecanismos de seguridad son cuatro cosas que pueden estar mal
  configuradas. Todos tienen valores por defecto conservadores y tests.
