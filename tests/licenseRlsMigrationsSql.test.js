import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Barandas de las migraciones que cierran licenses y backup_requests (P-016).
// Revisan el SQL ejecutable (sin comentarios): la reversión vive en comentarios
// y sí contiene las políticas abiertas a propósito.

const read = (name) => readFileSync(resolve(process.cwd(), 'supabase/migrations', name), 'utf8');
const executable = (sql) => sql.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n').replace(/[ \t]+/g, ' ');

const LICENSES = executable(read('20261115_licenses_cerrar_lectura_publica.sql'));
const BACKUP = executable(read('20261115_backup_requests_solo_propias.sql'));

describe('20261115_licenses_cerrar_lectura_publica', () => {
    it('quita la lectura pública y no abre otra', () => {
        expect(LICENSES).toMatch(/drop policy if exists "licenses_device_read" on public\.licenses/);
        expect(LICENSES).not.toMatch(/using\s*\(\s*true\s*\)/i);
        expect(LICENSES).not.toMatch(/to\s+anon/i);
    });

    it('solo deja leer la fila propia, con sesión de equipo', () => {
        expect(LICENSES).toMatch(/for select\s+to authenticated\s+using \(public\.is_own_device_row\(device_id\)\)/);
        expect(LICENSES).not.toMatch(/for (insert|update|delete|all)/i);
    });

    it('va en una sola transacción', () => {
        expect(LICENSES.trim().startsWith('begin;')).toBe(true);
        expect(LICENSES.trim().endsWith('commit;')).toBe(true);
    });
});

describe('20261115_backup_requests_solo_propias', () => {
    it('borra todas las políticas abiertas o rotas', () => {
        for (const name of [
            'Permitir lectura de backup_requests',
            'Permitir borrado de backup_requests',
            'Permitir insercion de backup_requests',
            'backup_requests_anon_access',
            'backup_requests_device_isolation',
        ]) {
            expect(BACKUP).toContain(`drop policy if exists "${name}" on public.backup_requests`);
        }
    });

    it('las cajas solo leen y marcan sus propias solicitudes', () => {
        expect(BACKUP).not.toMatch(/using\s*\(\s*true\s*\)/i);
        expect(BACKUP).not.toMatch(/with check\s*\(\s*true\s*\)/i);
        expect(BACKUP).not.toMatch(/for (insert|delete|all)/i);
        expect(BACKUP).toMatch(/"backup_requests_own_select"[\s\S]*?for select[\s\S]*?using \(public\.is_own_device_row\(device_id\)\)/);
        expect(BACKUP).toMatch(/"backup_requests_own_update"[\s\S]*?for update[\s\S]*?using \(public\.is_own_device_row\(device_id\)\)\s+with check \(public\.is_own_device_row\(device_id\)\)/);
    });

    it('no toca la política de la Estación (service_role)', () => {
        expect(BACKUP).not.toContain('backup_requests_admin_write');
    });

    it('va en una sola transacción', () => {
        expect(BACKUP.trim().startsWith('begin;')).toBe(true);
        expect(BACKUP.trim().endsWith('commit;')).toBe(true);
    });
});
