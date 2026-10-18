// ── Fase 1: evaluador de verificación ("¿Hizo efecto de verdad?") ───────────
// Regla de Donde Juancho: "la igualdad de stock no basta". Aplicado significa
// probado contra el eco real de la caja (sync_documents). Tres sellos posibles:
//   - 'received'  : Recibido por la caja (sin eco aún, o el eco no permite
//                   verificar este cambio → honesto, jamás un verde falso).
//   - 'verified'  : Aplicado y verificado (el eco posterior confirma el efecto).
//   - 'mismatch'  : No coincide — revisar (el eco posterior CONTRADICE el cambio).

import { describe, expect, it } from 'vitest';
import {
    VERIFICATION_GRACE_MS,
    VERIFICATION_LEVELS,
    evaluateCommandVerification,
    getVerificationMeta,
} from '../src/services/supervisorCommandVerification';

const APPLIED_AT = '2026-10-18T07:04:00.000Z';
const NOW = new Date('2026-10-18T07:05:00.000Z').getTime();

// Eco posterior al comando (el que puede verificar).
const echoAfter = (extra = {}) => ({
    updatedAt: '2026-10-18T07:04:30.000Z',
    capturedAt: '2026-10-18T07:04:30.000Z',
    ...extra,
});

const appliedCommand = (type, payload, extra = {}) => ({
    command_id: 'cmd-1',
    command_type: type,
    status: 'applied',
    payload,
    updated_at: APPLIED_AT,
    ...extra,
});

describe('niveles y metadatos', () => {
    it('expone exactamente los tres niveles del contrato', () => {
        expect([...VERIFICATION_LEVELS]).toEqual(['received', 'verified', 'mismatch']);
    });

    it('getVerificationMeta etiqueta cada nivel en lenguaje llano', () => {
        expect(getVerificationMeta('received')).toMatchObject({ level: 'received', label: 'Recibido por la caja' });
        expect(getVerificationMeta('verified')).toMatchObject({ level: 'verified', label: 'Aplicado y verificado' });
        expect(getVerificationMeta('mismatch')).toMatchObject({ level: 'mismatch', label: 'No coincide — revisar' });
        // Tono para la UI: info / success / danger.
        expect(getVerificationMeta('verified').tone).toBe('success');
        expect(getVerificationMeta('mismatch').tone).toBe('danger');
        expect(getVerificationMeta('received').tone).toBe('info');
    });
});

describe('regla general: sin eco posterior no hay verde', () => {
    it('sin snapshot → received con detalle honesto', () => {
        const result = evaluateCommandVerification({
            command: appliedCommand('supervisor.product.create', { product: { id: 'p1', name: 'Arroz' } }),
            snapshot: null,
            now: NOW,
        });
        expect(result.level).toBe('received');
        expect(result.detail).toBeTruthy();
    });

    it('eco anterior o igual al comando → received (esperando el eco)', () => {
        const result = evaluateCommandVerification({
            command: appliedCommand('supervisor.product.create', { product: { id: 'p1', name: 'Arroz' } }),
            snapshot: echoAfter({ updatedAt: APPLIED_AT }),
            now: NOW,
        });
        expect(result.level).toBe('received');
    });

    it('comando aún sin aplicar → received, nunca verified', () => {
        const result = evaluateCommandVerification({
            command: { ...appliedCommand('supervisor.product.create', { product: { id: 'p1', name: 'Arroz' } }), status: 'pending' },
            snapshot: echoAfter({ products: [{ id: 'p1', name: 'Arroz' }] }),
            now: NOW,
        });
        expect(result.level).toBe('received');
    });

    it('dentro del periodo de gracia el detalle invita a esperar sin alarmar', () => {
        const soon = Date.parse(APPLIED_AT) + VERIFICATION_GRACE_MS / 2;
        const result = evaluateCommandVerification({
            command: appliedCommand('supervisor.rate.set', { rateMode: 'bcv' }),
            snapshot: echoAfter({ updatedAt: APPLIED_AT }),
            now: soon,
        });
        expect(result.level).toBe('received');
        expect(String(result.detail).toLowerCase()).toContain('eco');
    });

    it('tipo de comando desconocido → received con detalle, jamás verified', () => {
        const result = evaluateCommandVerification({
            command: appliedCommand('supervisor.otra.cosa', {}),
            snapshot: echoAfter({ products: [] }),
            now: NOW,
        });
        expect(result.level).toBe('received');
    });
});

describe('inventario y stock: la igualdad de stock no basta', () => {
    it('stock del eco igual al stockAfter del ACK → verified', () => {
        const result = evaluateCommandVerification({
            command: appliedCommand('supervisor.inventory.batch.adjust', {
                direction: 'ingreso', productId: 'p1', quantityInput: 8, inputUnit: 'unidades',
                unitsPerPackage: 1, expectedStock: 22, reason: 'Ajuste de stock',
            }),
            ack: { status: 'applied', ok: true, ack: { stockAfter: 30 } },
            snapshot: echoAfter({ products: [{ id: 'p1', name: 'Champu Papeleta', stock: 30 }] }),
            now: NOW,
        });
        expect(result.level).toBe('verified');
        expect(result.checks.length).toBeGreaterThan(0);
    });

    it('tolerancia decimal: 30 vs 30.0000000001 cuenta como verificado', () => {
        const result = evaluateCommandVerification({
            command: appliedCommand('supervisor.inventory.batch.adjust', {
                direction: 'ingreso', productId: 'p1', quantityInput: 8, inputUnit: 'unidades',
                unitsPerPackage: 1, expectedStock: 22, reason: 'Ajuste de stock',
            }),
            ack: { status: 'applied', ok: true, ack: { stockAfter: 30 } },
            snapshot: echoAfter({ products: [{ id: 'p1', name: 'Champu', stock: 30.0000000001 }] }),
            now: NOW,
        });
        expect(result.level).toBe('verified');
    });

    it('stock del eco distinto del stockAfter → mismatch con la diferencia a la vista', () => {
        const result = evaluateCommandVerification({
            command: appliedCommand('supervisor.inventory.batch.adjust', {
                direction: 'ingreso', productId: 'p1', quantityInput: 8, inputUnit: 'unidades',
                unitsPerPackage: 1, expectedStock: 22, reason: 'Ajuste de stock',
            }),
            ack: { status: 'applied', ok: true, ack: { stockAfter: 30 } },
            snapshot: echoAfter({ products: [{ id: 'p1', name: 'Champu', stock: 12 }] }),
            now: NOW,
        });
        expect(result.level).toBe('mismatch');
        expect(result.detail).toContain('30');
        expect(result.detail).toContain('12');
    });

    it('SIN stockAfter en el ACK → jamás verified aunque el stock "cuadre" (regla de Donde Juancho)', () => {
        const result = evaluateCommandVerification({
            command: appliedCommand('supervisor.inventory.batch.adjust', {
                direction: 'ingreso', productId: 'p1', quantityInput: 8, inputUnit: 'unidades',
                unitsPerPackage: 1, expectedStock: 22, reason: 'Ajuste de stock',
            }),
            ack: { status: 'applied', ok: true, ack: {} },
            snapshot: echoAfter({ products: [{ id: 'p1', name: 'Champu', stock: 30 }] }),
            now: NOW,
        });
        expect(result.level).toBe('received');
        expect(String(result.detail).toLowerCase()).toContain('stock');
    });

    it('lote v2 multi-línea con stockAfter por línea → todas las líneas se verifican', () => {
        const result = evaluateCommandVerification({
            command: appliedCommand('supervisor.inventory.batch.adjust', {
                batchVersion: 2, direction: 'ingreso', reason: 'Recepción',
                lines: [
                    { productId: 'p1', quantityInput: 2, inputUnit: 'unidades', unitsPerPackage: 1, expectedStock: 10 },
                    { productId: 'p2', quantityInput: 1, inputUnit: 'unidades', unitsPerPackage: 1, expectedStock: 5 },
                ],
            }),
            ack: { status: 'applied', ok: true, ack: { lines: [{ productId: 'p1', stockAfter: 12 }, { productId: 'p2', stockAfter: 6 }] } },
            snapshot: echoAfter({ products: [{ id: 'p1', stock: 12 }, { id: 'p2', stock: 6 }] }),
            now: NOW,
        });
        expect(result.level).toBe('verified');
    });

    it('lote v2 multi-línea con una línea descuadrada → mismatch', () => {
        const result = evaluateCommandVerification({
            command: appliedCommand('supervisor.inventory.batch.adjust', {
                batchVersion: 2, direction: 'ingreso', reason: 'Recepción',
                lines: [
                    { productId: 'p1', quantityInput: 2, inputUnit: 'unidades', unitsPerPackage: 1, expectedStock: 10 },
                    { productId: 'p2', quantityInput: 1, inputUnit: 'unidades', unitsPerPackage: 1, expectedStock: 5 },
                ],
            }),
            ack: { status: 'applied', ok: true, ack: { lines: [{ productId: 'p1', stockAfter: 12 }, { productId: 'p2', stockAfter: 6 }] } },
            snapshot: echoAfter({ products: [{ id: 'p1', stock: 12 }, { id: 'p2', stock: 99 }] }),
            now: NOW,
        });
        expect(result.level).toBe('mismatch');
    });

    it('producto que no aparece en el eco de stock → mismatch (el movimiento no se ve)', () => {
        const result = evaluateCommandVerification({
            command: appliedCommand('supervisor.inventory.batch.adjust', {
                direction: 'ingreso', productId: 'p1', quantityInput: 8, inputUnit: 'unidades',
                unitsPerPackage: 1, expectedStock: 22, reason: 'Ajuste de stock',
            }),
            ack: { status: 'applied', ok: true, ack: { stockAfter: 30 } },
            snapshot: echoAfter({ products: [{ id: 'otro', name: 'Otro', stock: 30 }] }),
            now: NOW,
        });
        expect(result.level).toBe('mismatch');
    });

    it('eco sin datos de productos → received con detalle honesto (no se puede verificar)', () => {
        const result = evaluateCommandVerification({
            command: appliedCommand('supervisor.inventory.batch.adjust', {
                direction: 'ingreso', productId: 'p1', quantityInput: 8, inputUnit: 'unidades',
                unitsPerPackage: 1, expectedStock: 22, reason: 'Ajuste de stock',
            }),
            ack: { status: 'applied', ok: true, ack: { stockAfter: 30 } },
            snapshot: echoAfter({}),
            now: NOW,
        });
        expect(result.level).toBe('received');
    });
});

describe('productos: crear, editar, eliminar', () => {
    it('create con el producto presente y nombre igual → verified', () => {
        const result = evaluateCommandVerification({
            command: appliedCommand('supervisor.product.create', { product: { id: 'p1', name: 'Arroz', priceUsd: 2 } }),
            snapshot: echoAfter({ products: [{ id: 'p1', name: 'Arroz', priceUsd: 2, stock: 0 }] }),
            now: NOW,
        });
        expect(result.level).toBe('verified');
    });

    it('create con el producto ausente en el eco posterior → mismatch', () => {
        const result = evaluateCommandVerification({
            command: appliedCommand('supervisor.product.create', { product: { id: 'p1', name: 'Arroz' } }),
            snapshot: echoAfter({ products: [{ id: 'p2', name: 'Otro' }] }),
            now: NOW,
        });
        expect(result.level).toBe('mismatch');
    });

    it('update con todos los campos del patch coincidentes → verified', () => {
        const result = evaluateCommandVerification({
            command: appliedCommand('supervisor.product.update', {
                productId: 'p1',
                patch: { name: 'Arroz Premium', priceUsd: 3, baseRevision: 'rev-x' },
            }),
            snapshot: echoAfter({ products: [{ id: 'p1', name: 'Arroz Premium', priceUsd: 3, stock: 7 }] }),
            now: NOW,
        });
        expect(result.level).toBe('verified');
    });

    it('update con un campo del patch que no coincide → mismatch nombrando el campo', () => {
        const result = evaluateCommandVerification({
            command: appliedCommand('supervisor.product.update', {
                productId: 'p1',
                patch: { name: 'Arroz Premium', priceUsd: 3 },
            }),
            snapshot: echoAfter({ products: [{ id: 'p1', name: 'Arroz Premium', priceUsd: 5, stock: 7 }] }),
            now: NOW,
        });
        expect(result.level).toBe('mismatch');
        expect(result.detail).toContain('priceUsd');
    });

    it('update donde el patch incluye stock (protegido) se ignora para verificar: el stock manda el eco', () => {
        const result = evaluateCommandVerification({
            command: appliedCommand('supervisor.product.update', {
                productId: 'p1',
                patch: { name: 'Arroz', baseRevision: 'rev-x' },
            }),
            snapshot: echoAfter({ products: [{ id: 'p1', name: 'Arroz', stock: 42 }] }),
            now: NOW,
        });
        expect(result.level).toBe('verified');
    });

    it('delete con el producto ausente del eco → verified', () => {
        const result = evaluateCommandVerification({
            command: appliedCommand('supervisor.product.delete', { productId: 'p1' }),
            snapshot: echoAfter({ products: [{ id: 'p2', name: 'Otro' }] }),
            now: NOW,
        });
        expect(result.level).toBe('verified');
    });

    it('delete con el producto todavía presente → mismatch (sigue en el catálogo)', () => {
        const result = evaluateCommandVerification({
            command: appliedCommand('supervisor.product.delete', { productId: 'p1' }),
            snapshot: echoAfter({ products: [{ id: 'p1', name: 'Prueba', stock: 4 }] }),
            now: NOW,
        });
        expect(result.level).toBe('mismatch');
    });
});

describe('tasa y usuarios', () => {
    it('rate.set con el modo activo igual → verified', () => {
        const result = evaluateCommandVerification({
            command: appliedCommand('supervisor.rate.set', { rateMode: 'bcv' }),
            snapshot: echoAfter({ rateMode: 'bcv' }),
            now: NOW,
        });
        expect(result.level).toBe('verified');
    });

    it('rate.set con modo distinto → mismatch', () => {
        const result = evaluateCommandVerification({
            command: appliedCommand('supervisor.rate.set', { rateMode: 'manual', customRate: 40 }),
            snapshot: echoAfter({ rateMode: 'bcv' }),
            now: NOW,
        });
        expect(result.level).toBe('mismatch');
    });

    it('rate.set sin modo de tasa en el eco → received honesto', () => {
        const result = evaluateCommandVerification({
            command: appliedCommand('supervisor.rate.set', { rateMode: 'bcv' }),
            snapshot: echoAfter({}),
            now: NOW,
        });
        expect(result.level).toBe('received');
    });

    it('user.create presente en el eco → verified; user.delete ausente → verified', () => {
        const created = evaluateCommandVerification({
            command: appliedCommand('supervisor.user.create', { nombre: 'Juan', rol: 'CAJERO' }),
            snapshot: echoAfter({ users: [{ id: 1, nombre: 'Juan', rol: 'CAJERO' }] }),
            now: NOW,
        });
        expect(created.level).toBe('verified');

        const deleted = evaluateCommandVerification({
            command: appliedCommand('supervisor.user.delete', { userId: 1, nombre: 'Juan' }),
            snapshot: echoAfter({ users: [{ id: 2, nombre: 'Otra' }] }),
            now: NOW,
        });
        expect(deleted.level).toBe('verified');
    });

    it('user.create que no aparece en el eco posterior → mismatch', () => {
        const result = evaluateCommandVerification({
            command: appliedCommand('supervisor.user.create', { nombre: 'Juan', rol: 'CAJERO' }),
            snapshot: echoAfter({ users: [{ id: 2, nombre: 'Otra' }] }),
            now: NOW,
        });
        expect(result.level).toBe('mismatch');
    });

    it('user.pin.change → received honesto: el PIN no viaja en el eco, nunca un verde falso', () => {
        const result = evaluateCommandVerification({
            command: appliedCommand('supervisor.user.pin.change', { userId: 1, nombre: 'Juan' }),
            snapshot: echoAfter({ users: [{ id: 1, nombre: 'Juan' }] }),
            now: NOW,
        });
        expect(result.level).toBe('received');
        expect(String(result.detail).toLowerCase()).toContain('pin');
    });
});

describe('turnos: honestidad ante un eco que no permite verificar', () => {
    it('shift.close → received con detalle honesto (el eco no trae turnos)', () => {
        const result = evaluateCommandVerification({
            command: appliedCommand('supervisor.shift.close', { shiftId: 's1', cierreId: 'c1' }),
            snapshot: echoAfter({ products: [], users: [] }),
            now: NOW,
        });
        expect(result.level).toBe('received');
    });
});
