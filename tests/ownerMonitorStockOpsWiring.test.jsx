// @vitest-environment jsdom

// Cableado de OwnerMonitorView al servicio unificado de operaciones de stock
// (supervisorStockOps): el ajuste de fila +/− debe pasar por el MISMO servicio
// que el lote — estado provisional mientras la caja confirma, reversión y aviso
// al fallar, y plan de reconciliación al sincronizar.
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
    state: {
        products: [],
        effectiveRate: 3664.2,
        copEnabled: false,
    },
    sendBatch: vi.fn(),
    planSpy: vi.fn(),
    toast: vi.fn(),
    triggerRefresh: vi.fn(),
    // La inspección del comando se controla por test (por defecto: sin resolver).
    inspectImpl: async () => ({ state: 'unknown' }),
}));

vi.mock('../src/config/supabaseCloud', () => ({
    supabaseCloud: {
        channel: () => ({ on() { return this; }, subscribe() { return this; } }),
        removeChannel: () => Promise.resolve(),
    },
}));
vi.mock('../src/hooks/useCloudSync', () => ({ pushLocalSync: vi.fn(), pushCloudSync: vi.fn() }));
vi.mock('../src/utils/storageService', () => ({
    storageService: { getItem: vi.fn(async (_k, fallback) => fallback), setItem: vi.fn(async () => {}) },
}));
vi.mock('../src/components/Toast', () => ({ showToast: h.toast }));
vi.mock('../src/services/supervisorAuth', () => ({
    ensureSupervisorSession: vi.fn(async () => ({ session: { user: { id: 'auth-1' } }, error: null })),
}));
vi.mock('../src/services/supervisorCommandService', () => ({
    inspectSupervisorCommandState: vi.fn((...args) => h.inspectImpl(...args)),
    sendSupervisorCommand: vi.fn(async () => ({ ok: true })),
    claimSupervisorCommand: vi.fn(),
    fetchSupervisorCommandsForRecovery: vi.fn(async () => ({ data: [], error: null })),
    readSupervisorCommandAck: vi.fn(),
    SUPERVISOR_TERMINAL_COMMAND_STATUSES: [],
    withSupervisorCommandLock: vi.fn(async (_id, fn) => fn()),
}));
vi.mock('../src/hooks/useMonitorSync', () => ({
    useMonitorSync: () => ({
        isConnected: h.state.isConnected !== false,
        lastSync: null,
        loading: false,
        syncState: 'synced',
        stopMonitorSync: vi.fn(),
        syncError: null,
        triggerRefresh: h.triggerRefresh,
    }),
}));
vi.mock('../src/context/ProductContext', () => ({
    useProductContext: () => ({
        products: h.state.products,
        effectiveRate: h.state.effectiveRate,
        copEnabled: h.state.copEnabled,
    }),
}));
vi.mock('../src/hooks/useSupervisorControl', () => ({ useSupervisorControl: () => ({}) }));
vi.mock('../src/services/supervisorInventoryBatchSender', () => ({
    sendSupervisorInventoryBatch: h.sendBatch,
}));
// El servicio real es el que decide el estado; se envuelve SOLO para espiar que
// la vista pasa por él (nada de su lógica se sustituye).
vi.mock('../src/services/supervisorStockOps', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        planStockOpReconciliation: (...args) => {
            const plan = actual.planStockOpReconciliation(...args);
            h.planSpy(plan);
            return plan;
        },
    };
});

import OwnerMonitorView from '../src/views/OwnerMonitorView';
import { clearCommandDiagnostics, getReconciliations } from '../src/services/supervisorCommandDiagnostics';
import { getQueuedSupervisorCommands, resetSupervisorCommandQueue } from '../src/services/supervisorCommandQueue';
import { sendSupervisorCommand } from '../src/services/supervisorCommandService';

const PRODUCT = {
    id: 'p1',
    name: 'Detodito Grande',
    barcode: '7591206285584',
    category: 'Snacks',
    stock: 10,
    priceUsd: 3.8,
    costPrice: 0,
    minStock: 5,
    isWeight: false,
    isActive: true,
};

async function flush() {
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
    });
}

describe('OwnerMonitorView · ajuste de fila unificado con supervisorStockOps', () => {
    let container;
    let root;

    beforeEach(async () => {
        globalThis.IS_REACT_ACT_ENVIRONMENT = true;
        h.state.products = [{ ...PRODUCT }];
        h.state.isConnected = true;
        h.sendBatch.mockReset();
        h.planSpy.mockClear();
        h.toast.mockClear();
        h.triggerRefresh.mockClear();
        h.inspectImpl = async () => ({ state: 'unknown' });
        await clearCommandDiagnostics();
        resetSupervisorCommandQueue();
        localStorage.clear();
        localStorage.setItem('pda_paired_device_id', 'device-12345678');
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root?.unmount());
        container?.remove();
    });

    const row = () => container.querySelector('[data-testid="supervisor-product-row-p1"]');
    const button = (label) => [...row().querySelectorAll('button')]
        .find(element => (element.getAttribute('aria-label') || element.textContent || '').includes(label));

    async function mountAndOpenInventory() {
        await act(async () => root.render(<OwnerMonitorView theme="light" toggleTheme={() => {}} triggerHaptic={() => {}} rates={{}} />));
        await flush();
        const tab = [...container.querySelectorAll('button')].find(element => element.textContent.trim() === 'Inventario');
        await act(async () => { tab.click(); });
        expect(row()).toBeTruthy();
    }

    async function stepUpAndConfirm() {
        // Flujo real del UX actual: abrir el editor inline, ajustar con +/−,
        // confirmar el nuevo stock y luego confirmar el cambio en la franja.
        await act(async () => { button('Editar stock de Detodito Grande').click(); });
        await act(async () => { button('Subir stock de Detodito Grande').click(); });
        await act(async () => { button('Confirmar nuevo stock').click(); });
        await act(async () => { button('Confirmar cambio').click(); });
        await flush();
    }

    it('el +/− pasa por beginStockAdjust del servicio: estado provisional y objetivo creído', async () => {
        let resolveSend;
        h.sendBatch.mockImplementation(() => new Promise((resolve) => { resolveSend = resolve; }));
        await mountAndOpenInventory();

        await stepUpAndConfirm();

        // El envío usa el mismo canal batch v2 que el lote…
        expect(h.sendBatch).toHaveBeenCalledTimes(1);
        expect(h.sendBatch.mock.calls[0][0]).toMatchObject({ targetDeviceId: 'device-12345678' });
        // …y mientras la caja confirma, la fila muestra el objetivo provisional
        // (estado 'sending' del servicio unificado).
        expect(row().textContent).toContain('Enviando cambio de stock');
        expect(row().querySelector('button[aria-label^="Stock provisional"]')).toBeTruthy();

        // Confirmado: applied del servicio → chip de éxito y objetivo creído 11.
        await act(async () => {
            resolveSend({ ok: true, status: 'applied', commandId: 'cmd-1' });
        });
        await flush();
        expect(row().textContent).toContain('Stock actualizado en la caja');
        expect(row().textContent).toContain('11 u');

        // Al sincronizar la caja (stock 11), el plan del servicio programa el
        // retiro de la franja — la reconciliación también vive en el servicio.
        h.planSpy.mockClear();
        h.state.products = [{ ...PRODUCT, stock: 11 }];
        await act(async () => root.render(<OwnerMonitorView theme="light" toggleTheme={() => {}} triggerHaptic={() => {}} rates={{}} />));
        await flush();
        const plans = h.planSpy.mock.calls.map(([plan]) => plan);
        expect(plans.some(plan => plan.retire.some(entry => entry.id === 'p1' && entry.targetStock === 11))).toBe(true);
    });

    it('una venta posterior en la caja se descuenta en la fila (el objetivo creído se retira)', async () => {
        // El eco de productos vigente al iniciar el ajuste tiene la marca W0.
        localStorage.setItem('supervisor_sync_updated_at_bodega_products_v1', '2026-10-18T10:00:00.000Z');
        h.sendBatch.mockResolvedValue({ ok: true, status: 'applied', commandId: 'cmd-1' });
        await mountAndOpenInventory();

        await stepUpAndConfirm();

        // Aplicado en la caja y sin eco aún: la fila conserva el objetivo creído.
        expect(row().textContent).toContain('Stock actualizado en la caja');
        expect(row().textContent).toContain('11 u');

        // Luego la caja publica un eco MÁS NUEVO (W1) con una venta ya descontada.
        localStorage.setItem('supervisor_sync_updated_at_bodega_products_v1', '2026-10-18T10:05:00.000Z');
        h.planSpy.mockClear();
        h.state.products = [{ ...PRODUCT, stock: 8 }];
        await act(async () => root.render(<OwnerMonitorView theme="light" toggleTheme={() => {}} triggerHaptic={() => {}} rates={{}} />));
        await flush();

        // El objetivo quedó viejo y el servicio lo retiró al instante: el
        // descuento de la venta se ve ya en la fila (manda el sincronizado).
        const plans = h.planSpy.mock.calls.map(([plan]) => plan);
        expect(plans.some(plan => plan.superseded.some(entry => entry.id === 'p1' && entry.targetStock === 11))).toBe(true);
        expect(row().textContent).toContain('8 u');
        expect(row().textContent).not.toContain('Stock actualizado en la caja');
        expect(row().querySelector('button[aria-label^="Stock provisional"]')).toBe(null);
    });

    it('sin conexión el ajuste se guarda en la cola local (EN COLA) y se sube solo al reconectar', async () => {
        h.state.isConnected = false;
        await mountAndOpenInventory();

        await stepUpAndConfirm();

        // No se envió nada: el cambio quedó guardado en la cola local.
        expect(h.sendBatch).not.toHaveBeenCalled();
        expect(getQueuedSupervisorCommands()).toHaveLength(1);
        expect(getQueuedSupervisorCommands()[0]).toMatchObject({ kind: 'stock', type: 'supervisor.inventory.batch.adjust' });
        // La fila muestra el objetivo creído con la etiqueta honesta "EN COLA".
        expect(row().textContent).toContain('EN COLA');
        expect(row().textContent).toContain('11 u');
        expect(h.toast).toHaveBeenCalledWith('Cambio guardado en la cola — se subirá cuando vuelva la conexión', 'info');

        // Al volver la conexión, el barrido automático lo sube y pasa a
        // "esperando a la caja" con su commandId (la reconciliación sigue).
        sendSupervisorCommand.mockResolvedValueOnce({
            ok: true,
            commandId: 'cmd-queued-1',
            ackPromise: Promise.resolve({ ok: true, status: 'applied', commandId: 'cmd-queued-1', ack: null, error: null }),
        });
        h.state.isConnected = true;
        await act(async () => root.render(<OwnerMonitorView theme="light" toggleTheme={() => {}} triggerHaptic={() => {}} rates={{}} />));
        await flush();
        await flush();

        expect(getQueuedSupervisorCommands()).toHaveLength(0);
        expect(sendSupervisorCommand).toHaveBeenCalledWith(expect.objectContaining({
            type: 'supervisor.inventory.batch.adjust',
            targetDeviceId: 'device-12345678',
        }));
        expect(row().querySelector('button[aria-label^="Stock provisional"]')).toBeTruthy();
        expect(row().textContent).not.toContain('EN COLA');
    });

    it('si la caja concluye fallo, el servicio revierte el stock y se anuncia la reversión', async () => {
        h.sendBatch.mockResolvedValue({ ok: false, uncertain: false, status: 'rejected', error: 'La caja rechazó el cambio de stock' });
        await mountAndOpenInventory();

        await stepUpAndConfirm();

        // applyStockOpResult (announce: true) → estado failed con error visible y
        // botón de reintento…
        expect(row().textContent).toContain('La caja rechazó el cambio de stock');
        expect(button('Reintentar')).toBeTruthy();
        // …y la reversión del valor provisional: el stock vuelve al sincronizado.
        expect(row().textContent).toContain('10 u');
        expect(row().querySelector('button[aria-label^="Stock provisional"]')).toBe(null);
        expect(h.toast).toHaveBeenCalledWith('No se aplicó el cambio de stock; se revirtió el valor provisional', 'error');
    });
});

describe('OwnerMonitorView · diagnóstico de comandos y reconciliación de fila', () => {
    let container;
    let root;

    beforeEach(async () => {
        globalThis.IS_REACT_ACT_ENVIRONMENT = true;
        h.state.products = [{ ...PRODUCT }];
        h.sendBatch.mockReset();
        h.toast.mockClear();
        h.triggerRefresh.mockClear();
        h.inspectImpl = async () => ({ state: 'unknown' });
        await clearCommandDiagnostics();
        localStorage.clear();
        localStorage.setItem('pda_paired_device_id', 'device-12345678');
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root?.unmount());
        container?.remove();
    });

    const row = () => container.querySelector('[data-testid="supervisor-product-row-p1"]');
    const button = (label) => [...row().querySelectorAll('button')]
        .find(element => (element.getAttribute('aria-label') || element.textContent || '').includes(label));

    async function mountAndOpenInventory() {
        await act(async () => root.render(<OwnerMonitorView theme="light" toggleTheme={() => {}} triggerHaptic={() => {}} rates={{}} />));
        await flush();
        const tab = [...container.querySelectorAll('button')].find(element => element.textContent.trim() === 'Inventario');
        await act(async () => { tab.click(); });
        expect(row()).toBeTruthy();
    }

    it('los diagnósticos están ocultos en el encabezado por defecto', async () => {
        await act(async () => root.render(<OwnerMonitorView theme="light" toggleTheme={() => {}} triggerHaptic={() => {}} rates={{}} />));
        await flush();
        expect(container.querySelector('button[title="Diagnóstico de Comandos"]')).toBeNull();
        expect(container.querySelector('button[title="Diagnóstico de Sincronización"]')).toBeNull();
    });

    it('con ?diag=1 el botón del encabezado abre el panel de diagnóstico de comandos', async () => {
        window.history.replaceState(null, '', '/?diag=1');
        await act(async () => root.render(<OwnerMonitorView theme="light" toggleTheme={() => {}} triggerHaptic={() => {}} rates={{}} />));
        await flush();
        window.history.replaceState(null, '', '/');

        const diagnosticsButton = container.querySelector('button[title="Diagnóstico de Comandos"]');
        expect(diagnosticsButton).toBeTruthy();
        await act(async () => diagnosticsButton.click());
        await flush();

        // El panel está montado y carga el diagnóstico (vacío en esta corrida).
        expect(container.textContent).toContain('Diagnóstico de comandos');
        expect(container.textContent).toContain('Estado, latencia del ACK y reconciliaciones por commandId');
        expect(container.querySelector('[data-testid="diagnostics-empty"]')).toBeTruthy();
    });

    it('la reconciliación de una fila queda registrada por commandId en el diagnóstico', async () => {
        // El ajuste queda incierto; la caja lo resuelve sola en la consulta del
        // comando → la fila se reconcilia y el diagnóstico lo registra.
        h.sendBatch.mockResolvedValue({
            ok: false,
            uncertain: true,
            status: 'timeout',
            commandId: 'cmd-fila-1',
            error: 'La caja no confirmó la orden a tiempo',
        });
        h.inspectImpl = async () => ({ state: 'terminal', ack: { status: 'applied' } });

        await mountAndOpenInventory();
        await act(async () => { button('Editar stock de Detodito Grande').click(); });
        await act(async () => { button('Subir stock de Detodito Grande').click(); });
        await act(async () => { button('Confirmar nuevo stock').click(); });
        await act(async () => { button('Confirmar cambio').click(); });
        await flush();

        // La fila quedó reconciliada como aplicada…
        expect(row().textContent).toContain('Stock actualizado en la caja');
        // …y el diagnóstico tiene la reconciliación por commandId.
        const recorded = getReconciliations().filter(entry => entry.commandId === 'cmd-fila-1');
        expect(recorded).toHaveLength(1);
        expect(recorded[0]).toMatchObject({ source: 'fila', via: 'auto', outcome: 'applied' });
    });
});
