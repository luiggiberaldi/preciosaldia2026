# Roadmap de rendimiento y cuotas Free de Supabase

Fecha de línea base: **10 de octubre de 2026**. Proyecto observado: `sodgzkablshladvbtnes`, organización en plan Free. Este plan se ejecuta **un paso a la vez**: modificar, probar, medir contra Usage/logs y conservar o revertir antes de continuar. No incluye cambios de seguridad ni migraciones de base sin revisión específica.

## Línea base conocida

Valores de Usage de las capturas del ciclo actual:

| Medida | Base | Cuota Free | Observación |
|---|---:|---:|---|
| Ingesta de logs | 0,742 GB | 1 GB | 74%; menor margen relativo |
| Log Query | 9,563 GB | 100 GB | 10% |
| Egress uncached | 0,341 GB | 5 GB | 7% |
| Cached egress | 0,098 GB | 5 GB | 2% |
| Database size | 0,047 GB | 0,5 GB | 9% |
| Storage size | 0,082 GB | 1 GB | 8% |
| Realtime peak connections | 16 | 200 | 8% |
| Realtime messages | 53 | 2.000.000 | <1% |
| MAU | 6 | 50.000 | <1% |
| Edge Function invocations | 0 | 500.000 | 0% |

Logs consultados en una ventana de 24 h: 1.932 GET + 657 PATCH a `backup_requests`; 714 RPC `auto_register_device`; 688 RPC `heartbeat_device`; 981 RPC `get_license_status`; 780 registros de timeout de PostgREST. No se pudo asignar los timeouts a una ruta, y los logs de gateway no incluyen bytes de respuesta. Las cifras de solicitudes no son estimaciones de egress.

## Secuencia de trabajo

### Paso 1 — Reducir el polling de solicitudes de backup (código local implementado; pendiente despliegue autorizado y medición)

- Cambio: conservar el chequeo inicial y Realtime como vía primaria; espaciar el fail-safe visible de un minuto a cinco minutos, pausarlo en background y reconciliar al volver visible/online.
- Pruebas: comprobar el chequeo inicial, el intervalo, la suspensión/reanudación y la limpieza de listeners; mantener cubierta la ruta Realtime en la integración del hook.
- Medición: comparar GET/día por dispositivo activo; el máximo teórico de polling continuo baja de 1.440 a 288 por pestaña visible. Las pestañas ocultas dejan de generar polls periódicos; eventos Realtime y recuperaciones pueden sumar consultas legítimas.
- Criterio de aceptación: no perder solicitudes remotas, conservar el semáforo de procesamiento, pruebas relevantes, typecheck y build correctos.
- Verificación local actual: 4 pruebas del helper pasan, typecheck y build pasan, ESLint sin errores en helper y prueba; el hook tiene warnings preexistentes de lint.
- Sin despliegue ni cambios en la base remota. Comparar Usage y logs cuando el cambio llegue al entorno real.

### Paso 2 — Separar auto-registro, heartbeat y verificación de licencia (implementado localmente)

- La función SQL viva confirma que `auto_register_device` comprueba/inserta filas en `licenses`, `cloud_licenses` y `account_devices`; no actualiza `last_seen`. `heartbeat_device` actualiza timestamps y etiquetas de negocio; no consulta licencia.
- Cambio local: registrar una vez al inicializar el dispositivo; heartbeat periódico (3 min) llama sólo `heartbeat_device`; la verificación de licencia sigue separada en el ciclo actual y en Realtime. No se redujo la frescura de presencia ni se alteró el intervalo de licencia.
- Hipótesis medible: por dispositivo activo durante 24 h, evitar hasta 480 llamadas `auto_register_device` (una por cada heartbeat de 3 min) y hasta una llamada duplicada de registro en el montaje inicial. Se mantienen hasta 480 heartbeats y el mismo patrón de verificaciones de licencia; los valores reales dependen de actividad, mounts y reintentos.
- Verificación local: prueba del wrapper que confirma una única RPC `heartbeat_device`; pruebas dirigidas, typecheck, lint de los archivos nuevos, lint de los hooks (sin errores, warnings existentes) y build requeridos.
- Sin cambios ni migración remota. Medir conteos de las RPCs en 24 h representativas tras publicar: `auto_register_device` debe caer hacia arranques/sesiones y `heartbeat_device` permanecer proporcional a tiempo activo. Vigilar error de registro en instalaciones nuevas antes de continuar.
- Pendiente como mejora posterior: decidir si se puede reducir el intervalo de licencia una vez definido el SLA de revocación/activación; no hacerlo en este paso.

### Paso 3 — Reducir respuestas de PostgREST y encontrar la fuente de egress

- Usage atribuye el pico diario observado principalmente a PostgREST (p. ej. 61,39 MB el 2 de octubre), pero no prueba qué endpoint explica el total del ciclo.
- Usar API Gateway/Database Reports y query performance para localizar consultas frecuentes, lentas y con muchas filas; Logs Explorer para ordenar rutas. Los logs no muestran response bytes: usar el medidor agregado de Usage como verdad de egress.
- Optimizar sólo endpoints confirmados: columnas necesarias, filtros selectivos, paginación, caché donde proceda y evitar devolver filas de INSERT/UPDATE que el cliente no consume.
- Aceptación: menos GB/día y llamadas repetidas con datos funcionales intactos; anotar mismo intervalo, tráfico y cantidad de usuarios al comparar.

### Paso 4 — Diagnosticar timeouts y advisors de base de datos

- Agrupar los 780 timeouts por servicio, ruta, tipo de petición y hora; el conteo actual no atribuye causa.
- Revisar `EXPLAIN (ANALYZE, BUFFERS)` en consultas reproducibles y Advisors: políticas RLS con funciones recalculadas por fila, políticas permisivas repetidas, FK sin índice y seis índices nunca usados.
- Cambiar una causa confirmada por vez. No borrar índices de plataforma/producción por el aviso de “unused” sin validar período de actividad y dependencias.
- Aceptación: baja la frecuencia/latencia de la consulta sospechosa sin regresión en permisos ni flujos.

### Paso 5 — Mantener Realtime dimensionado al uso real

- Usage mostró sólo 53 mensajes y pico de 16 conexiones frente a cuotas 2 M / 200; no justifica reemplazar Realtime.
- Inventariar canales y ciclo de vida: un canal por necesidad, cleanup correcto y evitar suscripciones duplicadas; vigilar pico de conexiones, eventos por tipo, joins y tamaño de payload en Realtime Reports.
- Aceptación: funcionalidad remota intacta, conexiones no aumentan innecesariamente y los eventos siguen muy por debajo de cuota.

### Paso 6 — Revisar ingesta de logs sin cegar observabilidad

- La captura marca 0,742/1 GB (74%), mientras la documentación indica que la facturación de Logs Ingest comienza tras el período de gracia que llega al inicio de 2027.
- Identificar tipos/fuentes responsables en Logs Explorer y settings; conservar advertencias y logs lentos útiles. Sólo después ajustar `log_statement`, `log_min_duration_statement`, conexiones u otra fuente demostrada como voluminosa.
- Medir 48–72 horas o más, debido a variación diaria. No desactivar logging globalmente y no activar logging de cada statement sin una necesidad acotada.
- Aceptación: menor GB de ingesta por día, con capacidad de diagnosticar errores/timeouts preservada.

### Paso 7 — Optimizar Storage sólo si el medidor lo amerita

- Usage marcó 0,082/1 GB y 0,098/5 GB cached egress; los objetos del catálogo y sus rutas se sirven con CacheFirst en el PWA.
- Ver Storage Report: top objetos, respuestas, caché/hits, tamaños de imagen. No re-optimizar ni cambiar rutas/cache TTL sin evidencia de misses/bytes.
- Aceptación: baja egress o mejora carga sin regresión offline.

## Reglas de verificación entre pasos

1. Guardar antes y después: fecha, selector de proyecto, período de Usage, cuota consumida, y actividad representativa (dispositivos activos / sesiones).
2. Para magnitudes acumuladas, comparar GB/día y proyectar el fin del ciclo; para Realtime peak connections, guardar el máximo real y no extrapolarlo linealmente.
3. Usar Usage para cuotas, Reports para latencia/actividad, y logs para rutas/errores. No convertir recuentos de llamadas en GB sin medir bytes.
4. Investigar al superar 80% y aplicar medidas antes de 90% como umbrales internos preventivos (no cuotas oficiales).
5. Antes de cada paso se define la hipótesis, criterio de éxito, riesgo funcional y plan de rollback. No desplegar ni aplicar SQL remoto desde este roadmap sin autorización expresa.
