import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Clipboard,
  Clock3,
  Copy,
  Delete,
  ExternalLink,
  KeyRound,
  Loader2,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  X,
} from 'lucide-react';
import {
  createPairingToken,
  revokePairingToken,
  watchPairing,
  getPairingErrorMessage,
} from '../../services/supervisorPairingService';
import { useAuthStore } from '../../hooks/store/useAuthStore';

const INITIAL_STATE = 'pin';
const PIN_LENGTH = 6;
const PIN_PATTERN = new RegExp(`^\\d{${PIN_LENGTH}}$`);

function formatTimeLeft(expiresAt, now = Date.now()) {
  if (!expiresAt) return '—';
  const remaining = Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 1000));
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function getPairedDeviceId(payload) {
  if (typeof payload === 'string') return payload;
  return payload?.monitor_device_id
    || payload?.monitor_device_id_2
    || payload?.monitorDeviceId
    || payload?.deviceId
    || payload?.id
    || '';
}

function getFocusableElements(element) {
  if (!element) return [];
  return [...element.querySelectorAll(
    'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
  )];
}

export default function QuickSupervisorPairingModal({
  isOpen,
  deviceId,
  onClose,
  triggerHaptic,
  onOpenSettings,
}) {
  const verifyAdminPin = useAuthStore((state) => state.verifyAdminPin);
  const [status, setStatus] = useState(INITIAL_STATE);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [token, setToken] = useState('');
  const [expiresAt, setExpiresAt] = useState(null);
  const [timeLeft, setTimeLeft] = useState('—');
  const [progressMessage, setProgressMessage] = useState('Preparando el acceso temporal…');
  const [errorMessage, setErrorMessage] = useState('');
  const [copyState, setCopyState] = useState('idle');
  const [pairedDeviceId, setPairedDeviceId] = useState('');

  const dialogRef = useRef(null);
  const titleRef = useRef(null);
  const pinInputRef = useRef(null);
  const canvasRef = useRef(null);
  const cleanupWatchRef = useRef(null);
  const expiresAtRef = useRef(null);
  const wasOpenRef = useRef(false);
  const generationRef = useRef(0);
  const previousFocusRef = useRef(null);
  const copyTimeoutRef = useRef(null);
  const pinRef = useRef('');

  const clearWatcher = useCallback(() => {
    cleanupWatchRef.current?.();
    cleanupWatchRef.current = null;
  }, []);

  const clearSecretState = useCallback(() => {
    clearWatcher();
    pinRef.current = '';
    setPin('');
    setToken('');
    setExpiresAt(null);
    expiresAtRef.current = null;
    setTimeLeft('—');
    setCopyState('idle');
    setProgressMessage('Preparando el acceso temporal…');
  }, [clearWatcher]);

  const closeModal = useCallback(() => {
    triggerHaptic?.();
    generationRef.current += 1;
    const hadPendingToken = Boolean(token && ['ready', 'waiting'].includes(status));
    clearSecretState();
    setStatus(INITIAL_STATE);
    setPinError('');
    setErrorMessage('');
    setPairedDeviceId('');
    if (hadPendingToken && deviceId) {
      void revokePairingToken({ deviceId }).catch(() => {});
    }
    onClose?.();
    window.setTimeout(() => previousFocusRef.current?.focus?.(), 0);
  }, [clearSecretState, deviceId, onClose, status, token, triggerHaptic]);

  useEffect(() => {
    if (!isOpen || wasOpenRef.current) return undefined;

    wasOpenRef.current = true;
    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    setStatus(INITIAL_STATE);
    setPin('');
    setPinError('');
    setErrorMessage('');
    setPairedDeviceId('');
    const focusTimer = window.setTimeout(() => pinInputRef.current?.focus(), 0);

    return () => window.clearTimeout(focusTimer);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) return undefined;
    wasOpenRef.current = false;
    clearSecretState();
    return undefined;
  }, [clearSecretState, isOpen]);

  useEffect(() => () => {
    clearWatcher();
    if (copyTimeoutRef.current) window.clearTimeout(copyTimeoutRef.current);
  }, [clearWatcher]);

  useEffect(() => {
    if (!isOpen || !['ready', 'waiting'].includes(status) || !token || !expiresAt) {
      return undefined;
    }

    const tick = () => {
      const nextTime = formatTimeLeft(expiresAt);
      setTimeLeft(nextTime);
      if (nextTime === '0:00') {
        clearWatcher();
        setToken('');
        setStatus('expired');
      }
    };

    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [clearWatcher, expiresAt, isOpen, status, token]);

  useEffect(() => {
    if (!isOpen || status === 'pin' || status === 'generating') return undefined;
    const focusTimer = window.setTimeout(() => titleRef.current?.focus(), 0);
    return () => window.clearTimeout(focusTimer);
  }, [isOpen, status]);

  useEffect(() => {
    if (!isOpen || status !== 'ready' || !token || !canvasRef.current) return undefined;

    QRCode.toCanvas(
      canvasRef.current,
      token,
      {
        width: 160,
        margin: 1,
        errorCorrectionLevel: 'M',
        color: { dark: '#01696f', light: '#ffffff' },
      },
      (error) => {
        if (error) {
          setErrorMessage('No se pudo preparar el QR. Genera otro código para continuar.');
          setStatus('error');
        }
      },
    );

    // El canvas se desmonta al salir de ready/waiting; el token deja de estar
    // renderizado y no se conserva como imagen reutilizable.
    return undefined;
  }, [isOpen, status, token]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeModal();
        return;
      }

      if (event.key !== 'Tab') return;
      const focusable = getFocusableElements(dialogRef.current);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [closeModal, isOpen, status]);

  const handleGenerate = async (event, pinOverride) => {
    event?.preventDefault?.();
    const pinToVerify = pinOverride ?? pin;
    if (!PIN_PATTERN.test(pinToVerify)) {
      setPinError(`Ingresa los ${PIN_LENGTH} dígitos del PIN de administrador.`);
      setPin('');
      pinInputRef.current?.focus();
      return;
    }
    if (!deviceId) {
      setErrorMessage('No encontramos el identificador de esta caja.');
      setStatus('error');
      return;
    }

    triggerHaptic?.();
    setPinError('');
    setErrorMessage('');
    setProgressMessage('Validando la caja y preparando el código…');
    setStatus('generating');
    const requestId = ++generationRef.current;
    let timeoutId = null;

    try {
      const authorization = await verifyAdminPin(pinToVerify);
      if (!authorization?.success) {
        setPin('');
        setPinError(authorization?.error || 'PIN de administrador incorrecto.');
        setStatus('pin');
        pinInputRef.current?.focus();
        return;
      }

      // El PIN ya fue verificado; no debe permanecer en el estado del modal.
      setPin('');
      const result = await Promise.race([
        createPairingToken({ deviceId, onProgress: setProgressMessage }),
        new Promise((_, reject) => {
          timeoutId = window.setTimeout(() => reject(new Error('La operación tardó demasiado. Revisa la conexión e inténtalo de nuevo.')), 30000);
        }),
      ]);
      if (requestId !== generationRef.current) return;
      const nextToken = String(result?.token || '').trim();
      const nextExpiresAt = result?.expiresAt;

      if (!nextToken || !nextExpiresAt) {
        throw new Error('Respuesta inválida al generar el código');
      }

      expiresAtRef.current = nextExpiresAt;
      setToken(nextToken);
      setExpiresAt(nextExpiresAt);
      setTimeLeft(formatTimeLeft(nextExpiresAt));
      setStatus('ready');
    } catch (error) {
      if (requestId !== generationRef.current) return;
      setPin('');
      setErrorMessage(getPairingErrorMessage(error));
      setStatus('error');
    } finally {
      if (timeoutId) window.clearTimeout(timeoutId);
    }
  };

  const handlePadPress = (digit) => {
    if (status !== 'pin') return;
    const currentPin = pinRef.current;
    if (currentPin.length >= PIN_LENGTH) return;
    triggerHaptic?.();
    const nextPin = currentPin + digit;
    pinRef.current = nextPin;
    setPin(nextPin);
    setPinError('');
    if (nextPin.length === PIN_LENGTH) {
      void handleGenerate(null, nextPin);
    }
  };

  const handleDelete = () => {
    if (status !== 'pin') return;
    triggerHaptic?.();
    const nextPin = pinRef.current.slice(0, -1);
    pinRef.current = nextPin;
    setPin(nextPin);
    setPinError('');
  };

  const handleClear = () => {
    if (status !== 'pin') return;
    triggerHaptic?.();
    pinRef.current = '';
    setPin('');
    setPinError('');
  };

  const handleStartWaiting = useCallback(() => {
    if (!token || !deviceId) return;
    triggerHaptic?.();
    clearWatcher();
    setStatus('waiting');
    cleanupWatchRef.current = watchPairing({
      deviceId,
      onPaired: (payload) => {
        clearWatcher();
        setPairedDeviceId(getPairedDeviceId(payload));
        setToken('');
        setStatus('success');
        triggerHaptic?.();
      },
      onError: (error) => {
        clearWatcher();
        setErrorMessage(getPairingErrorMessage(error));
        setStatus('error');
      },
      intervalMs: 3000,
    });
  }, [clearWatcher, deviceId, token, triggerHaptic]);

  useEffect(() => {
    if (!isOpen || status !== 'ready' || !token || !deviceId || cleanupWatchRef.current) return undefined;
    handleStartWaiting();
    return undefined;
  }, [deviceId, expiresAt, handleStartWaiting, isOpen, status, token]);

  const handleRetry = () => {
    clearSecretState();
    setPinError('');
    setErrorMessage('');
    setStatus(INITIAL_STATE);
    window.setTimeout(() => pinInputRef.current?.focus(), 0);
  };

  const handleCopy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(token);
      } else {
        const helper = document.createElement('textarea');
        helper.value = token;
        helper.setAttribute('readonly', '');
        helper.style.position = 'fixed';
        helper.style.opacity = '0';
        document.body.appendChild(helper);
        helper.select();
        document.execCommand('copy');
        helper.remove();
      }
      triggerHaptic?.();
      setCopyState('copied');
      if (copyTimeoutRef.current) window.clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = window.setTimeout(() => setCopyState('idle'), 2200);
    } catch {
      setCopyState('error');
    }
  };

  if (!isOpen) return null;

  const isCodeVisible = ['ready', 'waiting'].includes(status) && token;

  return (
    <div
      className="fixed inset-0 z-[360] flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-md sm:items-center sm:p-4 animate-in fade-in duration-200"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeModal();
      }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-pairing-title"
        aria-describedby="quick-pairing-description"
        className="flex max-h-[96vh] w-full max-w-[420px] flex-col overflow-y-auto rounded-t-[2.5rem] border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-2xl sm:max-h-[92vh] sm:rounded-3xl transition-all"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800/80 px-5 py-4 sm:px-6">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-800/50 shadow-xs">
              <ShieldCheck size={20} strokeWidth={2.4} aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-emerald-600 dark:text-emerald-400">
                Acceso temporal
              </p>
              <h2
                ref={titleRef}
                tabIndex={-1}
                id="quick-pairing-title"
                className="text-base sm:text-lg font-black tracking-tight text-slate-900 dark:text-white outline-none truncate"
                aria-live="polite"
              >
                Vincular supervisor
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={closeModal}
            className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            aria-label="Cerrar vinculación de supervisor"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <p id="quick-pairing-description" className="sr-only">
          Conecta otro dispositivo a esta caja sin salir de la pantalla inicial.
        </p>

        <div className="flex-1 px-5 py-4 sm:px-6">
          {status === 'pin' && (
            <form onSubmit={handleGenerate} noValidate className="space-y-4">
              {/* Header de Autorización sutil */}
              <div className="text-center pt-0.5">
                <label
                  htmlFor="supervisor-admin-pin"
                  className="block text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300"
                >
                  PIN de administrador · 6 dígitos
                </label>
                <p id="supervisor-pin-help" className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
                  Ingresa tu clave para autorizar el enlace
                </p>
              </div>

              {/* Contenedor de Celdas PIN de Alta Fidelidad */}
              <div className="relative cursor-pointer" onClick={() => pinInputRef.current?.focus()}>
                <div
                  className={`grid grid-cols-6 gap-2 sm:gap-2.5 p-1 transition-all ${
                    pinError ? 'animate-shake' : ''
                  }`}
                  aria-hidden="true"
                >
                  {Array.from({ length: PIN_LENGTH }, (_, index) => {
                    const digit = pin[index];
                    const isNextActive = index === pin.length && !pinError;
                    const isFilled = Boolean(digit);

                    return (
                      <div
                        key={index}
                        className={`flex h-12 sm:h-13 items-center justify-center rounded-2xl border-2 transition-all duration-150 select-none ${
                          pinError
                            ? 'border-rose-400 bg-rose-50/50 dark:bg-rose-950/30 text-rose-600'
                            : isFilled
                              ? 'border-emerald-500 dark:border-emerald-400 bg-emerald-50/80 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 shadow-sm scale-100'
                              : isNextActive
                                ? 'border-emerald-500 dark:border-emerald-400 bg-white dark:bg-slate-900 shadow-sm ring-4 ring-emerald-500/15 scale-105'
                                : 'border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 text-slate-300 dark:text-slate-700'
                        }`}
                      >
                        {isFilled ? (
                          <span className="w-3.5 h-3.5 rounded-full bg-emerald-600 dark:bg-emerald-400 transform transition-transform scale-100" />
                        ) : isNextActive ? (
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        ) : null}
                      </div>
                    );
                  })}
                </div>

                {/* Hidden Input for Keyboard, Barcode & Paste Accessibility */}
                <input
                  ref={pinInputRef}
                  id="supervisor-admin-pin"
                  name="supervisor-admin-pin"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={PIN_LENGTH}
                  value={pin}
                  onChange={(event) => {
                    const clean = event.target.value.replace(/\D/g, '').slice(0, PIN_LENGTH);
                    pinRef.current = clean;
                    setPin(clean);
                    setPinError('');
                  }}
                  aria-label="PIN de administrador de 6 dígitos"
                  aria-invalid={Boolean(pinError)}
                  aria-describedby={pinError ? 'supervisor-pin-error' : 'supervisor-pin-help'}
                  className="absolute inset-0 h-full w-full cursor-text opacity-0"
                />
              </div>

              {/* Mensaje de Error o Contador */}
              <div className="flex items-center justify-between px-1 text-xs min-h-[20px]">
                {pinError ? (
                  <p id="supervisor-pin-error" role="alert" className="font-bold text-rose-600 dark:text-rose-400">
                    {pinError}
                  </p>
                ) : (
                  <span className="text-slate-400 dark:text-slate-500 text-[11px]">
                    Usa el teclado táctil o físico
                  </span>
                )}
                <span className="font-mono font-bold tabular-nums text-slate-400 dark:text-slate-500 text-[11px] ml-auto" aria-hidden="true">
                  {pin.length}/{PIN_LENGTH}
                </span>
              </div>

              {/* Teclado Numérico Táctil Integrado (Numpad) */}
              <div className="grid grid-cols-3 gap-2 sm:gap-2.5 pt-1">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => (
                  <button
                    key={digit}
                    type="button"
                    onClick={() => handlePadPress(String(digit))}
                    className="min-h-[50px] sm:min-h-[54px] rounded-2xl bg-slate-100/90 dark:bg-slate-800/80 hover:bg-slate-200/90 dark:hover:bg-slate-700/80 active:scale-95 text-lg font-black text-slate-800 dark:text-slate-100 transition-all flex items-center justify-center cursor-pointer shadow-xs select-none focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                  >
                    {digit}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={handleClear}
                  className="min-h-[50px] sm:min-h-[54px] rounded-2xl bg-slate-100/50 dark:bg-slate-800/40 hover:bg-slate-200/60 dark:hover:bg-slate-700/60 active:scale-95 text-xs font-black uppercase tracking-wider text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 transition-all flex items-center justify-center cursor-pointer select-none focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                  title="Borrar todo"
                >
                  C
                </button>
                <button
                  type="button"
                  onClick={() => handlePadPress('0')}
                  className="min-h-[50px] sm:min-h-[54px] rounded-2xl bg-slate-100/90 dark:bg-slate-800/80 hover:bg-slate-200/90 dark:hover:bg-slate-700/80 active:scale-95 text-lg font-black text-slate-800 dark:text-slate-100 transition-all flex items-center justify-center cursor-pointer shadow-xs select-none focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                >
                  0
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  className="min-h-[50px] sm:min-h-[54px] rounded-2xl bg-slate-100/50 dark:bg-slate-800/40 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40 dark:hover:text-rose-400 active:scale-95 text-slate-600 dark:text-slate-300 transition-all flex items-center justify-center cursor-pointer select-none focus:outline-none focus:ring-2 focus:ring-rose-500/20"
                  title="Borrar dígito"
                  aria-label="Borrar dígito"
                >
                  <Delete size={19} strokeWidth={2.2} />
                </button>
              </div>

              {/* Botón de Envío / Generación */}
              <button
                type="submit"
                className={`flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-2xl px-4 text-xs font-black uppercase tracking-wider transition-all select-none shadow-sm ${
                  pin.length === PIN_LENGTH
                    ? 'bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white shadow-emerald-600/25 ring-2 ring-emerald-500/20'
                    : 'bg-slate-100 hover:bg-slate-200/80 dark:bg-slate-800 dark:hover:bg-slate-700/80 text-slate-500 dark:text-slate-400 border border-slate-200/60 dark:border-slate-700/60'
                }`}
              >
                <ShieldCheck size={16} strokeWidth={2.4} aria-hidden="true" />
                <span>Generar código temporal</span>
              </button>
            </form>
          )}

          {status === 'generating' && (
            <div className="flex min-h-[260px] flex-col items-center justify-center text-center p-6">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-800/60 shadow-sm">
                <Loader2 className="animate-spin" size={28} aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-base font-black text-slate-900 dark:text-white">Preparando vinculación</h3>
              <p className="mt-1.5 max-w-[34ch] text-xs leading-normal text-slate-500 dark:text-slate-400" role="status">
                {progressMessage}
              </p>
            </div>
          )}

          {isCodeVisible && (
            <div className="space-y-3.5">
              <div className="flex flex-col items-center rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50 p-4 shadow-sm">
                <div className="mb-3 flex w-full items-center justify-between text-xs font-bold text-slate-500 dark:text-slate-400">
                  <span className="flex items-center gap-1.5 font-black uppercase tracking-wider text-[11px] text-emerald-600 dark:text-emerald-400">
                    <QrCode size={15} aria-hidden="true" />
                    Código listo
                  </span>
                  <span className="rounded-full bg-amber-50 dark:bg-amber-950/50 px-2.5 py-0.5 text-[11px] font-black text-amber-700 dark:text-amber-400 border border-amber-200/80 dark:border-amber-800/60">
                    {timeLeft}
                  </span>
                </div>
                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white p-3 shadow-inner">
                  <canvas ref={canvasRef} width="160" height="160" aria-label="Código QR para vincular el supervisor" />
                </div>
                <p className="mt-2 text-center text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  Escanéalo desde el celular del supervisor.
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/60 p-3 sm:p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[9px] font-black uppercase tracking-[0.12em] text-slate-400">Código de respaldo</p>
                    <p className="mt-0.5 break-all font-mono text-sm font-black tracking-wider text-slate-800 dark:text-slate-200 sm:text-base">
                      {token}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="flex min-h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-xl border border-slate-200/80 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-black text-slate-700 dark:text-slate-200 transition-colors hover:border-emerald-300 hover:text-emerald-700 focus:outline-none focus:ring-4 focus:ring-emerald-500/20"
                    aria-label="Copiar código de vinculación"
                  >
                    {copyState === 'copied' ? <Check size={14} className="text-emerald-600 dark:text-emerald-400" aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                    <span>{copyState === 'copied' ? 'Copiado' : 'Copiar'}</span>
                  </button>
                </div>
                {copyState === 'error' && (
                  <p role="alert" className="mt-1.5 text-xs font-bold text-rose-600 dark:text-rose-400">
                    No se pudo copiar. Selecciona el código manualmente.
                  </p>
                )}
              </div>

              <div className="grid gap-1.5 text-xs text-slate-600 dark:text-slate-400 sm:grid-cols-3">
                {[
                  ['1', 'Abre la app en el celular'],
                  ['2', 'Pulsa modo supervisor'],
                  ['3', 'Escanea o escribe código'],
                ].map(([number, text]) => (
                  <div key={number} className="flex items-center gap-1.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 p-2 text-[10px] leading-tight font-medium border border-slate-100 dark:border-slate-800">
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-950/80 text-[9px] font-black text-emerald-800 dark:text-emerald-300">
                      {number}
                    </span>
                    <span className="leading-tight">{text}</span>
                  </div>
                ))}
              </div>

              {status === 'ready' ? (
                <button
                  type="button"
                  onClick={handleStartWaiting}
                  className="flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-2xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] px-4 text-xs font-black uppercase tracking-wider text-white shadow-lg shadow-emerald-600/25 transition-all focus:outline-none focus:ring-4 focus:ring-emerald-500/25"
                >
                  <Smartphone size={16} aria-hidden="true" />
                  <span>Esperar conexión del supervisor</span>
                </button>
              ) : (
                <div className="flex items-center justify-center gap-2 rounded-2xl border border-emerald-200/80 dark:border-emerald-800/80 bg-emerald-50 dark:bg-emerald-950/40 px-3 py-2.5 text-xs font-extrabold text-emerald-800 dark:text-emerald-300" role="status">
                  <Loader2 size={15} className="animate-spin text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                  <span>Esperando conexión del supervisor…</span>
                </div>
              )}
            </div>
          )}

          {status === 'success' && (
            <div className="flex min-h-[260px] flex-col items-center justify-center text-center p-6" role="status" aria-live="polite">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-800/60 shadow-sm">
                <CheckCircle2 size={30} aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-lg font-black text-slate-900 dark:text-white">Supervisor vinculado</h3>
              <p className="mt-1.5 max-w-[34ch] text-xs leading-normal text-slate-500 dark:text-slate-400">
                El dispositivo ya puede consultar el inventario y las métricas de esta caja.
              </p>
              {pairedDeviceId && (
                <p className="mt-3 rounded-xl bg-slate-100 dark:bg-slate-800 px-3 py-1.5 font-mono text-xs font-bold text-slate-600 dark:text-slate-300 border border-slate-200/60 dark:border-slate-700">
                  {pairedDeviceId.slice(0, 18)}{pairedDeviceId.length > 18 ? '…' : ''}
                </p>
              )}
              <button
                type="button"
                onClick={closeModal}
                className="mt-5 flex min-h-11 w-full cursor-pointer items-center justify-center rounded-2xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] px-4 text-xs font-black uppercase tracking-wider text-white shadow-lg shadow-emerald-600/25 transition-all focus:outline-none focus:ring-4 focus:ring-emerald-500/25"
              >
                Listo
              </button>
            </div>
          )}

          {status === 'expired' && (
            <StateMessage
              icon={<Clock3 size={24} aria-hidden="true" />}
              tone="amber"
              title="El código venció"
              description="Por seguridad, este código ya no puede utilizarse. Genera uno nuevo para continuar."
              actionLabel="Generar otro código"
              onAction={handleRetry}
            />
          )}

          {status === 'error' && (
            <div className="space-y-3" role="alert" aria-live="assertive">
              <StateMessage
                icon={<AlertCircle size={24} aria-hidden="true" />}
                tone="rose"
                title="No pudimos completar la vinculación"
                description={errorMessage}
                actionLabel="Intentar de nuevo"
                onAction={handleRetry}
              />
              {onOpenSettings && /vinculad/i.test(errorMessage) && (
                <button
                  type="button"
                  onClick={() => { triggerHaptic?.(); onOpenSettings(); }}
                  className="flex min-h-11 w-full cursor-pointer items-center justify-center gap-1.5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 text-xs font-black text-slate-700 dark:text-slate-200 transition-colors hover:border-emerald-300 hover:text-emerald-700 focus:outline-none focus:ring-4 focus:ring-emerald-500/20"
                >
                  <span>Abrir Ajustes</span>
                  <ExternalLink size={15} aria-hidden="true" />
                </button>
              )}
            </div>
          )}
        </div>

        {status !== 'success' && status !== 'generating' && (
          <div className="flex items-center justify-between gap-3 border-t border-slate-100 dark:border-slate-800/80 px-5 py-3 sm:px-6">
            <p className="flex items-center gap-1.5 text-[11px] text-slate-400 dark:text-slate-500 font-medium">
              <Clipboard size={12} strokeWidth={2.2} aria-hidden="true" />
              <span>Código temporal y de un solo uso</span>
            </p>
            <button
              type="button"
              onClick={closeModal}
              className="min-h-8 cursor-pointer rounded-xl px-3 py-1 text-xs font-bold text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            >
              Cancelar
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function StateMessage({ icon, tone, title, description, actionLabel, onAction }) {
  const tones = {
    amber: {
      box: 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300',
      icon: 'bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300',
      title: 'text-amber-950 dark:text-amber-200',
    },
    rose: {
      box: 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300',
      icon: 'bg-rose-100 dark:bg-rose-900/60 text-rose-700 dark:text-rose-300',
      title: 'text-rose-950 dark:text-rose-200',
    },
  };
  const palette = tones[tone] || tones.rose;

  return (
    <div className="flex min-h-[240px] flex-col items-center justify-center text-center p-4" role="status" aria-live="polite">
      <div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${palette.icon}`}>{icon}</div>
      <h3 className={`mt-3 text-base font-black ${palette.title}`}>{title}</h3>
      <p className="mt-1.5 max-w-[36ch] text-xs leading-normal text-slate-600 dark:text-slate-400">{description}</p>
      <button
        type="button"
        onClick={onAction}
        className={`mt-4 flex min-h-10 w-full cursor-pointer items-center justify-center gap-1.5 rounded-2xl border px-4 text-xs font-black transition-colors focus:outline-none focus:ring-4 focus:ring-emerald-500/20 ${palette.box} hover:brightness-95`}
      >
        <RefreshCw size={15} aria-hidden="true" />
        {actionLabel}
      </button>
    </div>
  );
}

