-- Reversión puntual de una pieza de 20261016_device_sessions_reclaim_repair.sql
-- (rollout 2026-10-22 en producción): la política abierta de reclamo.
--
-- Contexto: 20261017_device_sessions_possession_proof.sql (ya aplicada en
-- producción) eliminó "device_sessions_reclaim" a propósito: reclamar una fila
-- de device_sessions exige la RPC claim_device_session con prueba de posesión
-- (secreto local; en la nube solo su hash SHA-256). El cliente actual ya no usa
-- UPDATE directo: src/utils/deviceIdentity.js reclama solo por
-- claim_device_session.
--
-- La reparación 20261016 (diseñada ANTES de la prueba de posesión, para el
-- cliente legacy de UPDATE directo) recreó la política abierta y volvió a
-- permitir reasignar identidades ajenas sin secreto. Este archivo elimina esa
-- política y restaura el estado 20261017.
--
-- No toca datos. Reversible: volver a crear la política de 20261016 si algún
-- día se necesita el flujo legacy (no recomendado).
--
-- Aplicar en: sodgzkablshladvbtnes (producción).
-- En staging NO aplicar: staging no tiene claim_device_session y el reclamo
-- legacy es allí el único flujo activo.

BEGIN;

DROP POLICY IF EXISTS "device_sessions_reclaim" ON public.device_sessions;

COMMIT;
