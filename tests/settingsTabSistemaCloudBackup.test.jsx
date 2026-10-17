import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsTabSistema from '../src/components/Settings/tabs/SettingsTabSistema';

vi.mock('qrcode', () => ({ default: { toCanvas: vi.fn() } }));
vi.mock('../src/components/Toast', () => ({ showToast: vi.fn() }));
vi.mock('../src/components/SettingsShared', () => ({
    SectionCard: ({ children, title }) => <section><h2>{title}</h2>{children}</section>,
    Toggle: () => null,
}));
vi.mock('../src/components/Settings/AuditLogViewer', () => ({ default: () => null }));
vi.mock('../src/components/Settings/PairingManager', () => ({ default: () => null }));
// SettingsTabSistema usa useSecurity para corregir IDs duplicados entre estaciones.
vi.mock('../src/hooks/useSecurity', () => ({
    useSecurity: () => ({ fixDuplicateDeviceId: vi.fn() }),
}));

import { showToast } from '../src/components/Toast';

const baseProps = {
    theme: 'light', toggleTheme: vi.fn(), deviceId: 'DEVICE-1', idCopied: false,
    setIdCopied: vi.fn(), isAdmin: false, importStatus: null, statusMessage: '',
    handleExport: vi.fn(), handleImportClick: vi.fn(), handleSyncCloud: vi.fn(),
    dataConflictPending: null, handleDataConflictChoice: vi.fn(), lastError: null,
    onDismissError: vi.fn(), setIsShareOpen: vi.fn(), setShowDeleteConfirm: vi.fn(),
    triggerHaptic: vi.fn(),
};

describe('SettingsTabSistema cloud backup action', () => {
    let container;
    let root;

    beforeEach(() => {
        globalThis.IS_REACT_ACT_ENVIRONMENT = true;
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        vi.clearAllMocks();
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
    });

    async function render(isLicensedCloud) {
        await act(async () => root.render(
            <SettingsTabSistema {...baseProps} isLicensedCloud={isLicensedCloud} />
        ));
    }

    it('invokes cloud sync when licensed', async () => {
        await render(true);
        const button = [...container.querySelectorAll('button')]
            .find(item => item.textContent.includes('Sincronizar con la Nube'));

        await act(async () => button.click());

        expect(baseProps.handleSyncCloud).toHaveBeenCalledTimes(1);
        expect(showToast).not.toHaveBeenCalled();
    });

    it('does not invoke cloud sync when unlicensed and explains why', async () => {
        await render(false);
        const button = [...container.querySelectorAll('button')]
            .find(item => item.textContent.includes('Sincronizar con la Nube'));

        await act(async () => button.click());

        expect(baseProps.handleSyncCloud).not.toHaveBeenCalled();
        expect(showToast).toHaveBeenCalledWith(
            'La sincronización con la nube requiere licencia completa',
            'error'
        );
    });
});
