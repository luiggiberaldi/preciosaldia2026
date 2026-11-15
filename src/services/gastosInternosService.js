/**
 * gastosInternosService.js — Escritura segura de «Gastos internos».
 *
 * Nómina F0 (docs/plans/2026-11-14-plan-nomina-simple-bodega.md). Antes el hook
 * guardaba la lista de ventas que tenía la pantalla, sin candado: un gasto podía
 * pisar una venta hecha al mismo tiempo en otra pestaña. Ahora:
 *   1. todo pasa bajo `pos_write_lock` (el mismo candado de las ventas),
 *   2. se lee la lista FRESCA dentro del candado,
 *   3. después de guardar se relee y se confirma que el cambio quedó.
 *
 * Analogía: antes se escribía en una copia del cuaderno y se pegaba encima del
 * original; ahora se toma el cuaderno real, se anota y se revisa que quedó escrito.
 *
 * @module services/gastosInternosService
 */

import { storageService } from '../utils/storageService';
import { withLock } from '../utils/withLock';
import { findOpenCashShift } from '../utils/cashShift';
import { isGranelProduct, adjustStockValue } from '../utils/granel';
import { requiresOpenCash, canVoidGastoFromList, CAJA_CERRADA_MSG } from '../utils/gastoInterno';

export const SALES_KEY = 'bodega_sales_v1';
export const PRODUCTS_KEY = 'bodega_products_v1';
export const POS_LOCK = 'pos_write_lock';

/**
 * Relee las ventas y confirma que cada registro esperado está como se escribió.
 * No compara la lista entera (puede ser muy grande): solo los registros tocados.
 */
export async function confirmSalesRecords(storage, expectedRecords) {
    const readBack = await storage.getItem(SALES_KEY, []);
    const byId = new Map((Array.isArray(readBack) ? readBack : []).map(r => [r?.id, r]));
    for (const expected of expectedRecords) {
        const found = byId.get(expected.id);
        if (!found || JSON.stringify(found) !== JSON.stringify(expected)) {
            throw new Error('El gasto no se confirmó en el almacenamiento del equipo. Intenta de nuevo.');
        }
    }
    return readBack;
}

/**
 * Agrega uno o más registros a las ventas, bajo candado y con lectura fresca.
 * Si alguno saca efectivo, exige caja abierta.
 *
 * Debe llamarse YA dentro del candado (lo usa también la nómina, que necesita
 * escribir más cosas en la misma vuelta).
 */
export async function appendSalesRecordsUnlocked(storage, records) {
    const freshSales = await storage.getItem(SALES_KEY, []);
    const list = Array.isArray(freshSales) ? freshSales : [];
    if (records.some(requiresOpenCash) && !findOpenCashShift(list)) {
        throw new Error(CAJA_CERRADA_MSG);
    }
    const ids = new Set(list.map(r => r?.id));
    const nuevos = records.filter(r => !ids.has(r.id));
    const updated = [...nuevos, ...list];
    await storage.setItem(SALES_KEY, updated);
    await confirmSalesRecords(storage, records);
    return updated;
}

/** Guarda un gasto normal. Devuelve la lista de ventas actualizada. */
export async function saveGastoInterno(record, { storage = storageService, lock = withLock } = {}) {
    return lock(POS_LOCK, () => appendSalesRecordsUnlocked(storage, [record]));
}

/**
 * Guarda un autoconsumo: baja el inventario y agrega el gasto en la misma vuelta.
 */
export async function saveAutoconsumo(record, items, { storage = storageService, lock = withLock, allowNegative = false } = {}) {
    return lock(POS_LOCK, async () => {
        const freshProducts = await storage.getItem(PRODUCTS_KEY, []);
        const updatedProducts = freshProducts.map(p => {
            const cartItem = items.find(i => i.id === p.id);
            if (!cartItem) return p;
            const newStock = adjustStockValue(p.stock ?? 0, -cartItem.qty, isGranelProduct(p));
            return { ...p, stock: allowNegative ? newStock : Math.max(0, newStock) };
        });
        await storage.setItem(PRODUCTS_KEY, updatedProducts);
        return appendSalesRecordsUnlocked(storage, [record]);
    });
}

/**
 * Anula un gasto desde la lista de Gastos internos (marca `ANULADA`, nunca crea
 * un movimiento al revés). Si es autoconsumo, devuelve el stock.
 *
 * @returns {Promise<{ updatedSales: Array, gasto: object }>}
 */
export async function voidGastoInterno(gastoId, { storage = storageService, lock = withLock, usuario = null, now = new Date() } = {}) {
    return lock(POS_LOCK, async () => {
        const freshSales = await storage.getItem(SALES_KEY, []);
        const target = freshSales.find(s => s?.id === gastoId && s?.tipo === 'GASTO_INTERNO');
        const check = canVoidGastoFromList(target);
        if (!check.ok) throw new Error(check.reason);

        if (target.isAutoconsumo && Array.isArray(target.items)) {
            const freshProducts = await storage.getItem(PRODUCTS_KEY, []);
            const restored = freshProducts.map(p => {
                const item = target.items.find(i => i.id === p.id);
                if (!item) return p;
                return { ...p, stock: adjustStockValue(p.stock ?? 0, item.qty, isGranelProduct(p)) };
            });
            await storage.setItem(PRODUCTS_KEY, restored);
        }

        const voided = {
            ...target,
            status: 'ANULADA',
            voidedAt: now.toISOString(),
            voidedBy: usuario?.nombre || 'Sin sesión',
            voidedById: usuario?.id ?? null,
        };
        const updatedSales = freshSales.map(s => (s?.id === gastoId ? voided : s));
        await storage.setItem(SALES_KEY, updatedSales);
        await confirmSalesRecords(storage, [voided]);
        return { updatedSales, gasto: voided };
    });
}
