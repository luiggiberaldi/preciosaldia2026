# Medición A/B de red intermitente — antes/después de las Fases 1–5

**Fecha:** 2026-10-17
**Plan:** [docs/plans/2026-10-17-plan-fix-resiliencia-envio-supervisor.md](../plans/2026-10-17-plan-fix-resiliencia-envio-supervisor.md)
**Arnés:** [tests/supervisorIntermittentNetwork.perf.test.jsx](../../tests/supervisorIntermittentNetwork.perf.test.jsx)
**Resultado de la corrida:** 6/6 pruebas en verde (exit 0)

## Qué se midió

El envío de órdenes del Modo Supervisor → caja bajo red intermitente, comparando
el pipeline **ANTES** de las 5 fases de resiliencia contra el **DESPUÉS**, con
las mismas condiciones exactas de red.

## Cómo se midió (metodología A/B)

- **ANTES** = copia congelada del pipeline previo a las fases, generada desde
  `git show HEAD:src/services/supervisorCommandService.js` y guardada en
  [tests/ab-fixtures/supervisorCommandServiceBefore.mjs](../../tests/ab-fixtures/supervisorCommandServiceBefore.mjs)
  (única modificación: rutas de imports; el header del archivo documenta cómo
  regenerarla contra otra base).
- **DESPUÉS** = código actual en
  [src/services/supervisorCommandService.js](../../src/services/supervisorCommandService.js).
- Ambos corren contra **el mismo transporte defectuoso**, con fallas
  controladas y deterministas: RTT configurable, fallos `fetch failed` en el
  create, canal de ACK que muere (`CHANNEL_ERROR`) y ACK que aparece tardío en
  el servidor.
- Los tiempos son **wall-clock real** medidos en cada corrida (mismo estilo que
  `tests/supervisorAckLatency.perf.test.jsx`). Se usan reintentos y backoff
  reales del código, sin acelerarlos.

## Resultados medidos

| Escenario (fase) | Métrica | ANTES | DESPUÉS |
|---|---|---|---|
| **S1** blip de red en el create (Fase 1) | órdenes entregadas | **0/1** — `'failed'` en 94 ms, orden perdida | **1/1** — `'sent'` en ~1.5 s (reintento con el mismo `commandId`, 1 sola fila en el servidor) |
| **S2** red lenta, RTT 150 ms (Fase 2) | latencia de envío (p50 de 5) | **452 ms** (3 idas y vueltas secuenciales) | **300 ms** (2) → **−150 ms por envío** |
| **S3a** canal de ACK caído, ACK ya publicado (Fase 3) | resultado | **`'failed'` falso** (108 ms) | **`'applied'`** (91 ms) |
| **S3b** canal caído, ACK llega durante la espera (Fase 3) | resultado | **`'failed'` falso** — ACK huérfano | **`'applied'` vía polling degradado** (7.1 s, backoff real) |
| **S4** corte de red de 90 s (Fase 5) | ¿la orden viva sobrevive? | **no** (ventana 60 s) | **sí con flag** (ventana 300 s) |
| **S5** barrido tras reconectar (Fase 4) | tiempo hasta el 1.er barrido | **hasta ~20 s** (backoff) | **~0 ms** (evento `online`) |

## Lectura de los resultados

- **Fiabilidad (S1, S3):** antes, cualquier blip de red perdía la orden o
  producía un fallo falso; después, 100 % de entrega **sin duplicados**
  (verificado: una sola fila por orden, mismo `commandId` en cada reintento).
- **Velocidad (S2):** −150 ms por envío en red lenta, medido (un round-trip
  menos gracias a sesión + vínculo en paralelo).
- **Costos honestos del failover:** S1 paga ~1.5 s de reintento y S3b paga el
  backoff real del receptor (~7 s, dentro del timeout de 10 s) para recuperar un
  ACK que, antes, se perdía para siempre.
- **S4/S5 son métricas calculadas** desde las constantes/políticas reales (no
  corridas temporizadas); el comportamiento de la Fase 4 está probado en
  `tests/supervisorRemoteCommandsRecovery.test.jsx`.

## Cómo reproducir

```bash
npx vitest run tests/supervisorIntermittentNetwork.perf.test.jsx --pool=forks --maxWorkers=1
```

La tabla se imprime al final de la corrida (stdout del test S5).

## Qué se verificó

- Corrida final: **6/6 pruebas en verde** (exit 0).
- `eslint` sobre ambos archivos nuevos: limpio (exit 0).
- Las aserciones validan también la medición: cada escenario comprueba el
  desenlace esperado de AMBOS lados (antes falla como se esperaba, después
  resuelve como se espera).
- Correcciones durante el arnés (ambas en el propio arnés, no en el código
  medido): bug del helper `measure()` que anidaba el resultado, y timeout del
  caso S3b ampliado a 20 s porque mide el backoff real de 5–7.5 s.

## Limitaciones

- La intermitencia es a nivel de **transporte inyectado** (RTT y fallos reales
  del pipeline, pero no un apagón de red real del navegador). El E2E de dos
  navegadores contra staging con DevTools throttling (Capa 2 del plan de
  aplicación) sigue pendiente y requiere acceso a staging.
- El "ANTES" es el contenido de `git HEAD` al momento de la medición; para
  comparar contra otra base, regenerar el fixture (instrucciones en su header).
- Los números de latencia varían ligeramente entre corridas (jitter real del
  backoff); los desenlaces (entregado/perdido, ok/failed) son estables y
  deterministas.
