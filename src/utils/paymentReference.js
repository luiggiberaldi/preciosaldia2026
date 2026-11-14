/**
 * Referencia de un pago (últimos 4 dígitos), CASO-058.
 * La referencia se guarda en cada pago de la venta como `referencia`.
 */

/** Texto corto para mostrar junto al método: « · Ref. 1234» o '' si no hay. */
export function refSuffix(payment, sep = ' · ') {
    const ref = String(payment?.referencia || '').trim();
    return ref ? `${sep}Ref. ${ref}` : '';
}

/** Para líneas «Método: monto» (recibo y WhatsApp): « (Ref. 1234)» o ''. ERR-112. */
export function refParen(payment) {
    const ref = String(payment?.referencia || '').trim();
    return ref ? ` (Ref. ${ref})` : '';
}

/** ¿El pago tiene esta referencia? (búsqueda en el historial; sin mayúsculas ni espacios) */
export function paymentHasRef(payment, term) {
    const ref = String(payment?.referencia || '').trim().toLowerCase();
    const t = String(term || '').trim().toLowerCase();
    return Boolean(ref && t && ref.includes(t));
}

/**
 * Busca la misma referencia y método en otras ventas del mismo día.
 * Devuelve la primera venta que coincide, o null. Las anuladas no cuentan.
 * `sales`: ventas guardadas; `dayKey`: 'AAAA-MM-DD' local del día a revisar.
 */
export function findDuplicateRef(sales, methodId, referencia, dayKey) {
    const ref = String(referencia || '').trim().toUpperCase();
    if (!ref || !methodId || !Array.isArray(sales)) return null;
    for (const s of sales) {
        if (!s || s.status === 'ANULADA' || s.anulada) continue;
        const ts = s.timestamp || s.fecha || s.createdAt;
        if (!ts) continue;
        const d = new Date(ts);
        if (Number.isNaN(d.getTime())) continue;
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        if (key !== dayKey) continue;
        const hit = (s.payments || []).some(p => p.methodId === methodId && String(p.referencia || '').trim().toUpperCase() === ref);
        if (hit) return s;
    }
    return null;
}

/**
 * Siguiente referencia repetida que todavía no se avisó (ERR-110).
 * `metodos`: [{ id, nombre }] con monto; `avisadas`: Set de claves 'metodo|REF' ya avisadas.
 * Devuelve { metodo, ref, clave, previa } o null si no queda nada por avisar.
 * Así, con dos o más repetidas, se avisa cada una una vez y luego se cobra.
 */
export function nextDuplicateWarning(metodos, referencias, sales, dayKey, avisadas) {
    for (const m of Array.isArray(metodos) ? metodos : []) {
        const ref = String(referencias?.[m.id] || '').trim();
        if (ref.length < 4) continue;
        const clave = `${m.id}|${ref.toUpperCase()}`;
        if (avisadas?.has(clave)) continue;
        const previa = findDuplicateRef(sales, m.id, ref, dayKey);
        if (previa) return { metodo: m, ref, clave, previa };
    }
    return null;
}

/** 'AAAA-MM-DD' de la fecha local. */
export function localDayKey(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * Filas de «Referencias de pago» para el cierre: una por pago con referencia,
 * ordenadas por método y hora. Marca `repetida` si el mismo método y referencia
 * aparecen en más de un pago del grupo. Las ventas anuladas no cuentan.
 */
export function collectPaymentRefs(sales) {
    const rows = [];
    for (const s of Array.isArray(sales) ? sales : []) {
        if (!s || s.status === 'ANULADA') continue;
        for (const p of s.payments || []) {
            const ref = String(p.referencia || '').trim();
            if (!ref) continue;
            const ts = new Date(s.timestamp);
            rows.push({
                ts: ts.getTime() || 0,
                hora: Number.isNaN(ts.getTime()) ? '—' : ts.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' }),
                venta: s.saleNumber ? `#${String(s.saleNumber).padStart(7, '0')}` : `#${String(s.id || '').substring(0, 6).toUpperCase()}`,
                metodo: p.methodLabel || p.methodId || 'Pago',
                methodId: p.methodId,
                referencia: ref.toUpperCase(),
                moneda: p.currency === 'BS' ? 'BS' : p.currency === 'COP' ? 'COP' : 'USD',
                monto: p.currency === 'BS' ? (p.amountBs ?? p.amountInput ?? 0) : p.currency === 'COP' ? (p.amountInput ?? 0) : (p.amountUsd ?? 0),
            });
        }
    }
    const count = new Map();
    rows.forEach(r => { const k = `${r.methodId}|${r.referencia}`; count.set(k, (count.get(k) || 0) + 1); });
    rows.forEach(r => { r.repetida = count.get(`${r.methodId}|${r.referencia}`) > 1; });
    rows.sort((a, b) => (a.metodo.localeCompare(b.metodo, 'es')) || (a.ts - b.ts));
    return rows;
}
