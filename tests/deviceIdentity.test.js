/**
 * tests/deviceIdentity.test.js — Identidad de dispositivo + saneamiento RLS.
 *
 * Cubre:
 *  - ensureDeviceSessionRegistered: registro idempotente con reconciliacion
 *    por 23505 (politica reclaim de la migracion 001_device_own_row_rls.sql).
 *  - Saneamiento del SQL de migracion: politicas/funciones presentes
 *    para cloud_backups y sync_documents.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { _insertMock, _updateMock, _updateEqMock, _updateEqResult, _updateSelectMock, _getSessionMock, _rpcMock, _selectMock, _selectEqMock, _maybeSingleMock } = vi.hoisted(() => ({
    _insertMock: vi.fn(),
    _updateMock: vi.fn(),
    _updateEqMock: vi.fn(),
    _updateEqResult: vi.fn(),
    _updateSelectMock: vi.fn(),
    _getSessionMock: vi.fn(),
    _rpcMock: vi.fn(),
    _selectMock: vi.fn(),
    _selectEqMock: vi.fn(),
    _maybeSingleMock: vi.fn(),
}));

vi.mock('../src/config/supabaseCloud', () => ({
    supabaseCloud: {
        from: vi.fn(() => ({
            insert: _insertMock,
            update: _updateMock.mockImplementation(() => ({ eq: _updateEqMock })),
            select: _selectMock.mockImplementation(() => ({
                eq: _selectEqMock.mockImplementation(() => ({ maybeSingle: _maybeSingleMock })),
            })),
        })),
        rpc: _rpcMock,
        auth: {
            getSession: _getSessionMock,
        },
    },
}));

import { ensureDeviceSessionRegistered, verifyDeviceSessionRegistered } from '../src/utils/deviceIdentity';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = join(here, '..', 'supabase', 'migrations', '001_device_own_row_rls.sql');
const REGISTRATION_MIGRATION_PATH = join(here, '..', 'supabase', 'migrations', '20261015_supervisor_device_session_registration.sql');

beforeEach(() => {
    _insertMock.mockReset();
    _updateMock.mockReset();
    _updateEqMock.mockReset();
    _updateSelectMock.mockReset();
    _updateEqResult.mockReset();
    _getSessionMock.mockReset();
    _rpcMock.mockReset();
    _selectMock.mockReset();
    _selectEqMock.mockReset();
    _maybeSingleMock.mockReset();
    _getSessionMock.mockResolvedValue({
        data: { session: { user: { id: 'user-1111-2222' } } },
    });
    // Cadena real: update(...).eq(...)
    _updateMock.mockImplementation(() => ({ eq: _updateEqMock }));
    // Cadena real: update(...).eq(...) [.select(...)]. El reclamo pide las filas
    // afectadas; los casos que usan eq como await directo siguen funcionando.
    _updateEqMock.mockImplementation(() => ({
        select: _updateSelectMock,
        then: (resolve, reject) => _updateEqResult().then(resolve, reject),
    }));
    _updateEqResult.mockResolvedValue({ error: null });
    // select() es el único punto donde el reclamo lee error y filas afectadas.
    _updateSelectMock.mockImplementation(async () => {
        const { error } = await _updateEqResult();
        return error ? { data: null, error } : { data: [{ device_id: 'PDA-TEST' }], error: null };
    });
    _rpcMock.mockResolvedValue({ data: null, error: { code: 'PGRST202' } });
    // Read-back por defecto: la fila de device_sessions sí quedó ligada.
    _maybeSingleMock.mockResolvedValue({ data: { device_id: 'PDA-TEST' }, error: null });
});

describe('ensureDeviceSessionRegistered', () => {
    it('no reporta reclamo exitoso si claim_device_session rechaza la posesión', async () => {
        _insertMock.mockResolvedValue({ error: { code: '23505' } });
        _rpcMock.mockImplementation((name) => (name === 'claim_device_session'
            ? Promise.resolve({ data: { success: false, code: 'POSSESSION_REQUIRED' }, error: null })
            : Promise.resolve({ data: null, error: { code: 'PGRST202' } })));

        const res = await ensureDeviceSessionRegistered('PDA-TEST');

        expect(res.ok).toBe(false);
        expect(res.reclaimed).toBe(false);
        expect(res.error && res.error.code).toBe('POSSESSION_REQUIRED');
    });

    it('usa el RPC seguro cuando el ambiente revoca INSERT directo', async () => {
        _rpcMock.mockResolvedValue({
            data: { success: true, device_id: 'PDA-TEST' },
            error: null,
        });

        const res = await ensureDeviceSessionRegistered('PDA-TEST');

        expect(res).toEqual({ ok: true, registered: true, reclaimed: false, error: null });
        expect(_rpcMock).toHaveBeenCalledWith('register_device_session', {
            p_device_id: 'PDA-TEST',
        });
        expect(_insertMock).not.toHaveBeenCalled();
    });

    it('INSERT exitoso devuelve registered=true', async () => {
        _insertMock.mockResolvedValue({ error: null });
        const res = await ensureDeviceSessionRegistered('PDA-TEST');
        expect(res).toEqual({ ok: true, registered: true, reclaimed: false, error: null });
        expect(_insertMock).toHaveBeenCalledWith({
            device_id: 'PDA-TEST',
            user_id: 'user-1111-2222',
        });
    });

    it('sin deviceId devuelve ok=false sin lanzar', async () => {
        const res = await ensureDeviceSessionRegistered('');
        expect(res.ok).toBe(false);
        expect(_insertMock).not.toHaveBeenCalled();
    });

    it('sin sesion activa devuelve ok=false sin lanzar', async () => {
        _getSessionMock.mockResolvedValue({ data: { session: null } });
        const res = await ensureDeviceSessionRegistered('PDA-TEST');
        expect(res.ok).toBe(false);
        expect(_insertMock).not.toHaveBeenCalled();
    });

    it('23505 reclama con claim_device_session y el secreto local', async () => {
        _insertMock.mockResolvedValue({ error: { code: '23505' } });
        _rpcMock.mockImplementation((name) => (name === 'claim_device_session'
            ? Promise.resolve({ data: { success: true, code: 'RECLAIMED' }, error: null })
            : Promise.resolve({ data: null, error: { code: 'PGRST202' } })));
        const res = await ensureDeviceSessionRegistered('PDA-TEST');
        expect(res.ok).toBe(true);
        expect(res.registered).toBe(false);
        expect(res.reclaimed).toBe(true);
        expect(_rpcMock).toHaveBeenCalledWith('claim_device_session', expect.objectContaining({
            p_device_id: 'PDA-TEST',
            p_secret: expect.any(String),
        }));
        expect(_updateMock).not.toHaveBeenCalled();
    });

    it('23505 con claim_device_session fallido devuelve ok=false y el error', async () => {
        _insertMock.mockResolvedValue({ error: { code: '23505' } });
        _rpcMock.mockImplementation((name) => (name === 'claim_device_session'
            ? Promise.resolve({ data: null, error: { code: '42501' } })
            : Promise.resolve({ data: null, error: { code: 'PGRST202' } })));
        const res = await ensureDeviceSessionRegistered('PDA-TEST');
        expect(res.ok).toBe(false);
        expect(res.reclaimed).toBe(false);
        expect(res.error && res.error.code).toBe('42501');
    });

    it('error RLS directo se propaga en el resultado sin lanzar', async () => {
        _insertMock.mockResolvedValue({ error: { code: '42501' } });
        const res = await ensureDeviceSessionRegistered('PDA-TEST');
        expect(res.ok).toBe(false);
        expect(res.error && res.error.code).toBe('42501');
    });

    it('re-liga la fila cuando el RPC reporta conflicto de sesión (recuperación automática)', async () => {
        _rpcMock.mockImplementation((name) => (name === 'claim_device_session'
            ? Promise.resolve({ data: { success: true, code: 'RECLAIMED' }, error: null })
            : Promise.resolve({
                data: { success: false, code: 'DEVICE_SESSION_CONFLICT', message: 'Esta caja ya está vinculada a otra sesión.' },
                error: null,
            })));

        const res = await ensureDeviceSessionRegistered('PDA-TEST');

        expect(res).toEqual({ ok: true, registered: false, reclaimed: true, error: null });
        expect(_insertMock).not.toHaveBeenCalled();
        expect(_updateMock).not.toHaveBeenCalled();
        expect(_rpcMock).toHaveBeenCalledWith('claim_device_session', expect.objectContaining({ p_device_id: 'PDA-TEST' }));
    });

    it('si la re-ligación también falla, conserva el error y no inventa éxito', async () => {
        _rpcMock.mockImplementation((name) => (name === 'claim_device_session'
            ? Promise.resolve({ data: null, error: { code: '42501' } })
            : Promise.resolve({
                data: { success: false, code: 'DEVICE_SESSION_CONFLICT', message: 'Esta caja ya está vinculada a otra sesión.' },
                error: null,
            })));

        const res = await ensureDeviceSessionRegistered('PDA-TEST');

        expect(res.ok).toBe(false);
        expect(res.reclaimed).toBe(false);
        expect(res.error && res.error.code).toBe('42501');
        expect(_insertMock).not.toHaveBeenCalled();
    });

    it('otros rechazos del RPC no se re-ligan automáticamente', async () => {
        _rpcMock.mockResolvedValue({
            data: { success: false, code: 'INVALID_DEVICE_ID', message: 'Identificador de dispositivo inválido.' },
            error: null,
        });

        const res = await ensureDeviceSessionRegistered('PDA-TEST');

        expect(res.ok).toBe(false);
        expect(res.error).toEqual(expect.objectContaining({ code: 'INVALID_DEVICE_ID' }));
        expect(_updateMock).not.toHaveBeenCalled();
        expect(_insertMock).not.toHaveBeenCalled();
    });

    it('un reclaim sin efecto NO es éxito: exige vínculo comprobado (bug RLS)', async () => {
        _rpcMock.mockImplementation((name) => (name === 'claim_device_session'
            ? Promise.resolve({ data: { success: true, code: 'RECLAIMED' }, error: null })
            : Promise.resolve({ data: { success: false, code: 'DEVICE_SESSION_CONFLICT', message: 'Esta caja ya está vinculada a otra sesión.' }, error: null })));
        // El RPC responde éxito pero la fila no quedó ligada: el read-back lo detecta.
        _maybeSingleMock.mockResolvedValue({ data: null, error: null });

        const res = await ensureDeviceSessionRegistered('PDA-TEST');

        expect(res.ok).toBe(false);
        expect(res.reclaimed).toBe(false);
        expect(res.error && res.error.code).toBe('DEVICE_SESSION_NOT_BOUND');
    });

    it('también verifica el vínculo en el camino del RPC exitoso', async () => {
        _rpcMock.mockResolvedValue({
            data: { success: true, device_id: 'PDA-TEST' },
            error: null,
        });
        _maybeSingleMock.mockResolvedValue({ data: null, error: null });

        const res = await ensureDeviceSessionRegistered('PDA-TEST');

        expect(res.ok).toBe(false);
        expect(res.error && res.error.code).toBe('DEVICE_SESSION_NOT_BOUND');
    });

    it('verifyDeviceSessionRegistered distingue vínculo comprobado de fila ausente', async () => {
        _maybeSingleMock.mockResolvedValue({ data: { device_id: 'PDA-TEST' }, error: null });
        expect((await verifyDeviceSessionRegistered('PDA-TEST')).bound).toBe(true);

        _maybeSingleMock.mockResolvedValue({ data: null, error: null });
        expect((await verifyDeviceSessionRegistered('PDA-TEST')).bound).toBe(false);
    });
});

describe('migracion 001_device_own_row_rls.sql (saneamiento)', () => {
    const sql = readFileSync(MIGRATION_PATH, 'utf8');

    it('declara la tabla puente device_sessions', () => {
        expect(sql).toContain('create table if not exists public.device_sessions');
        expect(sql).toContain('device_id    text primary key');
        expect(sql).toContain('references auth.users (id) on delete cascade');
    });

    it('habilita RLS en las tres tablas', () => {
        expect(sql).toContain('alter table public.device_sessions enable row level security');
        expect(sql).toContain('alter table public.cloud_backups enable row level security');
        expect(sql).toContain('alter table public.sync_documents enable row level security');
    });

    it('incluye politicas own-row para cloud_backups', () => {
        expect(sql).toContain('create policy "device_upsert_own_backup"');
        expect(sql).toContain('create policy "device_update_own_backup"');
        expect(sql).toContain('create policy "device_read_own_backup"');
        expect(sql).toContain('is_own_device_row(device_id)');
    });

    it('incluye politicas own-row para sync_documents', () => {
        expect(sql).toContain('create policy "device_write_own_sync_doc"');
        expect(sql).toContain('create policy "device_update_own_sync_doc"');
        expect(sql).toContain('create policy "device_read_own_sync_doc"');
    });

    it('declara las funciones helper con security definer', () => {
        expect(sql).toContain('function public.is_own_device_row');
        expect(sql).toContain('function public.current_device_id');
        expect(sql).toMatch(/security definer/);
    });

    it('la lectura del monitor resuelve via device_pairings', () => {
        expect(sql).toContain('monitor_device_id = public.current_device_id()');
    });

    it('no concede DELETE a dispositivos (retencion: solo service_role)', () => {
        expect(sql).not.toMatch(/for delete to anon/);
        expect(sql).not.toMatch(/for delete to anon, authenticated/);
    });
});

describe('registro server-side de device_sessions', () => {
    it('la migración de producción limita la RPC a sesiones autenticadas', () => {
        const sql = readFileSync(REGISTRATION_MIGRATION_PATH, 'utf8');
        expect(sql).toContain('CREATE OR REPLACE FUNCTION public.register_device_session');
        expect(sql).toContain("'DEVICE_SESSION_CONFLICT'");
        expect(sql).toContain('REVOKE ALL ON FUNCTION public.register_device_session(text) FROM PUBLIC, anon');
        expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.register_device_session(text) TO authenticated, service_role');
    });

});
