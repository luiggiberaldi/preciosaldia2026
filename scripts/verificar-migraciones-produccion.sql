-- ─────────────────────────────────────────────────────────────────────────────
-- Verificación de migraciones previas — PRODUCCIÓN SYNC CLOUD (sodgzkablshladvbtnes)
--
-- SOLO LECTURA. No modifica nada. Pegar completo en:
--   Supabase Dashboard → SQL Editor → proyecto "preciosaldia rebranding"
--   (https://sodgzkablshladvbtnes.supabase.co)
-- y devolver la salida tal cual. Cada fila dice 'OK' o 'FALTA'.
--
-- Cubre los objetos creados por supabase/migrations/*.sql (25 archivos):
--   001_device_own_row_rls, 20261014 seguridad, 20261015 * (7),
--   20261016 * (3), 20261017 * (3), 20261018 product delete,
--   20261020 server clock, 20261021 índices, 20261022 * (2),
--   20261023 expected stock negativo, 20261024 delete policy,
--   20261026 órdenes de proveedores/facturas, 20261029 ventas remotas,
--   20261030 avances en ventas remotas, 20261031 anulación remota,
--   20261101 compras de mercancía
--   (Sección 7 y Sección 8).
--
-- NOTA: 20261017_supervisor_command_ttl_extended.sql quedó SOBRESCRITA por
-- 20261020_supervisor_command_server_clock.sql (misma función), por lo que su
-- "pendiente de aplicación" no importa si el marcador de versión de
-- create_supervisor_command da OK.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Sección 1: tablas + RLS habilitado ──────────────────────────────────────
SELECT '01 tabla' AS tipo, t.objeto,
       CASE WHEN to_regclass('public.' || t.objeto) IS NULL THEN 'FALTA'
            ELSE 'OK' END AS estado
FROM (VALUES
    ('device_pairings'), ('device_sessions'), ('supervisor_commands'),
    ('sync_documents'), ('cloud_backups')
) AS t(objeto)

UNION ALL
SELECT '02 rls_enabled', t.objeto,
       CASE WHEN c.oid IS NULL THEN 'FALTA'
            WHEN c.relrowsecurity THEN 'OK'
            ELSE 'RLS DESACTIVADO' END
FROM (VALUES
    ('device_sessions'), ('sync_documents'), ('cloud_backups')
) AS t(objeto)
LEFT JOIN pg_class c ON c.relname = t.objeto
LEFT JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'

-- ── Sección 2: columnas agregadas por migraciones ───────────────────────────
UNION ALL
SELECT '03 columna', c.tbl || '.' || c.col,
       CASE WHEN EXISTS (
           SELECT 1 FROM information_schema.columns ic
           WHERE ic.table_schema = 'public' AND ic.table_name = c.tbl
             AND ic.column_name = c.col
       ) THEN 'OK' ELSE 'FALTA' END
FROM (VALUES
    ('device_pairings', 'token_hash'),
    ('device_pairings', 'token_expires_at'),
    ('device_pairings', 'token_used_at'),
    ('device_pairings', 'revoked_at'),
    ('device_pairings', 'monitor_auth_id'),
    ('device_pairings', 'monitor_device_id_2'),
    ('device_pairings', 'monitor_auth_id_2'),
    ('device_pairings', 'paired_at_2'),
    ('supervisor_commands', 'applied_at'),
    ('supervisor_commands', 'cancelled_at'),
    ('supervisor_commands', 'cancelled_by'),
    ('supervisor_commands', 'cancel_reason'),
    ('device_sessions', 'possession_hash')
) AS c(tbl, col)

-- ── Sección 3: índices ──────────────────────────────────────────────────────
UNION ALL
SELECT '04 indice', i.nombre,
       CASE WHEN to_regclass('public.' || i.nombre) IS NOT NULL THEN 'OK'
            -- 20261021 solo exige un UNIQUE sobre (device_id, collection, doc_id):
            -- producción ya lo tenía como restricción con el nombre por defecto.
            WHEN i.nombre = 'sync_documents_device_collection_doc_uk'
                 AND to_regclass('public.sync_documents_device_id_collection_doc_id_key') IS NOT NULL
            THEN 'OK (equivalente: sync_documents_device_id_collection_doc_id_key)'
            ELSE 'FALTA' END
FROM (VALUES
    ('device_pairings_monitor_idx'),
    ('device_pairings_monitor_device_id_2_key'),
    ('device_pairings_monitor_2_idx'),
    ('idx_device_pairings_token_hash_active'),
    ('idx_supervisor_commands_control_page'),
    ('sync_documents_device_collection_doc_uk'),
    ('sync_documents_device_doc_idx')
) AS i(nombre)

-- ── Sección 4: políticas RLS (incluye la crítica 20261024) ──────────────────
UNION ALL
SELECT '05 policy', p.tbl || ' :: ' || p.pol || ' (' || p.cmd || ')',
       CASE WHEN EXISTS (
           SELECT 1 FROM pg_policies pg
           WHERE pg.schemaname = 'public' AND pg.tablename = p.tbl
             AND pg.policyname = p.pol AND pg.cmd = p.cmd
       ) THEN 'OK' ELSE 'FALTA' END
FROM (VALUES
    ('sync_documents',   'device_write_own_sync_doc',   'INSERT'),
    ('sync_documents',   'device_update_own_sync_doc',  'UPDATE'),
    ('sync_documents',   'device_read_own_sync_doc',    'SELECT'),
    ('sync_documents',   'device_delete_own_sync_doc',  'DELETE'),  -- 20261024: requerida por el retiro del doc legacy de ventas
    ('cloud_backups',    'device_upsert_own_backup',    'INSERT'),
    ('cloud_backups',    'device_update_own_backup',    'UPDATE'),
    ('cloud_backups',    'device_read_own_backup',      'SELECT'),
    ('device_sessions',  'device_sessions_insert_own',  'INSERT'),
    ('device_sessions',  'device_sessions_select_own',  'SELECT'),
    -- device_sessions_reclaim: eliminada a propósito por 20261022 (no se espera).
    ('device_sessions',  'device_sessions_update_own',  'UPDATE'),
    ('device_pairings',  'device_pairings_authenticated_read', 'SELECT'),
    ('supervisor_commands', 'supervisor_commands_authorized_read', 'SELECT')
) AS p(tbl, pol, cmd)

-- ── Sección 5: funciones RPC ────────────────────────────────────────────────
UNION ALL
SELECT '06 funcion', f.nombre,
       CASE WHEN EXISTS (
           SELECT 1 FROM pg_proc pr JOIN pg_namespace ns ON ns.oid = pr.pronamespace
           WHERE ns.nspname = 'public' AND pr.proname = f.nombre
       ) THEN 'OK' ELSE 'FALTA' END
FROM (VALUES
    ('create_supervisor_command'),
    ('claim_supervisor_command'),
    ('ack_supervisor_command'),
    ('cancel_supervisor_command'),
    ('get_supervisor_command_control_counts'),
    ('enforce_supervisor_income_command'),
    ('is_valid_supervisor_inventory_batch_payload'),
    ('is_valid_supervisor_sale_payload'),     -- 20261029 ventas remotas
    ('supervisor_json_number'),               -- 20261029 ventas remotas
    ('is_valid_supervisor_sale_void_payload'), -- 20261031 anulación remota
    ('is_valid_supervisor_purchase_payload'), -- 20261101 compras de mercancía
    ('generate_pairing_token'),
    ('pair_monitor_device'),
    ('unpair_monitor'),
    ('revoke_pairing_token'),
    ('register_device_session'),
    ('claim_device_session'),
    ('current_device_id'),
    ('is_own_device_row'),
    ('has_permanent_backup_license')
) AS f(nombre)

-- ── Sección 6: trigger ──────────────────────────────────────────────────────
UNION ALL
SELECT '07 trigger', 'supervisor_income_pairing_guard ON supervisor_commands',
       CASE WHEN EXISTS (
           SELECT 1 FROM pg_trigger tg
           JOIN pg_class cl ON cl.oid = tg.tgrelid
           JOIN pg_namespace ns ON ns.oid = cl.relnamespace
           WHERE ns.nspname = 'public' AND cl.relname = 'supervisor_commands'
             AND tg.tgname = 'supervisor_income_pairing_guard'
       ) THEN 'OK' ELSE 'FALTA' END

ORDER BY 1, 2;

-- ── Sección 7: VERSIÓN viva de las funciones que se reemplazan seguido ──────
-- (una función puede existir con un cuerpo viejo; estos marcadores confirman
--  que pg_proc tiene la definición de la ÚLTIMA migración)
SELECT
    pr.proname AS funcion,
    CASE
        WHEN pr.proname = 'create_supervisor_command'
            THEN CASE
                WHEN pr.prosrc NOT LIKE '%v_duration%' THEN 'VERSIÓN VIEJA (falta 20261020)'
                WHEN pr.prosrc NOT LIKE '%supervisor.invoice.delete%' THEN 'VERSIÓN VIEJA (falta 20261026 proveedores)'
                WHEN pr.prosrc NOT LIKE '%supervisor.sale.create%' THEN 'VERSIÓN VIEJA (falta 20261029 ventas remotas)'
                WHEN pr.prosrc NOT LIKE '%supervisor.sale.void%' THEN 'VERSIÓN VIEJA (falta 20261031 anulación remota)'
                WHEN pr.prosrc NOT LIKE '%supervisor.purchase.upsert%' THEN 'VERSIÓN VIEJA (falta 20261101 compras)'
                ELSE 'OK (20261101 compras)' END
        WHEN pr.proname = 'enforce_supervisor_income_command'
            THEN CASE
                WHEN pr.prosrc NOT LIKE '%rateMode%' THEN 'VERSIÓN VIEJA (falta 20261022)'
                WHEN pr.prosrc NOT LIKE '%supervisor.invoice.delete%' THEN 'VERSIÓN VIEJA (falta 20261026 proveedores)'
                WHEN pr.prosrc NOT LIKE '%supervisor.sale.create%' THEN 'VERSIÓN VIEJA (falta 20261029 ventas remotas)'
                WHEN pr.prosrc NOT LIKE '%supervisor.sale.void%' THEN 'VERSIÓN VIEJA (falta 20261031 anulación remota)'
                WHEN pr.prosrc NOT LIKE '%supervisor.purchase.upsert%' THEN 'VERSIÓN VIEJA (falta 20261101 compras)'
                ELSE 'OK (20261101 compras)' END
        WHEN pr.proname = 'is_valid_supervisor_sale_payload'
            THEN CASE WHEN pr.prosrc LIKE '%cashAdvances%' THEN 'OK (20261030 avances)' ELSE 'VERSIÓN VIEJA (falta 20261030 avances)' END
        WHEN pr.proname = 'is_valid_supervisor_inventory_batch_payload'
            THEN CASE WHEN pr.prosrc LIKE '%-10000000%' THEN 'OK (20261023 stock negativo)' ELSE 'VERSIÓN VIEJA (falta 20261023)' END
    END AS version
FROM pg_proc pr
JOIN pg_namespace ns ON ns.oid = pr.pronamespace
WHERE ns.nspname = 'public'
  AND pr.proname IN ('create_supervisor_command',
                     'enforce_supervisor_income_command',
                     'is_valid_supervisor_inventory_batch_payload',
                     'is_valid_supervisor_sale_payload')
ORDER BY 1;

-- ── Sección 8: CHECK de tipos de orden (20261026 proveedores/facturas,
--    20261029 ventas remotas) ─────────────────────────────────────────────────
-- Sin esto, el INSERT de una orden supervisor.supplier.* / invoice.* falla
-- aunque la RPC ya la acepte.
SELECT
    'supervisor_commands_command_type_check' AS objeto,
    CASE WHEN EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'supervisor_commands_command_type_check'
          AND pg_get_constraintdef(oid) LIKE '%supervisor.invoice.delete%'
    ) THEN 'OK' ELSE 'FALTA' END AS estado
UNION ALL
SELECT
    'supervisor_commands_command_type_check (venta remota)',
    CASE WHEN EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'supervisor_commands_command_type_check'
          AND pg_get_constraintdef(oid) LIKE '%supervisor.sale.create%'
    ) THEN 'OK' ELSE 'FALTA' END
UNION ALL
SELECT
    'supervisor_commands_command_type_check (anulación remota)',
    CASE WHEN EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'supervisor_commands_command_type_check'
          AND pg_get_constraintdef(oid) LIKE '%supervisor.sale.void%'
    ) THEN 'OK' ELSE 'FALTA' END
UNION ALL
SELECT
    'supervisor_commands_command_type_check (compras de mercancía)',
    CASE WHEN EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'supervisor_commands_command_type_check'
          AND pg_get_constraintdef(oid) LIKE '%supervisor.purchase.delete%'
    ) THEN 'OK' ELSE 'FALTA' END;
