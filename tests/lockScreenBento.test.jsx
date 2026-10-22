// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  usuarios: [
    { id: 1, nombre: 'Admin', rol: 'ADMIN', requirePin: true },
    { id: 2, nombre: 'Cajero', rol: 'CAJERO', requirePin: false },
  ],
  login: vi.fn(),
  loginDirect: vi.fn(),
  resetPinEmergency: vi.fn(),
  readPairingRow: vi.fn().mockResolvedValue({
    data: { id: 'primary-row', monitor_device_id: 'PDA-V2-SUPERVISOR-9999' },
    error: null,
  }),
  getActivePairingSlots: vi.fn().mockReturnValue([
    { id: 'PDA-V2-SUPERVISOR-9999', key: 'slot_1' },
  ]),
  rpc: vi.fn().mockResolvedValue({ error: null }),
  ensureSupervisorSession: vi.fn().mockResolvedValue({
    session: { access_token: 'fake' },
    error: null,
  }),
}));

vi.mock('../src/hooks/store/useAuthStore', () => ({
  useAuthStore: () => ({
    usuarios: mocks.usuarios,
    login: mocks.login,
    loginDirect: mocks.loginDirect,
    requireCajeroPin: false,
    requireAdminPin: true,
    resetPinEmergency: mocks.resetPinEmergency,
  }),
}));

vi.mock('../src/config/supabaseCloud', () => ({
  supabaseCloud: {
    rpc: mocks.rpc,
  },
}));

vi.mock('../src/services/supervisorAuth', () => ({
  ensureSupervisorSession: mocks.ensureSupervisorSession,
}));

vi.mock('../src/services/supervisorPairingState', () => ({
  readPairingRow: mocks.readPairingRow,
  getActivePairingSlots: mocks.getActivePairingSlots,
}));

import LockScreen from '../src/components/security/LockScreen';

describe('LockScreen Bento Card Redesign', () => {
  let container;
  let root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.setItem('pda_device_id', 'PDA-V2-PRIMARY-LOCAL-1234');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    localStorage.clear();
    vi.clearAllMocks();
  });

  // El panel de detalles de supervisión arranca plegado (optimización móvil del
  // commit del panel plegable): la telemetría y las acciones viven dentro, así
  // que las pruebas lo expanden antes de verificarlas.
  function expandSupervisionPanel() {
    const toggle = container.querySelector('[aria-label="Panel de supervisión y enlace"]');
    expect(toggle).toBeTruthy();
    act(() => {
      toggle.click();
    });
  }

  it('renders bento card with supervisor status and device telemetries', async () => {
    const onOpenPairing = vi.fn();
    const onOpenPairingIssuer = vi.fn();

    await act(async () => {
      root.render(
        <LockScreen
          onOpenPairing={onOpenPairing}
          onOpenPairingIssuer={onOpenPairingIssuer}
        />
      );
    });

    // Verify Bento card header
    expect(container.textContent).toContain('Supervisión & Enlace');
    expect(container.textContent).toContain('1 Vinculado');

    // El detalle arranca plegado; al expandirlo aparece la telemetría.
    expect(container.textContent).not.toContain('Esta Caja');
    expandSupervisionPanel();

    // Verify Local POS ID
    expect(container.textContent).toContain('Esta Caja');
    expect(container.textContent).toContain('PDA-V2-PR…1234');

    // Verify Linked Supervisor ID
    expect(container.textContent).toContain('Supervisor');
    expect(container.textContent).toContain('PDA-V2-SU…9999');

    // Verify Action Buttons
    const supervisorModeBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent.includes('Entrar en Modo Supervisor')
    );
    expect(supervisorModeBtn).toBeTruthy();
    act(() => {
      supervisorModeBtn.click();
    });
    expect(onOpenPairing).toHaveBeenCalledTimes(1);

    const pairIssuerBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent.includes('Vincular Nuevo Supervisor')
    );
    expect(pairIssuerBtn).toBeTruthy();
    act(() => {
      pairIssuerBtn.click();
    });
    expect(onOpenPairingIssuer).toHaveBeenCalledTimes(1);
  });

  it('renders unlinked status when no supervisor is paired', async () => {
    mocks.getActivePairingSlots.mockReturnValueOnce([]);

    await act(async () => {
      root.render(
        <LockScreen
          onOpenPairing={vi.fn()}
          onOpenPairingIssuer={vi.fn()}
        />
      );
    });

    expect(container.textContent).toContain('Sin Enlace');
    expandSupervisionPanel();
    expect(container.textContent).toContain('Ninguno enlazado');
  });

  it('opens confirmation modal when clicking unpair button and triggers RPC', async () => {
    await act(async () => {
      root.render(
        <LockScreen
          onOpenPairing={vi.fn()}
          onOpenPairingIssuer={vi.fn()}
        />
      );
    });

    expandSupervisionPanel();
    const unpairTriggerBtn = container.querySelector('button[title="Desvincular supervisor"]');
    expect(unpairTriggerBtn).toBeTruthy();

    await act(async () => {
      unpairTriggerBtn.click();
    });

    expect(container.textContent).toContain('¿Desvincular supervisor?');
    const confirmBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Desvincular'
    );
    expect(confirmBtn).toBeTruthy();

    await act(async () => {
      confirmBtn.click();
    });

    expect(mocks.rpc).toHaveBeenCalledWith('unpair_monitor', {
      p_device_id: 'PDA-V2-PRIMARY-LOCAL-1234',
    });
  });
});
