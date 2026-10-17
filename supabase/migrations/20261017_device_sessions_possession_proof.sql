-- NO APLICAR EN PRODUCCIÓN sin aprobación explícita y pruebas en staging.
-- Plan: docs/plans/2026-10-17-plan-reclamo-identidad-caja.md
--
-- Objetivo: el reclamo de una identidad de caja (device_sessions) ya no puede
-- hacerse solo porque la fila es visible. Exige un secreto local de la caja
-- (solo se guarda su hash SHA-256).
--
-- Idempotente: drop ... if exists + create.

begin;

-- digest() viene de pgcrypto. Supabase lo instala en el schema extensions.
create extension if not exists pgcrypto with schema extensions;

alter table public.device_sessions
    add column if not exists possession_hash text;

-- Reemplaza el reclamo abierto (using (true)) de 001/20261016.
drop policy if exists "device_sessions_reclaim" on public.device_sessions;

-- El UPDATE directo ya no reasigna filas ajenas. Solo el dueño actual puede
-- actualizar su propia fila (last_seen, etc.).
-- Para reclamar una fila ajena se usa la RPC claim_device_session (abajo).
drop policy if exists "device_sessions_update_own" on public.device_sessions;
create policy "device_sessions_update_own"
    on public.device_sessions
    for update to anon, authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

-- Reclamo con prueba de posesión. SECURITY DEFINER: valida el hash antes de
-- reasignar. Nunca reasigna sin secreto válido.
create or replace function public.claim_device_session(
    p_device_id text,
    p_secret    text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_uid  uuid := auth.uid();
    v_row  public.device_sessions%rowtype;
begin
    if v_uid is null then
        return jsonb_build_object('success', false, 'code', 'NO_SESSION');
    end if;
    if p_secret is null or length(p_secret) < 32 then
        return jsonb_build_object('success', false, 'code', 'SECRET_INVALID');
    end if;

    select * into v_row
    from public.device_sessions
    where device_id = p_device_id
    for update;

    -- Alta: el secreto queda fijado en la primera escritura. Nunca se reemplaza.
    if not found then
        insert into public.device_sessions (device_id, user_id, possession_hash)
        values (p_device_id, v_uid, encode(extensions.digest(p_secret, 'sha256'), 'hex'));
        return jsonb_build_object('success', true, 'code', 'CREATED');
    end if;

    if v_row.user_id = v_uid then
        update public.device_sessions set last_seen = now() where device_id = p_device_id;
        return jsonb_build_object('success', true, 'code', 'ALREADY_BOUND');
    end if;

    -- Fila de otra sesión: exige prueba de posesión.
    -- Fila sin secreto (legado): no se reclama. Requiere migración de datos explícita.
    if v_row.possession_hash is null
       or v_row.possession_hash <> encode(extensions.digest(p_secret, 'sha256'), 'hex') then
        return jsonb_build_object('success', false, 'code', 'POSSESSION_REQUIRED');
    end if;

    update public.device_sessions
       set user_id = v_uid, last_seen = now()
     where device_id = p_device_id;
    return jsonb_build_object('success', true, 'code', 'RECLAIMED');
end;
$$;

revoke all on function public.claim_device_session(text, text) from public;
grant execute on function public.claim_device_session(text, text) to anon, authenticated;

commit;
