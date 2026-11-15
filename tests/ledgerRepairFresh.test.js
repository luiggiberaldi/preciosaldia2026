// F1 del PLAN-FIXEO-CLIENTES-BILLETERA (ERR-016): «Reparar cartera» en Reportes
// reescribía la lista de clientes con lo que la pantalla tenía en memoria. Con la
// caja cobrando en otra pestaña (el aviso de guardado no cruza pestañas), se
// perdían saldos nuevos y clientes creados después. Ahora la reparación lee todo
// de nuevo dentro del candado y solo toca a los clientes descuadrados.
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
    useAuthStore: { getState: () => ({ usuarioActivo: { id: 'u1', nombre: 'Admin', rol: 'ADMIN' } }) },
}));

import { CUSTOMER_LEDGER_KEY, CUSTOMER_MOVEMENT_TYPES, rebuildCustomersFromLedger } from '../src/utils/customerLedger';
import { applyCustomerMovement, rebuildAllCustomersFromLedger } from '../src/services/customerWalletService';
import { reconcileCustomersWithLedger } from '../src/utils/pocketReconciliation';

const CUSTOMERS = 'bodega_customers_v1';
const abono = (id, amountUsd) => ({
    type: CUSTOMER_MOVEMENT_TYPES.DEBT_PAYMENT, direction: 'CREDIT', amountUsd,
    sourceType: 'SALE', sourceId: `${id}:cartera`, sourceSaleId: id, reason: 'Abono',
});
const fiado = (id, amountUsd) => ({
    type: CUSTOMER_MOVEMENT_TYPES.CREDIT_SALE, direction: 'DEBIT', amountUsd,
    sourceType: 'SALE', sourceId: `${id}:fiado`, sourceSaleId: id, reason: 'Fiado',
});

beforeEach(() => memoryStore.clear());

async function escenario() {
    memoryStore.set(CUSTOMERS, [
        { id: 'ana', name: 'Ana', deuda: 0, favor: 0 },
        { id: 'beto', name: 'Beto', deuda: 0, favor: 0 },
    ]);
    await applyCustomerMovement({ customerId: 'ana', movement: fiado('v1', 10) });
    await applyCustomerMovement({ customerId: 'beto', movement: fiado('v2', 4) });
    // Descuadre a reparar: el registro de Ana dice $12, el ledger dice $10.
    memoryStore.set(CUSTOMERS, memoryStore.get(CUSTOMERS).map(c => c.id === 'ana' ? { ...c, deuda: 12 } : c));
    // Lo que Reportes tenía en memoria en ese momento:
    const pantalla = { customers: memoryStore.get(CUSTOMERS), ledger: memoryStore.get(CUSTOMER_LEDGER_KEY) };
    // Mientras tanto, en otra pestaña: Beto abona $4 y se crea a Carla.
    await applyCustomerMovement({ customerId: 'beto', movement: abono('a1', 4) });
    memoryStore.set(CUSTOMERS, [...memoryStore.get(CUSTOMERS), { id: 'carla', name: 'Carla', deuda: 0, favor: 0 }]);
    return pantalla;
}

describe('Reparar cartera (Reportes)', () => {
    it('ANTES: reparar con lo que había en pantalla devolvía la deuda de Beto y borraba a Carla', async () => {
        const pantalla = await escenario();
        const viejo = rebuildCustomersFromLedger(pantalla.customers, pantalla.ledger);
        expect(viejo.find(c => c.id === 'beto').deuda).toBe(4); // ya había pagado
        expect(viejo.some(c => c.id === 'carla')).toBe(false);
    });

    it('AHORA: lee de nuevo, repara a Ana y no toca lo que pasó en otra pestaña', async () => {
        await escenario();
        const r = await rebuildAllCustomersFromLedger();
        const guardado = memoryStore.get(CUSTOMERS);
        expect(r.repairedIds).toEqual(['ana']);
        expect(guardado.find(c => c.id === 'ana')).toMatchObject({ deuda: 10, favor: 0 });
        expect(guardado.find(c => c.id === 'beto')).toMatchObject({ deuda: 0, favor: 0 });
        expect(guardado.some(c => c.id === 'carla')).toBe(true);
        expect(reconcileCustomersWithLedger(guardado, memoryStore.get(CUSTOMER_LEDGER_KEY)).ok).toBe(true);
    });

    it('no reescribe a los clientes que ya cuadran (mismos datos, misma versión)', async () => {
        await escenario();
        const antes = memoryStore.get(CUSTOMERS).find(c => c.id === 'beto');
        await rebuildAllCustomersFromLedger();
        expect(memoryStore.get(CUSTOMERS).find(c => c.id === 'beto')).toEqual(antes);
    });

    it('sin descuadres no guarda nada', async () => {
        memoryStore.set(CUSTOMERS, [{ id: 'ana', name: 'Ana', deuda: 0, favor: 0 }]);
        await applyCustomerMovement({ customerId: 'ana', movement: fiado('v1', 3) });
        const { storageService } = await import('../src/utils/storageService');
        storageService.setItem.mockClear();
        const r = await rebuildAllCustomersFromLedger();
        expect(r.repairedIds).toEqual([]);
        expect(storageService.setItem).not.toHaveBeenCalled();
    });

    it('espera al candado: un abono en curso termina antes de reparar', async () => {
        await escenario();
        const [, r] = await Promise.all([
            applyCustomerMovement({ customerId: 'ana', movement: abono('a2', 10) }),
            rebuildAllCustomersFromLedger(),
        ]);
        // La reparación ve el abono ya guardado (no lo pisa): cliente y ledger quedan iguales.
        expect(r.ledger.some(m => m.sourceId === 'a2:cartera')).toBe(true);
        expect(reconcileCustomersWithLedger(memoryStore.get(CUSTOMERS), memoryStore.get(CUSTOMER_LEDGER_KEY)).ok).toBe(true);
    });
});
