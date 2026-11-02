// systemConsciousnessService.js — Servicio seguro de contexto de salud operativa del POS
// Fase 4 & 5: Filtrado estricto por rol (Cajero vs Admin/Supervisor) y modularización de indicadores.

import { storageService } from '../utils/storageService';
import { getActivePaymentMethods } from '../config/paymentMethods';
import { isLowStockProduct } from '../utils/granel'; // BULTOS-001
import { getCaracasISODate, getCaracasDayOf } from '../utils/dateHelpers';
import { findOpenCashShift } from '../utils/cashShift';
import { summarizePurchases } from '../utils/merchandisePurchases';
import { buildSupplierLedger } from '../utils/supplierLedger';

export async function compileSystemConsciousnessContext({ effectiveRate, tasaCop, products, cart, usuarioActivo, isOnline }) {
    const role = usuarioActivo?.rol || 'CAJERO';
    const isCajero = role === 'CAJERO';
    const timestampStr = new Date().toLocaleString('es-VE', { timeZone: 'America/Caracas' });

    // 1. NEGOCIO & CONEXIÓN
    const businessName = localStorage.getItem('business_name') || 'Bodega / Comercio POS';
    const connection = isOnline ? 'Online (Sincronizado)' : 'Offline (Modo local sin internet)';

    // 2. INVENTARIO & SALUD DE STOCK
    const totalProducts = products?.length || 0;
    const lowStockItems = products ? products.filter(p => isLowStockProduct(p)) : []; // BULTOS-001: umbral canónico
    const outOfStockItems = products ? products.filter(p => (p.stock ?? 0) <= 0) : [];

    const criticalStockSummary = lowStockItems
        .sort((a, b) => (a.stock ?? 0) - (b.stock ?? 0))
        .slice(0, 5)
        .map(p => `${p.name} (stock actual: ${p.stock ?? 0})`)
        .join(', ') || 'Ninguno';

    // 3. CARRITO DE VENTA ACTIVO
    const cartCount = cart?.length || 0;
    const cartSummary = cart?.length > 0
        ? cart.map(i => `${i.name} x${i.qty}`).join(', ')
        : 'Vacío';

    // 4. METRICAS DE VENTAS DEL TURNO
    let salesCount = 0;
    let totalSalesUsd = 0;
    let totalSalesBs = 0;
    let paymentSummary = 'Sin ventas registradas hoy';
    let lastSalesDetail = 'Sin transacciones recientes';
    let allSales = [];
    let shiftSummary = 'Sin turno abierto';

    try {
        const sales = await storageService.getItem('bodega_sales_v1', []);
        allSales = Array.isArray(sales) ? sales : [];
        const openShift = findOpenCashShift(allSales);
        if (openShift?.timestamp) {
            shiftSummary = `Abierto desde ${new Date(openShift.timestamp).toLocaleString('es-VE', { timeZone: 'America/Caracas', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`;
        }
        // «Hoy» en la zona de Caracas: las ventas se guardan en ISO UTC.
        const todayStr = getCaracasISODate();
        const todaySales = sales
            .filter(s => getCaracasDayOf(s.timestamp) === todayStr && s.status !== 'ANULADA')
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        salesCount = todaySales.length;
        totalSalesUsd = todaySales.reduce((acc, s) => acc + (s.totalUsd || 0), 0);
        totalSalesBs = todaySales.reduce((acc, s) => acc + (s.totalBs || 0), 0);

        if (!isCajero && todaySales.length > 0) {
            let breakdown = {};
            todaySales.forEach(s => {
                const method = s.payments?.length > 0
                    ? s.payments.map(p => p.methodLabel || p.methodId).join('+')
                    : (s.paymentMethod || 'Efectivo/Otro');
                breakdown[method] = (breakdown[method] || 0) + (s.totalUsd || 0);
            });
            paymentSummary = Object.entries(breakdown)
                .map(([m, val]) => `${m}: $${val.toFixed(2)}`)
                .join(' | ');
        }
    } catch {}

    // 5. SALUD DE BACKUP & SINCRONIZACION
    let backupStatus = 'No registrado en este equipo';
    let syncQueueStatus = 'Sincronizado sin pendientes';
    try {
        const lastBackupDate = localStorage.getItem('pda_last_backup_timestamp');
        if (lastBackupDate) {
            backupStatus = `Último respaldo exitoso: ${new Date(lastBackupDate).toLocaleString('es-VE', { timeZone: 'America/Caracas' })}`;
        } else {
            backupStatus = '⚠️ ATENCIÓN: No hay respaldo de seguridad reciente registrado.';
        }

        const pendingQueue = JSON.parse(localStorage.getItem('pda_offline_queue_v1') || '[]');
        if (pendingQueue.length > 0) {
            syncQueueStatus = `⚠️ ${pendingQueue.length} operaciones locales pendientes de sincronizar con la nube.`;
        }
    } catch {}

    // 6. CLIENTES & DEUDAS (SOLO ADMIN / SUPERVISOR)
    let debtSummary = 'No autorizado para el rol Cajero';
    if (!isCajero) {
        try {
            const customers = await storageService.getItem('bodega_customers_v1', []);
            const debtors = customers.filter(c => (c.deuda || 0) > 0.01);
            const totalDebt = debtors.reduce((acc, c) => acc + (c.deuda || 0), 0);
            debtSummary = `${debtors.length} clientes con saldo pendiente | Total deudas por cobrar: $${totalDebt.toFixed(2)} USD`;
        } catch {
            debtSummary = 'Sin datos de deudores';
        }
    }

    // 6b. COMPRAS DE MERCANCIA Y PROVEEDORES (SOLO ADMIN / SUPERVISOR)
    let purchasesSummary = 'No autorizado para el rol Cajero';
    let suppliersSummary = 'No autorizado para el rol Cajero';
    if (!isCajero) {
        try {
            const [purchases, suppliers, invoices] = await Promise.all([
                storageService.getItem('bodega_merchandise_purchases_v1', []),
                storageService.getItem('bodega_suppliers_v1', []),
                storageService.getItem('bodega_supplier_invoices_v1', []),
            ]);
            const todayKey = getCaracasISODate();
            const month = summarizePurchases(purchases, `${todayKey.slice(0, 8)}01`, todayKey);
            const topSupplier = month.suppliers[0];
            purchasesSummary = month.count > 0
                ? `${month.count} compras este mes | Total: $${month.totalUsd.toFixed(2)} USD${topSupplier ? ` | Mayor proveedor: ${topSupplier.name} ($${topSupplier.totalUsd.toFixed(2)})` : ''}`
                : 'Sin compras registradas este mes';

            const ledger = buildSupplierLedger(suppliers, invoices, allSales);
            const withDebt = ledger.filter((row) => (row.deudaUsd || 0) > 0.01);
            const totalPayable = withDebt.reduce((acc, row) => acc + (row.deudaUsd || 0), 0);
            const overdueInvoices = ledger.reduce((acc, row) => acc + (row.overdueCount || 0), 0);
            suppliersSummary = `${withDebt.length} proveedores con deuda | Total por pagar: $${totalPayable.toFixed(2)} USD | ${overdueInvoices} facturas vencidas`;
        } catch {
            purchasesSummary = 'Sin datos de compras';
            suppliersSummary = 'Sin datos de proveedores';
        }
    }

    // 7. CONSTRUCCION DE PAYLOAD DE CONTEXTO SEGUN EL ROL ACTIVO
    if (isCajero) {
        return `
[CONTEXTO DEL POS — CONCIENCIA DEL SISTEMA]
- Fecha y Hora de Servidor: ${timestampStr} (Hora Venezuela)
- Rol Activo: CAJERO (${usuarioActivo?.nombre || 'Operador'})
- Estado de Conexión: ${connection}

## CONTEXTO OPERATIVO DE CAJERO
- Tasa BCV Oficial: Bs. ${(effectiveRate || 0).toFixed(2)} / USD
- Tasa COP: ${tasaCop > 0 ? `${tasaCop.toFixed(2)} COP / USD` : 'No configurada'}
- Carrito de Venta Activo: ${cartCount} ítems (${cartSummary})
- Inventario: ${totalProducts} registrados | ${lowStockItems.length} bajos de stock (${outOfStockItems.length} agotados)
- Productos Críticos: ${criticalStockSummary}
- Turno de caja: ${shiftSummary}
- Ventas procesadas hoy: ${salesCount} (todas las cajas del día)
- Estado de Respaldo: ${backupStatus}
- Estado de Sincronización: ${syncQueueStatus}

RESTRICCIÓN DE SEGURIDAD (SEC-ROLE-CAJERO):
No tienes permitido consultar ni revelar costos de compra, márgenes de ganancia del negocio, deudas totales de clientes, RIF institucional ni usuarios administradores.
`.trim();
    }

    // CONTEXTO COMPLETO PARA ADMINISTRADOR / SUPERVISOR
    return `
[CONTEXTO DEL POS — CONCIENCIA DEL SISTEMA (ADMIN/SUPERVISOR)]
- Fecha y Hora de Servidor: ${timestampStr} (Hora Venezuela)
- Rol Activo: ${role} (${usuarioActivo?.nombre || 'Administrador'})
- Negocio: ${businessName}
- Estado de Conexión: ${connection}

## SALUD DEL SISTEMA Y OPERACIONES
- Tasa BCV Oficial: Bs. ${(effectiveRate || 0).toFixed(2)} / USD
- Tasa COP: ${tasaCop > 0 ? `${tasaCop.toFixed(2)} COP / USD` : 'No configurada'}
- Ventas del Día: ${salesCount} transacciones | Total USD: $${totalSalesUsd.toFixed(2)} / Total Bs: Bs.${totalSalesBs.toFixed(2)}
- Desglose por Método de Pago: ${paymentSummary}
- Carrito de Venta Activo: ${cartCount} ítems (${cartSummary})
- Salud de Inventario: ${totalProducts} productos | ${lowStockItems.length} bajo stock crítico | ${outOfStockItems.length} agotados
- Productos Críticos: ${criticalStockSummary}
- Salud de Deudas / Cuentas por Cobrar: ${debtSummary}
- Turno de caja: ${shiftSummary}
- Compras de mercancía del mes: ${purchasesSummary}
- Proveedores (cuentas por pagar): ${suppliersSummary}
- Salud de Copias de Seguridad (Backup): ${backupStatus}
- Salud de Sincronización Nube: ${syncQueueStatus}
`.trim();
}
