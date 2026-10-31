// @vitest-environment jsdom
// Bloque «Guardadas en la caja, sincronizando…» del Supervisor.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import PurchasesPendingSync from '../src/components/Monitor/PurchasesPendingSync';

let container;
let root;
beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});
afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
});

const command = (minutesAgo) => ({
    command_id: 'c1',
    command_type: 'supervisor.purchase.upsert',
    status: 'applied_with_warnings',
    issued_at: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    payload: { v: 1, purchase: { id: 'p1', date: '2026-10-01', supplier: 'COLORANTES', note: '01', amountUsd: 37, updatedAt: 'u1' } },
});

describe('PurchasesPendingSync', () => {
    it('muestra la compra confirmada que aún no llega y avisa si tarda', async () => {
        await act(async () => root.render(<PurchasesPendingSync commands={[command(30)]} purchases={[]} />));
        const block = container.querySelector('[data-testid="purchases-pending-sync"]');
        expect(block.textContent).toContain('Guardadas en la caja, sincronizando… (1)');
        expect(block.textContent).toContain('COLORANTES');
        expect(block.textContent).toContain('01/10/2026');
        expect(container.querySelector('[data-testid="purchases-sync-stale"]')).not.toBeNull();
    });

    it('sin aviso si es reciente y desaparece cuando la compra llega', async () => {
        await act(async () => root.render(<PurchasesPendingSync commands={[command(1)]} purchases={[]} />));
        expect(container.querySelector('[data-testid="purchases-sync-stale"]')).toBeNull();
        await act(async () => root.render(<PurchasesPendingSync commands={[command(1)]} purchases={[{ id: 'p1', updatedAt: 'u1' }]} />));
        expect(container.querySelector('[data-testid="purchases-pending-sync"]')).toBeNull();
    });
});
