import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
    STOCK_MESSAGES,
    notifyStockToast,
    stockMessage,
    stockToastType,
} from '../src/services/supervisorStockMessages';

// Superficies de los dos flujos de ajuste de stock:
//   fila: OwnerMonitorView + SupervisorInventoryCatalog (sobre supervisorStockOps);
//   lote: SupervisorInventoryBatchPanel + SupervisorInventoryBatchModal (sobre
//         supervisorInventoryDraft y supervisorInventoryBatchSender).
const FLOWS = {
    'fila · vista': 'src/views/OwnerMonitorView.jsx',
    'fila · filas': 'src/components/Monitor/SupervisorInventoryCatalog.jsx',
    'lote · panel': 'src/components/Monitor/SupervisorInventoryBatchPanel.jsx',
    'lote · modal': 'src/components/Monitor/SupervisorInventoryBatchModal.jsx',
};

describe('catálogo compartido de mensajes de stock (fila y lote)', () => {
    it('resuelve textos estáticos y parametrizados con su tipo de toast canónico', () => {
        expect(stockMessage('BOX_OFFLINE_STOCK')).toBe('La caja está desconectada; no se puede cambiar el stock');
        expect(stockMessage('ORDER_EXPIRED')).toBe('La orden expiró en la caja sin aplicarse');
        expect(stockMessage('PENDING_LINES', { count: 1 })).toBe('1 línea queda pendiente para reintentar.');
        expect(stockMessage('PENDING_LINES', { count: 3 })).toBe('3 líneas quedan pendientes para reintentar.');
        expect(stockMessage('BATCH_CONFIRMED', { count: 1 })).toBe('1 movimiento confirmado en caja');
        expect(stockMessage('BATCH_CONFIRMED', { count: 2 })).toBe('2 movimientos confirmados en caja');
        expect(stockMessage('BATCH_PARTIAL', { applied: 2, pending: 1 })).toBe('2 aplicados; quedan 1 pendientes de revisión');
        expect(stockMessage('STOCK_INSUFFICIENT', { units: 5, stock: 2 }))
            .toBe('No puedes retirar 5 unidades: el stock disponible es 2.');
        expect(stockMessage('CONNECTION_LOST', { count: 1 }))
            .toBe('La conexión con la caja se perdió. 1 línea queda pendiente para reintentar.');

        expect(stockToastType('STOCK_REVERT')).toBe('error');
        expect(stockToastType('BATCH_UNCONFIRMED_TOAST')).toBe('warning');
        expect(stockToastType('BATCH_CONFIRMED')).toBe('success');
    });

    it('una clave desconocida queda visible en pantalla en vez de un texto vacío', () => {
        expect(stockMessage('CLAVE_QUE_NO_EXISTE')).toBe('CLAVE_QUE_NO_EXISTE');
    });

    it('notifyStockToast anuncia el texto con el tipo canónico de la clave', () => {
        const showToast = vi.fn();
        notifyStockToast(showToast, 'STOCK_REVERT');
        expect(showToast).toHaveBeenCalledWith('No se aplicó el cambio de stock; se revirtió el valor provisional', 'error');

        notifyStockToast(showToast, 'BATCH_PARTIAL', { applied: 2, pending: 1 });
        expect(showToast).toHaveBeenCalledWith('2 aplicados; quedan 1 pendientes de revisión', 'warning');
    });

    it('fila y lote toman los mensajes del catálogo compartido (sin textos duplicados en los componentes)', () => {
        for (const [label, path] of Object.entries(FLOWS)) {
            const source = readFileSync(path, 'utf8');
            // Cada superficie de stock se surte del catálogo…
            expect(source, `${label} importa el catálogo`).toContain('supervisorStockMessages');
            // …y ninguno redeclara en línea los textos unificados.
            for (const text of [
                'No se pudo actualizar el stock',
                'La caja rechazó el lote',
                'La orden expiró en la caja sin aplicarse',
                'Indica una cantidad mayor que cero.',
                'No se pudo enviar el movimiento',
                'La caja está desconectada; no se puede cambiar el stock',
                'Lote sin confirmar todavía',
                'Empaque guardado en el producto',
                'Egreso confirmado en la caja',
                'Ingreso confirmado en la caja',
                'aplicados; quedan',
            ]) {
                expect(source, `${label} no duplica «${text}»`).not.toContain(text);
            }
        }
    });

    it('las claves cubren las situaciones compartidas por ambos flujos', () => {
        for (const key of [
            'EGRESS_DISABLED',
            'BOX_OFFLINE_SEND',
            'BOX_OFFLINE_STOCK',
            'ADJUST_IN_FLIGHT',
            'STOCK_REVERT',
            'STOCK_UPDATE_FAILED',
            'PRODUCT_REQUIRED',
            'QUANTITY_REQUIRED',
            'PACKAGE_FACTOR_MISSING',
            'PACKAGE_FACTOR_INVALID',
            'STOCK_INSUFFICIENT',
            'REASON_REQUIRED',
            'REVIEW_LINES',
            'ACK_TIMEOUT',
            'ORDER_EXPIRED',
            'ORDER_NOT_CREATED',
            'BATCH_REJECTED',
            'BATCH_UNCONFIRMED',
            'PENDING_LINES',
            'BATCH_CONFIRMED',
            'BATCH_APPLIED_WITH_WARNINGS',
            'INGRESS_CONFIRMED',
            'EGRESS_CONFIRMED',
        ]) {
            expect(STOCK_MESSAGES[key], `falta la clave ${key}`).toBeTruthy();
        }
    });
});
