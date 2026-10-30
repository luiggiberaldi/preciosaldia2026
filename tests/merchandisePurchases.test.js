// Compras de mercancía: núcleo (validación, totales) y familia de sync por mes.
import { describe, expect, it, vi } from 'vitest';

// jsPDF real, pero registrando textos y sin descargar el archivo.
const pdf = vi.hoisted(() => ({ texts: [], saved: [], pages: 0 }));
vi.mock('jspdf', async (importOriginal) => {
    const actual = await importOriginal();
    class RecordingPDF extends actual.jsPDF {
        constructor(...args) {
            super(...args);
            const text = this.text.bind(this);
            const addPage = this.addPage.bind(this);
            pdf.pages = 1;
            this.text = (value, ...rest) => { pdf.texts.push(String(value)); return text(value, ...rest); };
            this.addPage = (...rest) => { pdf.pages += 1; return addPage(...rest); };
            this.save = (name) => { pdf.saved.push(name); };
        }
    }
    return { ...actual, jsPDF: RecordingPDF };
});
import {
    buildPurchase,
    purchaseAmountBs,
    purchaseSupplierSuggestions,
    removePurchase,
    summarizePurchases,
    upsertPurchase,
} from '../src/utils/merchandisePurchases';
import {
    PURCHASES_SYNC_BASE_KEY,
    buildPurchasesSyncPlan,
    getPurchasesSyncPeriodOf,
    isPurchasesSyncDocId,
    mergePurchasesSyncDoc,
    parsePurchasesSyncDocId,
} from '../src/utils/purchasesSyncFamily';
import { validateSupervisorSyncDocument } from '../src/services/supervisorContracts';
import { IDB_KEYS } from '../src/config/backupKeys';

const make = (over) => {
    const result = buildPurchase({ date: '2026-10-01', supplier: 'Colorantes', amount: 37, rate: 40, now: '2026-10-01T10:00:00Z', ...over });
    if (!result.ok) throw new Error(result.error);
    return result.purchase;
};

describe('buildPurchase', () => {
    it('arma una compra en $ con la tasa del día', () => {
        const p = make({ supplier: '  Distribuidora   Polar ', amount: '50,65', note: ' fact 123 ' });
        expect(p).toMatchObject({ date: '2026-10-01', supplier: 'Distribuidora Polar', amountUsd: 50.65, currency: 'USD', rate: 40, note: 'fact 123' });
        expect(purchaseAmountBs(p)).toBe(2026);
    });

    it('en Bs convierte a $ y guarda el monto original', () => {
        const p = make({ amount: 4000, currency: 'BS' });
        expect(p).toMatchObject({ amountUsd: 100, amountBs: 4000, currency: 'BS' });
        expect(purchaseAmountBs(p)).toBe(4000);
    });

    it('valida fecha, proveedor, monto y tasa', () => {
        expect(buildPurchase({ date: '01/10/2026', supplier: 'X', amount: 1 }).ok).toBe(false);
        expect(buildPurchase({ date: '2026-10-01', supplier: '  ', amount: 1 }).ok).toBe(false);
        expect(buildPurchase({ date: '2026-10-01', supplier: 'X', amount: 0 }).ok).toBe(false);
        expect(buildPurchase({ date: '2026-10-01', supplier: 'X', amount: 'abc' }).ok).toBe(false);
        expect(buildPurchase({ date: '2026-10-01', supplier: 'X', amount: 10, currency: 'BS', rate: 0 }).ok).toBe(false);
    });

    it('corregir conserva id y fecha de creación', () => {
        const original = make({});
        const fixed = buildPurchase({ date: '2026-10-02', supplier: 'Colorantes', amount: 40, rate: 40, previous: original, now: '2026-10-03T00:00:00Z' }).purchase;
        expect(fixed.id).toBe(original.id);
        expect(fixed.createdAt).toBe(original.createdAt);
        expect(fixed.updatedAt).toBe('2026-10-03T00:00:00.000Z');
        const list = upsertPurchase([original], fixed);
        expect(list).toHaveLength(1);
        expect(list[0].amountUsd).toBe(40);
        expect(removePurchase(list, original.id)).toEqual([]);
    });
});

describe('summarizePurchases (la libreta del cliente)', () => {
    const purchases = [
        make({ id: 'a', date: '2026-10-01', supplier: 'Colorantes', amount: 37 }),
        make({ id: 'b', date: '2026-10-01', supplier: 'Distribuidora Polar', amount: 50.65 }),
        make({ id: 'c', date: '2026-10-01', supplier: 'Frigorífico Carpanito', amount: 37 }),
        make({ id: 'd', date: '2026-10-01', supplier: 'Golden Burger C.A', amount: 17.5 }),
        make({ id: 'e', date: '2026-10-01', supplier: 'Farmacia los Guayos', amount: 20 }),
        make({ id: 'f', date: '2026-10-02', supplier: 'Inversiones Río 2021', amount: 68.83 }),
        make({ id: 'g', date: '2026-10-02', supplier: 'colorantes', amount: 10 }),
        make({ id: 'z', date: '2026-09-30', supplier: 'Fuera de rango', amount: 999 }),
    ];

    it('total del período, por día y por proveedor', () => {
        const s = summarizePurchases(purchases, '2026-10-01', '2026-10-31');
        expect(s.count).toBe(7);
        expect(s.totalUsd).toBe(240.98);
        expect(s.days.map((d) => [d.date, d.count, d.totalUsd])).toEqual([
            ['2026-10-02', 2, 78.83],
            ['2026-10-01', 5, 162.15],
        ]);
        // «Colorantes» y «colorantes» son el mismo proveedor.
        expect(s.suppliers[0]).toMatchObject({ name: 'Inversiones Río 2021', totalUsd: 68.83 });
        expect(s.suppliers.find((x) => x.name === 'Colorantes')).toMatchObject({ count: 2, totalUsd: 47 });
        expect(s.avgPerDay).toBe(120.49);
    });

    it('período vacío → ceros', () => {
        expect(summarizePurchases(purchases, '2026-11-01', '2026-11-30')).toMatchObject({ count: 0, totalUsd: 0, days: [], suppliers: [] });
    });

    it('sugiere los proveedores más usados primero', () => {
        expect(purchaseSupplierSuggestions(purchases)[0]).toBe('Colorantes');
    });
});

describe('familia de sync por mes', () => {
    const oct = make({ id: 'o1', date: '2026-10-05' });
    const nov = make({ id: 'n1', date: '2026-11-02' });

    it('un documento por mes, ordenado', () => {
        const plan = buildPurchasesSyncPlan([nov, oct]);
        expect(plan.map((s) => s.docId)).toEqual([`${PURCHASES_SYNC_BASE_KEY}:2026-10`, `${PURCHASES_SYNC_BASE_KEY}:2026-11`]);
        expect(getPurchasesSyncPeriodOf({ date: 'x' })).toBe('recent');
        expect(isPurchasesSyncDocId(`${PURCHASES_SYNC_BASE_KEY}:2026-10`)).toBe(true);
        expect(isPurchasesSyncDocId('bodega_sales_v1:2026-10')).toBe(false);
        expect(parsePurchasesSyncDocId(`${PURCHASES_SYNC_BASE_KEY}:2026-10`)).toBe('2026-10');
        expect(parsePurchasesSyncDocId(`${PURCHASES_SYNC_BASE_KEY}:hack`)).toBeNull();
    });

    it('el lector reemplaza SOLO el mes del documento; [] lo vacía', () => {
        const edited = { ...oct, amountUsd: 99 };
        expect(mergePurchasesSyncDoc([oct, nov], `${PURCHASES_SYNC_BASE_KEY}:2026-10`, [edited])).toEqual([nov, edited]);
        expect(mergePurchasesSyncDoc([oct, nov], `${PURCHASES_SYNC_BASE_KEY}:2026-10`, [])).toEqual([nov]);
        expect(mergePurchasesSyncDoc([oct], `${PURCHASES_SYNC_BASE_KEY}:2026-10`, { bad: true })).toEqual([oct]);
    });

    it('en la caja, una descarga vieja no borra una compra guardada después (carrera al recargar)', () => {
        const docAt = '2026-10-30T01:24:05.000Z';
        const mani = { ...oct, id: 'mani', updatedAt: '2026-10-30T01:24:03.000Z' };
        const nueva = { ...oct, id: 'prueba', updatedAt: '2026-10-30T01:32:04.000Z' };
        const docId = `${PURCHASES_SYNC_BASE_KEY}:2026-10`;
        // Sin la opción (supervisor): reemplazo exacto del mes.
        expect(mergePurchasesSyncDoc([mani, nueva], docId, [mani])).toEqual([mani]);
        // Caja: la compra posterior al doc sobrevive.
        expect(mergePurchasesSyncDoc([mani, nueva], docId, [mani], { keepLocalNewerThan: docAt })).toEqual([mani, nueva]);
        // Una corrección local posterior gana sobre la versión vieja del doc.
        const corregida = { ...mani, amountUsd: 300, updatedAt: '2026-10-30T01:40:00.000Z' };
        expect(mergePurchasesSyncDoc([corregida], docId, [mani], { keepLocalNewerThan: docAt })).toEqual([corregida]);
        // Lo anterior al doc sí se reemplaza (el borrado remoto se respeta).
        expect(mergePurchasesSyncDoc([mani], docId, [], { keepLocalNewerThan: docAt })).toEqual([]);
    });

    it('el doc base nunca limpia (unión, lo entrante gana)', () => {
        const edited = { ...oct, amountUsd: 5 };
        expect(mergePurchasesSyncDoc([oct, nov], PURCHASES_SYNC_BASE_KEY, [edited])).toEqual([edited, nov]);
        expect(mergePurchasesSyncDoc([oct], PURCHASES_SYNC_BASE_KEY, [])).toEqual([oct]);
    });

    it('está en el contrato del supervisor y en los respaldos', () => {
        expect(validateSupervisorSyncDocument(PURCHASES_SYNC_BASE_KEY, [oct]).valid).toBe(true);
        expect(validateSupervisorSyncDocument(PURCHASES_SYNC_BASE_KEY, { oct }).valid).toBe(false);
        expect(IDB_KEYS).toContain(PURCHASES_SYNC_BASE_KEY);
    });
});

describe('PDF de compras', () => {
    it('se genera con total, proveedores, días y detalle (también vacío)', async () => {
        const { generatePurchasesReportPDF } = await import('../src/utils/purchasesReportGenerator');
        const purchases = Array.from({ length: 80 }, (_, i) => make({ id: `p${i}`, date: `2026-10-${String((i % 28) + 1).padStart(2, '0')}`, supplier: `Proveedor ${i % 9}`, amount: 10 + i }));
        pdf.texts = [];
        pdf.saved = [];
        generatePurchasesReportPDF({ purchases, from: '2026-10-01', to: '2026-10-31', businessName: 'Bodega', salesUsd: 5000 });
        expect(pdf.saved).toEqual(['Compras_2026-10-01_2026-10-31.pdf']);
        expect(pdf.texts).toContain('COMPRAS DE MERCANCÍA');
        expect(pdf.texts).toContain('$ 3,960.00');
        expect(pdf.texts).toEqual(expect.arrayContaining(['POR PROVEEDOR', 'POR DÍA', 'DETALLE', 'TOTAL DEL PERÍODO', 'Ventas del período: $ 5,000.00']));
        expect(pdf.pages).toBeGreaterThan(1);

        generatePurchasesReportPDF({ purchases: [], from: '2026-11-01', to: '2026-11-30' });
        expect(pdf.saved).toHaveLength(2);
        expect(pdf.texts).toContain('No hay compras registradas en este período.');
    });
});

describe('órdenes del Supervisor (supervisor.purchase.*)', async () => {
    const m = await import('../src/utils/merchandisePurchases');
    const { validateSupervisorCommand, SUPERVISOR_COMMAND_TYPES } = await import('../src/services/supervisorContracts');
    const { buildSupervisorCommand, isSupervisorCommandEnabled } = await import('../src/services/supervisorCommandService');
    const base = make({ id: 'c1', supplier: 'Mani', amount: 251 });

    it('tipos en el contrato, con validación de forma y el interruptor de proveedores', () => {
        expect(SUPERVISOR_COMMAND_TYPES).toEqual(expect.arrayContaining([m.PURCHASE_UPSERT_TYPE, m.PURCHASE_DELETE_TYPE]));
        const ctx = { targetDeviceId: 'caja', monitorDeviceId: 'm1', now: 1_000 };
        const upsert = buildSupervisorCommand({ type: m.PURCHASE_UPSERT_TYPE, targetDeviceId: 'caja', monitorDeviceId: 'm1', payload: m.buildPurchaseUpsertPayload(base), now: 1_000 });
        expect(validateSupervisorCommand(upsert, ctx).valid).toBe(true);
        expect(validateSupervisorCommand({ ...upsert, payload: m.buildPurchaseUpsertPayload({ ...base, amountUsd: -1 }) }, ctx).valid).toBe(false);
        const del = buildSupervisorCommand({ type: m.PURCHASE_DELETE_TYPE, targetDeviceId: 'caja', monitorDeviceId: 'm1', payload: m.buildPurchaseDeletePayload(base), now: 1_000 });
        expect(validateSupervisorCommand(del, ctx).valid).toBe(true);
        expect(isSupervisorCommandEnabled(m.PURCHASE_UPSERT_TYPE, {})).toBe(true);
    });

    it('la caja guarda, corrige (conserva la creación) y es idempotente', () => {
        const first = m.planPurchaseCommand(m.PURCHASE_UPSERT_TYPE, m.buildPurchaseUpsertPayload(base), []);
        expect(first.status).toBe('apply');
        expect(first.list).toHaveLength(1);
        expect(first.list[0]).toMatchObject({ id: 'c1', supplier: 'Mani', amountUsd: 251 });

        const again = m.planPurchaseCommand(m.PURCHASE_UPSERT_TYPE, m.buildPurchaseUpsertPayload(base), first.list);
        expect(again.status).toBe('already_applied');

        const fixed = { ...base, amountUsd: 150, createdAt: 'otro', updatedAt: '2026-10-30T00:00:00.000Z' };
        const edit = m.planPurchaseCommand(m.PURCHASE_UPSERT_TYPE, m.buildPurchaseUpsertPayload(fixed), first.list);
        expect(edit.list).toHaveLength(1);
        expect(edit.list[0]).toMatchObject({ amountUsd: 150, createdAt: base.createdAt });

        // Campos extra no se guardan.
        const extra = m.planPurchaseCommand(m.PURCHASE_UPSERT_TYPE, m.buildPurchaseUpsertPayload({ ...base, id: 'c2', hack: 1 }), []);
        expect(extra.list[0]).not.toHaveProperty('hack');
    });

    it('borrar quita la compra; repetirlo es aplicado sin cambios; forma mala se rechaza', () => {
        const del = m.planPurchaseCommand(m.PURCHASE_DELETE_TYPE, m.buildPurchaseDeletePayload(base), [base]);
        expect(del).toMatchObject({ status: 'apply', list: [] });
        expect(m.planPurchaseCommand(m.PURCHASE_DELETE_TYPE, m.buildPurchaseDeletePayload(base), []).status).toBe('already_applied');
        expect(m.planPurchaseCommand(m.PURCHASE_DELETE_TYPE, { v: 1, purchaseId: '' }, [base]).status).toBe('rejected');
        expect(m.planPurchaseCommand(m.PURCHASE_UPSERT_TYPE, { v: 2, purchase: base }, []).status).toBe('rejected');
    });
});
