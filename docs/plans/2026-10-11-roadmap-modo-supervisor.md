# Roadmap incremental — Modo Supervisor confiable y eficiente

**Fecha:** 11 de octubre de 2026  
**Prioridad:** conservar la funcionalidad necesaria y reducir transferencias repetidas sin recortar actualizaciones en vivo ni seguridad.  
**Alcance inicial:** auditoría del código local, pruebas sintéticas y cambios locales. No incluye publicar, ejecutar SQL ni escribir datos reales.

## Situación de partida

- El monitor descarga snapshots de `sync_documents` y luego recibe cambios con Realtime.
- La caja sube listas de productos, ventas y otros datos. Hay hashes/debounce, pero al iniciar también hay subidas forzadas y una ruta de recuperación que pueden repetir transferencias.
- La operación de desvincular en la pantalla del monitor continúa aunque falle el RPC y puede anunciar éxito sin que el servidor haya revocado el vínculo.
- La auditoría local registra riesgos de datos retenidos en el monitor, comandos tardíos/repetidos y falta de mediciones por endpoint. No acredita el estado actual de Supabase.
- El código incluye pantallas de cambios remotos de tasa y producto, aunque su disponibilidad depende de flags compilados. El egreso está cerrado por diseño. La configuración real publicada debe comprobarse aparte.

## Fases

### Fase 1 — Desvinculación honesta y limpieza local comprobable

**Objetivo:** que no se confunda salir de la pantalla con revocar el acceso del servidor.

- Decisión acordada: si no se puede confirmar la revocación remota, no salir ni borrar datos; mantener el monitor y permitir reintentar.
- En el camino exitoso, exigir confirmación de la RPC de revocación antes de quitar la vinculación local.
- Borrar del almacenamiento del monitor únicamente los datos y marcas de sincronización del negocio que llegaron por pairing; conservar autenticación y datos no pertenecientes al monitor.
- Si la revocación o limpieza falla, mostrar un aviso que nombre lo ocurrido, no un éxito.
- Evitar dobles pulsaciones y cubrir éxito, rechazo/error del servidor y fallo de limpieza con pruebas.

**Se completa cuando:** la UI nunca dice que el vínculo remoto fue revocado sin confirmación; la limpieza local es selectiva y comprobable; los fallos no esconden datos ni dejan un estado que prometa más de lo ocurrido.

### Fase 2 — Órdenes remotas aplicadas una sola vez y detenidas al revocar

- Cerrar la ventana entre modificar la caja, guardar el identificador de orden y confirmar la orden.
- Impedir que una orden pendiente o ya recibida se aplique después de revocar el vínculo.
- Probar reinicio, timeout, reintento, dos pestañas y revocación durante una orden.

**Se completa cuando:** reintentar no duplica inventario/tasa/edición y una autorización revocada no deja cambios tardíos. No ampliar permisos durante esta fase.

### Fase 3 — Medir el tráfico del Supervisor sin tocar producción

- Medir en pruebas el tamaño de cada snapshot y contar lecturas/subidas al abrir, reconectar, volver de segundo plano y actualizar datos.
- Confirmar si la subida forzada inicial y la recuperación cargan dos veces los mismos datos.
- Registrar supuestos y separar mensajes Realtime de bytes de PostgREST; el número de llamadas no se convierte en GB.

**Se completa cuando:** existe una medición reproducible y una línea base local; no se atribuye ahorro a producción sin Usage comparable.

### Fase 4 — Quitar transferencias repetidas preservando la sincronización

- Evitar subir snapshots iguales y consolidar subidas duplicadas de arranque/reconexión.
- Serializar la reconciliación inicial caja↔nube para no pisar cambios válidos.
- Mantener Realtime para los cambios recientes y permitir refresco manual verificable.

**Se completa cuando:** pruebas de desconexión, reconexión, importación y cambios concurrentes pasan; se reduce el tráfico simulado frente a la línea base; no se pierde ni retrasa un cambio funcional.

### Fase 5 — Mejorar el trabajo de inventario y tasa

- Mostrar en una edición qué valor existe y qué valor se propone; registrar quién, cuándo y qué cambió.
- Para la tasa, mostrar el valor actual/nuevo y no anunciar que se aplicó sin confirmación de la caja.
- Mantener creación, edición, eliminación, egreso y tasa detrás de capacidades separadas; no habilitarlas por interfaz solamente.

**Se completa cuando:** pruebas demuestran el cambio exacto en la caja, la confirmación visible y el historial de auditoría. La activación en un ambiente real requiere revisión y autorización aparte.

### Fase 6 — Egreso de inventario, solo si el negocio lo necesita

- Requerir motivo/categoría, existencias suficientes, stock esperado y confirmación de la caja.
- Mantener un movimiento reversible por registro auditado; nunca borrar movimientos para corregirlos.
- Validar primero con datos sintéticos y backend de pruebas autorizado.

**Se completa cuando:** no hay egresos duplicados ni stock negativo, la revocación y rollback funcionan, y backend y frontend acuerdan la misma regla. Sin esa evidencia el egreso sigue apagado.

### Fase 7 — Prueba integral y decisión de despliegue

- Probar caja A y monitor A, además de aislamiento frente a caja B, pérdida de red, revocación y re-vinculación.
- Medir en Usage antes/después durante ventanas comparables y normalizadas por dispositivo activo; comprobar errores y frescura.
- Revisar configuración efectiva de flags, permisos y funciones de Supabase en lectura solamente, si hay acceso autorizado.

**Se completa cuando:** los escenarios de seguridad y funcionalidad están verificados; se informa ahorro observado y limitaciones; publicación queda como decisión explícita separada.

## Orden de ejecución

Ir una fase por vez. Cada fase deja una nota de resultado, pasa sus pruebas locales y tiene un criterio de salida antes de abrir la siguiente. Ninguna fase activa por defecto capacidades remotas ni publica cambios. En Fase 1 se acordó mantener al usuario en el monitor si el servidor no confirma la revocación, con opción de reintentar.
