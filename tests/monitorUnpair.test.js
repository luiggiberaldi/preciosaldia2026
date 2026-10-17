import { describe, expect, it, vi } from 'vitest';
import {
    clearMonitorCache,
    commitMonitorPairing,
    MONITOR_CLEANUP_PENDING_KEY,
    isPairingRevocationConfirmed,
    revokeAndClearMonitor,
} from '../src/services/monitorUnpair.js';
import { SUPERVISOR_SYNC_KEYS } from '../src/services/supervisorContracts.js';
import { getSyncMetadataKey } from '../src/services/supervisorSyncService.js';

function createLocalStorage(initialEntries = [], { failRemove = null } = {}) {
    const entries = new Map(initialEntries);
    return {
        getItem: vi.fn((key) => entries.get(key) ?? null),
        setItem: vi.fn((key, value) => entries.set(key, String(value))),
        removeItem: vi.fn((key) => {
            if (key === failRemove) throw new Error(`cannot remove ${key}`);
            entries.delete(key);
        }),
        entries,
    };
}

function createStore(initialEntries = [], { failRemove = null } = {}) {
    const entries = new Map(initialEntries);
    return {
        getItem: vi.fn(async (key) => entries.get(key) ?? null),
        removeItem: vi.fn(async (key) => {
            if (key === failRemove) throw new Error(`cannot remove ${key}`);
            entries.delete(key);
        }),
        entries,
    };
}

const makeDeps = (overrides = {}) => ({
    deviceId: 'primary-device',
    ensureSession: vi.fn(async () => ({ session: { user: { id: 'monitor-auth' } }, error: null })),
    revokePairing: vi.fn(async () => ({ error: null })),
    verifyPairingRevoked: vi.fn(async () => false),
    idbStore: createStore(),
    localStorage: createLocalStorage([['pda_paired_device_id', 'primary-device'], ['pda_pairing_mode', 'monitor']]),
    onRemoteRevoked: vi.fn(),
    ...overrides,
});

describe('isPairingRevocationConfirmed', () => {
    it('requires affirmative evidence that this monitor no longer owns the pairing', () => {
        expect(isPairingRevocationConfirmed(null, 'monitor-auth')).toBe(false);
        expect(isPairingRevocationConfirmed({ monitor_auth_id: 'monitor-auth' }, 'monitor-auth')).toBe(false);
        expect(isPairingRevocationConfirmed({ monitor_auth_id: 'other-monitor' }, 'monitor-auth')).toBe(true);
        expect(isPairingRevocationConfirmed({ revoked_at: '2026-01-01T00:00:00Z' }, 'monitor-auth')).toBe(true);
    });
});

describe('revokeAndClearMonitor', () => {
    it('revoca, pausa sincronización y limpia solo la caché del monitor', async () => {
        const syncKey = SUPERVISOR_SYNC_KEYS[0];
        const idbStore = createStore([[syncKey, [{ id: 'remote' }]], ['abasto-auth-storage', { state: { user: 'local' } }]]);
        const localStorage = createLocalStorage([
            ['pda_paired_device_id', 'primary-device'],
            ['pda_pairing_mode', 'monitor'],
            ['business_name', 'Tienda vinculada'],
            ['keep-user-setting', 'preserve'],
            [getSyncMetadataKey(syncKey), '2026-01-01T00:00:00.000Z'],
        ]);
        const deps = makeDeps({ idbStore, localStorage });

        await expect(revokeAndClearMonitor(deps)).resolves.toBeUndefined();

        expect(deps.revokePairing).toHaveBeenCalledWith('primary-device');
        expect(deps.onRemoteRevoked).toHaveBeenCalledOnce();
        expect(idbStore.entries.has(syncKey)).toBe(false);
        expect(idbStore.entries.has('abasto-auth-storage')).toBe(true);
        expect(localStorage.getItem('pda_paired_device_id')).toBeNull();
        expect(localStorage.getItem('pda_pairing_mode')).toBeNull();
        expect(localStorage.getItem('business_name')).toBeNull();
        expect(localStorage.getItem('keep-user-setting')).toBe('preserve');
        expect(localStorage.getItem(getSyncMetadataKey(syncKey))).toBeNull();
        expect(localStorage.getItem(MONITOR_CLEANUP_PENDING_KEY)).toBeNull();
    });

    it('no elimina nada ni pausa sync si la revocación remota falla', async () => {
        const idbStore = createStore([['bodega_products_v1', [{ id: 'remote' }]]]);
        const localStorage = createLocalStorage([['pda_paired_device_id', 'primary-device']]);
        const deps = makeDeps({
            idbStore,
            localStorage,
            revokePairing: vi.fn(async () => ({ error: new Error('network down') })),
        });

        await expect(revokeAndClearMonitor(deps)).rejects.toMatchObject({
            name: 'MonitorUnpairError',
            phase: 'revoke',
        });

        expect(idbStore.entries.has('bodega_products_v1')).toBe(true);
        expect(localStorage.getItem('pda_paired_device_id')).toBe('primary-device');
        expect(localStorage.getItem(MONITOR_CLEANUP_PENDING_KEY)).toBeNull();
        expect(deps.onRemoteRevoked).not.toHaveBeenCalled();
    });

    it('si la respuesta de revocación falla, verifica estado y evita repetir RPC al reintentar limpieza', async () => {
        const idbStore = createStore([], { failRemove: 'bodega_products_v1' });
        const localStorage = createLocalStorage([['pda_paired_device_id', 'primary-device']]);
        const deps = makeDeps({
            idbStore,
            localStorage,
            revokePairing: vi.fn(async () => ({ error: new Error('response lost') })),
            verifyPairingRevoked: vi.fn(async () => true),
        });

        await expect(revokeAndClearMonitor(deps)).rejects.toMatchObject({ phase: 'cleanup' });
        expect(deps.verifyPairingRevoked).toHaveBeenCalledWith('primary-device');
        expect(deps.onRemoteRevoked).toHaveBeenCalledOnce();
        expect(localStorage.getItem(MONITOR_CLEANUP_PENDING_KEY)).toBe('true');
        expect(localStorage.getItem('pda_paired_device_id')).toBe('primary-device');

        idbStore.removeItem.mockImplementation(async (key) => idbStore.entries.delete(key));
        await expect(revokeAndClearMonitor(deps)).resolves.toBeUndefined();
        expect(deps.revokePairing).toHaveBeenCalledOnce();
        expect(deps.onRemoteRevoked).toHaveBeenCalledTimes(2);
        expect(localStorage.getItem(MONITOR_CLEANUP_PENDING_KEY)).toBeNull();
        expect(localStorage.getItem('pda_paired_device_id')).toBeNull();
    });

    it('continúa limpieza solo cuando verify confirma revocación tras fallo de la RPC', async () => {
        const deps = makeDeps({
            revokePairing: vi.fn(async () => ({ error: new Error('response lost') })),
            verifyPairingRevoked: vi.fn(async () => true),
            onServerRevoked: vi.fn(),
        });

        await expect(revokeAndClearMonitor(deps)).resolves.toBeUndefined();

        expect(deps.verifyPairingRevoked).toHaveBeenCalledWith('primary-device');
        expect(deps.onServerRevoked).toHaveBeenCalledOnce();
        expect(deps.onRemoteRevoked).toHaveBeenCalledOnce();
        expect(deps.localStorage.getItem('pda_paired_device_id')).toBeNull();
    });

    it('no considera revocado un estado desconocido por verificación sin implementar', async () => {
        const deps = makeDeps({
            revokePairing: vi.fn(async () => ({ error: new Error('response lost') })),
            verifyPairingRevoked: undefined,
            onServerRevoked: vi.fn(),
        });

        await expect(revokeAndClearMonitor(deps)).rejects.toMatchObject({ phase: 'revoke' });
        expect(deps.localStorage.getItem('pda_paired_device_id')).toBe('primary-device');
        expect(deps.onServerRevoked).not.toHaveBeenCalled();
        expect(deps.onRemoteRevoked).not.toHaveBeenCalled();
    });

    it('rechaza borrar todo el almacenamiento, incluida la identidad local', async () => {
        const idbStore = createStore();
        const localStorage = createLocalStorage([['premium_token', 'license'], ['sb-auth-token', 'auth']]);

        await clearMonitorCache({ idbStore, localStorage });

        expect(localStorage.getItem('premium_token')).toBe('license');
        expect(localStorage.getItem('sb-auth-token')).toBe('auth');
        expect(idbStore.removeItem).not.toHaveBeenCalledWith('abasto-auth-storage');
    });

    it('si el marker de reintento no se puede guardar, no limpia la caché local', async () => {
        const idbStore = createStore([['bodega_products_v1', [{ id: 'remote' }]]]);
        const baseStorage = createLocalStorage([['pda_paired_device_id', 'primary-device']]);
        const localStorage = {
            ...baseStorage,
            setItem: vi.fn(() => { throw new Error('storage unavailable'); }),
        };
        const deps = makeDeps({ idbStore, localStorage });

        await expect(revokeAndClearMonitor(deps)).rejects.toMatchObject({ phase: 'cleanup' });
        expect(idbStore.entries.has('bodega_products_v1')).toBe(true);
        expect(localStorage.getItem('pda_paired_device_id')).toBe('primary-device');
        expect(deps.onRemoteRevoked).not.toHaveBeenCalled();
    });

    it('conserva el monitor si no hay ID para pedir la revocación', async () => {
        const deps = makeDeps({ deviceId: null });

        await expect(revokeAndClearMonitor(deps)).rejects.toMatchObject({
            name: 'MonitorUnpairError',
            phase: 'revoke',
        });
        expect(deps.revokePairing).not.toHaveBeenCalled();
    });
});

describe('commitMonitorPairing (F2: purga al re-vincular)', () => {
    it('purga la caché heredada ANTES de fijar el nuevo vínculo', async () => {
        const syncKey = SUPERVISOR_SYNC_KEYS[0];
        const idbStore = createStore([[syncKey, [{ id: 'heredado' }]]]);
        const localStorage = createLocalStorage([
            ['pda_paired_device_id', 'primary-viejo'],
            ['pda_pairing_mode', 'monitor'],
            [getSyncMetadataKey(syncKey), '2026-08-01T00:00:00Z'],
        ]);

        await commitMonitorPairing({ idbStore, localStorage, primaryDeviceId: 'primary-nuevo' });

        expect(idbStore.entries.has(syncKey)).toBe(false);
        expect(localStorage.getItem('pda_paired_device_id')).toBe('primary-nuevo');
        expect(localStorage.getItem('pda_pairing_mode')).toBe('monitor');
        expect(localStorage.getItem(getSyncMetadataKey(syncKey))).toBeNull();
    });

    it('si la purga falla, NO se fija el vínculo nuevo (rollback de identidad)', async () => {
        const idbStore = createStore([['bodega_products_v1', [{ id: 'x' }]]], { failRemove: 'bodega_products_v1' });
        const localStorage = createLocalStorage();

        await expect(commitMonitorPairing({ idbStore, localStorage, primaryDeviceId: 'primary-nuevo' }))
            .rejects.toThrow();

        expect(localStorage.getItem('pda_paired_device_id')).toBeNull();
        expect(localStorage.getItem('pda_pairing_mode')).toBeNull();
    });

    it('rechaza fijar un vínculo sin dispositivo principal', async () => {
        const localStorage = createLocalStorage();
        await expect(commitMonitorPairing({ idbStore: createStore(), localStorage, primaryDeviceId: '' }))
            .rejects.toThrow(/dispositivo principal/i);
        expect(localStorage.getItem('pda_paired_device_id')).toBeNull();
    });
});

