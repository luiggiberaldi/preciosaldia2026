import { FinancialEngine } from '../core/FinancialEngine';
import { getLocalISODate } from './dateHelpers';
import { mulR, sumR, round2 } from './dinero';

export function calculateReportsData(allSales, from, to, bcvRate, products) {
    // Ventas de Mercancía (para Totales, Profit, Top Productos)
    const salesForStats = allSales.filter(s => {
        if (s.status === 'ANULADA' || (s.tipo !== 'VENTA' && s.tipo !== 'VENTA_FIADA' && s.tipo !== 'VENTA_CASHEA')) return false;
        const dateStr = getLocalISODate(new Date(s.timestamp));
        return dateStr >= from && dateStr <= to;
    });

    // Flujo de Dinero (para Desglose de Pagos, incluye pagos de deudas y avances de efectivo)
    const salesForCashFlow = allSales.filter(s => {
        if (s.status === 'ANULADA') return false;
        if (s.tipo !== 'VENTA' && s.tipo !== 'VENTA_FIADA' && s.tipo !== 'VENTA_CASHEA' && s.tipo !== 'COBRO_DEUDA' && s.tipo !== 'PAGO_PROVEEDOR' && s.tipo !== 'AVANCE_EFECTIVO') return false;
        const dateStr = getLocalISODate(new Date(s.timestamp));
        return dateStr >= from && dateStr <= to;
    });

    const historySales = allSales.filter(s => {
        if (s.tipo !== 'VENTA' && s.tipo !== 'VENTA_FIADA' && s.tipo !== 'VENTA_CASHEA') return false;
        const dateStr = getLocalISODate(new Date(s.timestamp));
        return dateStr >= from && dateStr <= to;
    });

    const totalUsd = sumR(salesForStats.map(sale => sale.totalUsd || 0));
    const totalBs = sumR(salesForStats.map(sale => sale.totalBs || 0));
    const totalCop = sumR(salesForStats.map(sale => sale.totalCop || 0));
    const totalItems = salesForStats.reduce((s, sale) => s + (sale.items ? sale.items.reduce((is, i) => is + i.qty, 0) : 0), 0);
    
    // Sumar ganancias de ventas + comisiones por avances de efectivo
    const profitFromSales = FinancialEngine.calculateAggregateProfit(salesForStats, bcvRate, products);
    const advancesInPeriod = allSales.filter(s => {
        if (s.status === 'ANULADA' || s.tipo !== 'AVANCE_EFECTIVO') return false;
        const dateStr = getLocalISODate(new Date(s.timestamp));
        return dateStr >= from && dateStr <= to;
    });
    const profitFromAdvances = advancesInPeriod.reduce((sum, a) => {
        const rate = a.rate || bcvRate || 1;
        const commBs = a.currency === 'BS' ? (a.montoComision || 0) : mulR(a.montoComision || 0, rate);
        return sum + commBs;
    }, 0);
    const profit = round2(profitFromSales + profitFromAdvances);
    
    const paymentBreakdown = FinancialEngine.calculatePaymentBreakdown(salesForCashFlow);

    // Top productos
    // FIN-018: acumular revenue con round2 (antes era `+= mulR(...)` sin re-redondeo → drift).
    const productMap = {};
    salesForStats.forEach(s => {
        s.items?.forEach(item => {
            const key = item.id || item.name;
            if (!productMap[key]) productMap[key] = { name: item.name, qty: 0, revenue: 0 };
            productMap[key].qty += item.qty;
            productMap[key].revenue = round2(productMap[key].revenue + mulR(item.priceUsd, item.qty));
        });
    });
    const topProducts = Object.values(productMap).sort((a, b) => b.revenue - a.revenue).slice(0, 8);

    // Ventas por día para mini gráfica
    const map = {};
    salesForStats.forEach(s => {
        const day = s.timestamp ? getLocalISODate(new Date(s.timestamp)) : getLocalISODate(new Date());
        if (!map[day]) map[day] = { date: day, total: 0, count: 0 };
        map[day].total = round2(map[day].total + (s.totalUsd || 0));
        map[day].count++;
    });
    const salesByDay = Object.values(map).sort((a, b) => a.date.localeCompare(b.date));

    return {
        salesForStats,
        salesForCashFlow,
        historySales,
        totalUsd,
        totalBs,
        totalCop,
        totalItems,
        profit,
        paymentBreakdown,
        topProducts,
        salesByDay
    };
}

export function groupSalesByCierreId(allSales, from, to) {
    // 1. Encontrar ventas/aperturas que caen en el rango y tienen cierreId
    const entitiesInDateRange = allSales.filter(s => {
        const dateStr = getLocalISODate(new Date(s.timestamp));
        return dateStr >= from && dateStr <= to && s.cierreId;
    });

    // 2. Agrupar por cierreId
    const cMap = {};
    entitiesInDateRange.forEach(entity => {
        const cId = entity.cierreId;
        if (!cMap[cId]) {
            cMap[cId] = {
                cierreId: cId,
                timestamp: cId,
                apertura: null,
                sales: [],
            };
        }
        if (entity.tipo === 'APERTURA_CAJA') {
            cMap[cId].apertura = entity;
        } else {
            cMap[cId].sales.push(entity);
        }
    });

    // 3. Calcular resumen y ordenar desc
    const result = Object.values(cMap)
        .filter(c => c.sales.length > 0)
        .map(c => {
            const dateObj = new Date(c.cierreId);

            // Filtrar para métricas generales (stats) y flujo de caja (cashflow)
            const salesForStats = c.sales.filter(s => s.tipo === 'VENTA' || s.tipo === 'VENTA_FIADA' || s.tipo === 'VENTA_CASHEA');
            const salesForCashFlow = c.sales.filter(s => s.tipo === 'VENTA' || s.tipo === 'VENTA_FIADA' || s.tipo === 'VENTA_CASHEA' || s.tipo === 'COBRO_DEUDA' || s.tipo === 'PAGO_PROVEEDOR' || s.tipo === 'AVANCE_EFECTIVO');

            const totalUsd = sumR(salesForStats.map(s => s.totalUsd || 0));
            const totalBs = sumR(salesForStats.map(s => s.totalBs || 0));
            const totalCop = sumR(salesForStats.map(s => s.totalCop || 0));
            const totalItems = salesForStats.reduce((acc, s) => acc + (s.items ? s.items.reduce((is, it) => is + it.qty, 0) : 0), 0);
            
            // Reconstruir desglose de pago de esta caja
            const paymentBreakdown = FinancialEngine.calculatePaymentBreakdown(salesForCashFlow);

            return {
                ...c,
                dateObj,
                salesForStats,
                salesForCashFlow,
                totalUsd,
                totalBs,
                totalCop,
                totalItems,
                paymentBreakdown,
            };
        })
        .sort((a, b) => String(b.cierreId).localeCompare(String(a.cierreId)));

    return result;
}
