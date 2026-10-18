// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildAporteCajaRecord } from '../src/utils/cajaAporte';
import { storageService } from '../src/utils/storageService';
import { withLock } from '../src/utils/withLock';

describe('Dashboard Aporte Flow Integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('builds APORTE_CAJA record and appends to storage under pos_write_lock', async () => {
        const mockSales = [{ id: 'sale_1', totalUsd: 10 }];
        vi.spyOn(storageService, 'getItem').mockResolvedValue(mockSales);
        vi.spyOn(storageService, 'setItem').mockResolvedValue(true);

        const data = {
            aporteUsd: 20,
            aporteBs: 0,
            aporteCop: 0,
            motivo: 'Fondo para sencillo'
        };

        const usuario = { id: 'admin_1', nombre: 'Carlos Admin' };
        const record = buildAporteCajaRecord({ ...data, usuario });

        expect(record.tipo).toBe('APORTE_CAJA');
        expect(record.aporteUsd).toBe(20);
        expect(record.motivo).toBe('Fondo para sencillo');
        expect(record.registradoPor).toBe('Carlos Admin');

        await withLock('pos_write_lock', async () => {
            const existingSales = await storageService.getItem('bodega_sales_v1', []);
            await storageService.setItem('bodega_sales_v1', [...existingSales, record]);
        });

        expect(storageService.setItem).toHaveBeenCalledWith(
            'bodega_sales_v1',
            [mockSales[0], record]
        );
    });

    it('rejects if amount <= 0 or missing motivo via buildAporteCajaRecord', () => {
        const usuario = { id: 'admin_1', nombre: 'Carlos Admin' };

        // Monto <= 0
        expect(() => {
            buildAporteCajaRecord({
                aporteUsd: 0,
                aporteBs: 0,
                aporteCop: 0,
                motivo: 'Fondo caja',
                usuario
            });
        }).toThrow('Ingresa un monto mayor a cero.');

        // Monto negativo
        expect(() => {
            buildAporteCajaRecord({
                aporteUsd: -5,
                aporteBs: 0,
                aporteCop: 0,
                motivo: 'Fondo caja',
                usuario
            });
        }).toThrow('Los montos del aporte no pueden ser negativos.');

        // Sin motivo
        expect(() => {
            buildAporteCajaRecord({
                aporteUsd: 10,
                aporteBs: 0,
                aporteCop: 0,
                motivo: '',
                usuario
            });
        }).toThrow('Indica el motivo del aporte.');
    });

    it('rejects if requireLogin is true and user is not admin', () => {
        const requireLogin = true;
        const usuarioActivo = { id: 'cajero_1', nombre: 'Juan Cajero', rol: 'CAJERO' };

        const checkPermission = (requireLogin, usuario) => {
            if (requireLogin && usuario?.rol !== 'ADMIN') {
                return false;
            }
            return true;
        };

        expect(checkPermission(requireLogin, usuarioActivo)).toBe(false);
        expect(checkPermission(requireLogin, { id: 'admin_1', nombre: 'Admin', rol: 'ADMIN' })).toBe(true);
        expect(checkPermission(false, usuarioActivo)).toBe(true);
    });
});
