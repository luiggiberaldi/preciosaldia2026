/**
 * tests/installIdentity.test.js — Identidad única por instalación.
 *
 * Cubre el fix de dos equipos compartiendo el mismo `PDA-V2-…`:
 *  - generateRandomDeviceId produce IDs únicos (128 bits, formato válido).
 *  - ensureInstallIdentity preserva el ID existente (licencias intactas) y solo
 *    genera uno nuevo cuando la instalación no tiene ninguno.
 *  - verifyInstallOwnership acepta el ID propio y rechaza IDs ajenos/inyectados.
 *  - migrateDeviceIdentity separa una estación que comparte ID, conservando el
 *    ID anterior para poder re-registrar la licencia desde el ID nuevo.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const store = new Map();

beforeEach(() => {
    store.clear();
    globalThis.localStorage = {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
        clear: () => store.clear(),
    };
    vi.stubGlobal('localStorage', globalThis.localStorage);
});

const {
    generateRandomDeviceId,
    ensureInstallIdentity,
    verifyInstallOwnership,
    migrateDeviceIdentity,
} = await import('../src/security/installIdentity');

const ID_RE = /^PDA-V2-[0-9A-F]{32}$/;

describe('generateRandomDeviceId', () => {
    it('genera IDs con formato PDA-V2-<32hex>', () => {
        expect(generateRandomDeviceId()).toMatch(ID_RE);
    });

    it('genera IDs distintos entre llamadas (128 bits de entropía)', () => {
        const ids = new Set(Array.from({ length: 200 }, () => generateRandomDeviceId()));
        expect(ids.size).toBe(200);
    });
});

describe('ensureInstallIdentity', () => {
    it('crea un ID aleatorio en una instalación nueva y lo persiste', () => {
        const { deviceId, isNew } = ensureInstallIdentity();

        expect(isNew).toBe(true);
        expect(deviceId).toMatch(ID_RE);
        expect(localStorage.getItem('pda_device_id')).toBe(deviceId);
    });

    it('dos instalaciones nuevas nunca comparten ID', () => {
        const a = ensureInstallIdentity().deviceId;
        localStorage.removeItem('pda_device_id');
        localStorage.removeItem('pda_fp_anchor_v1');
        localStorage.removeItem('pda_install_secret_v1');
        const b = ensureInstallIdentity().deviceId;

        expect(a).not.toBe(b);
    });

    it('preserva el ID existente (la licencia sigue ligada al mismo ID)', () => {
        const legacyId = 'PDA-V2-333D310EA8EFAB0B2261EF0BCB675980';
        localStorage.setItem('pda_device_id', legacyId);

        const { deviceId, isNew } = ensureInstallIdentity();

        expect(isNew).toBe(false);
        expect(deviceId).toBe(legacyId);
    });

    it('crea el secreto de instalación aunque el ID ya exista', () => {
        localStorage.setItem('pda_device_id', 'PDA-V2-333D310EA8EFAB0B2261EF0BCB675980');

        ensureInstallIdentity();

        expect(localStorage.getItem('pda_install_secret_v1')).toBeTruthy();
    });
});

describe('verifyInstallOwnership', () => {
    it('acepta el ID generado por esta instalación', async () => {
        const { deviceId } = ensureInstallIdentity();

        await expect(verifyInstallOwnership(deviceId)).resolves.toBe(true);
    });

    it('rechaza IDs mal formados o inyectados', async () => {
        ensureInstallIdentity();

        await expect(verifyInstallOwnership('PDA-DEAD')).resolves.toBe(false);
        await expect(verifyInstallOwnership('')).resolves.toBe(false);
        await expect(verifyInstallOwnership(null)).resolves.toBe(false);
        await expect(verifyInstallOwnership('not-a-pda-id')).resolves.toBe(false);
    });

    it('rechaza un ID ajeno forzado en localStorage (robo de identidad)', async () => {
        ensureInstallIdentity();
        const foreign = 'PDA-V2-' + 'C'.repeat(32);
        localStorage.setItem('pda_device_id', foreign);

        await expect(verifyInstallOwnership(foreign)).resolves.toBe(false);
    });
});

describe('migrateDeviceIdentity', () => {
    it('genera un ID nuevo y conserva el anterior para re-registrar la licencia', () => {
        const sharedId = 'PDA-V2-333D310EA8EFAB0B2261EF0BCB675980';
        localStorage.setItem('pda_device_id', sharedId);

        const { deviceId, previousDeviceId } = migrateDeviceIdentity();

        expect(previousDeviceId).toBe(sharedId);
        expect(deviceId).toMatch(ID_RE);
        expect(deviceId).not.toBe(sharedId);
        expect(localStorage.getItem('pda_device_id')).toBe(deviceId);
        expect(localStorage.getItem('pda_previous_device_id_v1')).toBe(sharedId);
    });

    it('invalida la caché de licencia del ID anterior', () => {
        localStorage.setItem('pda_device_id', 'PDA-V2-333D310EA8EFAB0B2261EF0BCB675980');
        localStorage.setItem('pda_license_cache', JSON.stringify({ deviceId: 'PDA-V2-333D310EA8EFAB0B2261EF0BCB675980', isActive: true }));

        migrateDeviceIdentity();

        expect(localStorage.getItem('pda_license_cache')).toBeNull();
    });

    it('dos estaciones que compartían ID quedan con IDs distintos tras migrar', () => {
        const sharedId = 'PDA-V2-333D310EA8EFAB0B2261EF0BCB675980';

        // Estación 1
        localStorage.setItem('pda_device_id', sharedId);
        const est1 = migrateDeviceIdentity().deviceId;

        // Estación 2 (otro perfil: se simula limpiando el storage)
        store.clear();
        localStorage.setItem('pda_device_id', sharedId);
        const est2 = migrateDeviceIdentity().deviceId;

        expect(est1).not.toBe(sharedId);
        expect(est2).not.toBe(sharedId);
        expect(est1).not.toBe(est2);
    });

    it('el ID migrado pasa la verificación de propiedad', async () => {
        localStorage.setItem('pda_device_id', 'PDA-V2-333D310EA8EFAB0B2261EF0BCB675980');

        const { deviceId } = migrateDeviceIdentity();

        await expect(verifyInstallOwnership(deviceId)).resolves.toBe(true);
    });
});
