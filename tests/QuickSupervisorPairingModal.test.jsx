import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pairingMocks = vi.hoisted(() => ({
  createPairingToken: vi.fn(),
  revokePairingToken: vi.fn().mockResolvedValue(true),
  watchPairing: vi.fn(),
  cleanup: vi.fn(),
  verifyAdminPin: vi.fn().mockResolvedValue({ success: true, user: { id: 1, rol: 'ADMIN' } }),
  getPairingErrorMessage: vi.fn((error) => String(error?.message || error || 'Error')),
}));

vi.mock('../src/services/supervisorPairingService', () => ({
  createPairingToken: pairingMocks.createPairingToken,
  revokePairingToken: pairingMocks.revokePairingToken,
  watchPairing: pairingMocks.watchPairing,
  getPairingErrorMessage: pairingMocks.getPairingErrorMessage,
}), { virtual: true });

vi.mock('qrcode', () => ({
  default: { toCanvas: vi.fn() },
}));

vi.mock('../src/hooks/store/useAuthStore', () => ({
  useAuthStore: (selector) => selector({ verifyAdminPin: pairingMocks.verifyAdminPin }),
}));

import QuickSupervisorPairingModal from '../src/components/security/QuickSupervisorPairingModal';

describe('QuickSupervisorPairingModal', () => {
  let container;
  let root;
  let onClose;
  let triggerHaptic;
  let onOpenSettings;

  const futureExpiry = () => new Date(Date.now() + 120_000).toISOString();

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    onClose = vi.fn();
    triggerHaptic = vi.fn();
    onOpenSettings = vi.fn();
    pairingMocks.createPairingToken.mockReset();
    pairingMocks.revokePairingToken.mockReset();
    pairingMocks.revokePairingToken.mockResolvedValue(true);
    pairingMocks.watchPairing.mockReset();
    pairingMocks.verifyAdminPin.mockReset();
    pairingMocks.verifyAdminPin.mockResolvedValue({ success: true, user: { id: 1, rol: 'ADMIN' } });
    pairingMocks.watchPairing.mockReturnValue(pairingMocks.cleanup);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  async function render(overrides = {}) {
    await act(async () => root.render(
      <QuickSupervisorPairingModal
        isOpen
        deviceId="BOX-001"
        onClose={onClose}
        triggerHaptic={triggerHaptic}
        onOpenSettings={onOpenSettings}
        {...overrides}
      />,
    ));
  }

  function button(label) {
    return [...container.querySelectorAll('button')]
      .find((item) => item.textContent.includes(label));
  }

  function setInputValue(input, value) {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    ).set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  it('stays fully unmounted while closed', async () => {
    await render({ isOpen: false });

    expect(container.textContent).toBe('');
    expect(pairingMocks.createPairingToken).not.toHaveBeenCalled();
  });

  it('asks for an accessible administrator PIN before generating', async () => {
    await render();

    expect(container.querySelector('[role="dialog"]')).toBeTruthy();
    expect(container.querySelector('label[for="supervisor-admin-pin"]')).toBeTruthy();
    expect(container.textContent).toContain('PIN de administrador');

    const input = container.querySelector('#supervisor-admin-pin');
    await act(async () => {
      setInputValue(input, '123');
      button('Generar código temporal').click();
    });

    expect(pairingMocks.createPairingToken).not.toHaveBeenCalled();
    expect(container.textContent).toContain('6 dígitos');
  });

  it('shows QR, backup code and starts watching after confirmation', async () => {
    pairingMocks.createPairingToken.mockResolvedValue({ token: 'A1B2C3D4', expiresAt: futureExpiry() });
    await render();

    const input = container.querySelector('#supervisor-admin-pin');
    await act(async () => {
      setInputValue(input, '123456');
    });
    await act(async () => button('Generar código temporal').click());

    expect(pairingMocks.createPairingToken).toHaveBeenCalledWith({
      deviceId: 'BOX-001',
      onProgress: expect.any(Function),
    });
    expect(pairingMocks.verifyAdminPin).toHaveBeenCalledWith('123456');
    expect(container.textContent).toContain('A1B2C3D4');
    expect(container.textContent).toContain('Código de respaldo');

    expect(pairingMocks.watchPairing).toHaveBeenCalledWith(expect.objectContaining({
      deviceId: 'BOX-001',
      intervalMs: 3000,
      onPaired: expect.any(Function),
      onError: expect.any(Function),
    }));
    expect(container.textContent).toContain('Esperando conexión del supervisor');
  });

  it('copies the backup code and confirms the action visually', async () => {
    pairingMocks.createPairingToken.mockResolvedValue({ token: 'PAIR-9988', expiresAt: futureExpiry() });
    await render();
    const input = container.querySelector('#supervisor-admin-pin');
    await act(async () => {
      setInputValue(input, '123456');
      await button('Generar código temporal').click();
    });

    await act(async () => button('Copiar').click());
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('PAIR-9988');
    expect(container.textContent).toContain('Copiado');
  });

  it('moves to success, cleans the watcher and supports closing', async () => {
    pairingMocks.createPairingToken.mockResolvedValue({ token: 'PAIR-9988', expiresAt: futureExpiry() });
    await render();
    const input = container.querySelector('#supervisor-admin-pin');
    await act(async () => {
      setInputValue(input, '123456');
      await button('Generar código temporal').click();
    });
    const { onPaired } = pairingMocks.watchPairing.mock.calls[0][0];
    await act(async () => onPaired({ monitor_device_id: 'MONITOR-123456789' }));

    expect(container.textContent).toContain('Supervisor vinculado');
    expect(container.textContent).toContain('MONITOR-123456789');

    await act(async () => button('Listo').click());
    expect(pairingMocks.cleanup).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('expires the code and offers a recovery action', async () => {
    vi.useFakeTimers();
    pairingMocks.createPairingToken.mockResolvedValue({
      token: 'EXPIRING',
      expiresAt: new Date(Date.now() + 1_000).toISOString(),
    });
    await render();
    const input = container.querySelector('#supervisor-admin-pin');
    await act(async () => {
      setInputValue(input, '123456');
      await button('Generar código temporal').click();
    });

    await act(async () => vi.advanceTimersByTime(1_100));
    expect(container.textContent).toContain('El código venció');
    expect(container.textContent).toContain('Generar otro código');
  });
});
