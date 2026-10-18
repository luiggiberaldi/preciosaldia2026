// @vitest-environment jsdom

/**
 * tests/productContextCatalogRace.test.jsx — ROJO-VERDE del hueco documentado en
 * docs/FIX-VENTAS-STOCK-SUPERVISOR.md §4 ("Hueco detectado 2026-10-18"):
 *
 * El cajero edita un producto (el guardado vive en el auto-save de
 * ProductContext, SIN pos_write_lock) mientras el supervisor manda una orden
 * `supervisor.product.update` para el MISMO producto. Sin serialización, el
 * último escritor gana y el cambio del otro se pierde en silencio — el monitor
 * muestra "Aplicado" pero la caja quedó con el estado viejo.
 *
 * Escenario reproducido aquí (el del informe):
 *   1. El cajero edita el nombre en estado (aún sin persistir; el auto-save
 *      tiene 1 s de debounce).
 *   2. Llega la orden del supervisor y se aplica tal como la aplica la caja
 *      (useRemoteCommands: RMW bajo withLock('pos_write_lock') + dispatch).
 *   3. El auto-save del cajero se despacha después.
 *
 * Esperado (VERDE con el cierre): ambos cambios sobreviven — nombre del cajero
 * Y precio del supervisor. ROJO hoy: un lado se pisa.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import localforage from 'localforage';

import { ProductProvider, useProductContext } from '../src/context/ProductContext';
import { storageService } from '../src/utils/storageService';
import {
    applySupervisorProductCommand,
    buildProductRevision,
} from '../src/services/supervisorProductCommand';
import { withLock } from '../src/utils/withLock';

// La carrera es local (caja): la nube no participa.
vi.mock('../src/hooks/useCloudSync', () => ({
    pushLocalSync: () => {},
    pushCloudSync: async () => ({ ok: true }),
    queueCloudSync: () => {},
}));

// RateContext dispara fetches de tasas; no es parte de esta carrera.
vi.mock('../src/context/RateContext', () => ({
    useRateContext: () => ({}),
}));

const captured = { current: null };
function Probe() {
    captured.current = useProductContext();
    return null;
}

const PRODUCTO_BASE = {
    id: 'p1',
    name: 'Café',
    priceUsd: 4,
    priceUsdt: 4,
    stock: 10,
    unit: 'unidad',
    category: 'General',
    updatedAt: '2026-10-18T10:00:00.000Z',
};

/** Aplica la orden del supervisor EXACTAMENTE como la aplica la caja:
 *  RMW bajo pos_write_lock + publicación + aviso a la UI (useRemoteCommands). */
async function aplicarOrdenSupervisor(productPatch) {
    await withLock('pos_write_lock', async () => {
        const current = await storageService.getItem('bodega_products_v1', []) || [];
        const existing = current.find(p => p.id === 'p1');
        const result = applySupervisorProductCommand(current, {
            action: 'edit',
            productId: 'p1',
            product: { id: 'p1', ...productPatch, baseRevision: buildProductRevision(existing) },
            baseRevision: buildProductRevision(existing),
        });
        await storageService.setItem('bodega_products_v1', result.products);
        window.dispatchEvent(new CustomEvent('app_storage_update', {
            detail: { key: 'bodega_products_v1', source: 'remote' },
        }));
    });
}

describe('carrera: edición del cajero vs orden del supervisor', () => {
    beforeEach(async () => {
        await localforage.clear();
        localStorage.clear();
        captured.current = null;
    });

    it('la orden y la edición se aplican sin pisarse (ambos cambios sobreviven)', async () => {
        await storageService.setItem('bodega_products_v1', [{ ...PRODUCTO_BASE }]);

        render(
            <ProductProvider>
                <Probe />
            </ProductProvider>
        );

        await waitFor(() => expect(captured.current?.products).toHaveLength(1));
        const ctx = captured.current;

        // 1. El cajero edita el nombre en la vista de Productos (estado + auto-save
        //    diferido de 1 s; aún nada persistido).
        act(() => {
            ctx.setProducts(prev => prev.map(p => (p.id === 'p1' ? { ...p, name: 'Café Premium' } : p)));
        });

        // 2. La orden del supervisor (cambio de precio) llega y se aplica EN LA
        //    VENTANA del debounce: la caja ya escribió el catálogo y confirmó.
        await act(async () => {
            await aplicarOrdenSupervisor({ priceUsd: 5, priceUsdt: 5 });
        });

        // 3. Se despacha el auto-save del cajero. El resultado correcto conserva
        //    los DOS cambios: el nombre del cajero y el precio del supervisor.
        await waitFor(async () => {
            const saved = await storageService.getItem('bodega_products_v1', []) || [];
            expect(saved).toHaveLength(1);
            expect(saved[0].name).toBe('Café Premium'); // edición del cajero
            expect(saved[0].priceUsd).toBe(5);          // orden del supervisor
            expect(saved[0].priceUsdt).toBe(5);
        }, { timeout: 4000 });

        // Y la UI de la caja también refleja ambos (sin estado fantasma).
        await waitFor(() => {
            expect(captured.current.products[0].name).toBe('Café Premium');
            expect(captured.current.products[0].priceUsd).toBe(5);
        }, { timeout: 4000 });
    });

    it('el ajuste rápido de stock del cajero tampoco revierte la orden del supervisor', async () => {
        await storageService.setItem('bodega_products_v1', [{ ...PRODUCTO_BASE }]);

        render(
            <ProductProvider>
                <Probe />
            </ProductProvider>
        );

        await waitFor(() => expect(captured.current?.products).toHaveLength(1));
        const ctx = captured.current;

        // La orden del supervisor primero (precio 5), y enseguida el cajero
        // descuenta stock con el ajuste rápido de la tarjeta.
        await act(async () => {
            await aplicarOrdenSupervisor({ priceUsd: 5, priceUsdt: 5 });
        });
        await act(async () => {
            ctx.adjustStock('p1', -3);
            // El ajuste escribe asincrónicamente; darle un turno de eventos.
            await new Promise(r => setTimeout(r, 50));
        });

        await waitFor(async () => {
            const saved = await storageService.getItem('bodega_products_v1', []) || [];
            expect(saved).toHaveLength(1);
            expect(saved[0].priceUsd).toBe(5); // orden del supervisor intacta
            expect(saved[0].stock).toBe(7);    // 10 − 3 del cajero
        }, { timeout: 4000 });
    });
});
