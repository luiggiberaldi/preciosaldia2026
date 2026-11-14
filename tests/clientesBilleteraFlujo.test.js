// Verificación de punta a punta del flujo de clientes (2026-11-14):
// fiado total y parcial, abonos ($, Bs, mixto, mayor que la deuda), vuelto a
// la billetera, compras con saldo a favor, anulaciones, cambio de tasa,
// centavos, «Recalcular deudas» y lo que ve el cierre de caja.
// Usa los procesadores reales (venta, abono, anulación) sobre un storage en
// memoria, y después el motor de caja y el resumen del cierre.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const memoryStore = new Map();

vi.mock('../src/utils/storageService', () => ({
    storageService: {
        getItem: vi.fn(async (key, defaultValue = null) => memoryStore.has(key) ? memoryStore.get(key) : defaultValue),
        setItem: vi.fn(async (key, value) => memoryStore.set(key, JSON.parse(JSON.stringify(value)))),
    },
}));
vi.mock('../src/services/auditService', () => ({ logEvent: vi.fn(() => Promise.resolve()) }));
vi.mock('../src/hooks/store/useAuthStore', () => ({
    useAuthStore: { getState: () => ({ usuarioActivo: { id: 'u1', nombre: 'Cajera', rol: 'ADMIN' } }) },
}));

import { CUSTOMER_LEDGER_KEY, rebuildCustomersFromLedger } from '../src/utils/customerLedger';
import { processSaleTransaction } from '../src/utils/checkoutProcessor';
import { processVoidSale } from '../src/utils/voidSaleProcessor';
import { processCustomerTransaction } from '../src/utils/customerTransactionProcessor';
import { FinancialEngine } from '../src/core/FinancialEngine';
import { calcularEfectivoEsperado } from '../src/utils/cajaEsperada';
import { buildCloseDaySummary } from '../src/utils/closeDaySummary';
import { reconcileCustomersWithLedger } from '../src/utils/pocketReconciliation';
import { computeReceivablesMovements } from '../src/utils/receivablesReport';

const CUSTOMERS = 'bodega_customers_v1';
const SALES = 'bodega_sales_v1';
const PRODUCTS = 'bodega_products_v1';

const cliente = (id = 'maria') => memoryStore.get(CUSTOMERS).find(c => c.id === id);
const ventas = () => memoryStore.get(SALES) || [];
const ledger = () => memoryStore.get(CUSTOMER_LEDGER_KEY) || [];

const usd = (amountUsd, rate) => ({ methodId: 'efectivo_usd', currency: 'USD', amountUsd, amountBs: amountUsd * rate });
const bs = (amountBs, rate) => ({ methodId: 'efectivo_bs', currency: 'BS', amountUsd: amountBs / rate, amountBs });
const favor = (amountUsd, rate) => ({ methodId: 'saldo_favor', currency: 'USD', amountUsd, amountBs: amountUsd * rate, isSaldoFavor: true });

async function vender({ totalUsd, payments = [], rate = 40, changeBreakdown = {}, customerId = 'maria' }) {
    const products = memoryStore.get(PRODUCTS);
    return processSaleTransaction({
        cart: [{ id: 'p1', name: 'Harina', qty: 1, priceUsd: totalUsd, costUsd: 0, isWeight: false }],
        cartTotalUsd: totalUsd,
        cartTotalBs: totalUsd * rate,
        cartSubtotalUsd: totalUsd,
        payments,
        changeBreakdown,
        selectedCustomerId: customerId,
        customers: memoryStore.get(CUSTOMERS),
        products,
        effectiveRate: rate,
        tasaCop: 0,
        copEnabled: false,
        discountData: null,
        useAutoRate: false,
    });
}

async function abonar(monto, currencyMode = 'USD', rate = 40, id = 'maria') {
    return processCustomerTransaction({
        transactionAmount: monto,
        currencyMode,
        type: 'ABONO',
        customer: cliente(id),
        paymentMethod: currencyMode === 'USD' ? 'efectivo_usd' : 'efectivo_bs',
        bcvRate: rate,
        tasaCop: 0,
        copEnabled: false,
    });
}

const saldo = (id = 'maria') => {
    const c = cliente(id);
    return { deuda: c.deuda, favor: c.favor };
};

beforeEach(() => {
    memoryStore.clear();
    memoryStore.set(CUSTOMERS, [{ id: 'maria', name: 'María Prueba', deuda: 0, favor: 0 }]);
    memoryStore.set(PRODUCTS, [{ id: 'p1', name: 'Harina', stock: 500, costUsd: 0 }]);
});

describe('Flujo de clientes de punta a punta (tasa 40 Bs/$)', () => {
    it('escenarios 1 a 8 en una misma jornada cuadran en cliente, historial, caja y cierre', async () => {
        const R = 40;

        // ── 1. Venta a crédito total ($10) y parcial ($8: paga $3, fía $5) ──
        const fiadoTotal = await vender({ totalUsd: 10, payments: [], changeBreakdown: { esCredito: true } });
        expect(fiadoTotal.success).toBe(true);
        expect(fiadoTotal.sale).toMatchObject({ tipo: 'VENTA_FIADA', fiadoUsd: 10, changeUsd: 0 });
        expect(saldo()).toEqual({ deuda: 10, favor: 0 });

        const fiadoParcial = await vender({ totalUsd: 8, payments: [usd(3, R)], changeBreakdown: { esCredito: true } });
        expect(fiadoParcial.success).toBe(true);
        expect(fiadoParcial.sale).toMatchObject({ tipo: 'VENTA_FIADA', fiadoUsd: 5 });
        expect(saldo()).toEqual({ deuda: 15, favor: 0 });

        // En modo crédito no se puede pagar de más (el excedente se perdería).
        const creditoDeMas = await vender({ totalUsd: 4, payments: [usd(5, R)], changeBreakdown: { esCredito: true } });
        expect(creditoDeMas.success).toBe(false);
        expect(saldo()).toEqual({ deuda: 15, favor: 0 });

        // ── 2. Abonos: $5, Bs 200 (= $5), mixto $2 + Bs 80 (= $4), luego $3 con deuda $1 ──
        await abonar(5, 'USD', R);
        expect(saldo()).toEqual({ deuda: 10, favor: 0 });
        const abonoBs = await abonar(200, 'BS', R);
        expect(abonoBs.sale).toMatchObject({ tipo: 'COBRO_DEUDA', totalUsd: 5, totalBs: 200 });
        expect(saldo()).toEqual({ deuda: 5, favor: 0 });
        // El abono mixto se registra como dos abonos (la ventana de abono es de una moneda).
        await abonar(2, 'USD', R);
        await abonar(80, 'BS', R);
        expect(saldo()).toEqual({ deuda: 1, favor: 0 });
        const abonoDeMas = await abonar(3, 'USD', R);
        expect(abonoDeMas.sale.saldoFavorGeneradoUsd).toBe(2);
        expect(abonoDeMas.sale.vueltoParaMonedero).toBe(0);
        expect(saldo()).toEqual({ deuda: 0, favor: 2 });

        // ── 3. Vuelto a la billetera: compra $7, paga $10, los $3 van a su billetera ──
        const conVuelto = await vender({
            totalUsd: 7,
            payments: [usd(10, R)],
            changeBreakdown: { changeUsdGiven: 0, changeBsGiven: 0, vueltoCredito: true, changeAllocationExplicit: true },
        });
        expect(conVuelto.success).toBe(true);
        expect(conVuelto.sale).toMatchObject({ tipo: 'VENTA', changeUsd: 0, changeBs: 0, vueltoParaMonedero: 3 });
        expect(conVuelto.sale.changeAllocation).toMatchObject({ totalUsd: 3, creditedUsd: 3, deliveredUsd: 0 });
        expect(saldo()).toEqual({ deuda: 0, favor: 5 });

        // Vuelto repartido: compra $6, paga $10 → $1 en mano + Bs 40 (= $1) + $2 a billetera.
        const repartido = await vender({
            totalUsd: 6,
            payments: [usd(10, R)],
            changeBreakdown: { changeUsdGiven: 1, changeBsGiven: 40, vueltoCredito: true, changeAllocationExplicit: true },
        });
        expect(repartido.success).toBe(true);
        expect(repartido.sale).toMatchObject({ changeUsd: 1, changeBs: 40, vueltoParaMonedero: 2 });
        expect(saldo()).toEqual({ deuda: 0, favor: 7 });

        // ── 4. Compras con saldo a favor: total, parcial + efectivo, y saldo que no alcanza ──
        const conFavor = await vender({ totalUsd: 3, payments: [favor(3, R)] });
        expect(conFavor.success).toBe(true);
        expect(conFavor.sale.tipo).toBe('VENTA');
        expect(saldo()).toEqual({ deuda: 0, favor: 4 });

        const favorMasEfectivo = await vender({ totalUsd: 6, payments: [favor(4, R), bs(80, R)] });
        expect(favorMasEfectivo.success).toBe(true);
        expect(saldo()).toEqual({ deuda: 0, favor: 0 });

        const sinSaldo = await vender({ totalUsd: 2, payments: [favor(1, R), usd(1, R)] });
        expect(sinSaldo.success).toBe(false);
        expect(sinSaldo.error).toMatch(/insuficiente/i);
        expect(saldo()).toEqual({ deuda: 0, favor: 0 });

        // ── 5. Anulaciones ──
        // Anular la venta fiada parcial ($8, fió $5): la deuda baja $5 (hoy es favor $5).
        await processVoidSale(fiadoParcial.sale, ventas(), memoryStore.get(PRODUCTS));
        expect(saldo()).toEqual({ deuda: 0, favor: 5 });
        // Anular la compra pagada con $3 de saldo a favor: se devuelven los $3.
        await processVoidSale(conFavor.sale, ventas(), memoryStore.get(PRODUCTS));
        expect(saldo()).toEqual({ deuda: 0, favor: 8 });
        // Anular la venta con $3 de vuelto acreditado: se quitan los $3.
        await processVoidSale(conVuelto.sale, ventas(), memoryStore.get(PRODUCTS));
        expect(saldo()).toEqual({ deuda: 0, favor: 5 });
        // Anular el abono de $3 que dejó $2 a favor: se quitan los $3 completos.
        await processVoidSale(abonoDeMas.sale, ventas(), memoryStore.get(PRODUCTS));
        expect(saldo()).toEqual({ deuda: 0, favor: 2 });
        // Cuenta de control: fiado 10 + 8 (anulado) − abonos 5+5+2+2 (+3 anulado)
        // + billetera 3 (anulado) + 2 − favor usado 3 (anulado) − 4 → favor 2.

        // ── 6. Nunca hay deuda y saldo a favor a la vez (saldo único) ──
        const fiadoConFavor = await vender({ totalUsd: 5, payments: [], changeBreakdown: { esCredito: true } });
        expect(fiadoConFavor.success).toBe(true);
        expect(fiadoConFavor.sale.walletSnapshot).toEqual({ favorAntes: 2, deudaAntes: 0 });
        expect(saldo()).toEqual({ deuda: 3, favor: 0 });

        // ── 7. «Recalcular deudas desde el historial» deja los mismos saldos ──
        const customers = memoryStore.get(CUSTOMERS);
        expect(reconcileCustomersWithLedger(customers, ledger()).ok).toBe(true);
        const rebuilt = rebuildCustomersFromLedger(customers, ledger());
        expect({ deuda: rebuilt[0].deuda, favor: rebuilt[0].favor }).toEqual({ deuda: 3, favor: 0 });

        // ── 8. Caja y cierre ──
        const todas = ventas();
        const breakdown = FinancialEngine.calculatePaymentBreakdown(todas);
        const caja = calcularEfectivoEsperado(breakdown);
        // Efectivo $ que entró y sigue válido: abonos 5 + 2 + repartido 10 − vuelto 1.
        // (El $3 del fiado parcial, el $10 con vuelto a billetera y el abono de $3 se anularon.)
        expect(caja.expectedUsd).toBe(16);
        // Bs: abonos 200 + 80, + 80 de la compra con favor − 40 de vuelto.
        expect(caja.expectedBs).toBe(320);
        // El saldo a favor usado no es efectivo ni se suma a la caja.
        expect(breakdown.saldo_favor).toMatchObject({ isInternalCredit: true, total: 4 });

        const cxc = computeReceivablesMovements(todas);
        expect(cxc.fiadoOtorgadoUsd).toBe(15); // 10 + 5 (el de 8 se anuló)
        // F6: del fiado de $5 del paso 6, $2 los cubrió el saldo a favor que tenía.
        expect(cxc.fiadoCubiertoConFavorUsd).toBe(2);
        expect(cxc.cobranzasUsd).toBe(14);     // 5 + 5 + 2 + 2 (el de 3 se anuló)
        expect(cxc.saldoFavorGeneradoUsd).toBe(0);

        const cierre = buildCloseDaySummary({ allSales: todas, bcvRate: R, carteraUsd: 3 });
        // Ventas de mercancía válidas: 10 (fiado) + 6 (repartido) + 6 (favor+Bs) + 5 (fiado) = 27.
        expect(cierre.ventasNetasUsd).toBe(27);
        expect(cierre.creditosUsd).toBe(15);
        expect(cierre.cobradoUsd).toBe(12);
        // Los abonos aparecen aparte y no se suman a las ventas.
        expect(cierre.cobranzasUsd).toBe(14);
        expect(cierre.invariante.ok).toBe(true);
        // ERR-015: el vuelto de $2 que quedó en la billetera aparece como saldo generado (como en el Inicio).
        expect(cierre.saldoFavorGeneradoUsd).toBe(2);
        // F4: los $4 pagados con saldo a favor salen aparte bajo «Cobrado».
        expect(cierre.saldoFavorUsadoUsd).toBe(4);
        expect(cierre.rows.find(r => r.key === 'cobrado_caja').usd).toBe(8);
        expect(breakdown._saldo_favor_generado.total).toBe(2);
    });

    it('ERR-015: el cierre cuenta como «saldo a favor generado» el vuelto a billetera y el sobrante del abono', async () => {
        await vender({ totalUsd: 7, payments: [usd(10, 40)], changeBreakdown: { changeUsdGiven: 0, changeBsGiven: 0, vueltoCredito: true, changeAllocationExplicit: true } });
        await vender({ totalUsd: 4, payments: [], changeBreakdown: { esCredito: true } }); // consume $3 de favor, deja $1 de deuda
        await abonar(3, 'USD', 40); // deuda 1 → favor 2
        expect(saldo()).toEqual({ deuda: 0, favor: 2 });
        const todas = ventas();
        const cierre = buildCloseDaySummary({ allSales: todas, bcvRate: 40 });
        const motor = FinancialEngine.calculatePaymentBreakdown(todas)._saldo_favor_generado.total;
        expect(cierre.saldoFavorGeneradoUsd).toBe(5); // $3 de vuelto + $2 de sobrante
        expect(cierre.saldoFavorGeneradoUsd).toBe(motor);
        expect(cierre.rows.find(r => r.key === 'saldo_favor').usd).toBe(5);
    });
});

describe('Cambio de tasa y centavos', () => {
    it('la deuda queda en $: si la tasa sube, el abono en Bs se convierte a la tasa del día', async () => {
        await vender({ totalUsd: 10, rate: 40, payments: [], changeBreakdown: { esCredito: true } });
        expect(saldo()).toEqual({ deuda: 10, favor: 0 });
        // Bs 400 ya no alcanzan con la tasa nueva (50): abona $8.
        await abonar(400, 'BS', 50);
        expect(saldo()).toEqual({ deuda: 2, favor: 0 });
        await abonar(100, 'BS', 50);
        expect(saldo()).toEqual({ deuda: 0, favor: 0 });
    });

    it('pagar en Bs el monto mostrado con tasas con decimales no deja centavos colgando', async () => {
        for (const [deudaUsd, rate] of [[2.74, 36.55], [10, 36.123], [7.33, 243.17], [0.99, 481.06]]) {
            memoryStore.set(CUSTOMERS, [{ id: 'maria', name: 'María', deuda: 0, favor: 0 }]);
            memoryStore.delete(CUSTOMER_LEDGER_KEY);
            memoryStore.delete(SALES);
            await vender({ totalUsd: deudaUsd, rate, payments: [], changeBreakdown: { esCredito: true } });
            const bsMostrado = Math.round(deudaUsd * rate * 100) / 100;
            await abonar(bsMostrado, 'BS', rate);
            expect(saldo(), `deuda ${deudaUsd} a tasa ${rate}`).toEqual({ deuda: 0, favor: 0 });
        }
    });

    it('un faltante de $0,01 en una venta de contado no se fía (queda como redondeo)', async () => {
        const r = await vender({ totalUsd: 5, payments: [usd(4.99, 40)] });
        expect(r.success).toBe(true);
        expect(r.sale).toMatchObject({ tipo: 'VENTA', fiadoUsd: 0, redondeoUsd: 0.01 });
        expect(saldo()).toEqual({ deuda: 0, favor: 0 });
    });

    it('anular una venta con vuelto a billetera ya gastado deja deuda por lo gastado', async () => {
        const v = await vender({
            totalUsd: 5,
            payments: [usd(10, 40)],
            changeBreakdown: { changeUsdGiven: 0, changeBsGiven: 0, vueltoCredito: true, changeAllocationExplicit: true },
        });
        expect(saldo()).toEqual({ deuda: 0, favor: 5 });
        await vender({ totalUsd: 5, payments: [favor(5, 40)] });
        expect(saldo()).toEqual({ deuda: 0, favor: 0 });
        await processVoidSale(v.sale, ventas(), memoryStore.get(PRODUCTS));
        // Al anular se le devuelven los $10 y la mercancía vuelve al estante,
        // pero la segunda compra se pagó con un saldo que ya no existe: debe $5.
        expect(saldo()).toEqual({ deuda: 5, favor: 0 });
        expect(reconcileCustomersWithLedger(memoryStore.get(CUSTOMERS), ledger()).ok).toBe(true);
    });
});

// F6 del PLAN-FIXEO-CLIENTES-BILLETERA (decisión D1): fiado cubierto con saldo a favor.
describe('Fiado cubierto con saldo a favor (reportes y cierre)', () => {
    const aVuelto = { changeUsdGiven: 0, changeBsGiven: 0, vueltoCredito: true, changeAllocationExplicit: true };

    it('fiado de $5 con $2 a favor: fiado otorgado 5, cubierto 2, la deuda sube solo 3', async () => {
        await vender({ totalUsd: 8, payments: [usd(10, 40)], changeBreakdown: aVuelto }); // +$2 a favor
        await vender({ totalUsd: 5, payments: [], changeBreakdown: { esCredito: true } });
        expect(saldo()).toEqual({ deuda: 3, favor: 0 });
        const cxc = computeReceivablesMovements(ventas());
        expect(cxc.fiadoOtorgadoUsd).toBe(5);
        expect(cxc.fiadoCubiertoConFavorUsd).toBe(2);
        expect(cxc.fiados[0].cubiertoConFavorUsd).toBe(2);
        const cierre = buildCloseDaySummary({ allSales: ventas(), bcvRate: 40 });
        expect(cierre.rows.find(r => r.key === 'fiado_cubierto')).toMatchObject({ usd: 2, bs: 80 });
    });

    it('si en la misma venta paga con saldo y fía el resto, solo cubre el saldo que sobra', async () => {
        await vender({ totalUsd: 7, payments: [usd(10, 40)], changeBreakdown: aVuelto }); // +$3 a favor
        // Venta de $5: paga $1 con saldo y fía $4. Quedaban $2 de saldo para el fiado.
        const r = await vender({ totalUsd: 5, payments: [favor(1, 40)], changeBreakdown: { esCredito: true } });
        expect(r.success).toBe(true);
        expect(saldo()).toEqual({ deuda: 2, favor: 0 });
        const cxc = computeReceivablesMovements(ventas());
        expect(cxc.fiadoOtorgadoUsd).toBe(4);
        expect(cxc.fiadoCubiertoConFavorUsd).toBe(2);
    });

    it('sin saldo a favor antes del fiado no aparece la fila', async () => {
        await vender({ totalUsd: 5, payments: [], changeBreakdown: { esCredito: true } });
        const cxc = computeReceivablesMovements(ventas());
        expect(cxc.fiadoCubiertoConFavorUsd).toBe(0);
        expect(buildCloseDaySummary({ allSales: ventas(), bcvRate: 40 }).rows.some(r => r.key === 'fiado_cubierto')).toBe(false);
    });
});

// F5 del PLAN-FIXEO-CLIENTES-BILLETERA: abono mixto ($ + Bs) en un solo registro.
describe('Abono mixto ($ + Bs)', () => {
    const abonoMixto = (payments, rate = 40) => processCustomerTransaction({
        type: 'ABONO', customer: cliente(), bcvRate: rate, tasaCop: 0, copEnabled: false,
        transactionAmount: '', currencyMode: 'MIXTO', paymentMethod: '',
        payments,
    });

    it('$2 + Bs 200 a tasa 40 saldan una deuda de $7 con UN solo abono y dos pagos', async () => {
        await vender({ totalUsd: 7, payments: [], changeBreakdown: { esCredito: true } });
        const r = await abonoMixto([
            { currency: 'USD', amount: '2', methodId: 'efectivo_usd' },
            { currency: 'BS', amount: '200', methodId: 'pago_movil' },
        ]);
        expect(r.error).toBeUndefined();
        expect(saldo()).toEqual({ deuda: 0, favor: 0 });
        expect(r.sale).toMatchObject({ tipo: 'COBRO_DEUDA', totalUsd: 7, totalBs: 280, saldoFavorGeneradoUsd: 0, paymentMethod: 'efectivo_usd' });
        expect(r.sale.payments).toEqual([
            expect.objectContaining({ methodId: 'efectivo_usd', currency: 'USD', amount: 2, amountUsd: 2, amountBs: 80 }),
            expect.objectContaining({ methodId: 'pago_movil', currency: 'BS', amount: 200, amountUsd: 5, amountBs: 200 }),
        ]);
        const abonos = ledger().filter(m => m.type === 'ABONO_DEUDA');
        expect(abonos).toHaveLength(1);
        expect(abonos[0].amountUsd).toBe(7);
        // Caja: el efectivo $ sube 2; el pago móvil va a su método (no es efectivo).
        const breakdown = FinancialEngine.calculatePaymentBreakdown(ventas());
        expect(breakdown.efectivo_usd.total).toBe(2);
        expect(breakdown.pago_movil.total).toBe(200);
        expect(computeReceivablesMovements(ventas()).cobranzas[0]).toMatchObject({ montoUsd: 7, methodIds: ['efectivo_usd', 'pago_movil'] });
    });

    it('si sobra, el sobrante queda a favor', async () => {
        await vender({ totalUsd: 3, payments: [], changeBreakdown: { esCredito: true } });
        const r = await abonoMixto([
            { currency: 'USD', amount: '2', methodId: 'efectivo_usd' },
            { currency: 'BS', amount: '80', methodId: 'efectivo_bs' },
        ]);
        expect(r.sale.saldoFavorGeneradoUsd).toBe(1);
        expect(saldo()).toEqual({ deuda: 0, favor: 1 });
    });

    it('con solo un campo lleno queda como abono normal en esa moneda', async () => {
        await vender({ totalUsd: 5, payments: [], changeBreakdown: { esCredito: true } });
        const r = await abonoMixto([
            { currency: 'USD', amount: '', methodId: 'efectivo_usd' },
            { currency: 'BS', amount: '120', methodId: 'efectivo_bs' },
        ]);
        expect(r.sale.payments).toEqual([expect.objectContaining({ methodId: 'efectivo_bs', currency: 'BS', amount: 120, amountUsd: 3, amountBs: 120 })]);
        expect(r.sale.totalBs).toBe(120);
        expect(saldo()).toEqual({ deuda: 2, favor: 0 });
    });

    it('con los dos campos vacíos no registra nada', async () => {
        const r = await abonoMixto([{ currency: 'USD', amount: '' }, { currency: 'BS', amount: '0' }]);
        expect(r.error).toBe('Monto inválido');
        expect(ventas()).toHaveLength(0);
    });
});
