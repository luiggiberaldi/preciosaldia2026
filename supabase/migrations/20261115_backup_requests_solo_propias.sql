-- 2026-11-15 · backup_requests: cada caja ve y marca solo SUS solicitudes (P-016).
--
-- ESTADO: APLICADA en producción el 2026-11-15, con el visto bueno del dueño.
--
-- Problema (revisado en vivo el 2026-11-15, solo lectura):
--   Las políticas permisivas se suman con OR, y tres de ellas valen `true`:
--     · "Permitir lectura de backup_requests"   SELECT  anon, authenticated  USING (true)
--     · "Permitir borrado de backup_requests"   DELETE  anon, authenticated  USING (true)
--     · "Permitir insercion de backup_requests" INSERT  anon, authenticated  (sin chequeo)
--   Con la clave pública de la app cualquiera puede ver, crear y BORRAR las
--   solicitudes de respaldo de cualquier equipo. Además:
--     · "backup_requests_anon_access" (ALL, anon) deja todo a quien sepa un
--       device_id que tenga fila en cloud_licenses.
--     · "backup_requests_device_isolation" compara auth.uid() (uuid) con
--       device_id ('PDA-V2-…'): nunca coincide, no protege nada.
--
-- Quién usa la tabla:
--   · Estación Maestra: crea y borra solicitudes con la clave de servicio
--     (src/lib/actions.ts). service_role salta RLS; no le afecta.
--   · Cajas de Bodega y Farmacia (useAutoBackup.js): con su sesión de equipo
--     (ensureSupervisorSession) LEEN sus solicitudes, las MARCAN completed/failed
--     y escuchan cambios por Realtime. Nunca insertan ni borran.
--     La versión publicada en main (d8804b5) ya usa la sesión de equipo.
--
-- Arreglo: la misma regla que ya protege sync_documents y cloud_backups,
--   is_own_device_row(device_id) = la fila de device_sessions de ese equipo es
--   de esta sesión. Solo SELECT y UPDATE; INSERT y DELETE quedan para la Estación.
--   Realtime aplica la política de SELECT, así que cada caja solo recibe avisos
--   de sus propias solicitudes.
--
-- Efecto conocido: una caja cuya fila de device_sessions no es de su sesión
--   actual deja de ver sus solicitudes, igual que hoy ya no puede subir a
--   cloud_backups. Al 2026-11-15, de las 11 licencias de pago activas solo
--   …8B4753A7 (Farmacia, "prueba pc") no tiene fila en device_sessions.
--
-- Verificación tras aplicar:
--   select policyname, cmd, roles, qual from pg_policies
--    where schemaname = 'public' and tablename = 'backup_requests';
--   -- deben quedar: backup_requests_admin_write, backup_requests_own_select,
--   --               backup_requests_own_update
--   Y desde una caja real: Estación → «Solicitar respaldo» → la caja lo sube
--   y la solicitud pasa a completed.
--
-- Reversión (deja las políticas exactamente como estaban el 2026-11-15):
--   begin;
--   drop policy if exists "backup_requests_own_select" on public.backup_requests;
--   drop policy if exists "backup_requests_own_update" on public.backup_requests;
--   create policy "Permitir lectura de backup_requests" on public.backup_requests
--       for select to anon, authenticated using (true);
--   create policy "Permitir borrado de backup_requests" on public.backup_requests
--       for delete to anon, authenticated using (true);
--   create policy "Permitir insercion de backup_requests" on public.backup_requests
--       for insert to anon, authenticated with check (true);
--   create policy "backup_requests_anon_access" on public.backup_requests
--       for all to anon
--       using (exists (select 1 from public.cloud_licenses c where c.device_id = backup_requests.device_id))
--       with check (exists (select 1 from public.cloud_licenses c where c.device_id = backup_requests.device_id));
--   create policy "backup_requests_device_isolation" on public.backup_requests
--       for all to authenticated
--       using ((auth.uid())::text = device_id) with check ((auth.uid())::text = device_id);
--   grant truncate, trigger, references on public.backup_requests to anon, authenticated;
--   commit;

begin;

drop policy if exists "Permitir lectura de backup_requests"   on public.backup_requests;
drop policy if exists "Permitir borrado de backup_requests"   on public.backup_requests;
drop policy if exists "Permitir insercion de backup_requests" on public.backup_requests;
drop policy if exists "backup_requests_anon_access"           on public.backup_requests;
drop policy if exists "backup_requests_device_isolation"      on public.backup_requests;

create policy "backup_requests_own_select" on public.backup_requests
    for select
    to anon, authenticated
    using (public.is_own_device_row(device_id));

create policy "backup_requests_own_update" on public.backup_requests
    for update
    to anon, authenticated
    using (public.is_own_device_row(device_id))
    with check (public.is_own_device_row(device_id));

-- Higiene: los clientes nunca vacían ni crean triggers sobre la tabla.
revoke truncate, trigger, references on public.backup_requests from anon, authenticated;

commit;
