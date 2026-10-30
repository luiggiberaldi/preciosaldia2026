-- Ventas remotas: avances de efectivo (supervisor.sale.create, payload v1).
--
-- Reemplaza SOLO public.is_valid_supervisor_sale_payload(jsonb), espejo de
-- validateRemoteSalePayload (src/services/supervisorSaleCommand.js):
--   * `cashAdvances` opcional: 0 a 5 avances {currency BS|USD, montoEfectivo > 0,
--     comisionPct 0..100}.
--   * `items` puede venir vacío si la venta trae al menos un avance.
-- El RPC create_supervisor_command y el trigger enforce_supervisor_income_command
-- (20261029) ya llaman a esta función: no cambian.
--
-- Compatible hacia atrás: una venta sin `cashAdvances` se valida igual que antes.
-- Si la caja tiene los avances desactivados, la caja rechaza la venta
-- (CASH_ADVANCE_DISABLED); el servidor solo valida FORMA.
--
-- Idempotente: CREATE OR REPLACE. Requiere 20261029.

BEGIN;

CREATE OR REPLACE FUNCTION public.is_valid_supervisor_sale_payload(p_payload JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, extensions
AS $$
DECLARE
    v_item JSONB;
    v_payment JSONB;
    v_advance JSONB;
    v_num NUMERIC;
    v_advances INTEGER := 0;
BEGIN
    IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN RETURN FALSE; END IF;
    IF coalesce(p_payload->>'v', '') <> '1' THEN RETURN FALSE; END IF;
    IF coalesce(p_payload->>'saleId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
        RETURN FALSE;
    END IF;

    IF trim(coalesce(p_payload->'seller'->>'name', '')) = '' THEN RETURN FALSE; END IF;
    IF length(p_payload->'seller'->>'name') > 60 THEN RETURN FALSE; END IF;

    -- Avances de efectivo: opcionales, 0 a 5.
    IF p_payload ? 'cashAdvances' THEN
        IF jsonb_typeof(p_payload->'cashAdvances') IS DISTINCT FROM 'array' THEN RETURN FALSE; END IF;
        v_advances := jsonb_array_length(p_payload->'cashAdvances');
        IF v_advances > 5 THEN RETURN FALSE; END IF;
        FOR v_advance IN SELECT value FROM jsonb_array_elements(p_payload->'cashAdvances') LOOP
            IF jsonb_typeof(v_advance) IS DISTINCT FROM 'object' THEN RETURN FALSE; END IF;
            IF coalesce(v_advance->>'currency', '') NOT IN ('BS', 'USD') THEN RETURN FALSE; END IF;
            v_num := public.supervisor_json_number(v_advance->'montoEfectivo');
            IF v_num IS NULL OR v_num <= 0 THEN RETURN FALSE; END IF;
            IF v_advance->>'currency' = 'USD' AND v_num > 1000000 THEN RETURN FALSE; END IF;
            IF v_num > 100000000000 THEN RETURN FALSE; END IF;
            v_num := public.supervisor_json_number(v_advance->'comisionPct');
            IF v_num IS NULL OR v_num < 0 OR v_num > 100 THEN RETURN FALSE; END IF;
        END LOOP;
    END IF;

    -- Ítems: 0 a 100 (al menos 1 si no hay avances), sin ventas libres,
    -- cantidad (0, 100000], precio [0, 1000000].
    IF jsonb_typeof(p_payload->'items') IS DISTINCT FROM 'array' THEN RETURN FALSE; END IF;
    IF jsonb_array_length(p_payload->'items') > 100 THEN RETURN FALSE; END IF;
    IF jsonb_array_length(p_payload->'items') = 0 AND v_advances = 0 THEN RETURN FALSE; END IF;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_payload->'items') LOOP
        IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' THEN RETURN FALSE; END IF;
        IF coalesce(v_item->>'productId', '') = '' OR length(v_item->>'productId') > 128 THEN RETURN FALSE; END IF;
        IF left(v_item->>'productId', 7) = 'custom_' THEN RETURN FALSE; END IF;
        IF coalesce(v_item->>'mode', '') NOT IN ('package', 'unit') THEN RETURN FALSE; END IF;
        v_num := public.supervisor_json_number(v_item->'qty');
        IF v_num IS NULL OR v_num <= 0 OR v_num > 100000 THEN RETURN FALSE; END IF;
        v_num := public.supervisor_json_number(v_item->'priceUsdSeen');
        IF v_num IS NULL OR v_num < 0 OR v_num > 1000000 THEN RETURN FALSE; END IF;
    END LOOP;

    -- Pagos: 1 a 10, solo contado, moneda conocida y montos no negativos.
    IF jsonb_typeof(p_payload->'payments') IS DISTINCT FROM 'array' THEN RETURN FALSE; END IF;
    IF jsonb_array_length(p_payload->'payments') NOT BETWEEN 1 AND 10 THEN RETURN FALSE; END IF;
    FOR v_payment IN SELECT value FROM jsonb_array_elements(p_payload->'payments') LOOP
        IF jsonb_typeof(v_payment) IS DISTINCT FROM 'object' THEN RETURN FALSE; END IF;
        IF coalesce(v_payment->>'methodId', '') = '' THEN RETURN FALSE; END IF;
        IF (v_payment->>'methodId') IN ('saldo_favor', 'cashea', 'fiado') THEN RETURN FALSE; END IF;
        IF coalesce(v_payment->>'currency', '') NOT IN ('USD', 'BS', 'COP') THEN RETURN FALSE; END IF;
        v_num := public.supervisor_json_number(v_payment->'amountUsd');
        IF v_num IS NULL OR v_num < 0 OR v_num > 1000000 THEN RETURN FALSE; END IF;
        v_num := public.supervisor_json_number(v_payment->'amountBs');
        IF v_num IS NULL OR v_num < 0 THEN RETURN FALSE; END IF;
        v_num := public.supervisor_json_number(v_payment->'amountCop');
        IF v_num IS NULL OR v_num < 0 THEN RETURN FALSE; END IF;
    END LOOP;

    v_num := public.supervisor_json_number(p_payload->'totalsSeen'->'totalUsd');
    IF v_num IS NULL OR v_num <= 0.01 OR v_num > 1000000 THEN RETURN FALSE; END IF;
    RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.is_valid_supervisor_sale_payload(jsonb) FROM PUBLIC, anon, authenticated;

COMMIT;
