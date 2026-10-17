-- NO APLICAR EN PRODUCCIÓN sin aprobación explícita y pruebas en staging.
--
-- Contexto: dos estaciones llegaron a compartir el mismo `device_id`
-- (PDA-V2-… derivado del navegador). Con la corrección de identidad única,
-- cada estación obtiene un ID propio. Este borrador permite que una estación
-- que acaba de generar su ID único RE-LIGUE su licencia existente al nuevo ID,
-- sin tocar la licencia de la otra estación.
--
-- Prueba de posesión: se exige el ID anterior (`p_old_device_id`), que solo
-- conoce la estación que venía usando esa licencia. Así un tercero no puede
-- reclamar una licencia ajena solo con el código de activación.
--
-- Idempotente: si ya existe licencia para el nuevo ID, no hace nada.

begin;

create or replace function public.claim_license_to_device_id(
    p_old_device_id text,
    p_new_device_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_license public.licenses%rowtype;
    v_count   integer;
begin
    if p_old_device_id is null or p_new_device_id is null
       or p_old_device_id = p_new_device_id then
        return jsonb_build_object('success', false, 'code', 'ARGS_INVALID');
    end if;

    -- Solo se acepta un cambio a un ID nuevo sin licencia previa: evita
    -- pisar una licencia ya registrada en el nuevo ID.
    select count(*) into v_count
    from public.licenses
    where device_id = p_new_device_id;

    if v_count > 0 then
        return jsonb_build_object('success', true, 'code', 'ALREADY_BOUND');
    end if;

    select * into v_license
    from public.licenses
    where device_id = p_old_device_id
    order by created_at desc
    limit 1;

    if not found then
        return jsonb_build_object('success', false, 'code', 'LICENSE_NOT_FOUND');
    end if;

    -- Se copia la licencia al nuevo ID. La fila original queda intacta para la
    -- otra estación: dos estaciones pueden conservar su licencia sin pisarse.
    -- OJO con las restricciones reales de `licenses`:
    --   * `code` es ÚNICO (licenses_code_key) → no se puede copiar el mismo código.
    --     El código nuevo se deriva del ID nuevo, igual que hace el registro normal
    --     (ACTIV-<últimos 8 del device_id>).
    --   * NO hay único en (device_id, product_id) → no se usa ON CONFLICT sobre esa
    --     pareja; se comprueba antes y se hace upsert solo si ya existía fila propia.
    if exists (
        select 1 from public.licenses
        where device_id = p_new_device_id and product_id = v_license.product_id
    ) then
        update public.licenses
           set code       = 'ACTIV-' || upper(substr(p_new_device_id, greatest(length(p_new_device_id) - 7, 1))),
               type       = v_license.type,
               is_active  = v_license.is_active,
               expires_at = v_license.expires_at,
               updated_at = now()
         where device_id = p_new_device_id and product_id = v_license.product_id;
    else
        insert into public.licenses (device_id, product_id, code, type, is_active, expires_at)
        values (
            p_new_device_id,
            v_license.product_id,
            'ACTIV-' || upper(substr(p_new_device_id, greatest(length(p_new_device_id) - 7, 1))),
            v_license.type,
            v_license.is_active,
            v_license.expires_at
        );
    end if;

    return jsonb_build_object('success', true, 'code', 'REBOUND');
end;
$$;

revoke all on function public.claim_license_to_device_id(text, text) from public;
grant execute on function public.claim_license_to_device_id(text, text) to anon, authenticated;

commit;
