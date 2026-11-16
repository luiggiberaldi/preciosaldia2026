-- 2026-11-15 · licenses: la tabla deja de ser legible con la clave pública.
--
-- ESTADO: APLICADA en producción el 2026-11-15, con el visto bueno del dueño.
-- Reemplaza a estacion-maestra/docs/migrations/001-restringir-lectura-anon-licenses.sql
-- (redactada el 2026-09-30, nunca aplicada); sus condiciones previas ya se cumplen.
--
-- Problema (revisado en vivo el 2026-11-15, solo lectura):
--   "licenses_device_read"  SELECT  anon, authenticated  USING (true)
--   Cualquiera con la clave pública de la app lee las 555 licencias: device_id,
--   tipo, estado y código de activación. Con el device_id de un cliente con
--   permanente, otro navegador puede hacerse pasar por ese equipo y usar su
--   licencia. No hay políticas de INSERT/UPDATE/DELETE: escribir ya está cerrado.
--
-- Por qué ahora es seguro cerrarlo:
--   · Las cajas consultan primero get_license_status (SECURITY DEFINER, no
--     devuelve el código). Existen las dos firmas en producción:
--       get_license_status(p_device_id)               → Bodega
--       get_license_status(p_device_id, p_product_id) → Farmacia
--     El SELECT directo es solo un respaldo para cuando el RPC falla; si queda
--     vacío la caja no cambia nada (versión en main) o no lo cuenta como
--     licencia borrada (useLicenseMonitoring nuevo, P-011).
--   · Activar con código usa verify_activation_code (SECURITY DEFINER, lee
--     cloud_licenses). Las 11 permanentes activas tienen su fila en
--     cloud_licenses al día (verificado el 2026-11-15).
--   · La Estación Maestra lee y escribe con la clave de servicio: no le afecta.
--   · El cliente de licencias de la caja no lleva sesión (persistSession:false):
--     corre como anon y tras esto no ve filas por SELECT. La política nueva solo
--     sirve a clientes con sesión de equipo, para su propia fila.
--
-- Efecto conocido:
--   · Si el RPC falla (caída de Supabase), la caja ya no tiene el SELECT de
--     respaldo y se queda con su caché offline, que es lo que hace sin red.
--   · DevicesManager.jsx (lista todas las licencias) dejará de ver filas. No se
--     usa en ningún lado del POS.
--
-- Verificación tras aplicar:
--   select policyname, cmd, roles, qual from pg_policies
--    where schemaname = 'public' and tablename = 'licenses';
--   -- debe quedar solo licenses_own_device_read
--   Con la clave pública (anon), debe devolver []:
--     GET /rest/v1/licenses?select=device_id&limit=1
--   Y en una caja real: abre, verifica la licencia y sigue premium.
--
-- Reversión (deja la política exactamente como estaba el 2026-11-15):
--   begin;
--   drop policy if exists "licenses_own_device_read" on public.licenses;
--   create policy "licenses_device_read" on public.licenses
--       for select to anon, authenticated using (true);
--   grant truncate, trigger, references on public.licenses to anon, authenticated;
--   commit;

begin;

drop policy if exists "licenses_device_read" on public.licenses;

create policy "licenses_own_device_read" on public.licenses
    for select
    to authenticated
    using (public.is_own_device_row(device_id));

-- Higiene: los clientes nunca vacían ni crean triggers sobre la tabla.
revoke truncate, trigger, references on public.licenses from anon, authenticated;

commit;
