import { describe, expect, it, vi } from 'vitest';
import {
    calculateSupervisorInventoryBatchAdjustment,
    calculateSupervisorInventoryBatchPlan,
    applySupervisorInventoryBatchTransaction,
    recoverSupervisorInventoryJournal,
    retryInventoryPublish,
} from '../src/services/supervisorInventoryCommand';

describe('Supervisor inventory batch command', () => {
    const product = { id: 'product-1', name: 'Arroz', stock: 10, costPrice: 1 };
    const payload = {
        direction: 'ingreso',
        productId: 'product-1',
        quantityInput: 2,
        inputUnit: 'cajas',
        unitsPerPackage: 24,
        expectedStock: 10,
        reason: 'Mercancía recibida',
        lotReference: 'LOTE-001',
    };

    describe('plan puro multiartículo (Fase 8)', () => {
        const batchPayload = {
            direction: 'ingreso',
            reason: 'Recepción',
            reasonCategory: undefined,
            lotReference: 'LOTE-10',
            lines: [
                { lineId: 'line-a', productId: 'product-1', quantityInput: 2, inputUnit: 'cajas', unitsPerPackage: 24, expectedStock: 10 },
                { lineId: 'line-b', productId: 'product-2', quantityInput: 3, inputUnit: 'unidades', expectedStock: 5 },
            ],
        };
        const batchProducts = [product, { id: 'product-2', name: 'Aceite', stock: 5, costPrice: 2 }];

        it('no devuelve plan parcial si la segunda línea entra en conflicto', () => {
            const conflictingPayload = {
                ...batchPayload,
                lines: [batchPayload.lines[0], { ...batchPayload.lines[1], expectedStock: 4 }],
            };
            let plan;
            expect(() => {
                plan = calculateSupervisorInventoryBatchPlan(batchProducts, [], conflictingPayload, {
                    commandId: 'command-multi-1', timestamp: '2026-10-16T12:00:00.000Z',
                });
            }).toThrow(/stock cambió/i);
            expect(plan).toBeUndefined();
        });

        it('calcula productos e historial completos sin mutar los originales', () => {
            const beforeProducts = structuredClone(batchProducts);
            const beforeSales = [{ id: 'sale-existing' }];
            const result = calculateSupervisorInventoryBatchPlan(batchProducts, beforeSales, batchPayload, {
                commandId: 'command-multi-1', timestamp: '2026-10-16T12:00:00.000Z',
            });
            expect(result.updatedProducts.map(item => item.stock)).toEqual([58, 8]);
            expect(result.updatedSales).toHaveLength(3);
            expect(result.lineResults).toHaveLength(2);
            expect(result.lineResults.map(item => item.unitsDelta)).toEqual([48, 3]);
            expect(batchProducts).toEqual(beforeProducts);
            expect(beforeSales).toEqual([{ id: 'sale-existing' }]);
        });

        it('produce IDs estables por commandId y línea en reintentos', () => {
            const first = calculateSupervisorInventoryBatchPlan(batchProducts, [], batchPayload, { commandId: 'command-multi-retry' });
            const retry = calculateSupervisorInventoryBatchPlan(batchProducts, [], batchPayload, { commandId: 'command-multi-retry' });
            expect(retry.lineResults.map(item => item.movement.movementId)).toEqual(first.lineResults.map(item => item.movement.movementId));
            expect(first.lineResults.map(item => item.movement.movementId)).toEqual([
                'supervisor-command-multi-retry-line-a',
                'supervisor-command-multi-retry-line-b',
            ]);
        });

        it('rechaza producto y unidad duplicados, pero permite varias unidades del mismo producto sobre la misma base', () => {
            const duplicateUnit = {
                ...batchPayload,
                lines: [batchPayload.lines[0], { ...batchPayload.lines[0], lineId: 'line-a-copy' }],
            };
            expect(() => calculateSupervisorInventoryBatchPlan(batchProducts, [], duplicateUnit, {
                commandId: 'command-multi-dup',
            })).toThrow(/líneas duplicadas/i);

            const distinctUnits = {
                ...batchPayload,
                lines: [
                    batchPayload.lines[0],
                    { ...batchPayload.lines[0], lineId: 'line-c', inputUnit: 'unidades', quantityInput: 2 },
                ],
            };
            const result = calculateSupervisorInventoryBatchPlan(batchProducts, [], distinctUnits, {
                commandId: 'command-multi-units',
            });
            expect(result.updatedProducts[0].stock).toBe(60);
            expect(result.lineResults.map(item => item.stockBefore)).toEqual([10, 58]);
        });

        it('no consulta storage ni red al construir un plan', () => {
            const plan = calculateSupervisorInventoryBatchPlan(batchProducts, [], batchPayload, { commandId: 'command-pure' });
            expect(plan.updatedProducts).toHaveLength(2);
            expect(plan.updatedSales).toHaveLength(2);
        });

        it('gate de defensa del desacople: el plan solo difiere del catálogo en el stock de los productos tocados', () => {
            // El desacople de la publicación de productos se apoya en que el
            // lote es stock-puro (§2 del plan 2026-10-22). Si un comando futuro
            // toca lotes, precios u otros campos, este gate falla y el call-site
            // debe volver a publicar el catálogo (decisión explícita, nunca un
            // diff frágil de "¿cambió solo stock?" en runtime).
            const result = calculateSupervisorInventoryBatchPlan(batchProducts, [], batchPayload, {
                commandId: 'command-gate-stock',
                timestamp: '2026-10-22T12:00:00.000Z',
            });
            expect(result.updatedProducts).toHaveLength(batchProducts.length);
            result.updatedProducts.forEach((after, index) => {
                const before = batchProducts[index];
                expect(after.id).toBe(before.id);
                const changedKeys = Object.keys({ ...before, ...after })
                    .filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
                const touched = result.lineResults.some(line => String(line.productId) === String(before.id));
                expect(changedKeys).toEqual(touched ? ['stock'] : []);
            });
        });
    });

    it('calcula delta, stock final y movimiento auditable', () => {
        const result = calculateSupervisorInventoryBatchAdjustment(product, payload, {
            commandId: 'command-batch-001',
            timestamp: '2026-08-09T12:00:00.000Z',
        });

        expect(result).toMatchObject({ unitsDelta: 48, stockBefore: 10, stockAfter: 58 });
        expect(result.product).toMatchObject({ id: 'product-1', stock: 58 });
        expect(result.movement).toMatchObject({
            movementId: 'supervisor-command-batch-001',
            direction: 'ingreso',
            inputUnit: 'cajas',
            unitsPerPackageSnapshot: 24,
            reason: 'Mercancía recibida',
            lotReference: 'LOTE-001',
            stockBefore: 10,
            stockAfter: 58,
        });
    });

    it('rechaza el conflicto de stock antes de generar una mutación', () => {
        expect(() => calculateSupervisorInventoryBatchAdjustment(product, {
            ...payload,
            expectedStock: 9,
        })).toThrow(/stock cambió/i);
    });

    it('aplica un egreso con categoría y rechaza superar el stock', () => {
        const result = calculateSupervisorInventoryBatchAdjustment(product, {
            ...payload,
            direction: 'egreso',
            quantityInput: 1,
            unitsPerPackage: 1,
            reasonCategory: 'merma',
            reason: 'Producto dañado',
        }, { commandId: 'command-egress-1' });

        expect(result).toMatchObject({ unitsDelta: 1, stockBefore: 10, stockAfter: 9 });
    });

    it('rechaza egresos inválidos o superiores al stock', () => {
        expect(() => calculateSupervisorInventoryBatchAdjustment(product, {
            ...payload,
            direction: 'egreso',
            quantityInput: 1,
            unitsPerPackage: 24,
            reasonCategory: 'merma',
        })).toThrow(/stock insuficiente/i);
        expect(() => calculateSupervisorInventoryBatchAdjustment(product, {
            ...payload,
            direction: 'egreso',
            reasonCategory: 'categoria-desconocida',
        })).toThrow(/categoría/i);
        expect(() => calculateSupervisorInventoryBatchAdjustment(product, { ...payload, quantityInput: 0 })).toThrow();
        expect(() => calculateSupervisorInventoryBatchAdjustment(product, { ...payload, inputUnit: 'paquetes' })).toThrow();
    });

    describe('conversiones a granel (Fase 4)', () => {
        const solid = { id: 'g-1', name: 'Azúcar', stock: 2, packagingType: 'granel', granelUnit: 'kg' };
        const liquid = { id: 'l-1', name: 'Aceite suelto', stock: 1, packagingType: 'granel', granelUnit: 'litro' };
        const base = { direction: 'ingreso', unitsPerPackage: 1, reason: 'Compra' };

        it('500 g → 0.5 kg en granel sólido', () => {
            const result = calculateSupervisorInventoryBatchAdjustment(solid, { ...base, productId: 'g-1', quantityInput: 500, inputUnit: 'g', expectedStock: 2 });
            expect(result).toMatchObject({ unitsDelta: 0.5, stockAfter: 2.5 });
            expect(result.movement).toMatchObject({ inputUnit: 'g', quantityInput: 500, unitsPerPackageSnapshot: 1 });
        });

        it('750 ml → 0.75 L en granel líquido', () => {
            const result = calculateSupervisorInventoryBatchAdjustment(liquid, { ...base, productId: 'l-1', quantityInput: 750, inputUnit: 'ml', expectedStock: 1 });
            expect(result).toMatchObject({ unitsDelta: 0.75, stockAfter: 1.75 });
        });

        it('1.5 kg conserva decimales y redondea a 3', () => {
            expect(calculateSupervisorInventoryBatchAdjustment(solid, { ...base, productId: 'g-1', quantityInput: 1.5, inputUnit: 'kg', expectedStock: 2 }))
                .toMatchObject({ unitsDelta: 1.5, stockAfter: 3.5 });
            expect(calculateSupervisorInventoryBatchAdjustment(solid, { ...base, productId: 'g-1', quantityInput: 0.12345, inputUnit: 'kg', expectedStock: 2 }).stockAfter)
                .toBe(2.123);
        });

        it('ignora un factor enviado distinto de 1 en unidades de medida', () => {
            expect(calculateSupervisorInventoryBatchAdjustment(solid, { ...base, productId: 'g-1', quantityInput: 1, inputUnit: 'kg', unitsPerPackage: 24, expectedStock: 2 }).unitsDelta)
                .toBe(1);
        });

        it('rechaza unidades incompatibles con sólido/líquido', () => {
            expect(() => calculateSupervisorInventoryBatchAdjustment(solid, { ...base, productId: 'g-1', quantityInput: 1, inputUnit: 'ml', expectedStock: 2 })).toThrow(/sólido/i);
            expect(() => calculateSupervisorInventoryBatchAdjustment(liquid, { ...base, productId: 'l-1', quantityInput: 1, inputUnit: 'kg', expectedStock: 1 })).toThrow(/líquido/i);
            expect(() => calculateSupervisorInventoryBatchAdjustment(solid, { ...base, productId: 'g-1', quantityInput: 1, inputUnit: 'cajas', unitsPerPackage: 12, expectedStock: 2 })).toThrow(/granel/i);
        });

        it('rechaza kg/g/lt/ml en productos no granel', () => {
            expect(() => calculateSupervisorInventoryBatchAdjustment(product, { ...payload, quantityInput: 1, inputUnit: 'kg', unitsPerPackage: 1 })).toThrow(/granel/i);
            expect(() => calculateSupervisorInventoryBatchAdjustment(product, { ...payload, quantityInput: 500, inputUnit: 'ml', unitsPerPackage: 1 })).toThrow(/granel/i);
        });

        it('rechaza granel cuyo tipo sólido/líquido no se puede inferir', () => {
            const unknown = { id: 'u-1', name: 'Suelto', stock: 1, isWeight: true };
            expect(() => calculateSupervisorInventoryBatchAdjustment(unknown, { ...base, productId: 'u-1', quantityInput: 1, inputUnit: 'kg', expectedStock: 1 })).toThrow(/sólido o líquido/i);
        });

        it('rechaza fracciones en productos contables', () => {
            expect(() => calculateSupervisorInventoryBatchAdjustment(product, { ...payload, quantityInput: 1.5, inputUnit: 'unidades', unitsPerPackage: 1 })).toThrow(/enteras/i);
            expect(() => calculateSupervisorInventoryBatchAdjustment(product, { ...payload, quantityInput: 0.5, inputUnit: 'cajas', unitsPerPackage: 3 })).toThrow(/enteras/i);
            expect(calculateSupervisorInventoryBatchAdjustment(product, { ...payload, quantityInput: 0.5, inputUnit: 'cajas', unitsPerPackage: 24 }).unitsDelta).toBe(12);
        });

        it('rechaza egreso de granel superior al stock', () => {
            expect(() => calculateSupervisorInventoryBatchAdjustment(solid, { ...base, direction: 'egreso', reasonCategory: 'merma', productId: 'g-1', quantityInput: 2001, inputUnit: 'g', expectedStock: 2 })).toThrow(/stock insuficiente/i);
            expect(calculateSupervisorInventoryBatchAdjustment(solid, { ...base, direction: 'egreso', reasonCategory: 'merma', productId: 'g-1', quantityInput: 2000, inputUnit: 'g', expectedStock: 2 }).stockAfter).toBe(0);
        });
    });

    it('genera el mismo movimiento para el mismo commandId y permite deduplicación externa', () => {
        const first = calculateSupervisorInventoryBatchAdjustment(product, payload, { commandId: 'command-replay-1' });
        const replay = calculateSupervisorInventoryBatchAdjustment(product, payload, { commandId: 'command-replay-1' });

        expect(replay.movement.movementId).toBe(first.movement.movementId);
        expect(replay.product.stock).toBe(first.product.stock);
    });

    it('un fallo de publicación conserva el movimiento local y deja el push pendiente con el mismo commandId', async () => {
        const state = {
            bodega_products_v1: [product],
            bodega_sales_v1: [{ id: 'sale-1', tipo: 'VENTA' }],
        };
        const storage = {
            getItem: async (key, fallback) => state[key] ?? fallback,
            setItem: async (key, value) => { state[key] = value; },
        };
        const pushSync = async () => ({ ok: false, error: 'staging sync failure' });

        const result = await applySupervisorInventoryBatchTransaction({
            storage,
            pushSync,
            payload,
            commandId: 'command-rollback-1',
        });

        expect(result.status).toBe('applied_with_warnings');
        expect(result.commandId).toBe('command-rollback-1');
        expect(state.bodega_products_v1[0].stock).toBe(58);
        expect(state.bodega_sales_v1).toHaveLength(2);
        expect(result.pendingPublish).toEqual(expect.objectContaining({
            commandId: 'command-rollback-1',
            // Desacople 2026-10-22: la deuda con la nube es solo la familia de
            // ventas; el catálogo es baseline y su stock viaja como efecto.
            keys: ['bodega_sales_v1'],
        }));
    });

    describe('persistencia local recuperable (Fase 9)', () => {
        const JOURNAL_KEY = 'bodega_supervisor_inventory_journal_v1';
        const baseState = {
            bodega_products_v1: [product, { id: 'product-2', name: 'Aceite', stock: 5, costPrice: 2 }],
            bodega_sales_v1: [{ id: 'sale-1', tipo: 'VENTA' }],
        };
        const v2Payload = {
            direction: 'ingreso',
            reason: 'Recepción',
            lotReference: 'LOTE-10',
            lines: [
                { lineId: 'line-a', productId: 'product-1', quantityInput: 2, inputUnit: 'cajas', unitsPerPackage: 24, expectedStock: 10 },
                { lineId: 'line-b', productId: 'product-2', quantityInput: 3, inputUnit: 'unidades', expectedStock: 5 },
            ],
        };
        const pushOk = async () => ({ ok: true });
        const pushFail = async () => ({ ok: false, error: 'sync caído' });

        /**
         * Storage con inyección de fallos: 'throw' lanza, 'silent' traga el error
         * (como el fallback de cuota de storageService.setItem), y `skip` permite
         * fallar la N-ésima escritura de una clave (p. ej. la del rollback).
         */
        function createFailingStorage(initial = {}) {
            const state = structuredClone(initial);
            const setLog = [];
            const setOpts = [];
            const failures = [];
            return {
                state,
                setLog,
                setOpts,
                failNextSet(key, { mode = 'throw', error = new Error(`write failed: ${key}`), times = 1, skip = 0 } = {}) {
                    failures.push({ key, mode, error, times, skip });
                },
                async getItem(key, fallback = null) {
                    return Object.prototype.hasOwnProperty.call(state, key) ? structuredClone(state[key]) : fallback;
                },
                async setItem(key, value, options) {
                    setLog.push(key);
                    setOpts.push({ key, options });
                    const failure = failures.find(f => f.key === key && (f.times > 0 || f.skip > 0));
                    if (failure) {
                        if (failure.skip > 0) {
                            failure.skip -= 1;
                        } else {
                            failure.times -= 1;
                            if (failure.mode === 'throw') throw failure.error;
                            return;
                        }
                    }
                    state[key] = structuredClone(value);
                },
                async removeItem(key) {
                    delete state[key];
                },
            };
        }

        it('escribe el journal antes que los documentos y lo retira al confirmar (WAL)', async () => {
            const storage = createFailingStorage(baseState);
            const result = await applySupervisorInventoryBatchTransaction({
                storage, pushSync: pushOk, payload, commandId: 'cmd-wal-1', timestamp: '2026-10-16T12:00:00.000Z',
            });

            expect(result.stockAfter).toBe(58);
            expect(storage.setLog).toEqual([JOURNAL_KEY, 'bodega_products_v1', 'bodega_sales_v1']);
            expect(storage.state[JOURNAL_KEY]).toBeUndefined();
            expect(storage.state.bodega_products_v1[0].stock).toBe(58);
            expect(storage.state.bodega_sales_v1).toHaveLength(2);
        });

        it('aplica un lote v2 completo con persistencia verificada', async () => {
            const storage = createFailingStorage(baseState);
            const result = await applySupervisorInventoryBatchTransaction({
                storage, pushSync: pushOk, payload: v2Payload, commandId: 'cmd-v2-1', timestamp: '2026-10-16T12:00:00.000Z',
            });

            expect(result.lineResults).toHaveLength(2);
            expect(result.unitsDelta).toBe(51);
            expect(storage.state.bodega_products_v1.map(item => item.stock)).toEqual([58, 8]);
            expect(storage.state.bodega_sales_v1).toHaveLength(3);
            expect(storage.state[JOURNAL_KEY]).toBeUndefined();
        });

        it('valida el plan completo antes de escribir nada (todo-o-nada)', async () => {
            const storage = createFailingStorage(baseState);
            const conflicting = {
                ...v2Payload,
                lines: [v2Payload.lines[0], { ...v2Payload.lines[1], expectedStock: 4 }],
            };
            await expect(applySupervisorInventoryBatchTransaction({
                storage, pushSync: pushOk, payload: conflicting, commandId: 'cmd-atomic-1',
            })).rejects.toThrow(/stock cambió/i);

            expect(storage.setLog).toHaveLength(0);
            expect(storage.state[JOURNAL_KEY]).toBeUndefined();
            expect(storage.state.bodega_products_v1).toEqual(baseState.bodega_products_v1);
            expect(storage.state.bodega_sales_v1).toEqual(baseState.bodega_sales_v1);
        });

        it('fallo al escribir el primer documento: journal pendiente y recuperación hacia adelante', async () => {
            const storage = createFailingStorage(baseState);
            storage.failNextSet('bodega_products_v1');

            await expect(applySupervisorInventoryBatchTransaction({
                storage, pushSync: pushOk, payload, commandId: 'cmd-fail-1',
            })).rejects.toMatchObject({ name: 'InventoryStateError', status: 'recoverable' });

            expect(storage.state[JOURNAL_KEY]).toMatchObject({ version: 1, commandId: 'cmd-fail-1', state: 'pending' });
            expect(storage.state[JOURNAL_KEY].docs.map(doc => doc.key)).toEqual(['bodega_products_v1', 'bodega_sales_v1']);
            expect(storage.state[JOURNAL_KEY].docs.every(doc => 'before' in doc && 'after' in doc)).toBe(true);
            expect(storage.state.bodega_products_v1).toEqual(baseState.bodega_products_v1);

            const recovery = await recoverSupervisorInventoryJournal(storage);
            expect(recovery).toEqual({ recovered: true, commandId: 'cmd-fail-1', direction: 'rollforward' });
            expect(storage.state.bodega_products_v1[0].stock).toBe(58);
            expect(storage.state.bodega_sales_v1).toHaveLength(2);
            expect(storage.state[JOURNAL_KEY]).toBeUndefined();
        });

        it('fallo al escribir el segundo documento: bloquea nuevas operaciones y resuelve el estado mixto', async () => {
            const storage = createFailingStorage(baseState);
            storage.failNextSet('bodega_sales_v1', { times: 2 });

            await expect(applySupervisorInventoryBatchTransaction({
                storage, pushSync: pushOk, payload, commandId: 'cmd-fail-2',
            })).rejects.toMatchObject({ status: 'recoverable' });

            // Estado mixto transitorio: productos aplicados, historial sin escribir.
            expect(storage.state.bodega_products_v1[0].stock).toBe(58);
            expect(storage.state.bodega_sales_v1).toHaveLength(1);
            expect(storage.state[JOURNAL_KEY]).toMatchObject({ state: 'pending' });

            // Nueva operación bloqueada mientras la escritura sigue fallando:
            // estado recuperable, nunca 'rejected'.
            await expect(applySupervisorInventoryBatchTransaction({
                storage, pushSync: pushOk, payload, commandId: 'cmd-fail-2b',
            })).rejects.toThrow(/recuperable/i);

            const recovery = await recoverSupervisorInventoryJournal(storage);
            expect(recovery.direction).toBe('rollforward');
            expect(storage.state.bodega_products_v1[0].stock).toBe(58);
            expect(storage.state.bodega_sales_v1).toHaveLength(2);
        });

        it('la recuperación es idempotente y no duplica movimientos', async () => {
            const storage = createFailingStorage(baseState);
            storage.failNextSet('bodega_sales_v1');
            await expect(applySupervisorInventoryBatchTransaction({
                storage, pushSync: pushOk, payload, commandId: 'cmd-idem-1',
            })).rejects.toMatchObject({ status: 'recoverable' });

            const first = await recoverSupervisorInventoryJournal(storage);
            const second = await recoverSupervisorInventoryJournal(storage);

            expect(first).toEqual({ recovered: true, commandId: 'cmd-idem-1', direction: 'rollforward' });
            expect(second).toEqual({ recovered: false, commandId: null, direction: null });
            expect(storage.state.bodega_sales_v1).toHaveLength(2);
            expect(storage.state.bodega_sales_v1[1].movementId).toBe('supervisor-cmd-idem-1');
        });

        it('recarga con journal pendiente (crash simulado): roll-forward determinista', async () => {
            const journal = {
                version: 1,
                commandId: 'cmd-crash-1',
                state: 'pending',
                createdAt: '2026-10-16T12:00:00.000Z',
                docs: [
                    {
                        key: 'bodega_products_v1',
                        before: baseState.bodega_products_v1,
                        after: [{ ...product, stock: 58 }, baseState.bodega_products_v1[1]],
                    },
                    {
                        key: 'bodega_sales_v1',
                        before: baseState.bodega_sales_v1,
                        after: [...baseState.bodega_sales_v1, { movementId: 'supervisor-cmd-crash-1' }],
                    },
                ],
            };
            // Productos ya escritos, historial no: estado mixto tras el crash.
            const storage = createFailingStorage({
                bodega_products_v1: journal.docs[0].after,
                bodega_sales_v1: journal.docs[1].before,
                [JOURNAL_KEY]: journal,
            });

            const recovery = await recoverSupervisorInventoryJournal(storage);

            expect(recovery).toEqual({ recovered: true, commandId: 'cmd-crash-1', direction: 'rollforward' });
            expect(storage.state.bodega_sales_v1).toEqual(journal.docs[1].after);
            expect(storage.state[JOURNAL_KEY]).toBeUndefined();
        });

        it('reinicio con push pendiente: reintenta solo la publicación con el mismo commandId y no duplica el movimiento', async () => {
            const storage = createFailingStorage(baseState);
            const first = await applySupervisorInventoryBatchTransaction({
                storage, pushSync: pushFail, payload, commandId: 'cmd-pub-1',
            });
            expect(first.status).toBe('applied_with_warnings');
            expect(storage.state[JOURNAL_KEY]).toMatchObject({
                state: 'published_pending',
                commandId: 'cmd-pub-1',
                pendingKeys: ['bodega_sales_v1'],
            });
            const movementsAfterApply = storage.state.bodega_sales_v1.length;
            const productsAfterApply = structuredClone(storage.state.bodega_products_v1);

            // Reinicio simulado: el journal persiste en storage y se reintenta la publicación.
            const pushes = [];
            const retry = await retryInventoryPublish({
                storage,
                pushSync: async (key, value) => { pushes.push({ key, value }); return { ok: true }; },
            });
            expect(retry).toEqual({ retried: true, ok: true, commandId: 'cmd-pub-1' });
            // Desacople: se reintenta SOLO la familia de ventas; el catálogo no
            // se publica por un lote de inventario.
            expect(pushes.map(item => item.key)).toEqual(['bodega_sales_v1']);
            expect(storage.state.bodega_sales_v1).toHaveLength(movementsAfterApply);
            expect(storage.state.bodega_products_v1).toEqual(productsAfterApply);
            expect(storage.state[JOURNAL_KEY]).toBeUndefined();

            // Un segundo reintento no publica ni duplica nada.
            const again = await retryInventoryPublish({ storage, pushSync: async () => { throw new Error('no debe llamarse'); } });
            expect(again).toEqual({ retried: false, ok: true });
            expect(storage.state.bodega_sales_v1).toHaveLength(movementsAfterApply);
        });

        it('publicación parcial: reintenta solo la clave que falló', async () => {
            const storage = createFailingStorage(baseState);
            await applySupervisorInventoryBatchTransaction({
                storage,
                pushSync: async key => (key === 'bodega_sales_v1' ? { ok: false, error: 'sales caído' } : { ok: true }),
                payload,
                commandId: 'cmd-partial-1',
            });
            expect(storage.state[JOURNAL_KEY].pendingKeys).toEqual(['bodega_sales_v1']);

            const pushes = [];
            const retry = await retryInventoryPublish({
                storage,
                pushSync: async (key) => { pushes.push(key); return { ok: true }; },
            });
            expect(retry.ok).toBe(true);
            expect(pushes).toEqual(['bodega_sales_v1']);
            expect(storage.state[JOURNAL_KEY]).toBeUndefined();
        });

        it('journal legacy con ambas claves: publica lo que dice y reduce pendingKeys a la fallida', async () => {
            // Escrito por la versión pre-desacople (pendingKeys aún debía el
            // catálogo): se liquida con la semántica con la que se escribió y,
            // al fallar una clave, pendingKeys queda reducido a las fallidas.
            const storage = createFailingStorage({
                ...baseState,
                [JOURNAL_KEY]: {
                    version: 1,
                    commandId: 'cmd-legacy-1',
                    state: 'published_pending',
                    createdAt: '2026-10-21T12:00:00.000Z',
                    pendingKeys: ['bodega_products_v1', 'bodega_sales_v1'],
                    docs: [
                        { key: 'bodega_products_v1', before: baseState.bodega_products_v1, after: baseState.bodega_products_v1 },
                        { key: 'bodega_sales_v1', before: baseState.bodega_sales_v1, after: baseState.bodega_sales_v1 },
                    ],
                },
            });

            const pushes = [];
            const first = await retryInventoryPublish({
                storage,
                pushSync: async (key) => {
                    pushes.push(key);
                    return key === 'bodega_sales_v1' ? { ok: false, error: 'sales caído' } : { ok: true };
                },
            });
            expect(first).toEqual({ retried: true, ok: false, commandId: 'cmd-legacy-1', failedKeys: ['bodega_sales_v1'] });
            expect(pushes.sort()).toEqual(['bodega_products_v1', 'bodega_sales_v1']);
            expect(storage.state[JOURNAL_KEY].pendingKeys).toEqual(['bodega_sales_v1']);

            const secondPushes = [];
            const second = await retryInventoryPublish({
                storage,
                pushSync: async (key) => { secondPushes.push(key); return { ok: true }; },
            });
            expect(second).toEqual({ retried: true, ok: true, commandId: 'cmd-legacy-1' });
            expect(secondPushes).toEqual(['bodega_sales_v1']);
            expect(storage.state[JOURNAL_KEY]).toBeUndefined();
        });

        it('desacople: la escritura local de productos va con skipSyncPush y la de ventas conserva su red de auto-enqueue', async () => {
            const storage = createFailingStorage(baseState);
            await applySupervisorInventoryBatchTransaction({
                storage, pushSync: pushOk, payload, commandId: 'cmd-desacople-1', timestamp: '2026-10-22T12:00:00.000Z',
            });

            const optionsByKey = Object.fromEntries(storage.setOpts.map(({ key, options }) => [key, options]));
            // Productos: escritura local durable SIN encolar publicación — el
            // cambio de stock ya viaja como efecto en la familia de ventas.
            expect(optionsByKey.bodega_products_v1).toEqual({ skipSyncPush: true });
            // Ventas: el auto-enqueue del interceptor queda como red de
            // seguridad (§3.1.6 del plan de desacople); su dedup por hash evita
            // el segundo viaje cuando el journal ya publicó (sellado en
            // cloudSyncSalesPeriods).
            expect(optionsByKey.bodega_sales_v1?.skipSyncPush).toBeFalsy();
        });

        it('detecta escrituras tragadas (setItem que no rechaza) verificando por lectura', async () => {
            const storage = createFailingStorage(baseState);
            // 'silent' imita el fallback de cuota de storageService: traga el error.
            storage.failNextSet('bodega_products_v1', { mode: 'silent' });

            await expect(applySupervisorInventoryBatchTransaction({
                storage, pushSync: pushOk, payload, commandId: 'cmd-swallow-1',
            })).rejects.toThrow(/no se confirmó/);

            expect(storage.state[JOURNAL_KEY]).toMatchObject({ state: 'pending' });
            expect(storage.state.bodega_products_v1).toEqual(baseState.bodega_products_v1);
        });

        it('Fase 4: el journal guarda los snapshots como strings y la recuperación los restaura completos', async () => {
            const storage = createFailingStorage(baseState);
            storage.failNextSet('bodega_sales_v1'); // estado mixto con journal pendiente

            await expect(applySupervisorInventoryBatchTransaction({
                storage, pushSync: pushOk, payload, commandId: 'cmd-pack-1',
            })).rejects.toMatchObject({ status: 'recoverable' });

            const journal = storage.state[JOURNAL_KEY];
            expect(journal.docs.map(doc => doc.key)).toEqual(['bodega_products_v1', 'bodega_sales_v1']);
            // Los snapshots viajan como strings marcados (comprimidos si hay
            // soporte), no como grafos de objetos.
            for (const doc of journal.docs) {
                expect(typeof doc.before).toBe('string');
                expect(typeof doc.after).toBe('string');
                expect(
                    doc.after.startsWith('z1:') || doc.after.startsWith('j1:'),
                ).toBe(true);
            }

            const recovery = await recoverSupervisorInventoryJournal(storage);
            expect(recovery).toEqual({ recovered: true, commandId: 'cmd-pack-1', direction: 'rollforward' });
            expect(storage.state.bodega_products_v1[0].stock).toBe(58);
            expect(storage.state.bodega_sales_v1).toHaveLength(2);
            expect(storage.state.bodega_sales_v1[1].movementId).toBe('supervisor-cmd-pack-1');
            expect(storage.state[JOURNAL_KEY]).toBeUndefined();
        });

        it('Fase 4: un snapshot ilegible no escribe basura y conserva el journal', async () => {
            const storage = createFailingStorage({
                ...baseState,
                [JOURNAL_KEY]: {
                    version: 1,
                    commandId: 'cmd-pack-corrupt',
                    state: 'pending',
                    createdAt: '2026-10-21T12:00:00.000Z',
                    docs: [
                        { key: 'bodega_products_v1', before: 'j1:{"roto":', after: 'j1:{"roto":' },
                        { key: 'bodega_sales_v1', before: baseState.bodega_sales_v1, after: baseState.bodega_sales_v1 },
                    ],
                },
            });

            await expect(recoverSupervisorInventoryJournal(storage)).rejects.toMatchObject({ status: 'recoverable' });
            expect(storage.state[JOURNAL_KEY]).toMatchObject({ commandId: 'cmd-pack-corrupt' });
            expect(storage.state.bodega_products_v1).toEqual(baseState.bodega_products_v1);
        });

        it('Fase 4: el reintento de publicación cae al snapshot comprimido si el storage quedó vacío', async () => {
            const storage = createFailingStorage(baseState);
            await applySupervisorInventoryBatchTransaction({
                storage, pushSync: pushFail, payload, commandId: 'cmd-pack-retry-1',
            });
            expect(storage.state[JOURNAL_KEY]).toMatchObject({ state: 'published_pending' });

            // Journal legacy (pre-desacople): aún debía ambos documentos, así el
            // fallback al snapshot 'after' se sella para los dos; los journals
            // nuevos solo deben la familia de ventas.
            storage.state[JOURNAL_KEY].pendingKeys = ['bodega_products_v1', 'bodega_sales_v1'];

            // Corte total: las claves desaparecen del storage y solo queda el journal.
            delete storage.state.bodega_products_v1;
            delete storage.state.bodega_sales_v1;

            const pushes = [];
            const retry = await retryInventoryPublish({
                storage,
                pushSync: async (key, value) => { pushes.push({ key, value }); return { ok: true }; },
            });
            expect(retry).toMatchObject({ retried: true, ok: true, commandId: 'cmd-pack-retry-1' });

            const productsPush = pushes.find(item => item.key === 'bodega_products_v1');
            const salesPush = pushes.find(item => item.key === 'bodega_sales_v1');
            expect(productsPush.value[0].stock).toBe(58);
            expect(salesPush.value).toHaveLength(2);
            expect(salesPush.value[1].movementId).toBe('supervisor-cmd-pack-retry-1');
        });

        it('un journal corrupto no autoriza escrituras sobre otras claves', async () => {
            const storage = createFailingStorage({
                ...baseState,
                otra_clave: ['dato ajeno'],
                [JOURNAL_KEY]: {
                    version: 1,
                    commandId: 'cmd-corrupt-1',
                    state: 'pending',
                    docs: [
                        { key: 'otra_clave', before: [], after: ['secuestrado'] },
                        { key: 'bodega_sales_v1', before: [], after: [] },
                    ],
                },
            });

            await expect(recoverSupervisorInventoryJournal(storage)).rejects.toThrow(/ilegible/i);
            expect(storage.state.otra_clave).toEqual(['dato ajeno']);
        });

        it('Fase 11: confirma el lote (onLocalApplied) antes de cualquier publicación cloud', async () => {
            const storage = createFailingStorage(baseState);
            const events = [];
            const result = await applySupervisorInventoryBatchTransaction({
                storage,
                pushSync: async (key) => { events.push(`publish:${key}`); return { ok: true }; },
                payload,
                commandId: 'cmd-ack-first-1',
                onLocalApplied: async (applied) => {
                    events.push('ack');
                    expect(applied.commandId).toBe('cmd-ack-first-1');
                    expect(applied.unitsDelta).toBe(48);
                    expect(applied.stockBefore).toBe(10);
                    expect(applied.stockAfter).toBe(58);
                },
            });

            expect(result.status).toBe('applied');
            // Desacople: el lote solo publica la familia de ventas.
            expect(events).toEqual(['ack', 'publish:bodega_sales_v1']);
        });

        it('Fase 11: un error en onLocalApplied no interrumpe la aplicación ni la publicación', async () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const storage = createFailingStorage(baseState);
            const pushed = [];
            const result = await applySupervisorInventoryBatchTransaction({
                storage,
                pushSync: async (key) => { pushed.push(key); return { ok: true }; },
                payload,
                commandId: 'cmd-ack-throw-1',
                onLocalApplied: async () => {
                    throw new Error('ACK caído');
                },
            });

            expect(result.status).toBe('applied');
            expect(storage.state.bodega_products_v1[0].stock).toBe(58);
            expect(pushed.sort()).toEqual(['bodega_sales_v1']);
            expect(warn).toHaveBeenCalled();
            warn.mockRestore();
        });

        it('Fase 11: la recuperación no bloquea un journal published_pending (solo falta publicar)', async () => {
            const pendingJournal = {
                version: 1,
                state: 'published_pending',
                commandId: 'cmd-pub-hold-1',
                createdAt: '2026-10-16T12:00:00.000Z',
                pendingKeys: ['bodega_sales_v1'],
                docs: [
                    { key: 'bodega_products_v1', before: baseState.bodega_products_v1, after: baseState.bodega_products_v1 },
                    { key: 'bodega_sales_v1', before: baseState.bodega_sales_v1, after: baseState.bodega_sales_v1 },
                ],
            };
            const storage = createFailingStorage({ ...baseState, [JOURNAL_KEY]: pendingJournal });

            const recovery = await recoverSupervisorInventoryJournal(storage);

            expect(recovery).toEqual({ recovered: false, commandId: 'cmd-pub-hold-1', direction: 'publish_pending' });
            expect(storage.setLog).toHaveLength(0);
            expect(storage.state[JOURNAL_KEY]).toMatchObject({ state: 'published_pending', commandId: 'cmd-pub-hold-1' });
        });

        it('Fase 11: un lote nuevo aplica aunque quede una publicación anterior pendiente', async () => {
            const pendingJournal = {
                version: 1,
                state: 'published_pending',
                commandId: 'cmd-pub-old-1',
                createdAt: '2026-10-16T12:00:00.000Z',
                pendingKeys: ['bodega_products_v1'],
                docs: [
                    { key: 'bodega_products_v1', before: baseState.bodega_products_v1, after: baseState.bodega_products_v1 },
                    { key: 'bodega_sales_v1', before: baseState.bodega_sales_v1, after: baseState.bodega_sales_v1 },
                ],
            };
            const storage = createFailingStorage({ ...baseState, [JOURNAL_KEY]: pendingJournal });

            const result = await applySupervisorInventoryBatchTransaction({
                storage, pushSync: pushOk, payload, commandId: 'cmd-subsume-1',
            });

            expect(result.status).toBe('applied');
            expect(storage.state.bodega_products_v1[0].stock).toBe(58);
            expect(storage.state[JOURNAL_KEY]).toBeUndefined();
        });
    });

    describe('H2/H3 (auditoría 2026-10-22): reaplicación idempotente y recuperación sin pisar', () => {
        const JOURNAL_KEY = 'bodega_supervisor_inventory_journal_v1';
        const p1 = { id: 'product-1', name: 'Arroz', stock: 10, costPrice: 1 };
        const p2 = { id: 'product-2', name: 'Aceite', stock: 5, costPrice: 2 };
        const saleBase = { id: 'sale-1', tipo: 'VENTA' };
        const batchPayload = {
            direction: 'ingreso',
            reason: 'Recepción',
            lotReference: 'LOTE-10',
            lines: [
                { lineId: 'line-a', productId: 'product-1', quantityInput: 2, inputUnit: 'cajas', unitsPerPackage: 24, expectedStock: 10 },
            ],
        };
        const pushOk = async () => ({ ok: true });

        function makeStorage(initial = {}) {
            const state = structuredClone(initial);
            return {
                state,
                getItem: async (key, fallback) => (key in state ? state[key] : fallback),
                setItem: async (key, value) => { state[key] = value; },
                removeItem: async (key) => { delete state[key]; },
            };
        }

        function journalFor({ commandId, state = 'pending', beforeProducts, afterProducts, beforeSales, afterSales }) {
            return {
                version: 1,
                commandId,
                state,
                createdAt: '2026-10-22T10:00:00.000Z',
                docs: [
                    { key: 'bodega_products_v1', before: beforeProducts, after: afterProducts },
                    { key: 'bodega_sales_v1', before: beforeSales, after: afterSales },
                ],
            };
        }

        it('H2: reaplicar el mismo commandId tras un corte es un no-op aplicado (sin movimiento duplicado)', async () => {
            const storage = makeStorage({
                bodega_products_v1: [p1, p2],
                bodega_sales_v1: [saleBase],
            });

            const first = await applySupervisorInventoryBatchTransaction({
                storage, pushSync: pushOk, payload: batchPayload, commandId: 'command-h2-1', deferPublish: true,
            });
            expect(first.status).toBe('applied');
            const productsAfterFirst = structuredClone(storage.state.bodega_products_v1);
            const salesAfterFirst = structuredClone(storage.state.bodega_sales_v1);

            // El corte perdió el ACK: el mismo commandId se vuelve a entregar.
            // Sin la detección por commandId esto fallaría con «El stock cambió
            // antes de aplicar» (falso «failed») o duplicaría el ajuste.
            const onLocalApplied = vi.fn();
            const second = await applySupervisorInventoryBatchTransaction({
                storage, pushSync: pushOk, payload: batchPayload, commandId: 'command-h2-1', deferPublish: true, onLocalApplied,
            });

            expect(second.alreadyApplied).toBe(true);
            expect(second.status).toBe('applied');
            expect(onLocalApplied).toHaveBeenCalledTimes(1);
            expect(storage.state.bodega_products_v1).toEqual(productsAfterFirst);
            expect(storage.state.bodega_sales_v1).toEqual(salesAfterFirst);
            expect(storage.state.bodega_sales_v1.filter(item => item.commandId === 'command-h2-1')).toHaveLength(1);
        });

        it('H3: roll-forward conserva la venta intermedia del cajero y agrega el movimiento del lote', async () => {
            const batchMovement = {
                id: 'supervisor-command-merge-1-line-a',
                movementId: 'supervisor-command-merge-1-line-a',
                commandId: 'command-merge-1',
                source: 'supervisor',
                tipo: 'AJUSTE_ENTRADA',
                unitsDelta: 48,
                stockBefore: 10,
                stockAfter: 58,
                productId: 'product-1',
            };
            // Corte entre escrituras: productos ya escribió (58) pero ventas no.
            // Antes de la recuperación, el cajero registró su venta (sale-cashier).
            const storage = makeStorage({
                bodega_products_v1: [{ ...p1, stock: 58 }, p2],
                bodega_sales_v1: [saleBase, { id: 'sale-cashier', tipo: 'VENTA' }],
                [JOURNAL_KEY]: journalFor({
                    commandId: 'command-merge-1',
                    beforeProducts: [p1, p2],
                    afterProducts: [{ ...p1, stock: 58 }, p2],
                    beforeSales: [saleBase],
                    afterSales: [saleBase, batchMovement],
                }),
            });

            const result = await recoverSupervisorInventoryJournal(storage);

            expect(result).toMatchObject({ recovered: true, direction: 'rollforward' });
            // El stock del lote se conserva (58) y la venta del cajero NO se pisa…
            expect(storage.state.bodega_products_v1[0].stock).toBe(58);
            const ids = storage.state.bodega_sales_v1.map(item => item.id);
            expect(ids).toContain('sale-cashier');
            // …y el movimiento del lote queda en el historial (una sola vez).
            expect(ids.filter(id => id === 'supervisor-command-merge-1-line-a')).toHaveLength(1);
            expect(storage.state[JOURNAL_KEY]).toBeUndefined();
        });

        it('H3: con evidencia ambigua (stock movido sin movimientos en el historial) escala sin pisar nada', async () => {
            const batchMovement = {
                id: 'supervisor-command-merge-2-line-a',
                commandId: 'command-merge-2',
                source: 'supervisor',
                unitsDelta: 48,
                stockBefore: 10,
                stockAfter: 58,
                productId: 'product-1',
            };
            // El stock derivó (56) y el historial NO confirma el efecto del lote:
            // cualquier elección automática sería una mentira silenciosa.
            const initial = {
                bodega_products_v1: [{ ...p1, stock: 56 }, p2],
                bodega_sales_v1: [saleBase, { id: 'sale-cashier', tipo: 'VENTA' }],
                [JOURNAL_KEY]: journalFor({
                    commandId: 'command-merge-2',
                    beforeProducts: [p1, p2],
                    afterProducts: [{ ...p1, stock: 58 }, p2],
                    beforeSales: [saleBase],
                    afterSales: [saleBase, batchMovement],
                }),
            };
            const storage = makeStorage(initial);

            await expect(recoverSupervisorInventoryJournal(storage)).rejects.toMatchObject({ status: 'recoverable' });

            // Nada se escribió: el journal queda intacto para intervención.
            expect(storage.state.bodega_products_v1[0].stock).toBe(56);
            expect(storage.state.bodega_sales_v1).toHaveLength(2);
            expect(storage.state[JOURNAL_KEY]).toBeTruthy();
        });

        it('H3: si el historial ya confirma el efecto del lote, el stock actual (con ventas posteriores) se conserva', async () => {
            const batchMovement = {
                id: 'supervisor-command-merge-3-line-a',
                commandId: 'command-merge-3',
                source: 'supervisor',
                unitsDelta: 48,
                stockBefore: 10,
                stockAfter: 58,
                productId: 'product-1',
            };
            const storage = makeStorage({
                bodega_products_v1: [{ ...p1, stock: 56 }, p2],
                bodega_sales_v1: [saleBase, batchMovement, { id: 'sale-cashier', tipo: 'VENTA' }],
                [JOURNAL_KEY]: journalFor({
                    commandId: 'command-merge-3',
                    beforeProducts: [p1, p2],
                    afterProducts: [{ ...p1, stock: 58 }, p2],
                    beforeSales: [saleBase],
                    afterSales: [saleBase, batchMovement],
                }),
            });

            const result = await recoverSupervisorInventoryJournal(storage);

            expect(result).toMatchObject({ recovered: true, direction: 'rollforward' });
            // El efecto del lote ya estaba aplicado; la venta posterior (-2) se
            // conserva tal cual: 56 es el stock correcto, no 58 ni 104.
            expect(storage.state.bodega_products_v1[0].stock).toBe(56);
            expect(storage.state.bodega_sales_v1.map(item => item.id)).toEqual(['sale-1', 'supervisor-command-merge-3-line-a', 'sale-cashier']);
            expect(storage.state[JOURNAL_KEY]).toBeUndefined();
        });

        it('H3: el rollback retira SOLO los movimientos del lote y conserva los del cajero', async () => {
            const batchMovement = {
                id: 'supervisor-command-merge-4-line-a',
                commandId: 'command-merge-4',
                source: 'supervisor',
                unitsDelta: 48,
                stockBefore: 10,
                stockAfter: 58,
                productId: 'product-1',
            };
            const storage = makeStorage({
                // El rollback de productos ya corrió (stock 10 = extremo 'before').
                bodega_products_v1: [p1, p2],
                bodega_sales_v1: [saleBase, batchMovement, { id: 'sale-cashier', tipo: 'VENTA' }],
                [JOURNAL_KEY]: journalFor({
                    commandId: 'command-merge-4',
                    state: 'rolling_back',
                    beforeProducts: [p1, p2],
                    afterProducts: [{ ...p1, stock: 58 }, p2],
                    beforeSales: [saleBase],
                    afterSales: [saleBase, batchMovement],
                }),
            });

            const result = await recoverSupervisorInventoryJournal(storage);

            expect(result).toMatchObject({ recovered: true, direction: 'rollback' });
            expect(storage.state.bodega_sales_v1.map(item => item.id)).toEqual(['sale-1', 'sale-cashier']);
            expect(storage.state[JOURNAL_KEY]).toBeUndefined();
        });
    });
});
