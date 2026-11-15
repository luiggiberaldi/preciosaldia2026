-- 2026-11-06 · Respaldos: que ninguna caja de pago pierda su respaldo por identidad.
--
-- Problema (auditoría AUDITORIA-RESPALDOS-2026-11-06.md, anexo):
--   1. register_device_session crea la fila de device_sessions SIN prueba de
--      posesión. Si la caja pierde su sesión anónima (navegador limpio,
--      reinstalación, sesión caducada), register responde CONFLICT y
--      claim_device_session responde POSSESSION_REQUIRED porque el hash está
--      vacío: la caja queda sin respaldo para siempre (197/197 filas sin hash).
--   2. has_permanent_backup_license solo acepta 'permanent': la mensualidad,
--      que también tiene derecho a respaldo según licensePolicy.js, no puede
--      subir directo.
--
-- Arreglo (compatible con las cajas actuales; no cambia firmas):
--   1. claim_device_session: si la fila ya es de esta sesión y no tiene hash,
--      GUARDA el hash del secreto (siembra). Nunca reemplaza un hash existente.
--      La caja nueva llama claim después de registrarse; la caja vieja sigue
--      funcionando igual que hoy.
--   2. has_permanent_backup_license: permanente o mensual activa, con la
--      gracia de 5 días de la mensualidad (MONTHLY_GRACE_DAYS). El nombre se
--      conserva porque lo usan las políticas existentes.
--
-- Las cajas que YA perdieron su sesión antes de este arreglo no tienen hash
-- sembrado y siguen necesitando liberarse una vez a mano (borrar su fila de
-- device_sessions); ver el anexo de la auditoría.

begin;

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
    v_hash text;
begin
    if v_uid is null then
        return jsonb_build_object('success', false, 'code', 'NO_SESSION');
    end if;
    if p_secret is null or length(p_secret) < 32 then
        return jsonb_build_object('success', false, 'code', 'SECRET_INVALID');
    end if;

    v_hash := encode(extensions.digest(p_secret, 'sha256'), 'hex');

    select * into v_row
    from public.device_sessions
    where device_id = p_device_id
    for update;

    if not found then
        insert into public.device_sessions (device_id, user_id, possession_hash)
        values (p_device_id, v_uid, v_hash);
        return jsonb_build_object('success', true, 'code', 'CREATED');
    end if;

    if v_row.user_id = v_uid then
        -- Siembra: la dueña actual deja guardada su prueba de posesión para
        -- poder reclamar la fila si un día pierde la sesión anónima.
        update public.device_sessions
           set last_seen = now(),
               possession_hash = coalesce(possession_hash, v_hash)
         where device_id = p_device_id;
        return jsonb_build_object(
            'success', true,
            'code', case when v_row.possession_hash is null then 'SEEDED' else 'ALREADY_BOUND' end
        );
    end if;

    if v_row.possession_hash is null or v_row.possession_hash <> v_hash then
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

create or replace function public.has_permanent_backup_license(target_device_id text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
    select exists (
        select 1
        from public.licenses l
        where l.device_id = target_device_id
          and l.product_id = 'bodega'
          and l.is_active is true
          and (
                lower(trim(l.type)) = 'permanent'
             or (
                    lower(trim(l.type)) = 'monthly'
                and l.expires_at is not null
                and now() < l.expires_at + interval '5 days'
                )
          )
    );
$$;

grant execute on function public.has_permanent_backup_license(text)
    to anon, authenticated, service_role;

commit;

-- Reversión (si hiciera falta): volver a aplicar
--   20261017_device_sessions_possession_proof.sql  (claim_device_session)
--   20261015_backup_permanent_license_rls.sql      (has_permanent_backup_license)
