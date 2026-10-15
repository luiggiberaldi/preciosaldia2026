-- Backup remoto: solo dispositivos con licencia permanente activa.
-- Aplicar en el proyecto POS productivo después de revisar el esquema.
-- No modifica el backup local.

BEGIN;

CREATE OR REPLACE FUNCTION public.has_permanent_backup_license(target_device_id text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.licenses l
        WHERE l.device_id = target_device_id
          AND l.product_id = 'bodega'
          AND lower(trim(l.type)) = 'permanent'
          AND l.is_active IS TRUE
    );
$$;

GRANT EXECUTE ON FUNCTION public.has_permanent_backup_license(text)
    TO anon, authenticated, service_role;

ALTER TABLE public.cloud_backups ENABLE ROW LEVEL SECURITY;

-- Evita que una policy antigua para auth.uid() salte la regla de licencia.
DROP POLICY IF EXISTS "cloud_backups_device_isolation" ON public.cloud_backups;

DROP POLICY IF EXISTS "device_upsert_own_backup" ON public.cloud_backups;
CREATE POLICY "device_upsert_own_backup"
    ON public.cloud_backups
    FOR INSERT TO anon, authenticated
    WITH CHECK (
        public.is_own_device_row(device_id)
        AND public.has_permanent_backup_license(device_id)
    );

DROP POLICY IF EXISTS "device_update_own_backup" ON public.cloud_backups;
CREATE POLICY "device_update_own_backup"
    ON public.cloud_backups
    FOR UPDATE TO anon, authenticated
    USING (
        public.is_own_device_row(device_id)
        AND public.has_permanent_backup_license(device_id)
    )
    WITH CHECK (
        public.is_own_device_row(device_id)
        AND public.has_permanent_backup_license(device_id)
    );

-- La lectura del monitor sigue siendo necesaria para el supervisor vinculado.
-- La lectura propia también queda limitada a licencia permanente.
DROP POLICY IF EXISTS "device_read_own_backup" ON public.cloud_backups;
CREATE POLICY "device_read_own_backup"
    ON public.cloud_backups
    FOR SELECT TO anon, authenticated
    USING (
        (
            public.is_own_device_row(device_id)
            AND public.has_permanent_backup_license(device_id)
        )
        OR EXISTS (
            SELECT 1
            FROM public.device_pairings dp
            WHERE dp.monitor_device_id = public.current_device_id()
              AND dp.primary_device_id = cloud_backups.device_id
        )
    );

COMMIT;
