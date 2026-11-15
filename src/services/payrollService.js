/**
 * payrollService.js — Nómina simple de Bodega: el «motor» que guarda.
 *
 * Plan: docs/plans/2026-11-14-plan-nomina-simple-bodega.md (fase F2).
 *
 * Barandas (cada una evita un error visto en Donde Juancho):
 *  - Todo bajo `pos_write_lock` y con lectura FRESCA de las listas COMPLETAS (E1:
 *    allá se guardaba una lista filtrada encima de la completa y se borraban
 *    los consumos de los demás empleados).
 *  - Anular = marcar `ANULADO` el renglón y `ANULADA` su movimiento de caja; nunca
 *    un movimiento al revés (E2: allá la reversa restaba la plata otra vez).
 *  - Un solo contrato de datos (utils/payrollModel.evaluateEntry) y la tasa la
 *    pone este servicio (E3).
 *  - PIN de Administrador siempre, aunque `requireLogin` esté apagado (E4).
 *  - Idempotencia: la misma llave nunca crea dos pagos (doble clic).
 *  - Recuperación: si se cortó la luz entre el movimiento de caja y el renglón,
 *    `recoverPayroll` deja las dos listas de acuerdo.
 *
 * @module services/payrollService
 */

import { storageService } from '../utils/storageService';
import { withLock } from '../utils/withLock';
import { writeVerifiedValue } from '../utils/verifiedWrite';
import { findOpenCashShift, isRecordInOpenCashShift } from '../utils/cashShift';
import { buildGastoInternoRecord, isCashMethodId } from '../utils/gastoInterno';
import { SALES_KEY, PRODUCTS_KEY, POS_LOCK, appendSalesRecordsUnlocked, confirmSalesRecords } from './gastosInternosService';
import { isGranelProduct, adjustStockValue } from '../utils/granel';
import {
    EMPLOYEES_KEY, PAYROLL_ENTRIES_KEY, PAYROLL_CATEGORY, MONEY_OUT_TYPES, ENTRY_TYPE_LABELS, GOODS_TYPE,
    normalizeEmployeeInput, periodIdFor, nextPeriodId, computePeriodBalance, frozenSalaryUsd,
    evaluateEntry, evaluateGoods, readGoodsValuation, goodsSummary, canVoidEntry, payrollMovementDescription,
} from '../utils/payrollModel';

const newId = (prefix) => `${prefix}_${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;

const asList = (v) => (Array.isArray(v) ? v : []);
const actorName = (u) => u?.nombre || 'Administrador';

function defaults(ctx = {}) {
    return {
        storage: ctx.storage || storageService,
        lock: ctx.lock || withLock,
        now: ctx.now || (() => new Date()),
        authorize: ctx.authorize,
        pin: ctx.pin,
        getRate: ctx.getRate || (() => 0),
        audit: ctx.audit || (() => {}),
        newId: ctx.newId || newId,
        getValuation: ctx.getValuation || (() => readGoodsValuation()),
        allowNegative: ctx.allowNegative || (() => {
            try { return globalThis.localStorage?.getItem('allow_negative_stock') === 'true'; } catch { return false; }
        }),
    };
}

/** Mueve el stock de los productos de la lista: `sign` −1 retira, +1 devuelve. */
function applyStock(products, items, sign, allowNegative) {
    const byId = new Map(items.map(i => [i.id, i]));
    return products.map(p => {
        const item = byId.get(p?.id);
        if (!item) return p;
        const next = adjustStockValue(p.stock ?? 0, sign * item.qty, isGranelProduct(p));
        return { ...p, stock: sign < 0 && !allowNegative ? Math.max(0, next) : next };
    });
}

/** Renglón de deuda que pasa al periodo siguiente cuando un movimiento se pasa del saldo. */
function buildArrastre({ c, employee, entries, periodoId, entryId, excedenteUsd, admin, nowIso, idempotencyKey }) {
    const siguiente = nextPeriodId(periodoId);
    return {
        id: c.newId('nom'),
        employeeId: employee.id,
        periodoId: siguiente,
        periodoOrigenId: periodoId,
        arrastreDe: entryId,
        sueldoPeriodoUsd: frozenSalaryUsd(entries, employee, siguiente),
        tipo: 'DESCUENTO',
        origen: 'ARRASTRE',
        montoUsd: excedenteUsd,
        moneda: 'USD',
        montoBs: null,
        tasa: null,
        metodoId: null,
        saleDeGaveta: null,
        movimientoCajaId: null,
        nota: `Deuda del periodo ${periodoId}`,
        status: 'ACTIVO',
        actor: actorName(admin),
        actorId: admin?.id ?? null,
        timestamp: nowIso,
        idempotencyKey: `${idempotencyKey}:arrastre`,
    };
}

/**
 * Pide el PIN de Administrador. Sin función de autorización, no se deja pasar.
 * @returns {Promise<object>} el usuario Administrador que autorizó.
 */
async function requireAdmin({ authorize, pin }) {
    if (typeof authorize !== 'function') throw new Error('Falta la autorización del Administrador.');
    const res = await authorize(String(pin ?? ''));
    if (!res?.success) throw new Error(res?.error || 'PIN de administrador incorrecto.');
    return res.user || { nombre: 'Administrador' };
}

async function readAll(storage) {
    const [employees, entries, sales] = await Promise.all([
        storage.getItem(EMPLOYEES_KEY, []),
        storage.getItem(PAYROLL_ENTRIES_KEY, []),
        storage.getItem(SALES_KEY, []),
    ]);
    return { employees: asList(employees), entries: asList(entries), sales: asList(sales) };
}

/** Una caja está «abierta» para un movimiento si no se cerró y es del turno actual. */
export function makeIsInOpenShift(sales) {
    const opening = findOpenCashShift(sales);
    return (movement) => {
        if (!movement || movement.cajaCerrada === true) return false;
        return opening ? isRecordInOpenCashShift(movement, opening) : true;
    };
}

// ─── Lectura ────────────────────────────────────────────────────────────────

export async function loadPayroll(ctx = {}) {
    const { storage } = defaults(ctx);
    const { employees, entries } = await readAll(storage);
    return { employees, entries };
}

// ─── Empleados ──────────────────────────────────────────────────────────────

/**
 * Crea o edita un empleado (pide PIN). El sueldo nuevo vale desde el próximo
 * periodo (el en curso tiene su foto). La frecuencia solo cambia con el periodo
 * en curso vacío o pagado.
 */
export async function saveEmployee(input, ctx = {}) {
    const c = defaults(ctx);
    const clean = normalizeEmployeeInput(input);
    const admin = await requireAdmin(c);

    return c.lock(POS_LOCK, async () => {
        const { employees, entries } = await readAll(c.storage);
        const nowIso = c.now().toISOString();
        let saved;
        let next;
        if (input.id) {
            const prev = employees.find(e => e.id === input.id);
            if (!prev) throw new Error('No se encontró el empleado.');
            if (prev.frecuencia !== clean.frecuencia) {
                const bal = computePeriodBalance(entries, prev, periodIdFor(c.now(), prev.frecuencia));
                if (bal.estado === 'EN_CURSO') {
                    throw new Error('Para cambiar la frecuencia, primero paga el periodo en curso o anula sus movimientos.');
                }
            }
            saved = { ...prev, ...clean, actualizadoAt: nowIso, actualizadoPor: actorName(admin) };
            next = employees.map(e => (e.id === saved.id ? saved : e));
        } else {
            const dup = employees.find(e => e.activo !== false && clean.cedula && e.cedula === clean.cedula);
            if (dup) throw new Error(`Ya hay un empleado activo con la cédula ${clean.cedula}.`);
            saved = {
                id: c.newId('emp'),
                ...clean,
                fechaIngreso: clean.fechaIngreso || nowIso.slice(0, 10),
                activo: true,
                creadoPor: actorName(admin),
                creadoAt: nowIso,
                actualizadoAt: nowIso,
            };
            next = [...employees, saved];
        }
        await writeVerifiedValue(c.storage, EMPLOYEES_KEY, next);
        c.audit('NOMINA', input.id ? 'EMPLEADO_EDITADO' : 'EMPLEADO_CREADO',
            `${saved.nombre}: sueldo $${saved.sueldoUsd.toFixed(2)} ${saved.frecuencia}`);
        return saved;
    });
}

/** Activa o desactiva (nunca borra: el historial se conserva). */
export async function setEmployeeActive(employeeId, activo, ctx = {}) {
    const c = defaults(ctx);
    const admin = await requireAdmin(c);
    return c.lock(POS_LOCK, async () => {
        const { employees } = await readAll(c.storage);
        const prev = employees.find(e => e.id === employeeId);
        if (!prev) throw new Error('No se encontró el empleado.');
        const saved = { ...prev, activo: !!activo, actualizadoAt: c.now().toISOString(), actualizadoPor: actorName(admin) };
        await writeVerifiedValue(c.storage, EMPLOYEES_KEY, employees.map(e => (e.id === employeeId ? saved : e)));
        c.audit('NOMINA', activo ? 'EMPLEADO_ACTIVADO' : 'EMPLEADO_DESACTIVADO', saved.nombre);
        return saved;
    });
}

// ─── Movimientos ────────────────────────────────────────────────────────────

/**
 * Registra un adelanto, pago, bono o descuento (pide PIN).
 * `input` sigue el contrato de `evaluateEntry`.
 *
 * @returns {Promise<{ entry, movement: object|null, arrastre: object|null, duplicate: boolean, sales: Array|null }>}
 */
export async function registerEntry(input, ctx = {}) {
    const c = defaults(ctx);
    const admin = await requireAdmin(c);

    return c.lock(POS_LOCK, async () => {
        const { employees, entries } = await readAll(c.storage);

        // Idempotencia: la misma llave devuelve lo ya hecho.
        const existing = entries.find(e => e.idempotencyKey && e.idempotencyKey === input?.idempotencyKey);
        if (existing) return { entry: existing, movement: null, arrastre: null, duplicate: true, sales: null };

        const employee = employees.find(e => e.id === input?.employeeId);
        if (!employee) throw new Error('No se encontró el empleado.');
        if (employee.activo === false) throw new Error('El empleado está desactivado.');

        const now = c.now();
        const nowIso = now.toISOString();
        const periodoId = periodIdFor(now, employee.frecuencia);
        const balance = computePeriodBalance(entries, employee, periodoId);
        const tasa = Number(c.getRate()) || 0;
        const ev = evaluateEntry({ input, balance, tasa, isCashMethod: isCashMethodId });

        const entryId = c.newId('nom');
        const sueldoPeriodoUsd = frozenSalaryUsd(entries, employee, periodoId);
        const isMoneyOut = MONEY_OUT_TYPES.has(input.tipo);
        const moneda = input.moneda === 'BS' ? 'BS' : 'USD';

        let movement = null;
        let sales = null;
        if (isMoneyOut) {
            movement = buildGastoInternoRecord({
                id: c.newId('gasto_nom'),
                description: payrollMovementDescription(input.tipo, employee, periodoId),
                category: PAYROLL_CATEGORY,
                amountUsd: ev.montoUsd,
                amountBs: ev.montoBs,
                methodId: input.metodoId,
                currency: moneda,
                note: input.nota,
                bcvRate: tasa,
                usuario: admin,
                // Como todo gasto de Bodega: el cierre lo cuenta siempre y el MÉTODO
                // decide si baja la gaveta (efectivo) o no (pago móvil). Así el pago
                // digital también sale en el cierre (evita E8 de Donde Juancho).
                afectaCaja: true,
                now,
                extra: {
                    isPayroll: true,
                    payrollEntryId: entryId,
                    employeeId: employee.id,
                    periodoId,
                    methodLabel: 'Nómina',
                    itemPrefix: 'Nómina',
                },
            });
            // El $ del movimiento es exactamente el del renglón (en Bs, la división
            // podría diferir un centavo del saldo pagado completo).
            movement.totalUsd = -ev.montoUsd;
            movement.items[0].priceUsd = -ev.montoUsd;
            if (moneda === 'USD') movement.payments[0].amountUsd = -ev.montoUsd;
            // 1.º el dinero (exige caja abierta si es efectivo y confirma la escritura).
            sales = await appendSalesRecordsUnlocked(c.storage, [movement]);
        }

        const entry = {
            id: entryId,
            employeeId: employee.id,
            periodoId,
            sueldoPeriodoUsd,
            tipo: input.tipo,
            origen: 'MANUAL',
            montoUsd: ev.montoUsd,
            moneda,
            montoBs: ev.montoBs,
            tasa: ev.tasa,
            metodoId: isMoneyOut ? input.metodoId : null,
            saleDeGaveta: isMoneyOut ? ev.saleDeGaveta : null,
            movimientoCajaId: movement?.id || null,
            nota: String(input.nota ?? '').trim().slice(0, 200),
            saldoAntesUsd: ev.saldoAntesUsd,
            status: 'ACTIVO',
            actor: actorName(admin),
            actorId: admin?.id ?? null,
            timestamp: nowIso,
            idempotencyKey: input.idempotencyKey,
        };

        let arrastre = null;
        const nuevos = [entry];
        if (ev.excedenteUsd > 0) {
            arrastre = buildArrastre({
                c, employee, entries, periodoId, entryId, excedenteUsd: ev.excedenteUsd, admin, nowIso,
                idempotencyKey: input.idempotencyKey,
            });
            nuevos.push(arrastre);
        }

        // 2.º el renglón, sobre la lista COMPLETA y fresca.
        try {
            await writeVerifiedValue(c.storage, PAYROLL_ENTRIES_KEY, [...entries, ...nuevos]);
        } catch (err) {
            // Vuelta atrás inmediata: el dinero no puede quedar sin su renglón.
            if (movement) {
                try {
                    const fresh = asList(await c.storage.getItem(SALES_KEY, []));
                    await c.storage.setItem(SALES_KEY, fresh.map(s => (s.id === movement.id
                        ? { ...s, status: 'ANULADA', voidedAt: nowIso, voidedBy: 'Vuelta atrás automática' } : s)));
                } catch { /* recoverPayroll lo arregla al abrir Nómina */ }
            }
            throw new Error('No se pudo guardar el movimiento de nómina. No se registró nada; intenta de nuevo.', { cause: err });
        }

        c.audit('NOMINA', input.tipo,
            `${ENTRY_TYPE_LABELS[input.tipo]} a ${employee.nombre} (${periodoId}): $${ev.montoUsd.toFixed(2)}`
            + (moneda === 'BS' ? ` (Bs ${ev.montoBs.toFixed(2)} a ${ev.tasa})` : '')
            + (arrastre ? ` · queda debiendo $${arrastre.montoUsd.toFixed(2)}` : ''));

        return { entry, movement, arrastre, duplicate: false, sales };
    });
}

/**
 * Registra la mercancía que se lleva un empleado (F6, pide PIN): baja el stock,
 * deja un retiro de inventario en las ventas (no toca la gaveta) y un renglón
 * que resta del saldo. El precio sale de Ajustes › Nómina (costo o venta).
 *
 * Orden de escritura, igual que un adelanto: 1.º stock + movimiento, 2.º renglón.
 * Si el renglón no se pudo guardar, se devuelve el stock y se anula el movimiento.
 *
 * @returns {Promise<{ entry, movement, arrastre, duplicate: boolean, sales: Array|null }>}
 */
export async function registerGoods(input, ctx = {}) {
    const c = defaults(ctx);
    const admin = await requireAdmin(c);

    return c.lock(POS_LOCK, async () => {
        const { employees, entries } = await readAll(c.storage);

        const existing = entries.find(e => e.idempotencyKey && e.idempotencyKey === input?.idempotencyKey);
        if (existing) return { entry: existing, movement: null, arrastre: null, duplicate: true, sales: null };

        const employee = employees.find(e => e.id === input?.employeeId);
        if (!employee) throw new Error('No se encontró el empleado.');
        if (employee.activo === false) throw new Error('El empleado está desactivado.');

        const now = c.now();
        const nowIso = now.toISOString();
        const periodoId = periodIdFor(now, employee.frecuencia);
        const balance = computePeriodBalance(entries, employee, periodoId);
        const tasa = Number(c.getRate()) || 0;
        const allowNegative = !!c.allowNegative();
        const products = asList(await c.storage.getItem(PRODUCTS_KEY, []));
        const ev = evaluateGoods({ input, products, balance, tasa, valuation: c.getValuation(), allowNegative });

        const entryId = c.newId('nom');
        const resumen = goodsSummary(ev.items);
        const nota = String(input.nota ?? '').trim().slice(0, 200);
        const movement = {
            id: c.newId('gasto_nom'),
            timestamp: nowIso,
            tipo: 'GASTO_INTERNO',
            category: PAYROLL_CATEGORY,
            // Es un retiro de inventario: el cierre lo muestra con los retiros y la
            // gaveta no lo cuenta (no salió dinero).
            isAutoconsumo: true,
            isPayroll: true,
            payrollEntryId: entryId,
            employeeId: employee.id,
            periodoId,
            afectaCaja: false,
            cajaCerrada: false,
            valoracion: ev.valoracion,
            description: `${payrollMovementDescription(GOODS_TYPE, employee, periodoId)}: ${resumen}`.slice(0, 200),
            note: nota,
            totalUsd: -ev.montoUsd,
            totalBs: -ev.montoBs,
            paymentMethod: 'autoconsumo',
            payments: [{ methodId: 'autoconsumo', amountUsd: -ev.montoUsd, amountBs: -ev.montoBs, currency: 'USD', methodLabel: 'Mercancía de nómina' }],
            items: ev.items.map(i => ({ id: i.id, name: i.name, qty: i.qty, costUsd: i.costUsd, priceUsd: i.priceUsd })),
            actor: actorName(admin),
            actorId: admin?.id ?? null,
        };

        // 1.º stock y movimiento (lectura fresca de productos dentro del candado).
        await c.storage.setItem(PRODUCTS_KEY, applyStock(products, ev.items, -1, allowNegative));
        let sales;
        try {
            sales = await appendSalesRecordsUnlocked(c.storage, [movement]);
        } catch (err) {
            const fresh = asList(await c.storage.getItem(PRODUCTS_KEY, []));
            await c.storage.setItem(PRODUCTS_KEY, applyStock(fresh, ev.items, +1, true));
            throw err;
        }

        const entry = {
            id: entryId,
            employeeId: employee.id,
            periodoId,
            sueldoPeriodoUsd: frozenSalaryUsd(entries, employee, periodoId),
            tipo: GOODS_TYPE,
            origen: 'MANUAL',
            montoUsd: ev.montoUsd,
            moneda: 'USD',
            montoBs: ev.montoBs,
            tasa: ev.tasa,
            metodoId: null,
            saleDeGaveta: false,
            movimientoCajaId: movement.id,
            valoracion: ev.valoracion,
            items: ev.items.map(i => ({ id: i.id, name: i.name, qty: i.qty, unitUsd: i.unitUsd, subtotalUsd: i.subtotalUsd })),
            nota,
            saldoAntesUsd: ev.saldoAntesUsd,
            status: 'ACTIVO',
            actor: actorName(admin),
            actorId: admin?.id ?? null,
            timestamp: nowIso,
            idempotencyKey: input.idempotencyKey,
        };
        const arrastre = ev.excedenteUsd > 0
            ? buildArrastre({ c, employee, entries, periodoId, entryId, excedenteUsd: ev.excedenteUsd, admin, nowIso, idempotencyKey: input.idempotencyKey })
            : null;

        // 2.º el renglón, sobre la lista COMPLETA y fresca.
        try {
            await writeVerifiedValue(c.storage, PAYROLL_ENTRIES_KEY, [...entries, entry, ...(arrastre ? [arrastre] : [])]);
        } catch (err) {
            try {
                const freshProducts = asList(await c.storage.getItem(PRODUCTS_KEY, []));
                await c.storage.setItem(PRODUCTS_KEY, applyStock(freshProducts, ev.items, +1, true));
                const freshSales = asList(await c.storage.getItem(SALES_KEY, []));
                await c.storage.setItem(SALES_KEY, freshSales.map(s => (s.id === movement.id
                    ? { ...s, status: 'ANULADA', voidedAt: nowIso, voidedBy: 'Vuelta atrás automática', stockDevuelto: true } : s)));
            } catch { /* recoverPayroll lo arregla al abrir Nómina */ }
            throw new Error('No se pudo guardar la mercancía del empleado. No se registró nada; intenta de nuevo.', { cause: err });
        }

        c.audit('NOMINA', GOODS_TYPE,
            `Mercancía a ${employee.nombre} (${periodoId}), a ${ev.valoracion}: $${ev.montoUsd.toFixed(2)} · ${resumen}`
            + (arrastre ? ` · queda debiendo $${arrastre.montoUsd.toFixed(2)}` : ''));

        return { entry, movement, arrastre, duplicate: false, sales };
    });
}

/**
 * Anula un movimiento (pide PIN). Marca el renglón, su deuda arrastrada y su
 * movimiento de caja. Solo dinero del turno abierto (decisión D5). Si era
 * mercancía, devuelve el stock.
 */
export async function voidEntry(entryId, ctx = {}) {
    const c = defaults(ctx);
    const admin = await requireAdmin(c);

    return c.lock(POS_LOCK, async () => {
        const { employees, entries, sales } = await readAll(c.storage);
        const entry = entries.find(e => e.id === entryId);
        const employee = employees.find(e => e.id === entry?.employeeId);
        const movement = entry?.movimientoCajaId ? sales.find(s => s.id === entry.movimientoCajaId) : null;
        const check = canVoidEntry(entry, { entries, employee, movement, isInOpenShift: makeIsInOpenShift(sales) });
        if (!check.ok) throw new Error(check.reason);

        const nowIso = c.now().toISOString();
        const stamp = { anuladoPor: actorName(admin), anuladoPorId: admin?.id ?? null, anuladoAt: nowIso };

        let updatedSales = null;
        if (movement && movement.status !== 'ANULADA') {
            const isGoods = entry.tipo === GOODS_TYPE && Array.isArray(movement.items);
            if (isGoods) {
                // La mercancía vuelve al inventario (lectura fresca, dentro del candado).
                const freshProducts = asList(await c.storage.getItem(PRODUCTS_KEY, []));
                await c.storage.setItem(PRODUCTS_KEY, applyStock(freshProducts, movement.items, +1, true));
            }
            const voidedMov = {
                ...movement, status: 'ANULADA', voidedAt: nowIso, voidedBy: actorName(admin), voidedById: admin?.id ?? null,
                ...(isGoods ? { stockDevuelto: true } : {}),
            };
            updatedSales = sales.map(s => (s.id === movement.id ? voidedMov : s));
            await c.storage.setItem(SALES_KEY, updatedSales);
            await confirmSalesRecords(c.storage, [voidedMov]);
        }

        const next = entries.map(e => {
            if (e.id === entryId || (e.arrastreDe === entryId && e.status === 'ACTIVO')) {
                return { ...e, status: 'ANULADO', ...stamp };
            }
            return e;
        });
        await writeVerifiedValue(c.storage, PAYROLL_ENTRIES_KEY, next);
        c.audit('NOMINA', 'ANULAR', `${ENTRY_TYPE_LABELS[entry.tipo]} de ${employee?.nombre || '?'} (${entry.periodoId}): $${entry.montoUsd.toFixed(2)}`);
        return { entry: next.find(e => e.id === entryId), sales: updatedSales };
    });
}

/**
 * Deja de acuerdo las dos listas después de un corte (no pide PIN: no mueve dinero nuevo).
 *  - Movimiento de nómina sin renglón → se marca `ANULADA` (la operación no terminó).
 *  - Renglón de dinero cuyo movimiento no existe → se marca `ANULADO`.
 * @returns {Promise<{ movimientosAnulados: number, renglonesAnulados: number }>}
 */
export async function recoverPayroll(ctx = {}) {
    const c = defaults(ctx);
    return c.lock(POS_LOCK, async () => {
        const { entries, sales } = await readAll(c.storage);
        const entryIds = new Set(entries.map(e => e.id));
        const salesIds = new Set(sales.map(s => s?.id));
        const nowIso = c.now().toISOString();

        const huerfanos = sales.filter(s => s?.isPayroll && s.status !== 'ANULADA' && !entryIds.has(s.payrollEntryId));
        if (huerfanos.length) {
            const ids = new Set(huerfanos.map(h => h.id));
            // Mercancía a medias: el stock ya bajó, se devuelve.
            const goods = huerfanos.filter(h => h.isAutoconsumo && Array.isArray(h.items)).flatMap(h => h.items);
            if (goods.length) {
                const freshProducts = asList(await c.storage.getItem(PRODUCTS_KEY, []));
                await c.storage.setItem(PRODUCTS_KEY, applyStock(freshProducts, goods, +1, true));
            }
            const fixed = sales.map(s => (ids.has(s.id) ? {
                ...s, status: 'ANULADA', voidedAt: nowIso, voidedBy: 'Recuperación automática',
                ...(s.isAutoconsumo ? { stockDevuelto: true } : {}),
            } : s));
            await c.storage.setItem(SALES_KEY, fixed);
            await confirmSalesRecords(c.storage, fixed.filter(s => ids.has(s.id)));
        }

        const sinMovimiento = entries.filter(e => e.status === 'ACTIVO' && (MONEY_OUT_TYPES.has(e.tipo) || e.tipo === GOODS_TYPE)
            && e.movimientoCajaId && !salesIds.has(e.movimientoCajaId));
        if (sinMovimiento.length) {
            const ids = new Set(sinMovimiento.map(e => e.id));
            await writeVerifiedValue(c.storage, PAYROLL_ENTRIES_KEY, entries.map(e => (
                ids.has(e.id) || (e.arrastreDe && ids.has(e.arrastreDe))
                    ? { ...e, status: 'ANULADO', anuladoPor: 'Recuperación automática', anuladoAt: nowIso }
                    : e
            )));
        }

        if (huerfanos.length || sinMovimiento.length) {
            c.audit('NOMINA', 'RECUPERACION', `Movimientos anulados: ${huerfanos.length}; renglones anulados: ${sinMovimiento.length}`);
        }
        return { movimientosAnulados: huerfanos.length, renglonesAnulados: sinMovimiento.length };
    });
}
