// ── Fase 3: fichas tipo recibo (inspiradas en MonitorCambiosTab de DJ) ──────
// Cada comando de supervisor_commands se transforma en una ficha legible:
// qué producto/cambio, qué se pidió (con delta), chips de detalle, quién, cuándo
// se envió, cuándo se aplicó, la fecha y el sello. Sin inventar datos: si el
// payload no trae un dato, la ficha muestra el fallback honesto.

import { describe, expect, it } from 'vitest';
import { getCommandReceipt } from '../src/services/supervisorCommandReceipt';

const SENT_AT = '2026-10-18T07:03:00.000Z';
const APPLIED_AT = '2026-10-18T07:04:00.000Z';

const command = (type, payload, extra = {}) => ({
    command_id: 'cmd-1',
    command_type: type,
    status: 'applied',
    payload,
    issued_at: SENT_AT,
    created_at: SENT_AT,
    updated_at: APPLIED_AT,
    ...extra,
});

describe('tipo legible con delta', () => {
    it('ingreso de inventario v1 → "AJUSTE DE STOCK (+8)" con chip de stock', () => {
        const receipt = getCommandReceipt(command('supervisor.inventory.batch.adjust', {
            direction: 'ingreso', productId: 'p1', productName: 'Champu Papeleta',
            quantityInput: 8, inputUnit: 'unidades', unitsPerPackage: 1,
            expectedStock: 22, reason: 'Ajuste de stock',
        }));
        expect(receipt.typeLabel).toBe('AJUSTE DE STOCK (+8)');
        expect(receipt.detailLines.some(chip => chip.includes('+8'))).toBe(true);
        expect(receipt.detailLines.some(chip => chip.includes('Ajuste de stock'))).toBe(true);
    });

    it('egreso v1 → el delta lleva signo menos', () => {
        const receipt = getCommandReceipt(command('supervisor.inventory.batch.adjust', {
            direction: 'egreso', productId: 'p1', quantityInput: 5, inputUnit: 'unidades',
            unitsPerPackage: 1, expectedStock: 10, reason: 'Merma', reasonCategory: 'merma',
        }));
        expect(receipt.typeLabel).toBe('AJUSTE DE STOCK (−5)');
    });

    it('lote v2 → tipo con la cantidad de movimientos y un chip por línea', () => {
        const receipt = getCommandReceipt(command('supervisor.inventory.batch.adjust', {
            batchVersion: 2, direction: 'ingreso', reason: 'Recepción',
            lines: [
                { productId: 'p1', productName: 'Arroz', quantityInput: 2, inputUnit: 'unidades', unitsPerPackage: 1 },
                { productId: 'p2', productName: 'Atún', quantityInput: 1, inputUnit: 'bultos', unitsPerPackage: 24 },
            ],
        }));
        expect(receipt.typeLabel).toBe('INGRESO DE INVENTARIO (2 movimientos)');
        expect(receipt.detailLines.length).toBeGreaterThanOrEqual(2);
    });

    it('cada tipo de comando tiene su etiqueta legible', () => {
        const cases = [
            ['supervisor.rate.set', { rateMode: 'bcv' }, 'CAMBIO DE TASA'],
            ['supervisor.product.create', { product: { id: 'p1', name: 'Arroz' } }, 'ALTA DE PRODUCTO'],
            ['supervisor.product.update', { productId: 'p1', patch: { name: 'Arroz Premium' } }, 'EDICIÓN DE PRODUCTO'],
            ['supervisor.product.delete', { productId: 'p1' }, 'BAJA DE PRODUCTO'],
            ['supervisor.user.create', { nombre: 'Juan', rol: 'CAJERO' }, 'ALTA DE USUARIO'],
            ['supervisor.user.pin.change', { userId: 1 }, 'CAMBIO DE PIN'],
            ['supervisor.user.update', { userId: 1, patch: { nombre: 'Juan' } }, 'EDICIÓN DE USUARIO'],
            ['supervisor.user.delete', { userId: 1 }, 'BAJA DE USUARIO'],
            ['supervisor.shift.close', { shiftId: 's1', cierreId: 'c1' }, 'CIERRE DE TURNO'],
            ['supervisor.shift.reopen', { shiftId: 's1', cierreId: 'c1' }, 'REAPERTURA DE TURNO'],
        ];
        cases.forEach(([type, payload, expected]) => {
            expect(getCommandReceipt(command(type, payload)).typeLabel).toBe(expected);
        });
    });
});

describe('título y chips: sin inventar datos', () => {
    it('el título nombra al producto/usuario cuando el payload lo trae', () => {
        expect(getCommandReceipt(command('supervisor.inventory.batch.adjust', {
            direction: 'ingreso', productId: 'p1', productName: 'Champu Papeleta',
            quantityInput: 8, inputUnit: 'unidades', unitsPerPackage: 1, reason: 'Ajuste',
        })).title).toBe('Champu Papeleta');

        expect(getCommandReceipt(command('supervisor.user.create', { nombre: 'Juan', rol: 'CAJERO' })).title).toBe('Juan');
    });

    it('sin nombre en el payload, un resolutor del eco puede darlo; sin resolutor, fallback honesto', () => {
        const deleteCommand = command('supervisor.product.delete', { productId: 'p_17923284790852_x7rzx' });
        const withResolver = getCommandReceipt(deleteCommand, { resolveName: id => (id === 'p_17923284790852_x7rzx' ? 'Prueba' : null) });
        expect(withResolver.title).toBe('Prueba');

        const withoutResolver = getCommandReceipt(deleteCommand);
        expect(withoutResolver.title).toBeTruthy();
        expect(withoutResolver.title).not.toBe('Prueba');
    });

    it('la tasa lleva chip de modo y, si es manual, el valor', () => {
        const bcv = getCommandReceipt(command('supervisor.rate.set', { rateMode: 'bcv' }));
        expect(bcv.detailLines.some(chip => chip.includes('bcv'))).toBe(true);

        const manual = getCommandReceipt(command('supervisor.rate.set', { rateMode: 'manual', customRate: 40 }));
        expect(manual.detailLines.some(chip => chip.includes('40'))).toBe(true);
    });

    it('los chips de usuario incluyen el rol cuando existe', () => {
        const receipt = getCommandReceipt(command('supervisor.user.create', { nombre: 'Juan', rol: 'CAJERO' }));
        expect(receipt.detailLines.some(chip => chip.includes('CAJERO'))).toBe(true);
    });
});

describe('quién, cuándo y sello', () => {
    it('la ficha recuerda quién lo pidió y las horas de envío y aplicación', () => {
        const receipt = getCommandReceipt(command('supervisor.product.create', { product: { id: 'p1', name: 'Arroz' } }));
        expect(receipt.actorLabel).toContain('Supervisor');
        expect(receipt.sentAt).toBe(SENT_AT);
        expect(receipt.appliedAt).toBe(APPLIED_AT);
    });

    it('la fecha va en formato dd/mm/aaaa con sello de caja', () => {
        const receipt = getCommandReceipt(command('supervisor.product.create', { product: { id: 'p1', name: 'Arroz' } }));
        expect(receipt.dateLabel).toMatch(/\d{2}\/\d{2}\/\d{4}/);
        expect(receipt.dateLabel).toContain('APLICADO EN CAJA');
        expect(receipt.seal.label).toBe('Aplicado por la caja');
    });

    it('un comando sin aplicar no muestra hora de aplicación y su sello es de espera', () => {
        const receipt = getCommandReceipt(command('supervisor.product.create', { product: { id: 'p1', name: 'Arroz' } }, {
            status: 'pending',
            updated_at: SENT_AT,
        }));
        expect(receipt.appliedAt).toBeNull();
        expect(receipt.dateLabel).toContain('ENVIADO');
        expect(receipt.seal.label).toBe('En espera de la caja');
    });

    it('cada estado terminal tiene su sello honesto', () => {
        const seals = [
            ['applied_with_warnings', 'Aplicado con reservas'],
            ['rejected', 'Rechazado por la caja'],
            ['failed', 'Falló en la caja'],
            ['cancelled', 'Anulado'],
        ];
        seals.forEach(([status, label]) => {
            const receipt = getCommandReceipt(command('supervisor.product.delete', { productId: 'p1' }, { status }));
            expect(receipt.seal.label).toBe(label);
        });
    });

    it('expone la verificación como sello de segundo nivel', () => {
        const verified = getCommandReceipt(command('supervisor.product.delete', { productId: 'p1' }), {
            verification: { level: 'verified', detail: 'confirmado' },
        });
        expect(verified.verification).toMatchObject({ level: 'verified', label: 'Aplicado y verificado' });

        const mismatch = getCommandReceipt(command('supervisor.product.delete', { productId: 'p1' }), {
            verification: { level: 'mismatch' },
        });
        expect(mismatch.verification).toMatchObject({ level: 'mismatch', label: 'No coincide — revisar' });

        // Sin verificación registrada: el sello por defecto es honesto ("recibido").
        const none = getCommandReceipt(command('supervisor.product.delete', { productId: 'p1' }));
        expect(none.verification).toMatchObject({ level: 'received', label: 'Recibido por la caja' });
    });
});
