-- 2026-11-15 · Avisos de cambio de ID dirigidos a UNA instalación.
--
-- Problema: dos computadoras comparten el mismo device_id (PDA-V2-…). Las
-- órdenes remotas (supervisor_commands) van por device_id y las toma la primera
-- que las ve, así que no sirven para separar una sola de las dos.
--
-- Solución: un aviso dirigido a la SESIÓN de la instalación (auth.uid()), que es
-- distinta en cada computadora aunque compartan el ID. La caja nueva pregunta
-- por su aviso; si lo hay y su ID actual es el viejo, adopta el ID nuevo que
-- trae el aviso (el mismo cambio que hace el botón «Generar ID único»).
--
-- Reglas:
--   * Nadie con la clave pública puede leer ni escribir la tabla: sin políticas
--     y sin permisos para anon/authenticated. Solo service_role crea avisos.
--   * get_my_identity_migration_order solo devuelve avisos de auth.uid().
--   * complete_identity_migration_order solo marca el aviso propio, una vez,
--     y solo si la caja ya usa el ID nuevo.
--   * Un aviso pendiente por sesión; vence a los 7 días.
--
-- Verificación tras aplicar:
--   select relrowsecurity from pg_class where oid = 'public.identity_migration_orders'::regclass;  -- true
--   select count(*) from pg_policies where tablename = 'identity_migration_orders';                -- 0
--   select has_table_privilege('anon', 'public.identity_migration_orders', 'select');               -- false
--   select has_table_privilege('authenticated', 'public.identity_migration_orders', 'select');      -- false
--
-- Reversión:
--   drop function if exists public.complete_identity_migration_order(uuid, text);
--   drop function if exists public.get_my_identity_migration_order(text);
--   drop table if exists public.identity_migration_orders;

begin;

create table if not exists public.identity_migration_orders (
    id uuid primary key default gen_random_uuid(),
    target_user_id uuid not null,
    old_device_id text not null,
    new_device_id text not null unique,
    status text not null default 'pending' check (status in ('pending', 'done', 'cancelled')),
    note text,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null default (now() + interval '7 days'),
    done_at timestamptz,
    constraint identity_migration_orders_ids_differ check (old_device_id <> new_device_id),
    constraint identity_migration_orders_new_id_format check (new_device_id ~ '^PDA-V2-[0-9A-F]{32}$')
);

create unique index if not exists identity_migration_orders_one_pending
    on public.identity_migration_orders (target_user_id)
    where status = 'pending';

alter table public.identity_migration_orders enable row level security;
revoke all on table public.identity_migration_orders from public, anon, authenticated;

create or replace function public.get_my_identity_migration_order(p_device_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_order public.identity_migration_orders%rowtype;
begin
    if auth.uid() is null or p_device_id is null then
        return null;
    end if;

    select * into v_order
    from public.identity_migration_orders
    where target_user_id = auth.uid()
      and status = 'pending'
      and expires_at > now()
      and (old_device_id = p_device_id or new_device_id = p_device_id)
    order by created_at desc
    limit 1;

    if not found then
        return null;
    end if;

    return jsonb_build_object(
        'id', v_order.id,
        'oldDeviceId', v_order.old_device_id,
        'newDeviceId', v_order.new_device_id
    );
end;
$$;

create or replace function public.complete_identity_migration_order(p_order_id uuid, p_device_id text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
    if auth.uid() is null or p_order_id is null or p_device_id is null then
        return jsonb_build_object('success', false, 'code', 'ARGS_INVALID');
    end if;

    update public.identity_migration_orders
    set status = 'done', done_at = now()
    where id = p_order_id
      and target_user_id = auth.uid()
      and status = 'pending'
      and new_device_id = p_device_id;

    if not found then
        return jsonb_build_object('success', false, 'code', 'ORDER_NOT_FOUND');
    end if;

    return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.get_my_identity_migration_order(text) from public, anon;
revoke all on function public.complete_identity_migration_order(uuid, text) from public, anon;
grant execute on function public.get_my_identity_migration_order(text) to authenticated;
grant execute on function public.complete_identity_migration_order(uuid, text) to authenticated;

commit;
