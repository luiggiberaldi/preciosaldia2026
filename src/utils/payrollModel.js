/**
 * payrollModel.js — Nómina simple de Bodega: cálculos puros (sin leer ni escribir datos).
 *
 * Plan: docs/plans/2026-11-14-plan-nomina-simple-bodega.md (fase F1).
 * Es el ÚNICO contrato de datos de la nómina: la pantalla y el servicio usan estas
 * mismas funciones y nombres (así se evita el error E3 de Donde Juancho, donde la
 * pantalla mandaba `pagos` y el servicio esperaba `payments`).
 *
 * Analogía: cada empleado tiene una tarjeta (su ficha) y un sobre por periodo.
 * Cada renglón es un papelito dentro del sobre. El saldo NO se guarda: se cuenta
 * cada vez sumando los papelitos que no están tachados.
 *
 * @module utils/payrollModel
 */

import { round0, round2, mulR, divR, sumR, subR } from './dinero';
import { formatUsd } from './calculatorUtils';

// ─── Constantes ─────────────────────────────────────────────────────────────

export const EMPLOYEES_KEY = 'bodega_employees_v1';
export const PAYROLL_ENTRIES_KEY = 'bodega_payroll_entries_v1';

export const FRECUENCIAS = ['semanal', 'quincenal', 'mensual'];
export const FRECUENCIA_LABELS = { semanal: 'Semanal', quincenal: 'Quincenal', mensual: 'Mensual' };

export const ENTRY_TYPES = ['ADELANTO', 'PAGO', 'BONO', 'DESCUENTO', 'MERCANCIA'];
export const ENTRY_TYPE_LABELS = { ADELANTO: 'Adelanto', PAGO: 'Pago', BONO: 'Bono', DESCUENTO: 'Descuento', MERCANCIA: 'Mercancía' };
/** Tipos que sacan dinero (crean un movimiento de caja). */
export const MONEY_OUT_TYPES = new Set(['ADELANTO', 'PAGO']);
/** Tipos que bajan el saldo (si se pasan del saldo, la diferencia se arrastra). */
export const REDUCING_TYPES = new Set(['ADELANTO', 'PAGO', 'DESCUENTO', 'MERCANCIA']);
/** Mercancía que se lleva el empleado (F6): baja el stock y el saldo, no toca la gaveta. */
export const GOODS_TYPE = 'MERCANCIA';

/** Ajustes › Nómina: a qué precio se descuenta la mercancía (F6, decisión del dueño 15-11-2026). */
export const GOODS_VALUATION_KEY = 'payroll_goods_valuation';
export const GOODS_VALUATIONS = ['costo', 'venta'];
export const GOODS_VALUATION_LABELS = { costo: 'Precio de costo', venta: 'Precio de venta' };

export const PAYROLL_CATEGORY = 'nomina';
export const PAYROLL_CATEGORY_LABEL = 'Nómina';

/** Venezuela usa UTC−4 todo el año (sin horario de verano desde 2016). */
const CARACAS_OFFSET_MIN = -4 * 60;
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const pad = (n) => String(n).padStart(2, '0');

// ─── Fechas en hora de Caracas ──────────────────────────────────────────────

/** Día calendario en Caracas de un instante. Mes 1–12. */
export function caracasDate(instant = new Date()) {
    const d = new Date(new Date(instant).getTime() + CARACAS_OFFSET_MIN * 60000);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}

/** Medianoche en Caracas de una fecha calendario, como instante ISO (UTC). */
function caracasMidnightIso(y, m, d) {
    return new Date(Date.UTC(y, m - 1, d) - CARACAS_OFFSET_MIN * 60000).toISOString();
}

function lastDayOfMonth(y, m) {
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Semana ISO (lunes a domingo) de una fecha calendario. */
function isoWeekOf(y, m, d) {
    const date = new Date(Date.UTC(y, m - 1, d));
    const day = date.getUTCDay() || 7; // lunes=1 … domingo=7
    date.setUTCDate(date.getUTCDate() + 4 - day); // jueves de esa semana
    const weekYear = date.getUTCFullYear();
    const yearStart = new Date(Date.UTC(weekYear, 0, 1));
    const days = round0((date - yearStart) / 86400000); // días enteros desde el 1-ene (no es dinero)
    const week = (days - (days % 7)) / 7 + 1;
    return { weekYear, week };
}

/** Lunes de una semana ISO. */
function mondayOfIsoWeek(weekYear, week) {
    const jan4 = new Date(Date.UTC(weekYear, 0, 4));
    const day = jan4.getUTCDay() || 7;
    const monday = new Date(jan4);
    monday.setUTCDate(jan4.getUTCDate() - (day - 1) + (week - 1) * 7);
    return { y: monday.getUTCFullYear(), m: monday.getUTCMonth() + 1, d: monday.getUTCDate() };
}

function addDays({ y, m, d }, n) {
    const t = new Date(Date.UTC(y, m - 1, d + n));
    return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

// ─── Periodos ───────────────────────────────────────────────────────────────

export function isValidFrecuencia(f) {
    return FRECUENCIAS.includes(f);
}

/**
 * Id del periodo que contiene un instante:
 *  semanal `S-2026-W46` · quincenal `Q-2026-11-1` / `Q-2026-11-2` · mensual `M-2026-11`.
 */
export function periodIdFor(instant, frecuencia) {
    const { y, m, d } = caracasDate(instant);
    if (frecuencia === 'semanal') {
        const { weekYear, week } = isoWeekOf(y, m, d);
        return `S-${weekYear}-W${pad(week)}`;
    }
    if (frecuencia === 'quincenal') return `Q-${y}-${pad(m)}-${d <= 15 ? 1 : 2}`;
    if (frecuencia === 'mensual') return `M-${y}-${pad(m)}`;
    throw new Error(`Frecuencia no válida: ${frecuencia}`);
}

/** Desarma un id de periodo. Lanza si no es válido. */
export function parsePeriodId(periodoId) {
    const s = String(periodoId || '');
    let r = /^S-(\d{4})-W(\d{2})$/.exec(s);
    if (r) return { frecuencia: 'semanal', y: +r[1], week: +r[2] };
    r = /^Q-(\d{4})-(\d{2})-([12])$/.exec(s);
    if (r) return { frecuencia: 'quincenal', y: +r[1], m: +r[2], half: +r[3] };
    r = /^M-(\d{4})-(\d{2})$/.exec(s);
    if (r) return { frecuencia: 'mensual', y: +r[1], m: +r[2] };
    throw new Error(`Periodo no válido: ${periodoId}`);
}

/** Fechas calendario (Caracas) de inicio y del último día del periodo. */
function periodDays(periodoId) {
    const p = parsePeriodId(periodoId);
    if (p.frecuencia === 'semanal') {
        const start = mondayOfIsoWeek(p.y, p.week);
        return { start, last: addDays(start, 6), next: addDays(start, 7) };
    }
    if (p.frecuencia === 'quincenal') {
        if (p.half === 1) return { start: { y: p.y, m: p.m, d: 1 }, last: { y: p.y, m: p.m, d: 15 }, next: { y: p.y, m: p.m, d: 16 } };
        const last = { y: p.y, m: p.m, d: lastDayOfMonth(p.y, p.m) };
        return { start: { y: p.y, m: p.m, d: 16 }, last, next: addDays(last, 1) };
    }
    const last = { y: p.y, m: p.m, d: lastDayOfMonth(p.y, p.m) };
    return { start: { y: p.y, m: p.m, d: 1 }, last, next: addDays(last, 1) };
}

/** Intervalo `[inicio, fin)` del periodo, como instantes ISO (medianoche de Caracas). */
export function periodRange(periodoId) {
    const { start, next } = periodDays(periodoId);
    return { inicio: caracasMidnightIso(start.y, start.m, start.d), fin: caracasMidnightIso(next.y, next.m, next.d) };
}

export function nextPeriodId(periodoId) {
    const { frecuencia } = parsePeriodId(periodoId);
    return periodIdFor(periodRange(periodoId).fin, frecuencia);
}

export function previousPeriodId(periodoId) {
    const { frecuencia } = parsePeriodId(periodoId);
    return periodIdFor(new Date(new Date(periodRange(periodoId).inicio).getTime() - 1), frecuencia);
}

/** Texto para la pantalla: «Semana del 9 al 15 de noviembre de 2026», «1.ª quincena de noviembre de 2026»… */
export function periodLabel(periodoId) {
    const p = parsePeriodId(periodoId);
    const { start, last } = periodDays(periodoId);
    if (p.frecuencia === 'semanal') {
        const sameMonth = start.m === last.m;
        const from = sameMonth ? `${start.d}` : `${start.d} de ${MONTHS[start.m - 1]}`;
        return `Semana del ${from} al ${last.d} de ${MONTHS[last.m - 1]} de ${last.y}`;
    }
    if (p.frecuencia === 'quincenal') return `${p.half === 1 ? '1.ª' : '2.ª'} quincena de ${MONTHS[p.m - 1]} de ${p.y} (${start.d}–${last.d})`;
    return `${MONTHS[p.m - 1][0].toUpperCase()}${MONTHS[p.m - 1].slice(1)} de ${p.y}`;
}

// ─── Empleados ──────────────────────────────────────────────────────────────

/**
 * Valida y limpia los datos del formulario de empleado. Lanza Error en español.
 * @returns {{ nombre, cedula, cargo, telefono, sueldoUsd, frecuencia, fechaIngreso, nota }}
 */
export function normalizeEmployeeInput(input = {}) {
    const nombre = String(input.nombre ?? '').trim();
    if (!nombre) throw new Error('Escribe el nombre del empleado.');
    if (nombre.length > 80) throw new Error('El nombre es demasiado largo.');
    const sueldoUsd = round2(Number(input.sueldoUsd));
    if (!Number.isFinite(sueldoUsd) || sueldoUsd <= 0) throw new Error('El sueldo debe ser mayor que cero.');
    const frecuencia = input.frecuencia || 'quincenal';
    if (!isValidFrecuencia(frecuencia)) throw new Error('Elige si se paga semanal, quincenal o mensual.');
    const fechaIngreso = input.fechaIngreso ? String(input.fechaIngreso).slice(0, 10) : '';
    if (fechaIngreso && !/^\d{4}-\d{2}-\d{2}$/.test(fechaIngreso)) throw new Error('La fecha de ingreso no es válida.');
    return {
        nombre,
        cedula: String(input.cedula ?? '').trim().slice(0, 20),
        cargo: String(input.cargo ?? '').trim().slice(0, 40),
        telefono: String(input.telefono ?? '').trim().slice(0, 20),
        sueldoUsd,
        frecuencia,
        fechaIngreso,
        nota: String(input.nota ?? '').trim().slice(0, 200),
    };
}

// ─── Renglones y saldo ──────────────────────────────────────────────────────

export const isActiveEntry = (e) => e?.status === 'ACTIVO';

/** Renglones de un empleado en un periodo (cualquier estado), del más viejo al más nuevo. */
export function entriesFor(entries = [], employeeId, periodoId) {
    return entries
        .filter(e => e?.employeeId === employeeId && e?.periodoId === periodoId)
        .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
}

/**
 * Sueldo congelado del periodo: la «foto» del primer renglón (aunque luego se anulara).
 * Si el periodo aún no tiene renglones, vale el sueldo actual de la ficha.
 */
export function frozenSalaryUsd(entries, employee, periodoId) {
    const first = entriesFor(entries, employee?.id, periodoId).find(e => Number.isFinite(e.sueldoPeriodoUsd));
    return round2(first ? first.sueldoPeriodoUsd : (employee?.sueldoUsd || 0));
}

/**
 * Saldo del periodo. Se calcula, nunca se guarda.
 * saldo = sueldo + bonos − descuentos − mercancía − adelantos − pagos + lo que se arrastró al periodo siguiente.
 */
export function computePeriodBalance(entries = [], employee, periodoId) {
    const own = entriesFor(entries, employee?.id, periodoId);
    const active = own.filter(isActiveEntry);
    const sumOf = (tipo, pred = () => true) => sumR(...active.filter(e => e.tipo === tipo && pred(e)).map(e => e.montoUsd || 0));

    const sueldoPeriodoUsd = frozenSalaryUsd(entries, employee, periodoId);
    const bonosUsd = sumOf('BONO');
    const descuentosUsd = sumOf('DESCUENTO', e => e.origen !== 'ARRASTRE');
    const arrastreRecibidoUsd = sumOf('DESCUENTO', e => e.origen === 'ARRASTRE');
    const mercanciaUsd = sumOf(GOODS_TYPE);
    const adelantosUsd = sumOf('ADELANTO');
    const pagosUsd = sumOf('PAGO');
    const arrastreEnviadoUsd = sumR(...entries
        .filter(e => isActiveEntry(e) && e.employeeId === employee?.id && e.origen === 'ARRASTRE' && e.periodoOrigenId === periodoId)
        .map(e => e.montoUsd || 0));

    const saldoUsd = round2(
        sueldoPeriodoUsd + bonosUsd - descuentosUsd - mercanciaUsd - arrastreRecibidoUsd - adelantosUsd - pagosUsd + arrastreEnviadoUsd
    );
    const tienePago = active.some(e => e.tipo === 'PAGO');
    const estado = saldoUsd <= 0 && tienePago ? 'PAGADO' : (active.length > 0 ? 'EN_CURSO' : 'SIN_MOVIMIENTOS');

    return {
        periodoId,
        sueldoPeriodoUsd,
        bonosUsd,
        descuentosUsd,
        arrastreRecibidoUsd,
        mercanciaUsd,
        adelantosUsd,
        pagosUsd,
        arrastreEnviadoUsd,
        saldoUsd,
        estado,
        renglones: own,
    };
}

/** Saldo en Bs con la tasa dada (2 decimales). */
export function saldoEnBs(saldoUsd, tasa) {
    return mulR(Math.max(0, saldoUsd), tasa);
}

/** ¿Se puede cambiar la frecuencia? Solo si el periodo actual no tiene movimientos activos o ya está pagado. */
export function canChangeFrequency(entries, employee, now = new Date()) {
    const periodoId = periodIdFor(now, employee.frecuencia);
    const bal = computePeriodBalance(entries, employee, periodoId);
    if (bal.estado === 'EN_CURSO') {
        return { ok: false, reason: 'Para cambiar la frecuencia, primero paga el periodo en curso o anula sus movimientos.' };
    }
    return { ok: true };
}

/**
 * Valida un movimiento y calcula sus montos. NO lo guarda.
 *
 * Contrato de entrada (el mismo para la pantalla y el servicio):
 *   { employeeId, tipo, moneda: 'USD'|'BS', monto, metodoId?, nota?, idempotencyKey, confirmarExceso? }
 * La tasa NO la manda la pantalla: la pone el servicio (tasa de la tienda, decisión D2).
 *
 * @returns {{ montoUsd, montoBs, tasa, excedenteUsd, saleDeGaveta: boolean|null, saldoAntesUsd }}
 */
export function evaluateEntry({ input, balance, tasa, isCashMethod = () => false }) {
    const tipo = input?.tipo;
    if (!ENTRY_TYPES.includes(tipo)) throw new Error('Tipo de movimiento no válido.');
    if (tipo === GOODS_TYPE) throw new Error('La mercancía se registra con sus productos (evaluateGoods).');
    const moneda = input.moneda === 'BS' ? 'BS' : 'USD';
    const monto = Number(input.monto);
    if (!Number.isFinite(monto) || monto <= 0) throw new Error('Ingresa un monto mayor a cero.');
    if (!input.idempotencyKey) throw new Error('Falta la llave del movimiento. Cierra y abre el formulario.');
    if (MONEY_OUT_TYPES.has(tipo) && !input.metodoId) throw new Error('Elige cómo se paga.');

    const t = Number(tasa) || 0;
    if (moneda === 'BS' && !(t > 0)) throw new Error('No hay tasa del día para pagar en bolívares.');

    let montoUsd;
    let montoBs;
    const saldoAntesUsd = round2(balance?.saldoUsd || 0);
    if (moneda === 'USD') {
        montoUsd = round2(monto);
        montoBs = t > 0 ? mulR(montoUsd, t) : 0;
    } else {
        // Regla 9 del plan: se compara en Bs. Si paga exactamente el saldo en Bs,
        // el $ es exactamente el saldo (sin centavo fantasma por la división).
        montoBs = round2(monto);
        const saldoBs = mulR(Math.max(0, saldoAntesUsd), t);
        montoUsd = Math.abs(subR(montoBs, saldoBs)) < 0.01 && saldoAntesUsd > 0 ? saldoAntesUsd : divR(montoBs, t);
    }
    if (!(montoUsd > 0)) throw new Error('El monto es demasiado pequeño.');

    let excedenteUsd = 0;
    if (REDUCING_TYPES.has(tipo)) {
        if (moneda === 'BS') {
            const saldoBs = mulR(Math.max(0, saldoAntesUsd), t);
            excedenteUsd = montoBs > saldoBs + 0.005 ? round2(Math.max(0, subR(montoUsd, Math.max(0, saldoAntesUsd)))) : 0;
        } else {
            excedenteUsd = round2(Math.max(0, subR(montoUsd, Math.max(0, saldoAntesUsd))));
        }
    }
    if (excedenteUsd > 0 && input.confirmarExceso !== true) {
        const err = new Error(`Se pasa del saldo por $${formatUsd(excedenteUsd)}. Confirma para que quede debiendo esa diferencia en el próximo periodo.`);
        err.code = 'EXCEDE_SALDO';
        err.excedenteUsd = excedenteUsd;
        throw err;
    }

    return {
        montoUsd,
        montoBs,
        tasa: t > 0 ? t : null,
        excedenteUsd,
        // ¿Salen billetes de la gaveta? (efectivo sí; pago móvil o transferencia no).
        saleDeGaveta: MONEY_OUT_TYPES.has(tipo) ? isCashMethod(input.metodoId) : null,
        saldoAntesUsd,
    };
}

/** Texto corto del movimiento de caja: «Adelanto: María Pérez (Q-2026-11-2)». */
export function payrollMovementDescription(tipo, employee, periodoId) {
    return `${ENTRY_TYPE_LABELS[tipo] || tipo}: ${employee?.nombre || 'Empleado'} (${periodoId})`;
}

/** ¿Se puede anular este renglón? `isInOpenShift(movimiento)` lo decide la caja. */
export function canVoidEntry(entry, { entries = [], employee, movement = null, isInOpenShift = () => false } = {}) {
    if (!entry) return { ok: false, reason: 'No se encontró el movimiento.' };
    if (entry.status !== 'ACTIVO') return { ok: false, reason: 'El movimiento ya estaba anulado.' };
    if (entry.origen === 'ARRASTRE') return { ok: false, reason: 'La deuda arrastrada se quita anulando el movimiento que la causó.' };
    if (MONEY_OUT_TYPES.has(entry.tipo)) {
        if (movement && movement.status !== 'ANULADA' && !isInOpenShift(movement)) {
            return { ok: false, reason: 'Ese dinero salió en una caja ya cerrada. Para corregirlo, registra un bono o un descuento.' };
        }
        return { ok: true };
    }
    if (entry.tipo === GOODS_TYPE && movement && movement.status !== 'ANULADA' && !isInOpenShift(movement)) {
        return { ok: false, reason: 'Esa mercancía salió en una caja ya cerrada. Para corregirlo, registra un bono o un descuento.' };
    }
    const bal = computePeriodBalance(entries, employee, entry.periodoId);
    if (bal.estado === 'PAGADO') return { ok: false, reason: 'El periodo ya está pagado. Para corregirlo, registra un bono o un descuento en el periodo actual.' };
    return { ok: true };
}

// ─── Mercancía del empleado (F6) ────────────────────────────────────────────

/** Valoración elegida en Ajustes; si no hay o es rara, «costo». */
export function readGoodsValuation(store = globalThis.localStorage) {
    try {
        const v = store?.getItem?.(GOODS_VALUATION_KEY);
        return GOODS_VALUATIONS.includes(v) ? v : 'costo';
    } catch {
        return 'costo';
    }
}

/** Precio unitario en $ de un producto según la valoración. */
export function goodsUnitPriceUsd(product, valuation) {
    return round2(Number(valuation === 'venta' ? product?.priceUsd : product?.costUsd) || 0);
}

/**
 * Valida la mercancía y calcula su monto con los productos FRESCOS. NO guarda.
 *
 * Contrato de entrada:
 *   { employeeId, tipo: 'MERCANCIA', items: [{ id, qty }], nota?, idempotencyKey, confirmarExceso? }
 * El precio lo pone el servicio con la valoración de Ajustes, nunca la pantalla.
 *
 * @returns {{ items, montoUsd, montoBs, tasa, excedenteUsd, saldoAntesUsd, valoracion }}
 */
export function evaluateGoods({ input, products = [], balance, tasa, valuation = 'costo', allowNegative = false }) {
    if (input?.tipo !== GOODS_TYPE) throw new Error('Tipo de movimiento no válido.');
    if (!input.idempotencyKey) throw new Error('Falta la llave del movimiento. Cierra y abre el formulario.');
    const valoracion = GOODS_VALUATIONS.includes(valuation) ? valuation : 'costo';
    const raw = Array.isArray(input.items) ? input.items : [];
    if (raw.length === 0) throw new Error('Elige al menos un producto.');

    const byId = new Map(products.map(p => [p?.id, p]));
    const seen = new Set();
    const items = raw.map(({ id, qty }) => {
        if (seen.has(id)) throw new Error('Un producto está repetido en la lista.');
        seen.add(id);
        const product = byId.get(id);
        if (!product) throw new Error('Un producto de la lista ya no existe en el inventario.');
        const q = Number(qty);
        if (!Number.isFinite(q) || q <= 0) throw new Error(`Cantidad no válida para ${product.name}.`);
        const stock = Number(product.stock) || 0;
        if (!allowNegative && q > stock + 1e-9) throw new Error(`No hay suficiente ${product.name}: quedan ${stock}.`);
        const unitUsd = goodsUnitPriceUsd(product, valoracion);
        if (!(unitUsd > 0)) {
            throw new Error(`${product.name} no tiene ${valoracion === 'venta' ? 'precio de venta' : 'costo'} cargado. Cárgalo en Inventario o cambia la opción en Ajustes.`);
        }
        return {
            id: product.id,
            name: product.name,
            qty: q,
            unitUsd,
            subtotalUsd: mulR(unitUsd, q),
            costUsd: round2(Number(product.costUsd) || 0),
            priceUsd: round2(Number(product.priceUsd) || 0),
        };
    });

    const montoUsd = sumR(...items.map(i => i.subtotalUsd));
    if (!(montoUsd > 0)) throw new Error('El monto es demasiado pequeño.');
    const t = Number(tasa) || 0;
    const saldoAntesUsd = round2(balance?.saldoUsd || 0);
    const excedenteUsd = round2(Math.max(0, subR(montoUsd, Math.max(0, saldoAntesUsd))));
    if (excedenteUsd > 0 && input.confirmarExceso !== true) {
        const err = new Error(`Se pasa del saldo por $${formatUsd(excedenteUsd)}. Confirma para que quede debiendo esa diferencia en el próximo periodo.`);
        err.code = 'EXCEDE_SALDO';
        err.excedenteUsd = excedenteUsd;
        throw err;
    }
    return {
        items,
        montoUsd,
        montoBs: t > 0 ? mulR(montoUsd, t) : 0,
        tasa: t > 0 ? t : null,
        excedenteUsd,
        saldoAntesUsd,
        valoracion,
    };
}

/** Texto corto de los productos: «2 × Harina PAN, 1 × Aceite y 3 más». */
export function goodsSummary(items = [], max = 3) {
    const parts = items.slice(0, max).map(i => `${i.qty} × ${i.name}`);
    const text = parts.join(', ');
    return items.length > max ? `${text} y ${items.length - max} más` : text;
}
