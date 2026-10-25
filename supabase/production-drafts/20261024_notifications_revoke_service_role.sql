-- ─────────────────────────────────────────────────────────────────────────────
-- Kill switch de la tormenta de escrituras a `notifications`
-- APLICADO el 2026-10-24 al proyecto sodgzkablshladvbtnes ("preciosaldia
-- rebranding", producción). Este archivo documenta qué se aplicó y cómo
-- revertirlo.
--
-- Contexto (REPORTE-CAUSA-RAIZ-EGRESS-Y-SOLUCION.md §2.1): el reconciliador de
-- notificaciones de Estación Maestra (src/lib/notifications.ts, supabase-js
-- 2.108.2 en Node 24, service_role, desplegado en Vercel) re-upsertea el set de
-- alertas activas (~94) una fila por request con
-- `on_conflict=type,ref_id` + `Prefer: resolution=ignore-duplicates`:
-- 58.531 POSTs en el 23-oct para una tabla de 125 filas (99,8% no-ops, solo
-- ~1.57 req/s sostenidos + ráfagas), contribuyendo a la saturación del pool de
-- 10 conexiones de PostgREST (los `Thread killed`).
--
-- Efecto de este REVOKE:
--   · Las escrituras dejan de modificar nada (error 42501): cero churn de
--     filas, cero WAL, cero inserciones espurias.
--   · Las lecturas del dashboard (campana: últimas 8 + contador de no leídas)
--     siguen intactas, igual que DELETE (para purgas de limpieza).
--   · OJO: el reconciliador sigue ENVIANDO sus peticiones (ahora fallando en
--     silencio, sus `catch {}` se tragan el 42501 — MED-08 de la auditoría).
--     La tormenta de requests solo desaparece con el fix en ../estacion-maestra
--     (emitir solo en transición / batch único / espaciar el ciclo).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── APLICADO el 2026-10-24 ──────────────────────────────────────────────────

REVOKE INSERT, UPDATE ON public.notifications FROM service_role;

-- ── REVERTIR (cuando el reconciliador de Estación Maestra esté corregido) ────
-- Devuelve el ACL previo, medido ANTES del cambio:
--   {postgres=arwdDxtm/postgres, anon=arwdDxtm/postgres,
--    authenticated=arwdDxtm/postgres, service_role=arwdDxtm/postgres}

-- GRANT INSERT, UPDATE ON public.notifications TO service_role;
-- (Comentado a propósito: descomentar SOLO al revertir. Este archivo debe poder
--  ejecutarse entero sin restaurar la escritura.)

-- Verificación del revert (deben devolver true/true):
--   SELECT has_table_privilege('service_role', 'public.notifications', 'INSERT') AS ins,
--          has_table_privilege('service_role', 'public.notifications', 'UPDATE') AS upd;

-- ── PURGA DE FIXTURES DE TEST (aplicada el 2026-10-24: 4 filas borradas) ─────
-- Borra solo notificaciones cuyo identificador es un fixture de e2e
-- (`e2e-primary-device`, `e2e-monitor-device`, `TEST-DEVICE-FP-*`, `test`).
-- Las notificaciones de demos de dispositivos reales NO se tocan. Idempotente:
-- se puede re-ejecutar tras corridas e2e contra producción.
--
-- Filas borradas el 24-oct: demo_expired + demo_expiring de `e2e-primary-device`
-- (demo "demo3"), y 2 `backup_failed` de `TEST-DEVICE-FP-1783628025514` y `test`
-- ("solicitud zombie del pipeline silencioso pre-fix").
--
-- DELETE FROM public.notifications
--  WHERE ref_id LIKE 'device_new:TEST-%'
--     OR ref_id LIKE 'device_new:test%'
--     OR ref_id LIKE 'device_new:e2e%'
--     OR ref_id LIKE 'backup_failed:TEST-DEVICE-FP-%'
--     OR ref_id LIKE 'backup_failed:test:%'
--     OR ref_id LIKE 'backup_failed:e2e%'
--     OR ref_id LIKE '%TEST-DEVICE-FP%'
--     OR body ILIKE '%e2e-primary-device%'
--     OR body ILIKE '%e2e-monitor-device%'
--     OR title ILIKE '%e2e-primary-device%'
--     OR title ILIKE '%e2e-monitor-device%';

-- ── NOTA DE HARDENING PENDIENTE (fuera de alcance de este cambio) ────────────
-- El ACL de `notifications` concede arwdDxtm también a `anon` y `authenticated`,
-- pese a que db_estacion_maestra_setup.sql declara «Escritura solo por
-- service_role». Si se quiere endurecer de verdad:
--   REVOKE INSERT, UPDATE ON public.notifications FROM anon, authenticated;
-- (verificar primero que ningún cliente legítimo escribe con esas claves).
