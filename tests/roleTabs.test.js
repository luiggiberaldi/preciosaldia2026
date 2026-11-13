import { describe, it, expect } from 'vitest';
import { ADMIN_ONLY_TABS, canOpenTab, safeTab } from '../src/app/roleTabs';

describe('portero de pantallas por rol', () => {
    it('el cajero no abre Reportes ni Ajustes', () => {
        expect(canOpenTab('reportes', true)).toBe(false);
        expect(canOpenTab('ajustes', true)).toBe(false);
        expect(ADMIN_ONLY_TABS.has('reportes')).toBe(true);
        expect(ADMIN_ONLY_TABS.has('ajustes')).toBe(true);
    });

    it('el cajero sí abre Inicio, Vender, Inventario y Clientes', () => {
        for (const tab of ['inicio', 'ventas', 'catalogo', 'clientes']) {
            expect(canOpenTab(tab, true)).toBe(true);
        }
    });

    it('el administrador abre todo', () => {
        for (const tab of ['inicio', 'ventas', 'catalogo', 'clientes', 'reportes', 'ajustes']) {
            expect(canOpenTab(tab, false)).toBe(true);
        }
    });

    it('si el cajero pide una pantalla prohibida, se queda en Vender', () => {
        expect(safeTab('ajustes', true)).toBe('ventas');
        expect(safeTab('clientes', true)).toBe('clientes');
        expect(safeTab('ajustes', false)).toBe('ajustes');
    });
});
