import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Clipboard,
  Clock3,
  Copy,
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

  const clearWatcher = useCallback(() => {
    cleanupWatchRef.current?.();
    cleanupWatchRef.current = null;
  }, []);

  const clearSecretState = useCallback(() => {
    clearWatcher();
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
        width: 224,
        margin: 2,
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

  const handleGenerate = async (event) => {
    event.preventDefault();
    if (!PIN_PATTERN.test(pin)) {
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
      const authorization = await verifyAdminPin(pin);
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
      className="fixed inset-0 z-[360] flex items-end justify-center bg-slate-950/50 p-0 backdrop-blur-sm sm:items-center sm:p-4"
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
        className="flex max-h-[94vh] w-full max-w-[560px] flex-col overflow-y-auto rounded-t-[2rem] border border-white/70 bg-[var(--bg)] text-slate-900 shadow-[0_-18px_70px_rgba(15,23,42,0.24)] sm:max-h-[90vh] sm:rounded-[2rem] sm:shadow-[0_28px_90px_rgba(15,23,42,0.28)] dark:text-slate-100"
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200/80 px-5 py-5 sm:px-7 sm:py-6">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
              <ShieldCheck size={23} strokeWidth={2.4} aria-hidden="true" />
            </div>
            <div>
              <p className="mb-1 text-[10px] font-black uppercase tracking-[0.16em] text-emerald-700">Acceso temporal</p>
              <h2 ref={titleRef} tabIndex={-1} id="quick-pairing-title" className="text-xl font-black tracking-tight text-slate-900 outline-none sm:text-2xl" aria-live="polite">
                Vincular supervisor
              </h2>
              <p id="quick-pairing-description" className="mt-1 max-w-[38ch] text-sm leading-5 text-slate-500">
                Conecta otro dispositivo a esta caja sin salir de la pantalla inicial.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={closeModal}
            className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-4 focus:ring-emerald-500/20"
            aria-label="Cerrar vinculación de supervisor"
          >
            <X size={21} aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 px-5 py-5 sm:px-7 sm:py-6">
          {status === 'pin' && (
            <form onSubmit={handleGenerate} noValidate className="space-y-5">
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4">
                <div className="flex gap-3">
                  <KeyRound className="mt-0.5 shrink-0 text-emerald-700" size={19} aria-hidden="true" />
                  <div>
                    <h3 className="text-sm font-extrabold text-emerald-950">Se requiere autorización</h3>
                    <p className="mt-1 text-sm leading-5 text-emerald-900/70">
                      Ingresa el PIN de un administrador para generar un código de un solo uso.
                    </p>
                  </div>
                </div>
              </div>

              <div>
                <label htmlFor="supervisor-admin-pin" className="mb-2 block text-xs font-black uppercase tracking-[0.12em] text-slate-600">
                  PIN de administrador · 6 dígitos
                </label>
                <div className="relative" onClick={() => pinInputRef.current?.focus()}>
                  <div
                    className={`grid grid-cols-6 gap-2 rounded-2xl border bg-white p-2 transition-shadow sm:gap-3 sm:p-3 ${pinError ? 'border-rose-300 ring-4 ring-rose-500/10' : 'border-slate-200 focus-within:border-emerald-500 focus-within:ring-4 focus-within:ring-emerald-500/15'}`}
                    aria-hidden="true"
                  >
                    {Array.from({ length: PIN_LENGTH }, (_, index) => {
                      const digit = pin[index];
                      const isActive = index === Math.min(pin.length, PIN_LENGTH - 1);
                      return (
                        <span
                          key={index}
                          className={`flex h-12 items-center justify-center rounded-xl border text-xl font-black transition-colors sm:h-14 ${digit ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : isActive ? 'border-emerald-400 bg-emerald-50/40 text-emerald-700' : 'border-slate-100 bg-slate-50 text-slate-300'}`}
                        >
                          {digit ? '•' : ''}
                        </span>
                      );
                    })}
                  </div>
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
                      setPin(event.target.value.replace(/\D/g, '').slice(0, PIN_LENGTH));
                      setPinError('');
                    }}
                    aria-label="PIN de administrador de 6 dígitos"
                    aria-invalid={Boolean(pinError)}
                    aria-describedby={pinError ? 'supervisor-pin-error' : 'supervisor-pin-help'}
                    className="absolute inset-0 h-full w-full cursor-text rounded-2xl opacity-0 outline-none"
                  />
                </div>
                <div className="mt-2 flex items-center justify-between gap-3">
                  {pinError ? (
                    <p id="supervisor-pin-error" role="alert" className="text-xs font-bold text-rose-600">{pinError}</p>
                  ) : (
                    <p id="supervisor-pin-help" className="text-xs leading-5 text-slate-500">Escribe o pega los 6 dígitos del PIN.</p>
                  )}
                  <span className="shrink-0 text-xs font-bold tabular-nums text-slate-400" aria-hidden="true">{pin.length}/{PIN_LENGTH}</span>
                </div>
              </div>

              <div className="flex items-start gap-2 rounded-xl bg-slate-100/80 px-3 py-3 text-xs leading-5 text-slate-600">
                <Clock3 className="mt-0.5 shrink-0 text-slate-500" size={15} aria-hidden="true" />
                <span>El código caduca automáticamente y no reemplaza la contraseña de ningún usuario.</span>
              </div>

              <button
                type="submit"
                className="flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-2xl bg-brand px-5 text-sm font-black text-white shadow-primary/20 transition-all hover:bg-brand-dark focus:outline-none focus:ring-4 focus:ring-brand/25 active:translate-y-px"
              >
                <ShieldCheck size={18} aria-hidden="true" />
                Generar código temporal
              </button>
            </form>
          )}

          {status === 'generating' && (
            <div className="flex min-h-[300px] flex-col items-center justify-center text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-emerald-100 text-emerald-700">
                <Loader2 className="animate-spin" size={29} aria-hidden="true" />
              </div>
              <h3 className="mt-5 text-lg font-black text-slate-900">Preparando vinculación</h3>
              <p className="mt-2 max-w-[34ch] text-sm leading-5 text-slate-500" role="status">{progressMessage}</p>
            </div>
          )}

          {isCodeVisible && (
            <div className="space-y-5">
              <div className="flex flex-col items-center rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                <div className="mb-3 flex w-full items-center justify-between text-xs font-bold text-slate-500">
                  <span className="flex items-center gap-2"><QrCode size={16} className="text-emerald-700" aria-hidden="true" />Código listo</span>
                  <span className="rounded-full bg-amber-50 px-2.5 py-1 font-black text-amber-700">{timeLeft}</span>
                </div>
                <div className="rounded-2xl border border-slate-100 bg-white p-3 shadow-inner">
                  <canvas ref={canvasRef} width="224" height="224" aria-label="Código QR para vincular el supervisor" />
                </div>
                <p className="mt-3 text-center text-xs leading-5 text-slate-500">Escanéalo desde el celular del supervisor.</p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Código de respaldo</p>
                    <p className="mt-2 break-all font-mono text-lg font-black tracking-[0.16em] text-slate-900">{token}</p>
                  </div>
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="flex min-h-11 shrink-0 cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 transition-colors hover:border-emerald-300 hover:text-emerald-700 focus:outline-none focus:ring-4 focus:ring-emerald-500/20"
                    aria-label="Copiar código de vinculación"
                  >
                    {copyState === 'copied' ? <Check size={16} className="text-emerald-600" aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
                    <span>{copyState === 'copied' ? 'Copiado' : 'Copiar'}</span>
                  </button>
                </div>
                {copyState === 'error' && <p role="alert" className="mt-2 text-xs font-bold text-rose-600">No se pudo copiar. Selecciona el código manualmente.</p>}
              </div>

              <div className="grid gap-2 text-sm text-slate-600 sm:grid-cols-3">
                {[
                  ['1', 'Abre la app en el celular'],
                  ['2', 'Pulsa modo supervisor'],
                  ['3', 'Escanea o escribe el código'],
                ].map(([number, text]) => (
                  <div key={number} className="flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-3 leading-5">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-[10px] font-black text-emerald-800">{number}</span>
                    <span>{text}</span>
                  </div>
                ))}
              </div>

              {status === 'ready' ? (
                <button
                  type="button"
                  onClick={handleStartWaiting}
                  className="flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-2xl bg-brand px-5 text-sm font-black text-white shadow-primary/20 transition-all hover:bg-brand-dark focus:outline-none focus:ring-4 focus:ring-brand/25 active:translate-y-px"
                >
                  <Smartphone size={18} aria-hidden="true" />
                  Esperar conexión del supervisor
                </button>
              ) : (
                <div className="flex items-center justify-center gap-2 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-extrabold text-emerald-800" role="status">
                  <Loader2 size={17} className="animate-spin" aria-hidden="true" />
                  Esperando conexión del supervisor…
                </div>
              )}
            </div>
          )}

          {status === 'success' && (
            <div className="flex min-h-[300px] flex-col items-center justify-center text-center" role="status" aria-live="polite">
              <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-emerald-100 text-emerald-700">
                <CheckCircle2 size={32} aria-hidden="true" />
              </div>
              <h3 className="mt-5 text-xl font-black text-slate-900">Supervisor vinculado</h3>
              <p className="mt-2 max-w-[34ch] text-sm leading-5 text-slate-500">El dispositivo ya puede consultar el inventario y las métricas de esta caja.</p>
              {pairedDeviceId && <p className="mt-4 rounded-xl bg-slate-100 px-3 py-2 font-mono text-xs font-bold text-slate-600">{pairedDeviceId.slice(0, 18)}{pairedDeviceId.length > 18 ? '…' : ''}</p>}
              <button
                type="button"
                onClick={closeModal}
                className="mt-6 flex min-h-12 w-full cursor-pointer items-center justify-center rounded-2xl bg-brand px-5 text-sm font-black text-white transition-colors hover:bg-brand-dark focus:outline-none focus:ring-4 focus:ring-brand/25"
              >
                Listo
              </button>
            </div>
          )}

          {status === 'expired' && (
            <StateMessage
              icon={<Clock3 size={31} aria-hidden="true" />}
              tone="amber"
              title="El código venció"
              description="Por seguridad, este código ya no puede utilizarse. Genera uno nuevo para continuar."
              actionLabel="Generar otro código"
              onAction={handleRetry}
            />
          )}

          {status === 'error' && (
            <div className="space-y-5" role="alert" aria-live="assertive">
              <StateMessage
                icon={<AlertCircle size={31} aria-hidden="true" />}
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
                  className="flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 text-sm font-black text-slate-700 transition-colors hover:border-emerald-300 hover:text-emerald-700 focus:outline-none focus:ring-4 focus:ring-emerald-500/20"
                >
                  Abrir Ajustes <ExternalLink size={16} aria-hidden="true" />
                </button>
              )}
            </div>
          )}
        </div>

        {status !== 'success' && status !== 'generating' && (
          <div className="flex items-center justify-between gap-3 border-t border-slate-200/80 px-5 py-4 sm:px-7">
            <p className="flex items-center gap-2 text-xs text-slate-500">
              <Clipboard size={14} aria-hidden="true" />
              Código temporal y de un solo uso
            </p>
            <button
              type="button"
              onClick={closeModal}
              className="min-h-10 cursor-pointer rounded-xl px-3 text-xs font-black text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus:ring-4 focus:ring-emerald-500/20"
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
    amber: { box: 'bg-amber-50 border-amber-200', icon: 'bg-amber-100 text-amber-700', title: 'text-amber-950' },
    rose: { box: 'bg-rose-50 border-rose-200', icon: 'bg-rose-100 text-rose-700', title: 'text-rose-950' },
  };
  const palette = tones[tone] || tones.rose;

  return (
    <div className="flex min-h-[300px] flex-col items-center justify-center text-center" role="status" aria-live="polite">
      <div className={`flex h-16 w-16 items-center justify-center rounded-3xl ${palette.icon}`}>{icon}</div>
      <h3 className={`mt-5 text-xl font-black ${palette.title}`}>{title}</h3>
      <p className="mt-2 max-w-[36ch] text-sm leading-5 text-slate-600">{description}</p>
      <button
        type="button"
        onClick={onAction}
        className={`mt-6 flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-2xl border px-5 text-sm font-black transition-colors focus:outline-none focus:ring-4 focus:ring-emerald-500/20 ${palette.box} text-slate-800 hover:border-emerald-300 hover:text-emerald-800`}
      >
        <RefreshCw size={17} aria-hidden="true" />
        {actionLabel}
      </button>
    </div>
  );
}

