# 0006 — El log exportado es API pública: esquema de eventos versionado y congelado

**Estado:** Aceptada

## Contexto

Todo el ecosistema consume el mismo artefacto: el log de eventos. El visualizador (Fase 2) lo reproduce para renderizar y exportar gifs; los golden fixtures del núcleo son logs guardados; la arena (Fase 3) los persiste por sala; el adaptador de auto-defensa (ADR 0005) genera los suyos; y el análisis de balance del meta se hace leyendo logs históricos. La Ley §3 ya exige que "los replays viejos deben seguir funcionando siempre" — pero hasta ahora esa garantía descansaba en la buena conducta, no en reglas de esquema explícitas. Un cambio informal de formato (renombrar un campo, cambiar su tipo, eliminarlo) rompería silenciosamente todos los logs guardados: exactamente la clase de deuda que sale barata hoy y carísima con miles de logs de salas reales.

## Decisión

**El formato del log exportado es la API pública del proyecto y se gobierna con la misma seriedad que `contract.test.ts`.**

1. **Sobre (envelope) estable.** Todo evento serializado mantiene el sobre ya fijado por el contrato: `{ v, type, roomId, seq, timestamp, ...payload }`. Estos campos del sobre no se renombran ni se eliminan jamás.
2. **Prohibido alterar o eliminar campos de eventos ya consolidados.** Dentro de una misma versión `v` de un tipo de evento, la única evolución permitida es **aditiva** (campos nuevos opcionales). Cambiar el tipo, el significado o el nombre de un campo existente, o eliminarlo, está prohibido.
3. **Toda evolución estructural exige un salto explícito de `v`** en el tipo de evento afectado. El salto viene acompañado de un **migrador puro** `v_n → v_(n+1)`, encadenable, que vive junto al reducer. Los consumidores leen **todas** las versiones históricas: compatibilidad hacia atrás estricta, sin excepciones.
4. **El archivo exportado lleva cabecera propia:** `{ schemaVersion, engineVersion, policyConfig }` además de la lista de eventos. `policyConfig` viaja en el export porque el replay determinista lo requiere (mismo log + misma política = mismo estado final).
5. **Los golden fixtures son los tests de esta API.** Cada versión de cada tipo de evento congela al menos un fixture; la suite reproduce todos los fixtures históricos en cada corrida. Un fixture que deja de reproducirse correctamente es un bug de compatibilidad, nunca un fixture "viejo para actualizar" — actualizar un fixture consolidado para que un cambio pase equivale a debilitar el contrato (Ley §6 aplica).

## Alternativas descartadas

- **Versión global única del log** (un solo número para todo el esquema). Obliga a migrar todos los tipos de evento en bloque aunque cambie uno solo, y contradice el campo `v` por evento que el contrato ya estableció. El versionado por tipo de evento es más granular y ya está pagado.
- **Romper y migrar los logs guardados** cuando cambie el formato (migración destructiva de datos en reposo). Viola la Ley §3 directamente: el log es append-only e inmutable; las migraciones son de *lectura* (migradores encadenados), nunca reescritura de lo persistido.
- **No versionar y "tener cuidado".** Como todo lo que se protege con disciplina en vez de con tests, se rompe en el momento de menos atención. La fricción del salto de `v` + migrador + fixture es deliberada: es el precio de que ningún gif, replay o análisis histórico muera jamás.

## Consecuencias

**Positivas:** los replays son eternos por construcción, no por promesa; el visualizador se desarrolla contra un esquema estable; los logs de salas reales acumulados sirven para análisis de balance sin conversiones; el adaptador de auto-defensa hereda las mismas garantías gratis.

**Negativas:** cada cambio estructural de un evento cuesta un migrador + un fixture nuevo + su test — fricción deliberada que desalienta cambios de esquema caprichosos. El conjunto de migradores crece con el tiempo y debe mantenerse testeado (mitigado: son funciones puras, triviales de testear).

## Impacto en la Ley de arquitectura / contrato canónico

Formaliza y hace ejecutable la Ley §3; no modifica ninguna de las 6 reglas. `contract.test.ts` no cambia. La suite de fixtures de compatibilidad (punto 5) se agrega como tests nuevos — sumar tests nunca requiere permiso.
