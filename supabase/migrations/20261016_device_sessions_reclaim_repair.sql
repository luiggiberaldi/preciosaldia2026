-- Reparación: políticas own-row de device_sessions (re-afirmación idempotente
-- del contrato de 001_device_own_row_rls.sql, sin cambiar el esquema).
--
-- Síntoma que corrige: al pedir un código de vinculación tras un ciclo
-- conectar/desconectar, createPairingToken moría con
--   "new row violates row-level security policy for table \"sync_documents\""
-- porque la fila de device_sessions quedaba ligada a otra auth.uid() (la sesión
-- anónima se regeneró) y el reclaim client-side no tenía política efectiva para
-- re-ligarse: el UPDATE no afectaba filas (sin error), el cliente reportaba
-- registro "ok" y el upsert posterior violaba is_own_device_row.
--
-- Aplicar en: sodgzkablshladvbtnes (producción) y staging.
-- Idempotente: safe to re-run (DROP POLICY IF EXISTS + CREATE).

BEGIN;

create table if not exists public.device_sessions (
    device_id    text primary key,                -- pda_device_id (ej: PDA-V2-XXXX)
    user_id      uuid not null references auth.users (id) on delete cascade,
    first_seen   timestamptz not null default now(),
    last_seen    timestamptz not null default now()
);

alter table public.device_sessions enable row level security;

drop policy if exists "device_sessions_insert_own" on public.device_sessions;
create policy "device_sessions_insert_own"
    on public.device_sessions
    for insert to anon, authenticated
    with check (auth.uid() = user_id);

drop policy if exists "device_sessions_select_own" on public.device_sessions;
create policy "device_sessions_select_own"
    on public.device_sessions
    for select to anon, authenticated
    using (auth.uid() = user_id);

-- Reconciliación: si la sesión se regeneró para un device_id ya registrado, el
-- poseedor actual re-liga la fila hacia sí mismo. SIN ESTA POLÍTICA el reclaim
-- del cliente actualiza 0 filas sin error y el push posterior viola RLS.
drop policy if exists "device_sessions_reclaim" on public.device_sessions;
create policy "device_sessions_reclaim"
    on public.device_sessions
    for update to anon, authenticated
    using (true)                        -- la fila es visible para reconciliar
    with check (auth.uid() = user_id);  -- solo se puede reasignar A uno mismo

drop policy if exists "device_sessions_update_own" on public.device_sessions;
create policy "device_sessions_update_own"
    on public.device_sessions
    for update to anon, authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

COMMIT;
