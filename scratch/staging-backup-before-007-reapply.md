# Respaldo staging antes de reaplicar 007 (2026-10-14)

- device_pairings: 6 filas, todas `primary_device_id LIKE 'e2e-%'`, sin datos de clientes.
- generate_pairing_token(text) vigente: versión previa a 007. Reclama dueño si owner_auth_id IS NULL (brecha), y hace INSERT si no existe la fila.
- Columnas claim_* ausentes; create_owner_claim_code y claim_owner_device ausentes.

Restauración: volver a ejecutar la definición de generate_pairing_token guardada en pg_get_functiondef, que se incluye abajo.

```sql
CREATE OR REPLACE FUNCTION public.generate_pairing_token(p_device_id text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_token TEXT;
    v_hash TEXT;
    v_owner UUID := auth.uid();
    v_device TEXT := trim(p_device_id);
    v_updated INTEGER;
BEGIN
    IF v_owner IS NULL THEN
        RAISE EXCEPTION 'Sesión no autenticada';
    END IF;

    IF v_device IS NULL OR v_device NOT LIKE 'e2e-%' THEN
        RAISE EXCEPTION 'Identificador sintético de staging inválido';
    END IF;

    v_token := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 24));
    v_hash := encode(digest(v_token, 'sha256'), 'hex');

    UPDATE public.device_pairings
    SET pairing_token = NULL,
        token_hash = v_hash,
        token_expires_at = now() + interval '5 minutes',
        token_used_at = NULL,
        monitor_device_id = NULL,
        monitor_auth_id = NULL,
        paired_at = NULL,
        revoked_at = NULL,
        owner_auth_id = v_owner
    WHERE primary_device_id = v_device
      AND (owner_auth_id IS NULL OR owner_auth_id = v_owner);

    GET DIAGNOSTICS v_updated = ROW_COUNT;

    IF v_updated = 0 THEN
        IF EXISTS (SELECT 1 FROM public.device_pairings WHERE primary_device_id = v_device) THEN
            RAISE EXCEPTION 'No autorizado para esta caja';
        END IF;
        INSERT INTO public.device_pairings (
            primary_device_id, owner_auth_id, token_hash, token_expires_at, created_at
        ) VALUES (
            v_device, v_owner, v_hash, now() + interval '5 minutes', now()
        );
    END IF;

    RETURN v_token;
END;
$function$;
```
