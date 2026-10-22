-- Delta del checklist de migraciones pendientes de producción (ítem 1).
--
-- De 20261014_supervisor_seguridad_practica.sql solo falta en producción el
-- índice parcial de verificación de tokens activos. El resto de esa migración
-- (generate_pairing_token / pair_monitor_device / unpair_monitor) ya está
-- SUPERADO en producción por versiones más nuevas:
--   - pair_monitor_device → 20261015_999 (dos supervisores)
--   - generate_pairing_token / unpair_monitor → 20261017_selfheal (owner)
-- Re-aplicar el archivo 20261014 completo regresaría esas funciones. Este
-- delta trae SOLO el índice.
--
-- Idempotente: CREATE INDEX IF NOT EXISTS. No toca funciones ni datos.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_device_pairings_token_hash_active
    ON public.device_pairings (token_hash)
    WHERE token_hash IS NOT NULL AND revoked_at IS NULL;

COMMIT;
