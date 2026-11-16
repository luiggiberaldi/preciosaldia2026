# CASO-006 — Egress de Realtime: el supervisor deja de recibir documentos enteros

**Fecha:** 2026-11-14
**Estado:** En curso (código hecho en la rama `fix/egress-realtime`; migraciones **aplicadas** en producción el 15-nov-2026; app **sin publicar**)
**Plan:** [2026-11-14-plan-fixeo-egress-realtime.md](../plans/2026-11-14-plan-fixeo-egress-realtime.md) · **Línea base:** [2026-11-14-baseline-egress-realtime.md](../reports/2026-11-14-baseline-egress-realtime.md)

## Qué pidió el dueño
Auditar el egress (los datos que salen de Supabase y se cobran) a partir de una captura: el 11-nov Realtime gastó 388 MB, el 88 % del día. Hacer un plan completo y ejecutarlo fase a fase. Decisiones del dueño:
- **D1:** el supervisor ve 7 días de audit log.
- **D2:** el audit log puede llegar al supervisor con hasta 60 s de retraso.
- **D3:** con la pestaña oculta, el supervisor descarga los cambios al volver.
- **D4:** `backup_requests` sí va a Realtime; `licenses` no.
- **F6:** dos avisos: alarma diaria en GitHub (issue solo si algo se pasa) e informe semanal de Claude.

## Causa
Cada venta subía documentos enteros a `sync_documents` y Realtime los reenviaba enteros a cada pestaña del supervisor, aunque estuviera oculta. El 13-nov, 450 de 916 subidas eran el audit log de ~407 KB (81 % de los bytes). El resto, sobre todo, era el tramo de ventas del mes, que se reescribía hasta 400 KB por venta. Además había tres canales escuchando tablas que no estaban en Realtime.

## Qué se hizo

| Fase | Qué cambia | Commit |
|---|---|---|
| F0 | `scripts/egress-report.mjs`: mide por día lo subido (por tamaño), los GET, las conexiones de Realtime y los docs más pesados; `--check` para la alarma | `32c6448` |
| F1 | El audit log se publica en franjas de 2 horas de los últimos 7 días, como mucho una vez por minuto. Una acción solo reescribe la franja en curso (≤ ~70 KB). El doc viejo de 407 KB y las franjas vencidas se borran de la nube | `45c928d` |
| F2 | Las ventas de hoy van en tramos propios de ≤ 100 KB; los cerrados siguen en 400 KB. Al cambiar de día se reacomodan una vez y los tramos sobrantes se borran | `45c928d` |
| F5 | Fuera los canales muertos de `licenses`; migración que publica `backup_requests` | `84c04fb` |
| F3 | Pestaña oculta más de 2 min suelta su conexión de Realtime y vuelve con un pull incremental. El panel de diagnóstico muestra el modo y las caídas del canal | `d5ca616` |
| F4 | Tabla `sync_document_events` (la llena un trigger): Realtime solo avisa «cambió tal doc» (~150 B) y el supervisor lo baja por PostgREST, agrupando la ráfaga y solo con la pestaña visible. Sin la tabla, sigue en el modo anterior | `d5ca616` |
| F6 | Alarma diaria `.github/workflows/egress-alarm.yml` (issue con reporte sin ids de equipos, porque el repo es público) y tarea programada semanal de Claude | `c8be37e` |

Cambios de diseño respecto al plan, con su razón en el plan y en la bitácora: franjas fijas en lugar de tramos para el audit log; solo el tramo de hoy chico en ventas (no todo a 80 KB); pestaña oculta que suelta el canal en lugar de pestaña «líder»; sin despliegue en dos pasos para F4.

## Estimación del efecto (por verificar con el informe semanal)
- Subida diaria: de ~170 MB a ~20–30 MB (audit log ~10 MB, ventas ~7 MB, productos ~14 MB).
- Realtime con supervisores al día: de cientos de MB a pocos MB (avisos de ~150 B). Las descargas pasan a PostgREST, una por ráfaga y solo con la pestaña visible.

## Para publicar (en este orden)
1. ~~Aplicar en producción las dos migraciones~~ Hecho el 15-nov-2026 (ver Verificación).
2. Unir la rama `fix/egress-realtime` y publicar la app (las cajas y los supervisores se actualizan solos).
3. Guardar el secreto `SUPABASE_ACCESS_TOKEN` en GitHub para la alarma.

## Compatibilidad
- Supervisor viejo + caja nueva: deja de ver el audit log nuevo (rechaza las franjas por contrato) hasta actualizarse; lo demás sigue igual.
- Supervisor nuevo + migración sin aplicar: detecta que falta la tabla de avisos y sigue como antes.

## Verificación
Pruebas nuevas o ajustadas: `egressReportCore` 7, `auditSyncFamily` 10, `cloudSyncAuditProjection` 6, `cloudSyncSalesOpenTail` 3, `realtimePublicationGuardrails` 4, `monitorSyncNotifyEvents` 6, `syncDiagnostics`. Suite completa: 2373 bien, 20 omitidas y 1 falla ajena (`licensePolicy`, que compara copias en otras carpetas del Escritorio; ya fallaba antes, P-011). `vite build` bien. **Producción, 15-nov-2026:** migraciones aplicadas. La publicación ahora tiene `backup_requests` y `sync_document_events` (además de `device_pairings`, `supervisor_commands` y `sync_documents`). Relleno: 481 avisos para 481 docs, 0 desfasados. RLS activa, `authenticated` solo SELECT, `anon` sin permisos. Prueba del trigger dentro de un bloque que se deshace: el aviso tomó la fecha nueva y el doc quedó igual. **No verificado en navegador con caja y supervisor reales** (pendiente P-014, tras publicar).

## Errores
Ninguno de la app. Durante el trabajo: una edición dejó finales de línea mezclados y falló una prueba de texto de varias líneas; al normalizarlos pasó (no es un error de la app, no lleva ficha ERR).

## Pendientes
P-014 a P-017.
