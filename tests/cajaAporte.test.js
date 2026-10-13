/**
 * tests/cajaAporte.test.js — Validación del registro de aporte de efectivo.
 *
 * Decisiones del dueño (2026-10-13): el motivo es obligatorio; sin login
 * cualquiera con acceso a la caja puede aportar (el control de rol va aparte).
 */
import { describe, expect, it } from 'vitest';
import { APORTE_CAJA_TIPO, buildAporteCajaRecord } from '../src/utils/cajaAporte.js';

const now = new Date('2026-10-13T12:00:00.000Z');
const usuario = { id: 'u1', nombre: 'Ana' };

describe('buildAporteCajaRecord', () => {
    it('construye un registro APORTE_CAJA con montos redondeados y caja abierta', () => {
        const rec = buildAporteCajaRecord({
            aporteUsd: '10.005', aporteBs: 365, aporteCop: 0,
            motivo: 'Cambio de monedas', usuario, now,
        });
        expect(rec.tipo).toBe(APORTE_CAJA_TIPO);
        expect(rec.aporteUsd).toBe(10.01);
        expect(rec.aporteBs).toBe(365);
        expect(rec.aporteCop).toBe(0);
        expect(rec.motivo).toBe('Cambio de monedas');
        expect(rec.registradoPor).toBe('Ana');
        expect(rec.registradoPorId).toBe('u1');
        expect(rec.timestamp).toBe(now.toISOString());
        expect(rec.cajaCerrada).toBe(false);
    });

    it('sin sesión registra "Sin sesión" (modo sin login permitido)', () => {
        const rec = buildAporteCajaRecord({ aporteUsd: 5, motivo: 'Fondo', usuario: null, now });
        expect(rec.registradoPor).toBe('Sin sesión');
        expect(rec.registradoPorId).toBeNull();
    });

    it('rechaza un aporte en cero', () => {
        expect(() => buildAporteCajaRecord({ aporteUsd: 0, aporteBs: '', motivo: 'x', now }))
            .toThrow('Ingresa un monto mayor a cero.');
    });

    it('rechaza montos negativos', () => {
        expect(() => buildAporteCajaRecord({ aporteUsd: -1, motivo: 'x', now }))
            .toThrow('Los montos del aporte no pueden ser negativos.');
    });

    it('exige un motivo (obligatorio por decisión del dueño)', () => {
        expect(() => buildAporteCajaRecord({ aporteUsd: 5, motivo: '   ', now }))
            .toThrow('Indica el motivo del aporte.');
        expect(() => buildAporteCajaRecord({ aporteUsd: 5, motivo: undefined, now }))
            .toThrow('Indica el motivo del aporte.');
    });

    it('recorta el motivo a 200 caracteres', () => {
        const rec = buildAporteCajaRecord({ aporteUsd: 5, motivo: 'a'.repeat(300), now });
        expect(rec.motivo).toHaveLength(200);
    });
});
