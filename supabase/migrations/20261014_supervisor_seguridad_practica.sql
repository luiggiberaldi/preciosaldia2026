-- ============================================================
-- MIGRACIÓN: MODO SUPERVISOR CON SEGURIDAD PRÁCTICA PARA BODEGA
-- Fecha: 2026-10-14 (v2 — correcciones de auditoría aplicadas)
-- Objetivo: Conexión instantánea en 1 paso (WhatsApp / QR),
--           validación por licencia permanente activa,
--           token de un solo uso con expiración de 30 minutos.
--
-- CORRECCIONES v2:
--   C-1: GRANT solo a 'authenticated' y 'service_role' (no a 'anon').
--   C-2: generate_pairing_token rechaza si ya existe monitor activo.
--   C-3: unpair_monitor valida identidad del solicitante (caja o monitor).
--   I-1: pair_monitor_device añade monitor_auth_id y devuelve business_name.
--   O-2: unpair_monitor limpia también token_used_at al desvincular.
-- ============================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ────────────────────────────────────────────────────────────────
-- 1. Columnas de seguridad en device_pairings
--    (idempotente: no falla si ya existen de migraciones anteriores)
-- ────────────────────────────────────────────────────────────────
ALTER TABLE public.device_pairings
    ADD COLUMN IF NOT EXISTS token_hash         text,
    ADD COLUMN IF NOT EXISTS token_expires_at   timestamptz,
    ADD COLUMN IF NOT EXISTS token_used_at      timestamptz,
    ADD COLUMN IF NOT EXISTS revoked_at         timestamptz,
    -- monitor_auth_id identifica la sesión Supabase del celular del dueño.
    -- Se necesita para que el monitor pueda desvincularse de manera segura.
    ADD COLUMN IF NOT EXISTS monitor_auth_id    uuid;

-- ────────────────────────────────────────────────────────────────
-- 2. Índice rápido para verificación de tokens activos
-- ────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_device_pairings_token_hash_active
    ON public.device_pairings (token_hash)
    WHERE token_hash IS NOT NULL AND revoked_at IS NULL;

-- ────────────────────────────────────────────────────────────────
-- 3. generate_pairing_token — Desde la Caja
--    Genera el token que viajará en el enlace de WhatsApp.
--    Requiere: licencia permanente activa. Rechaza si ya hay monitor.
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.generate_pairing_token(p_device_id text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_token   text;
    v_hash    text;
    v_device  text := trim(p_device_id);
    v_row     public.device_pairings%ROWTYPE;
    v_updated integer;
BEGIN
    -- Validación de formato del device_id
    IF v_device IS NULL OR length(v_device) < 8 OR length(v_device) > 160 THEN
        RAISE EXCEPTION 'Identificador de dispositivo inválido';
    END IF;

    -- [C-1] Requiere sesión autenticada (anon de Supabase o usuario real)
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Se requiere sesión activa para emitir un enlace de supervisor';
    END IF;

    -- Validar que la caja tenga licencia permanente activa
    PERFORM device_id
    FROM public.cloud_licenses
    WHERE device_id = v_device
      AND lower(trim(license_type)) = 'permanent'
      AND is_active IS TRUE
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Se requiere licencia permanente activa para emitir acceso de supervisor';
    END IF;

    -- Leer el estado actual del emparejamiento
    SELECT * INTO v_row
    FROM public.device_pairings
    WHERE primary_device_id = v_device
    FOR UPDATE;

    -- [C-2] Guardarraíl: rechazar si ya existe un monitor activo vinculado
    IF FOUND
       AND v_row.monitor_device_id IS NOT NULL
       AND v_row.revoked_at IS NULL
    THEN
        RAISE EXCEPTION 'Esta caja ya tiene un supervisor conectado. Desvincula el celular actual antes de generar un nuevo enlace.';
    END IF;

    -- Generar token aleatorio de 24 caracteres hexadecimales (mayúsculas)
    v_token := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 24));
    v_hash  := encode(digest(v_token, 'sha256'), 'hex');

    -- Actualizar el registro existente
    UPDATE public.device_pairings
    SET pairing_token    = NULL,
        token_hash       = v_hash,
        token_expires_at = now() + interval '30 minutes',
        token_used_at    = NULL,
        revoked_at       = NULL
    WHERE primary_device_id = v_device;

    GET DIAGNOSTICS v_updated = ROW_COUNT;

    -- Si la fila aún no existe para esta caja, crearla
    IF v_updated = 0 THEN
        INSERT INTO public.device_pairings (
            primary_device_id,
            token_hash,
            token_expires_at,
            created_at
        )
        VALUES (
            v_device,
            v_hash,
            now() + interval '30 minutes',
            now()
        );
    END IF;

    -- Devuelve el token en texto claro, una sola vez, para armar el link de WhatsApp
    RETURN v_token;
END;
$$;

-- ────────────────────────────────────────────────────────────────
-- 4. pair_monitor_device — Desde el Celular
--    Consume el token en 1 paso: lo quema y vincula el dispositivo.
--    Guarda monitor_auth_id para validar desvinculación futura.
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pair_monitor_device(p_token text, p_monitor_device_id text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_pairing      public.device_pairings%ROWTYPE;
    v_token_hash   text;
    v_monitor_id   text := trim(p_monitor_device_id);
    v_monitor_uid  uuid := auth.uid();
    v_business_name text;
BEGIN
    -- [C-1] Requiere sesión autenticada
    IF v_monitor_uid IS NULL THEN
        RETURN json_build_object('success', false, 'message', 'Se requiere sesión activa para vincular el supervisor.');
    END IF;

    IF v_monitor_id IS NULL OR length(v_monitor_id) < 8 OR length(v_monitor_id) > 160 THEN
        RETURN json_build_object('success', false, 'message', 'Identificador de monitor inválido.');
    END IF;

    IF p_token IS NULL OR length(trim(p_token)) < 16 OR length(trim(p_token)) > 64 THEN
        RETURN json_build_object('success', false, 'message', 'Código de enlace inválido.');
    END IF;

    v_token_hash := encode(digest(upper(trim(p_token)), 'sha256'), 'hex');

    -- Buscar la caja con este token activo, no expirado y no consumido
    SELECT * INTO v_pairing
    FROM public.device_pairings
    WHERE token_hash       = v_token_hash
      AND token_expires_at > now()
      AND token_used_at    IS NULL
      AND revoked_at       IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'El enlace ha expirado o ya fue utilizado. Pide uno nuevo desde la caja.');
    END IF;

    -- Confirmar que la caja sigue con licencia permanente activa
    PERFORM device_id
    FROM public.cloud_licenses
    WHERE device_id = v_pairing.primary_device_id
      AND lower(trim(license_type)) = 'permanent'
      AND is_active IS TRUE
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'La caja no cuenta con licencia permanente activa.');
    END IF;

    -- Intentar leer el nombre del negocio desde sync_documents (puede no existir aún)
    SELECT (data->>'business_name')
    INTO v_business_name
    FROM public.sync_documents
    WHERE device_id   = v_pairing.primary_device_id
      AND doc_id LIKE 'bodega_%'
    LIMIT 1;

    -- Vincular el celular y quemar el token de inmediato
    UPDATE public.device_pairings
    SET monitor_device_id = v_monitor_id,
        monitor_auth_id   = v_monitor_uid,  -- [I-1] Guarda la sesión para validar unpair
        pairing_token     = NULL,
        token_hash        = NULL,
        token_used_at     = now(),
        paired_at         = now()
    WHERE id = v_pairing.id;

    RETURN json_build_object(
        'success',           true,
        'primary_device_id', v_pairing.primary_device_id,
        'business_name',     v_business_name,    -- [I-1] nombre del negocio para la lista de locales
        'message',           'Vinculación exitosa'
    );
END;
$$;

-- ────────────────────────────────────────────────────────────────
-- 5. unpair_monitor — Desde la caja o desde el celular del dueño
--    [C-3] Solo puede desvincular el propio dispositivo:
--      • La caja: identidad validada por is_own_device_row().
--      • El celular: identidad validada por monitor_auth_id = auth.uid().
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.unpair_monitor(p_device_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_device  text := trim(p_device_id);
    v_caller  uuid := auth.uid();
    v_row     public.device_pairings%ROWTYPE;
BEGIN
    -- [C-1] Requiere sesión autenticada
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'Se requiere sesión activa para desvincular el supervisor';
    END IF;

    IF v_device IS NULL OR length(v_device) < 8 THEN
        RAISE EXCEPTION 'Identificador de dispositivo inválido';
    END IF;

    -- Leer el vínculo actual (p_device_id puede ser la caja o el monitor)
    SELECT * INTO v_row
    FROM public.device_pairings
    WHERE primary_device_id = v_device
       OR monitor_device_id = v_device
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN false;
    END IF;

    -- [C-3] Validar que quien llama tiene derecho a desvincular:
    --   a) La caja registrada en device_sessions (is_own_device_row)
    --   b) El celular del supervisor (monitor_auth_id coincide con la sesión actual)
    IF NOT (
        public.is_own_device_row(v_row.primary_device_id)
        OR (v_row.monitor_auth_id IS NOT NULL AND v_row.monitor_auth_id = v_caller)
    ) THEN
        RAISE EXCEPTION 'No autorizado para desvincular este supervisor';
    END IF;

    -- Desvincular y limpiar todo el estado del token [O-2]
    UPDATE public.device_pairings
    SET monitor_device_id = NULL,
        monitor_auth_id   = NULL,
        token_hash        = NULL,
        token_expires_at  = NULL,
        token_used_at     = NULL,   -- [O-2] limpiar también token_used_at
        revoked_at        = now()
    WHERE id = v_row.id;

    RETURN FOUND;
END;
$$;

-- ────────────────────────────────────────────────────────────────
-- 6. Permisos de ejecución — [C-1] Solo 'authenticated' y service_role.
--    El rol 'anon' (peticiones sin sesión) no tiene acceso.
--    La caja y el celular llaman a ensureSupervisorSession() antes de
--    invocar estas RPCs, lo que garantiza una sesión anónima de Supabase.
-- ────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.generate_pairing_token(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pair_monitor_device(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.unpair_monitor(text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.generate_pairing_token(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pair_monitor_device(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.unpair_monitor(text) TO authenticated, service_role;

COMMIT;
