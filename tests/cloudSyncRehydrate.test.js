import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/hooks/useCloudSync.js', 'utf8');

describe('CloudSync — hidratación confiable (D1/F1/F4)', () => {
    it('registra la sesión del dispositivo ANTES de consultar sync_documents', () => {
        const initSyncPos = source.indexOf('const initSync =');
        const registro = source.indexOf('ensureDeviceSessionRegistered(deviceId)', initSyncPos);
        const pull = source.indexOf("from('sync_documents')", initSyncPos);
        expect(registro).toBeGreaterThan(-1);
        expect(pull).toBeGreaterThan(-1);
        expect(registro).toBeLessThan(pull);
    });

    it('deja diagnóstico estructurado del pull inicial (D1)', () => {
        expect(source).toContain(`'[CloudSync] Pull inicial diagnóstico'`);
        expect(source).toContain(`'[CloudSync] Doc omitido por watermark'`);
        expect(source).toContain(`'[CloudSync] Pull inicial falló'`);
    });

    it('avisa restauración/fallo cuando el almacén local está vacío (F1/F4)', () => {
        expect(source).toContain('localWasEmpty');
        expect(source).toContain('Se restauró un respaldo previo de este equipo en la nube');
        expect(source).toContain('No se pudo restaurar el respaldo de este equipo en la nube');
    });

    it('expone la semántica de vacío publicable (F3)', () => {
        expect(source).toContain('export const EMPTY_SNAPSHOT_KEYS');
        expect(source).toContain('export async function resetPOSDataToEmpty');
    });
});
