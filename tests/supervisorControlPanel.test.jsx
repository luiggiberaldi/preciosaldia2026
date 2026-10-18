// @vitest-environment jsdom

// ── Fase 4: panel Control tipo recibo (propuesta 3 completa) ────────────────
// Cuatro contadores (Sin subir · En espera de la caja · Aplicados · Anulados),
// cinco filtros (Todos/Pendientes/Aplicados/Anulados/Rechazados) y una
// ficha-recibo por comando con los sellos de la propuesta 7
// ("Recibido por la caja" → "Aplicado y verificado" → "No coincide — revisar").
// El detalle técnico (ack_payload, error_message) se conserva plegable.

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SupervisorControlPanel from '../src/components/Monitor/SupervisorControlPanel';
import { resetSupervisorCommandTracker } from '../src/services/supervisorCommandTracker';

const T0 = '2026-10-18T07:03:00.000Z';
const T1 = '2026-10-18T07:04:00.000Z';

const CMD_STOCK = {
    command_id: 'cmd-stock',
    command_type: 'supervisor.inventory.batch.adjust',
    status: 'applied',
    payload: {
        direction: 'ingreso', productId: 'p1', productName: 'Champu Papeleta',
        quantityInput: 8, inputUnit: 'unidades', unitsPerPackage: 1,
        expectedStock: 22, reason: 'Ajuste de stock',
    },
    issued_at: T0, created_at: T0, updated_at: T1,
    ack_payload: { stockAfter: 30 },
};

const CMD_WARNINGS = {
    command_id: 'cmd-warnings',
    command_type: 'supervisor.product.update',
    status: 'applied_with_warnings',
    payload: { productId: 'p2', patch: { name: 'Arroz Premium', baseRevision: 'rev' } },
    issued_at: T0, created_at: T0, updated_at: T1,
    ack_payload: { warnings: ['precio recalculado'] },
};

const CMD_PENDING = {
    command_id: 'cmd-pending',
    command_type: 'supervisor.product.create',
    status: 'pending',
    payload: { product: { id: 'p3', name: 'Atún' } },
    issued_at: T0, created_at: T0, updated_at: T0,
};

const CMD_CANCELLED = {
    command_id: 'cmd-cancelled',
    command_type: 'supervisor.user.delete',
    status: 'cancelled',
    payload: { userId: 9, nombre: 'Juan' },
    issued_at: T0, created_at: T0, updated_at: T1,
};

const CMD_REJECTED = {
    command_id: 'cmd-rejected',
    command_type: 'supervisor.product.delete',
    status: 'rejected',
    payload: { productId: 'p9', productName: 'Prueba' },
    issued_at: T0, created_at: T0, updated_at: T1,
    error_message: 'el producto ya no existe',
    ack_payload: { note: 'rechazado por la caja' },
};

const CMD_EXPIRED = {
    command_id: 'cmd-expired',
    command_type: 'supervisor.product.update',
    status: 'pending',
    payload: { productId: 'p4', patch: { name: 'Viejo', baseRevision: 'rev' } },
    issued_at: '2026-10-18T05:00:00.000Z',
    created_at: '2026-10-18T05:00:00.000Z',
    updated_at: '2026-10-18T05:00:00.000Z',
    expires_at: '2026-10-18T05:01:00.000Z', // vencido → derivado 'expired'
};

const ALL_COMMANDS = [CMD_STOCK, CMD_WARNINGS, CMD_PENDING, CMD_CANCELLED, CMD_REJECTED, CMD_EXPIRED];

function makeControl(overrides = {}) {
    return {
        commands: ALL_COMMANDS,
        counts: { total: 6, pending: 1, applied: 1, warnings: 1, failed: 1, cancelled: 1 },
        verifications: [],
        total: 6,
        page: 0,
        pageSize: 25,
        loading: false,
        refreshing: false,
        error: '',
        selectedCommand: null,
        detailLoading: false,
        actionId: null,
        refresh: vi.fn(),
        openDetail: vi.fn(),
        closeDetail: vi.fn(),
        cancel: vi.fn(async () => ({ ok: true })),
        retry: vi.fn(async () => ({ ok: true })),
        setPage: vi.fn(),
        ...overrides,
    };
}

const cardOf = (container, commandId) => container.querySelector(`[data-command-id="${commandId}"]`);
const filterButton = (container, label) => Array.from(container.querySelectorAll('button')).find(b => b.textContent.trim().startsWith(label));
const kpiValue = (container, id) => container.querySelector(`[data-testid="kpi-${id}"]`)?.textContent || '';

describe('SupervisorControlPanel (fichas-recibo)', () => {
    let container;
    let root;

    beforeEach(() => {
        globalThis.IS_REACT_ACT_ENVIRONMENT = true;
        resetSupervisorCommandTracker();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
    });

    const render = async (control, isConnected = true) => act(async () => root.render(
        <SupervisorControlPanel control={control} isConnected={isConnected} onToast={() => {}} />,
    ));

    it('muestra los cuatro contadores grandes mapeados desde los conteos reales', async () => {
        await render(makeControl());
        expect(kpiValue(container, 'sin-subir')).toContain('0');
        expect(kpiValue(container, 'en-espera')).toContain('1');
        expect(kpiValue(container, 'aplicados')).toContain('2'); // applied + con reservas
        expect(kpiValue(container, 'anulados')).toContain('1');
    });

    it('los cinco filtros cuentan y muestran exactamente sus comandos', async () => {
        await render(makeControl());
        expect(filterButton(container, 'Todos').textContent).toContain('(6)');
        expect(filterButton(container, 'Pendientes').textContent).toContain('(1)');
        expect(filterButton(container, 'Aplicados').textContent).toContain('(2)');
        expect(filterButton(container, 'Anulados').textContent).toContain('(1)');
        expect(filterButton(container, 'Rechazados').textContent).toContain('(2)'); // rechazado + expirado

        await act(async () => filterButton(container, 'Pendientes').click());
        expect(cardOf(container, 'cmd-pending')).toBeTruthy();
        expect(cardOf(container, 'cmd-stock')).toBeNull();

        await act(async () => filterButton(container, 'Aplicados').click());
        expect(cardOf(container, 'cmd-stock')).toBeTruthy();
        expect(cardOf(container, 'cmd-warnings')).toBeTruthy();
        expect(cardOf(container, 'cmd-pending')).toBeNull();

        await act(async () => filterButton(container, 'Anulados').click());
        expect(cardOf(container, 'cmd-cancelled')).toBeTruthy();
        expect(cardOf(container, 'cmd-stock')).toBeNull();

        await act(async () => filterButton(container, 'Rechazados').click());
        expect(cardOf(container, 'cmd-rejected')).toBeTruthy();
        expect(cardOf(container, 'cmd-expired')).toBeTruthy();
        expect(cardOf(container, 'cmd-cancelled')).toBeNull();

        await act(async () => filterButton(container, 'Todos').click());
        expect(container.querySelectorAll('[data-command-id]').length).toBe(6);
    });

    it('la ficha es un recibo completo: qué, quién, cuándo y sello', async () => {
        await render(makeControl());
        const card = cardOf(container, 'cmd-stock');
        const text = card.textContent;
        expect(text).toContain('Champu Papeleta');
        expect(text).toContain('AJUSTE DE STOCK (+8)');
        expect(text).toContain('Stock: +8 unidades');
        expect(text).toContain('Por: Supervisor');
        expect(text).toContain('Enviado:');
        expect(text).toContain('APLICADO EN CAJA EL');
        expect(text).toContain('Aplicado por la caja');
    });

    it('el sello de verificación de segundo nivel se muestra; un mismatch pinta la ficha', async () => {
        await render(makeControl({
            verifications: [
                { commandId: 'cmd-stock', level: 'verified', detail: 'confirmado' },
                { commandId: 'cmd-warnings', level: 'mismatch', detail: 'el eco no coincide' },
            ],
        }));

        expect(cardOf(container, 'cmd-stock').textContent).toContain('Aplicado y verificado');
        const mismatchCard = cardOf(container, 'cmd-warnings');
        expect(mismatchCard.textContent).toContain('No coincide — revisar');
        expect(mismatchCard.getAttribute('data-verification')).toBe('mismatch');
    });

    it('sin verificación registrada el sello por defecto es honesto: "Recibido por la caja"', async () => {
        await render(makeControl());
        expect(cardOf(container, 'cmd-stock').textContent).toContain('Recibido por la caja');
    });

    it('el detalle técnico queda plegable: error y respuesta de la caja a la vista solo al desplegar', async () => {
        await render(makeControl());
        const card = cardOf(container, 'cmd-rejected');
        expect(card.textContent).not.toContain('el producto ya no existe');

        const toggle = Array.from(card.querySelectorAll('button')).find(b => b.textContent.includes('Ver detalle técnico'));
        await act(async () => toggle.click());
        expect(card.textContent).toContain('el producto ya no existe');
        expect(card.textContent).toContain('rechazado por la caja');

        await act(async () => toggle.click());
        expect(card.textContent).not.toContain('rechazado por la caja');
    });

    it('estado vacío honesto cuando no hay cambios registrados', async () => {
        await render(makeControl({ commands: [], counts: { total: 0, pending: 0, applied: 0, warnings: 0, failed: 0, cancelled: 0 } }));
        expect(container.textContent).toContain('Todavía no hay cambios registrados');
    });

    it('una anulación tardía muestra el aviso honesto de arrepentimiento', async () => {
        const onToast = vi.fn();
        const control = makeControl({
            cancel: vi.fn(async () => ({
                ok: false,
                status: 'received',
                error: 'La orden ya no está pendiente (estado: received) y no se anuló',
            })),
        });
        await act(async () => root.render(
            <SupervisorControlPanel control={control} isConnected onToast={onToast} />,
        ));

        await act(async () => cardOf(container, 'cmd-pending')
            .querySelector('button')
            .click());

        const [, type] = onToast.mock.calls.at(-1);
        expect(type).toBe('error');
        expect(onToast.mock.calls.at(-1)[0]).toContain('El cambio puede haber llegado ya a la caja; verifica su estado.');
    });

    it('sin conexión muestra el aviso honesto y sigue enseñando lo cacheado', async () => {
        await render(makeControl(), false);
        expect(container.textContent).toContain('Sin conexión en tiempo real');
        expect(cardOf(container, 'cmd-stock')).toBeTruthy();
    });
});
