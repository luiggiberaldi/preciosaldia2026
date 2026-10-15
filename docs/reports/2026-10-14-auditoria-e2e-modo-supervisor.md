# Auditoría E2E del modo Supervisor

**Fecha:** 2026-10-14  
**Aplicación:** `preciosaldia-supervisor-production-alignment`  
**Alcance:** entrada al modo Supervisor, pairing por código, pairing por QR, manejo de errores, sesión del dispositivo, sincronización y desvinculación.

## Resultado ejecutivo

El flujo de entrada al modo Supervisor y el pairing manual tienen un comportamiento correcto en la prueba local. La validación de códigos incompletos, el envío del código inválido y la comunicación del error al usuario funcionan.

No se puede declarar el modo Supervisor **100% certificado para producción** todavía: en esta ejecución no había una caja primaria emparejada/licenciada disponible para ejecutar el recorrido exitoso completo `pair → live sync → unpair`. El camino QR tampoco pudo probarse con cámara real en el navegador automatizado.

Existe además un bloqueo concreto en el entorno de staging: el script `test:supervisor:staging` referencia dos archivos de prueba que no están presentes en `staging/tests/`.

## Evidencia ejecutada

### Aplicación local con configuración de producción

- URL probada: `http://127.0.0.1:5173/`.
- El frontend cargó sin errores JavaScript fatales.
- Se observaron llamadas correctas a Supabase para registro de dispositivo, licencia, heartbeat, pairing y backups.
- El modo Supervisor abrió correctamente la pantalla **“Conectar a mi caja”**.

### Flujo manual de pairing

1. La opción **Código de vinculación** abre el formulario correctamente.
2. Un código corto permanece deshabilitado y no permite enviar el formulario.
3. Un código de 24 caracteres habilita el botón.
4. Un código inválido genera la llamada RPC `pair_monitor_device` con HTTP 200 y el mensaje de negocio **“El código expiró o ya fue utilizado.”**.
5. El botón vuelve a su estado normal después del rechazo y no deja la interfaz bloqueada.

### Flujo QR

La pantalla intentó enumerar cámaras, pero el navegador de prueba no tenía ningún dispositivo disponible y devolvió `NotFoundError`. La interfaz conservó la alternativa de vinculación manual. Esto deja el camino QR como **parcialmente probado**, no como fallo funcional confirmado.

### Evidencias visuales

- [Pantalla inicial](../../dogfood-output/supervisor-e2e-20261014/screenshots/00-initial.png)
- [Entrada al pairing Supervisor](../../dogfood-output/supervisor-e2e-20261014/screenshots/04-supervisor-pairing-entry.png)
- [Formulario de código manual](../../dogfood-output/supervisor-e2e-20261014/screenshots/05-manual-code.png)
- [Código inválido con longitud válida](../../dogfood-output/supervisor-e2e-20261014/screenshots/07-invalid-full-code.png)
- [Resultado del código inválido](../../dogfood-output/supervisor-e2e-20261014/screenshots/09-invalid-code-after-response.png)
- [QR sin cámara disponible](../../dogfood-output/supervisor-e2e-20261014/screenshots/10-scan-qr-no-camera.png)

No se generó video porque el entorno no tiene `ffmpeg` instalado.

## Matriz de resultados

| Escenario | Resultado | Observación |
|---|---|---|
| Carga inicial de la aplicación | PASS | Sin errores JS fatales. |
| Entrada al modo Supervisor | PASS | Se muestra “Conectar a mi caja”. |
| Validación de longitud del código | PASS | El botón se habilita únicamente con longitud válida. |
| Código inválido/expirado | PASS | Mensaje de negocio correcto y formulario recuperable. |
| Escaneo QR sin cámara | PARCIAL | La cámara no existe en el entorno; queda disponible el fallback manual. |
| Pairing exitoso | NO CERTIFICADO | No había una caja primaria activa para no mutar datos reales. |
| Sincronización en tiempo real | NO CERTIFICADO | Depende de un pairing exitoso. |
| Desvinculación desde el Supervisor | NO CERTIFICADO E2E | No había sesión emparejada activa en el entorno. |
| Rechazo de propietario incorrecto | NO CERTIFICADO EN VIVO | Hay cobertura automatizada, pero staging no pudo ejecutar su suite E2E. |
| Recuperación ante reconexión | NO CERTIFICADO | Requiere pairing activo y prueba de red controlada. |

## Hallazgos

### E2E-001 — P1 — Falta certificar el recorrido exitoso completo

El recorrido crítico `pair → lectura en vivo → cambios reflejados → unpair` no se pudo ejecutar contra una caja de prueba activa. Esto impide afirmar que la corrección del modo Supervisor está lista al 100% únicamente con la evidencia actual.

**Acción recomendada:** preparar en staging una estación primaria sintética con licencia activa, emparejar un monitor, verificar datos en vivo, cerrar/reabrir la sesión, probar reconexión y finalmente desvincularlo.

### E2E-002 — P1 — El runner de staging no es ejecutable actualmente

`bun run test:supervisor:staging` termina con `No test files found` porque el script busca:

```text
tests/supervisorPairingStaging.test.js
tests/supervisorSecretUnpairStaging.test.js
```

y esos archivos no están en la raíz `tests/` del checkout de staging. Están conservados fuera de esa ubicación, dentro del archivo de separación de staging, por lo que no funcionan como pruebas del checkout.

**Acción recomendada:** restaurar los tests de staging dentro de `preciosaldia-supervisor-staging/tests/` junto con sus helpers relativos, o actualizar el checkout para que mantenga una suite ejecutable y versionada. No debe apuntarse el script a un archivo archivado.

### E2E-003 — P2 — El camino QR requiere una prueba con hardware o permiso real

El navegador automatizado devolvió `NotFoundError` al listar cámaras. El fallback manual funcionó, pero no se validaron permisos, lectura del QR, cámara frontal/trasera ni recuperación después de denegar permisos.

**Acción recomendada:** ejecutar una prueba manual en Android/Chrome o un runner con cámara virtual. Debe verificarse que la ausencia o denegación de cámara muestre un mensaje claro y siempre permita pasar al código manual.

### E2E-004 — P2 — Ruido de observabilidad durante la carga

Durante el arranque se registraron mensajes esperables en estado no emparejado, entre ellos listener de Supervisor no iniciado por feature flag y una solicitud de backup pendiente marcada como fallida por “Estación no configurada”. No bloquearon el modo Supervisor, pero pueden confundir el diagnóstico de soporte.

**Acción recomendada:** diferenciar en logs los estados esperables de una estación no emparejada y limpiar/expirar solicitudes de backup pendientes de entornos anteriores.

## Cobertura automatizada existente

- Suite de Supervisor en el checkout principal: **14 archivos y 83 pruebas aprobadas** con `bun run test:supervisor -- --maxWorkers=1`.
- Lint del área Supervisor: **0 errores**, con advertencias preexistentes.
- Build de producción: completó correctamente, con advertencias de tamaño de chunks.
- Suite de staging: **no ejecutable** por la ausencia de los archivos que el script declara.

La cobertura automatizada valida partes importantes de identidad, pairing, autorización y desvinculación, pero no sustituye la prueba E2E contra una sesión emparejada real con eventos de sincronización.

## Criterio recomendado antes de producción

El modo Supervisor debería pasar estos cuatro casos en staging antes de liberar:

1. Pairing válido de monitor con caja primaria activa.
2. Lectura de inventario/estadísticas y actualización después de un cambio en la caja.
3. Cierre, reapertura y recuperación de la sesión del monitor.
4. Desvinculación autorizada y rechazo de desvinculación por dispositivo no propietario.

Con la evidencia actual, el estado es **apto para continuar pruebas**, pero **no certificado todavía como 100% funcional para producción**.

## Nota de cambios

Esta auditoría no modificó la lógica de la aplicación. Solo generó evidencia de prueba y este reporte.
