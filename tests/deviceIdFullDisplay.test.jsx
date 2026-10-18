import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsTabSistema from '../src/components/Settings/tabs/SettingsTabSistema';
import SettingsTabLicencia from '../src/components/Settings/tabs/SettingsTabLicencia';

vi.mock('qrcode', () => ({ default: { toCanvas: vi.fn() } }));
vi.mock('../src/components/Toast', () => ({ showToast: vi.fn() }));
vi.mock('../src/components/SettingsShared', () => ({
    SectionCard: ({ children, title }) => <section><h2>{title}</h2>{children}</section>,
    Toggle: () => null,
}));
vi.mock('../src/components/Settings/AuditLogViewer', () => ({ default: () => null }));
vi.mock('../src/components/Settings/PairingManager', () => ({ default: () => null }));
vi.mock('../src/hooks/useSecurity', () => ({
    useSecurity: () => ({ fixDuplicateDeviceId: vi.fn() }),
}));

describe('Device ID full display verification (no truncate)', () => {
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

    it('renders complete deviceId with break-all and without truncate in SettingsTabSistema', async () => {
        const fullDeviceId = 'PDA-V2-F53FCD2C47D8928C47EA86B0A91D345E67890ABC';
        await act(async () => root.render(
            <SettingsTabSistema
                theme="light"
                toggleTheme={vi.fn()}
                deviceId={fullDeviceId}
                idCopied={false}
                setIdCopied={vi.fn()}
                isAdmin={false}
                importStatus={null}
                statusMessage=""
                handleExport={vi.fn()}
                handleImportClick={vi.fn()}
                handleSyncCloud={vi.fn()}
                dataConflictPending={null}
                handleDataConflictChoice={vi.fn()}
                lastError={null}
                onDismissError={vi.fn()}
                setIsShareOpen={vi.fn()}
                setShowDeleteConfirm={vi.fn()}
                triggerHaptic={vi.fn()}
            />
        ));

        const deviceIdElement = container.querySelector('.select-all');
        expect(deviceIdElement).not.toBeNull();
        expect(deviceIdElement.textContent).toBe(fullDeviceId);
        expect(deviceIdElement.className).toContain('break-all');
        expect(deviceIdElement.className).not.toContain('truncate');
    });

    it('renders complete deviceId with break-all and without truncate in SettingsTabLicencia', async () => {
        const fullDeviceId = 'PDA-V2-F53FCD2C47D8928C47EA86B0A91D345E67890ABC';
        await act(async () => root.render(
            <SettingsTabLicencia
                isPremium={true}
                license={{ type: 'permanent' }}
                deviceId={fullDeviceId}
                idCopied={false}
                setIdCopied={vi.fn()}
                licenseStatus={null}
                licenseMessage=""
                licenseError={null}
                lastVerified={null}
                licenseInput=""
                setLicenseInput={vi.fn()}
                handleActivate={vi.fn()}
                isActivating={false}
                triggerHaptic={vi.fn()}
            />
        ));

        const deviceIdElement = container.querySelector('.select-all');
        expect(deviceIdElement).not.toBeNull();
        expect(deviceIdElement.textContent).toBe(fullDeviceId);
        expect(deviceIdElement.className).toContain('break-all');
        expect(deviceIdElement.className).not.toContain('truncate');
    });
});
