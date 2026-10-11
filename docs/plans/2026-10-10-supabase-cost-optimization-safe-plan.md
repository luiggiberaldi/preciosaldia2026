# Plan seguro para optimizar costos de Supabase

**Fecha:** 10 de octubre de 2026
**Relacionado:** [roadmap de optimización](2026-10-10-supabase-free-optimization-roadmap.md) y [checklist del heartbeat](2026-10-10-heartbeat-canary-checklist.md).

## Objetivo y límite de seguridad

Identificar oportunidades de bajar solicitudes, egress y carga sin afectar la información ni el uso de Cosméticos, Bodega Maní, MILY BEAUTY STORE u otros clientes.

**Límite actual:** el usuario requiere riesgo cero. Ningún cambio que llegue a producción se puede garantizar como riesgo cero. Por tanto, este plan autoriza únicamente inspección local, pruebas con mocks/datos sintéticos y lectura de métricas sin mutaciones. No autoriza publicar builds, desplegar, cambiar configuración, ejecutar SQL, escribir datos ni hacer pruebas activas sobre dispositivos de clientes. Si ese límite impide medir ahorro real, el resultado debe reportarse como no medido; no se relaja implícitamente.

## Situación conocida

- Hay una optimización de backup request polling implementada localmente: conserva el chequeo inicial y Realtime, usa un fallback visible de 5 minutos y pausa el intervalo cuando la pestaña está en background; reconcilia al volver visible o al recuperar conexión.
- Existen pruebas unitarias con temporizadores simulados para inicio, cadencia, background/foreground, online y cleanup.
- El roadmap informa datos históricos de solicitudes, pero no atribuyen bytes por ruta. El número de solicitudes por sí solo no equivale a egress ni permite calcular GB; esos bytes solo se miden agregados en Usage o con métricas de ruta explícitamente disponibles.
- El cambio de heartbeat también está local y no debe mezclarse con este plan ni publicarse bajo el requisito actual.

## Secuencia por etapas

### Etapa 1 — Verificación local inmediata, sin red

1. Revisar el estado y el diff solo de `useAutoBackup`, `backupRequestPolling` y su prueba; no tocar modificaciones ajenas del checkout.
2. Ejecutar las pruebas dirigidas del polling y las suites de backup relevantes con Supabase mockeado. Confirmar que el test no requiere credenciales ni hace solicitudes externas.
3. Revisar estos invariantes: chequeo al iniciar; Realtime sigue siendo el camino primario; polling fail-safe cada 5 minutos solo visible; reconcile al volver visible/online; semáforo evita doble ejecución; solicitud fallida sigue reintentable; cleanup elimina timer/listeners/canal.
4. Ejecutar typecheck, lint dirigido y build local cuando haya cambios. Registrar errores y warnings separadamente; no silenciar ni suprimirlos para conseguir un resultado verde.
5. Revisar que el build/test no haya publicado nada y que no se hayan creado cambios de datos/configuración remota.

**Aprobación de etapa:** pruebas enfocadas, typecheck y build pasan; no hay regresiones en los invariantes. Esto solo acredita el comportamiento local/mocked, no autoriza producción ni demuestra ahorro facturado.

### Etapa 2 — Auditoría del código, local y de solo lectura

1. Trazar todos los productores/consumidores de `backup_requests`: inserción desde el Supervisor, suscripción Realtime, consulta de reconciliación, update a `completed`, procesamiento y reintento.
2. Buscar otros polls, canales duplicados y posibles mounts múltiples del hook. Confirmar ciclo de vida y semáforos.
3. Clasificar llamadas por propósito y datos transferidos usando el código/esquema existente. No inferir bytes reales a partir del número de solicitudes.
4. Si se necesita consultar Dashboard/Usage, hacerlo en modo lectura, con el selector de proyecto y rango fechados; no ejecutar SQL ni cambiar settings. Guardar solo agregados necesarios y evitar exportar datos de clientes.

**Aprobación de etapa:** mapa de flujo revisado, incertidumbres anotadas, y cualquier métrica identificada como agregada o atribuible a una ruta solo si la herramienta realmente lo demuestra.

### Etapa 3 — Pruebas deterministas y análisis local

1. Completar pruebas con mocks para concurrencia Realtime + polling, pending/completed, request duplicado, error de lectura, error al generar backup, offline/online y desmontaje durante una petición.
2. Verificar que el semáforo se libera incluso en error/timeout y que un fallo no marca como completada una solicitud no respaldada.
3. Simular ventanas de actividad para comparar la tasa teórica anterior (poll cada minuto) con la propuesta (cada 5 minutos visible y sin intervalo oculto). Informar requests por hora/pestaña y supuestos; no convertir a GB sin tamaños medidos.
4. No usar cuentas, tokens, tablas ni dispositivos reales en estas pruebas.

**Aprobación de etapa:** pruebas deterministas cubren eventos solapados y fallos/reintentos, sin cambiar contrato de datos ni permisos.

### Etapa 4 — Mediciones con duración (lectura solamente)

Esta etapa puede esperar; no bloquea el trabajo local.

1. Obtener una línea base de al menos 24 horas desde Usage/Reports, con rango, zona horaria, proyecto, dispositivos/sesiones activos y tráfico representativo anotados.
2. Si las herramientas ofrecen métricas de ruta, guardar conteos/latencia de `backup_requests`; si no, declararlo explícitamente. Registrar egress y log ingest agregados como contexto, no como bytes atribuibles a esa tabla.
3. Bajo el requisito actual de no publicar, la medición posterior solo puede describir el sistema existente; no presentarla como ahorro atribuible a la optimización.
4. Solo una futura comparación posterior a rollout permitiría medir el efecto en producción, y eso implicaría riesgo distinto de cero; queda fuera de este plan hasta autorización nueva e informada.

**Aprobación de etapa:** datos antes y después son comparables, normalizados por sesiones/dispositivo-horas; fuentes y limitaciones quedan escritas. Si no hay atribución, no se reclama reducción de egress.

### Etapa 5 — Decisión

Con la condición actual de riesgo cero:

- Se permite cerrar con hallazgos locales y estimaciones teóricas claramente etiquetadas.
- No se publica el cambio del polling, el heartbeat ni ningún otro código a clientes.
- No se usan Cosméticos, Bodega Maní ni MILY BEAUTY STORE para canary.
- No se hacen migraciones, cambios RLS/índices/logging, cambios de cuota ni mutaciones de datos.

Una eventual decisión de publicar requiere una nueva conversación y autorización explícita para un nivel de riesgo no nulo, junto con rollback probado y alcance de distribución confirmado. Incluso con canary, no se debe prometer riesgo cero.

## Criterios de éxito permitidos ahora

- Evidencia reproducible de que el cliente local realiza menos consultas periódicas en simulación, respetando los flujos de backup.
- Pruebas automáticas, typecheck y build sin fallos; warnings reportados.
- Auditoría de solo lectura con observabilidad y límites documentados.
- Cero despliegues, escrituras o cambios a datos de clientes.

**No es criterio alcanzable sin publicar:** afirmar que cayó el gasto facturado de Supabase en producción.

## Estado al crear este plan

El cambio de polling ya está en el checkout local y el roadmap anota verificaciones locales previas. Este documento no vuelve a ejecutar esos checks ni cambia el código. La auditoría de rutas, la ampliación de cobertura ante fallos y las mediciones de Usage quedan como tareas futuras; no se accedió a Supabase y no se publicó nada.