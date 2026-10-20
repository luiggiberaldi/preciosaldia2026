// @vitest-environment jsdom

// Resiliencia del arranque (2026-10-20): la app se quedaba en "Verificando
// licencia..." con deviceId null cuando la nube no respondía — initDeviceId
// esperaba auto_register_device sin techo y checkLicense podía colgarse sin
// cerrar el loading. Estas pruebas fuerzan RPCs colgadas y RPCs que lanzan y
// exigen que el arranque SIEMPRE publique deviceId y cierre el loading.
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseMock = vi.hoisted(() => ({
    rpc: vi.fn(),
    from: vi.fn(),
}));

vi.mock('../src/core/supabaseClient', () => ({ supabase: supabaseMock }));

vi.mock('../src/utils/storageService', () => ({
    storageService: {
        getItem: async () => null,
        setItem: async () => undefined,
    },
}));

vi.mock('../src/security/installIdentity', () => ({
    ensureInstallIdentity: () => ({ deviceId: 'PDA-V2-' + 'AB'.repeat(16), isNew: false }),
    verifyInstallOwnership: async () => true,
    migrateDeviceIdentity: () => 'PDA-V2-' + 'AB'.repeat(16),
    DEVICE_ID_MIGRATED_EVENT: 'pda_device_id_migrated',
}));

vi.mock('../src/hooks/useLicenseMonitoring', () => ({
    useLicenseMonitoring: () => undefined,
}));

vi.mock('../src/hooks/useDemoCountdown', () => {
    const setDemoExpiredMsg = vi.fn();
    return {
        useDemoCountdown: () => ({
            demoTimeLeft: null,
            demoExpiredMsg: '',
            setDemoExpiredMsg,
            dismissExpiredMsg: vi.fn(),
        }),
    };
});

vi.mock('../src/services/deviceHeartbeat', () => ({
    sendDeviceHeartbeat: vi.fn(),
}));

import { SecurityProvider, useSecurity } from '../src/hooks/useSecurity';

const TEST_DEVICE_ID = 'PDA-V2-' + 'AB'.repeat(16);

// Promesa que jamás se resuelve: simula la nube colgada (sin respuesta).
const hang = () => new Promise(() => {});

function chainMock(maybeSingleImpl) {
    return {
        select: () => ({
            eq: () => ({
                eq: () => ({ maybeSingle: maybeSingleImpl }),
            }),
        }),
    };
}

function Probe({ capture }) {
    capture(useSecurity());
    return null;
}

describe('Arranque resiliente de useSecurity (nube colgada o rota)', () => {
    let container;
    let root;
    let state;

    beforeEach(() => {
        globalThis.IS_REACT_ACT_ENVIRONMENT = true;
        vi.useFakeTimers();
        localStorage.clear();
        supabaseMock.rpc.mockReset();
        supabaseMock.from.mockReset();
        state = null;
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
        vi.useRealTimers();
    });

    async function renderBoot() {
        await act(async () => {
            root.render(
                <SecurityProvider>
                    <Probe capture={(s) => { state = s; }} />
                </SecurityProvider>,
            );
        });
    }

    async function advanceNetworkTimeouts(steps = 4) {
        // Cada await de red tiene techo de 8 s; se avanza por tramos para que
        // las cadenas de promesas (registro → licencia → fallback → caché)
        // procesen sus microtareas entre timeouts.
        await act(async () => {
            for (let i = 0; i < steps; i += 1) {
                await vi.advanceTimersByTimeAsync(8100);
            }
        });
    }

    it('RPCs colgadas (nube sin respuesta): loading se resuelve y deviceId se publica', async () => {
        supabaseMock.rpc.mockImplementation(() => hang());
        supabaseMock.from.mockImplementation(() => chainMock(() => hang()));

        await renderBoot();
        await advanceNetworkTimeouts(4);

        expect(state).not.toBeNull();
        expect(state.loading).toBe(false);
        expect(state.deviceId).toBe(TEST_DEVICE_ID);
        expect(state.isPremium).toBe(false);
    });

    it('RPCs que lanzan (TypeError de red): loading se resuelve y deviceId se publica', async () => {
        supabaseMock.rpc.mockRejectedValue(new TypeError('Failed to fetch'));
        supabaseMock.from.mockImplementation(() => chainMock(() => Promise.reject(new TypeError('Failed to fetch'))));

        await renderBoot();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(10);
        });

        expect(state).not.toBeNull();
        expect(state.loading).toBe(false);
        expect(state.deviceId).toBe(TEST_DEVICE_ID);
    });

    it('nube colgada con caché offline válida: se aplica la caché y queda premium', async () => {
        localStorage.setItem('pda_license_cache', JSON.stringify({
            type: 'permanent',
            isActive: true,
            expiresAt: null,
            createdAt: '2026-10-01T00:00:00.000Z',
            deviceId: TEST_DEVICE_ID,
            updatedAt: Date.now(),
        }));
        supabaseMock.rpc.mockImplementation(() => hang());
        supabaseMock.from.mockImplementation(() => chainMock(() => hang()));

        await renderBoot();
        await advanceNetworkTimeouts(4);

        expect(state.loading).toBe(false);
        expect(state.deviceId).toBe(TEST_DEVICE_ID);
        expect(state.isPremium).toBe(true);
    });
});
