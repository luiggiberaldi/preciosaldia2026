// @vitest-environment jsdom

// ── Propuesta 4: etiqueta de estado en cada producto ───────────────────────
// "EN COLA" (sin enviar) → "ESPERANDO A LA CAJA" (en vuelo) → "APLICADO"
// (confirmado reciente). Nunca dos etiquetas contradictorias; sin actividad,
// sin etiqueta.

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { APPLIED_BADGE_MS, productQueueState } from '../src/services/supervisorCommandQueue';
import ProductStateBadge from '../src/components/Monitor/ProductStateBadge';

const NOW = Date.parse('2026-10-18T12:00:00.000Z');
const queueEntryFor = (productId) => ({ id: 'q1', productIds: [productId] });

describe('productQueueState: el badge sale del estado real', () => {
    it('cambio sin enviar → EN COLA', () => {
        const state = productQueueState({ productId: 'p1', queueEntries: [queueEntryFor('p1')], now: NOW });
        expect(state).toMatchObject({ key: 'queued', label: 'EN COLA' });
    });

    it('comando en vuelo → ESPERANDO A LA CAJA (por op o por tracker)', () => {
        expect(productQueueState({ productId: 'p1', stockOp: { state: 'sending' }, now: NOW }))
            .toMatchObject({ key: 'waiting', label: 'ESPERANDO A LA CAJA' });
        expect(productQueueState({ productId: 'p1', stockOp: { state: 'pending' }, now: NOW }))
            .toMatchObject({ key: 'waiting' });
        expect(productQueueState({ productId: 'p1', trackedInFlight: true, now: NOW }))
            .toMatchObject({ key: 'waiting' });
    });

    it('ACK terminal reciente → APLICADO; viejo → sin etiqueta', () => {
        expect(productQueueState({ productId: 'p1', stockOp: { state: 'applied' }, now: NOW }))
            .toMatchObject({ key: 'applied', label: 'APLICADO' });
        expect(productQueueState({
            productId: 'p1',
            trackedAppliedAt: new Date(NOW - 60_000).toISOString(),
            now: NOW,
        })).toMatchObject({ key: 'applied' });
        expect(productQueueState({
            productId: 'p1',
            trackedAppliedAt: new Date(NOW - APPLIED_BADGE_MS - 1000).toISOString(),
            now: NOW,
        })).toBeNull();
    });

    it('sin actividad reciente no hay etiqueta (un APLICADO eterno sería ruido)', () => {
        expect(productQueueState({ productId: 'p1', now: NOW })).toBeNull();
        expect(productQueueState({ productId: 'p1', stockOp: { state: 'failed' }, now: NOW })).toBeNull();
    });

    it('con cola Y envío a la vez, EN COLA nunca desaparece mientras haya algo sin subir', () => {
        const state = productQueueState({
            productId: 'p1',
            queueEntries: [queueEntryFor('p1')],
            stockOp: { state: 'sending', targetStock: 30 },
            trackedInFlight: true,
            now: NOW,
        });
        expect(state).toMatchObject({ key: 'queued', label: 'EN COLA' });
    });
});

describe('ProductStateBadge (la etiqueta visible)', () => {
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

    it('pinta la etiqueta con su estado como atributo', async () => {
        await act(async () => root.render(
            <ProductStateBadge state={{ key: 'waiting', label: 'ESPERANDO A LA CAJA', tone: 'warning' }} />,
        ));
        const badge = container.querySelector('[data-product-state="waiting"]');
        expect(badge).toBeTruthy();
        expect(badge.textContent).toContain('ESPERANDO A LA CAJA');
    });

    it('sin estado no pinta nada', async () => {
        await act(async () => root.render(<ProductStateBadge state={null} />));
        expect(container.querySelector('[data-product-state]')).toBeNull();
        expect(container.textContent).toBe('');
    });
});
