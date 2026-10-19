import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { Download, CheckCircle2, Link2, Trash2, Smartphone, Monitor, Radio, RotateCw, ChevronRight, AlertTriangle } from 'lucide-react';
import { useAuthStore } from '../../hooks/store/useAuthStore';
import { supabaseCloud } from '../../config/supabaseCloud';
import { ensureSupervisorSession } from '../../services/supervisorAuth';
import { readPairingRow, getActivePairingSlots } from '../../services/supervisorPairingState';
import UserCard from './UserCard';
import LoginPinModal from './LoginPinModal';
import EmergencyPinResetModal from './EmergencyPinResetModal';

export default function LockScreen({ onOpenPairing, onOpenPairingIssuer = () => {}, adminLoginRequest = 0, installPrompt, onInstall, showIOSButton, onShowIOSInstall, onOpenRemotion }) {
  const { usuarios, login, loginDirect, requireCajeroPin, requireAdminPin, resetPinEmergency } = useAuthStore();
  const [selectedUser, setSelectedUser] = useState(null);
  const [showEmergencyModal, setShowEmergencyModal] = useState(false);
  const [logoClickCount, setLogoClickCount] = useState(0);
  const clickTimeoutRef = useRef(null);
  const [showWelcome, setShowWelcome] = useState(() => {
    return localStorage.getItem('pda_welcome_dismissed') !== 'true';
  });
  const [supervisors, setSupervisors] = useState([]);
  const [confirmUnpair, setConfirmUnpair] = useState(false);
  const [unpairing, setUnpairing] = useState(false);
  const [unpairError, setUnpairError] = useState('');

  const deviceId = localStorage.getItem('pda_device_id');

  const loadSupervisors = useCallback(async () => {
    if (!deviceId) return;
    const { data, error } = await readPairingRow({ supabase: supabaseCloud, primaryDeviceId: deviceId });
    if (error) return;
    setSupervisors(getActivePairingSlots(data));
  }, [deviceId]);

  useEffect(() => {
    void loadSupervisors();
  }, [loadSupervisors]);

  const handleUnpairConfirm = async () => {
    setConfirmUnpair(false);
    setUnpairing(true);
    setUnpairError('');
    try {
      const { session, error: sessionError } = await ensureSupervisorSession();
      if (sessionError || !session) throw sessionError || new Error('No hay sesión segura del dispositivo');

      const { error } = await supabaseCloud.rpc('unpair_monitor', { p_device_id: deviceId });
      if (error) throw error;

      await loadSupervisors();
    } catch (err) {
      console.error('[LockScreen] Error al desvincular:', err);
      setUnpairError('No se pudo desvincular el supervisor. Inténtalo de nuevo.');
      await loadSupervisors();
    } finally {
      setUnpairing(false);
    }
  };

  useEffect(() => {
    if (!adminLoginRequest) return;
    const admin = (usuarios || []).find(user => String(user?.rol || '').toUpperCase() === 'ADMIN');
    if (admin) setSelectedUser(admin);
  }, [adminLoginRequest, usuarios]);

  const handleLogoClick = () => {
    if (clickTimeoutRef.current) clearTimeout(clickTimeoutRef.current);

    const nextCount = logoClickCount + 1;
    if (nextCount >= 7) {
      setLogoClickCount(0);
      try { navigator.vibrate?.([100, 50, 100]); } catch {}
      setShowEmergencyModal(true);
    } else {
      setLogoClickCount(nextCount);
      try { navigator.vibrate?.(40); } catch {}
      clickTimeoutRef.current = setTimeout(() => {
        setLogoClickCount(0);
      }, 1500);
    }
  };

  const isStandalone = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia?.('(display-mode: standalone)')?.matches || navigator.standalone;
  }, []);

  const handleUserClick = (user) => {
    if (user?.requirePin === false) {
      loginDirect(user.id);
    } else {
      setSelectedUser(user);
    }
  };

  const handlePinSubmit = async (pin, userId) => {
    const result = await login(pin, userId);
    if (result?.success) {
      setSelectedUser(null);
    }
    return result;
  };

  const handleDismissWelcome = () => {
    localStorage.setItem('pda_welcome_dismissed', 'true');
    setShowWelcome(false);
  };

  const handleInstallClick = async () => {
    if (onInstall) {
      await onInstall();
      return;
    }
    if (showIOSButton && onShowIOSInstall) {
      onShowIOSInstall();
    }
  };

  return (
    <div className="fixed inset-0 z-[250] bg-slate-50 text-slate-800 font-sans overflow-y-auto overflow-x-hidden flex min-h-full flex-col">
      {/* Background glow */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-[30%] -left-[15%] w-[600px] h-[600px] bg-sky-500/10 rounded-full blur-[120px]" />
        <div className="absolute -bottom-[30%] -right-[15%] w-[600px] h-[600px] bg-teal-400/10 rounded-full blur-[120px]" />
      </div>

      {/* Top Bar with PWA Install Button */}
      <div className="absolute top-4 right-4 z-30 flex items-center gap-2">
        {isStandalone ? (
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-[10px] font-extrabold uppercase tracking-wider rounded-xl shadow-sm">
            <CheckCircle2 size={13} className="text-emerald-500" />
            <span>App Instalada</span>
          </div>
        ) : (
          <button
            onClick={handleInstallClick}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white text-xs font-bold rounded-2xl shadow-lg shadow-emerald-600/20 transition-all cursor-pointer animate-pulse"
            title="Instalar como aplicación en este dispositivo"
          >
            <Download size={15} strokeWidth={2.5} />
            <span>Instalar App</span>
          </button>
        )}
      </div>

      {/* Version Tag - Top Left */}
      <div className="absolute top-4 left-4 z-30 flex items-center gap-2">
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-900/5 dark:bg-slate-100/10 border border-slate-900/10 dark:border-slate-100/10 rounded-xl backdrop-blur-md">
          <span className="text-[11px] font-black text-slate-500 dark:text-slate-400 tracking-wider">v2.0.1</span>
        </div>
      </div>

      <div className="relative z-10 flex flex-col items-center justify-center flex-1 p-6">
        {/* Header */}
        <div className="text-center mb-14">
          <div className="flex justify-center mb-6">
            <img
              src="./logo.png"
              alt="Logo"
              onClick={handleLogoClick}
              className="h-24 sm:h-32 w-auto object-contain drop-shadow-md cursor-pointer select-none active:scale-95 transition-transform"
              title="Precios Al Día"
            />
          </div>
          <h1 className="text-2xl sm:text-3xl font-light tracking-[0.15em] text-slate-600">
            Quien esta{' '}
            <strong className="text-slate-900 font-bold">operando</strong>?
          </h1>
        </div>

        {/* User Grid */}
        <div className="w-full grid grid-cols-2 md:flex md:flex-row md:flex-wrap md:justify-center gap-8 sm:gap-14 max-w-[320px] md:max-w-5xl mx-auto">
          {(usuarios || []).map(user => (
            <UserCard
              key={user.id}
              user={user}
              onClick={() => handleUserClick(user)}
            />
          ))}
        </div>
      </div>

      {/* Footer / Centro de Control & Supervisión */}
      <footer className="relative z-10 shrink-0 pb-8 px-4 w-full flex flex-col items-center">
        {/* Bento Card: Centro de Control & Supervisión */}
        <section
          aria-label="Centro de control de supervisión y enlaces"
          className="max-w-md w-full bg-white/90 dark:bg-slate-900/90 rounded-3xl border border-slate-200/80 dark:border-slate-800 p-4 sm:p-5 shadow-sm backdrop-blur-md space-y-3.5 transition-all"
        >
          {/* Card Header: Título e indicador de estado de enlace */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-800/60 shadow-xs">
                <Radio size={14} strokeWidth={2.5} className="animate-pulse" />
              </div>
              <h2 className="text-xs font-black tracking-wider text-slate-800 dark:text-slate-200 uppercase">
                Supervisión &amp; Enlace
              </h2>
            </div>

            {/* Status Pill Badge */}
            {supervisors.length > 0 ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200/80 dark:border-emerald-800/60">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                {supervisors.length} {supervisors.length === 1 ? 'Vinculado' : 'Vinculados'}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                Sin Enlace
              </span>
            )}
          </div>

          {/* Telemetry Sub-grid: Esta Caja POS vs Supervisor(es) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {/* Box 1: Esta Caja (POS Local) */}
            <div className="bg-slate-50/80 dark:bg-slate-950/50 rounded-2xl p-2.5 border border-slate-200/60 dark:border-slate-800/80 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="p-1 rounded-lg bg-slate-200/50 dark:bg-slate-800 text-slate-500 shrink-0">
                  <Monitor size={13} strokeWidth={2.2} />
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-[9px] font-black uppercase tracking-wider text-slate-400">Esta Caja</span>
                  <span className="text-[11px] font-mono font-bold text-slate-700 dark:text-slate-300 truncate" title={deviceId || undefined}>
                    {deviceId ? shortDeviceId(deviceId) : 'Sin ID'}
                  </span>
                </div>
              </div>
              <span className="text-[9px] font-black px-1.5 py-0.5 rounded-md bg-slate-200/70 dark:bg-slate-800 text-slate-600 dark:text-slate-400 shrink-0 uppercase tracking-wider">
                Local
              </span>
            </div>

            {/* Box 2: Supervisor(es) Vinculado(s) */}
            {supervisors.length > 0 ? (
              <div className="bg-slate-50/80 dark:bg-slate-950/50 rounded-2xl p-2.5 border border-slate-200/60 dark:border-slate-800/80 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="p-1 rounded-lg bg-emerald-100/60 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 shrink-0">
                    <Smartphone size={13} strokeWidth={2.2} />
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-[9px] font-black uppercase tracking-wider text-slate-400">
                      {supervisors.length === 1 ? 'Supervisor' : `Supervisores (${supervisors.length})`}
                    </span>
                    <span className="text-[11px] font-mono font-bold text-slate-700 dark:text-slate-300 truncate" title={supervisors.map(s => s.id).join(', ')}>
                      {shortDeviceId(supervisors[0].id)}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => setConfirmUnpair(true)}
                  disabled={unpairing}
                  title="Desvincular supervisor"
                  aria-label="Desvincular supervisor"
                  className="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/50 rounded-xl transition-all cursor-pointer shrink-0 disabled:opacity-50"
                >
                  <Trash2 size={13} strokeWidth={2.5} />
                </button>
              </div>
            ) : (
              <div className="bg-slate-50/40 dark:bg-slate-950/30 rounded-2xl p-2.5 border border-dashed border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0 text-slate-400">
                  <div className="p-1 rounded-lg bg-slate-100 dark:bg-slate-800/60 text-slate-400 shrink-0">
                    <Smartphone size={13} strokeWidth={2} />
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-[9px] font-black uppercase tracking-wider text-slate-400">Supervisor</span>
                    <span className="text-[10px] font-medium text-slate-400 truncate">Ninguno enlazado</span>
                  </div>
                </div>
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-400 shrink-0 uppercase tracking-wider">
                  Libre
                </span>
              </div>
            )}
          </div>

          {/* Error al desvincular si ocurre */}
          {unpairError && (
            <div className="p-2 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-[10px] text-rose-600 dark:text-rose-400 flex items-center gap-1.5 font-medium">
              <AlertTriangle size={12} className="shrink-0" />
              <span>{unpairError}</span>
            </div>
          )}

          {/* Action Buttons: Entrar en Modo Supervisor & Vincular Supervisor (QR) */}
          <div className="space-y-2 pt-0.5">
            <button
              onClick={onOpenPairing}
              className="w-full min-h-11 py-2.5 px-4 bg-slate-900 hover:bg-slate-800 active:scale-[0.98] dark:bg-white dark:hover:bg-slate-100 text-white dark:text-slate-900 rounded-2xl text-xs font-black tracking-wider uppercase transition-all shadow-sm flex items-center justify-center gap-2 cursor-pointer group"
            >
              <Smartphone size={15} strokeWidth={2.2} className="text-emerald-400 dark:text-emerald-600" />
              <span>Entrar en Modo Supervisor</span>
              <ChevronRight size={14} strokeWidth={2.5} className="opacity-60 group-hover:translate-x-0.5 transition-transform" />
            </button>

            <button
              onClick={onOpenPairingIssuer}
              className="w-full min-h-10 py-2 px-4 bg-emerald-50 hover:bg-emerald-100/90 active:scale-[0.98] dark:bg-emerald-950/30 dark:hover:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 border border-emerald-200/80 dark:border-emerald-800/60 rounded-2xl text-[11px] font-extrabold tracking-wider uppercase transition-all shadow-xs flex items-center justify-center gap-2 cursor-pointer"
            >
              <Link2 size={13} strokeWidth={2.5} className="text-emerald-600 dark:text-emerald-400" />
              <span>Vincular Nuevo Supervisor (QR)</span>
            </button>
          </div>
        </section>

        {/* Micro-enlaces secundarios debajo de la tarjeta */}
        <div className="flex items-center justify-center gap-3 pt-3 text-[10px] text-slate-400 dark:text-slate-500 font-medium tracking-wide">
          <span>
            {(usuarios || []).every(u => u?.requirePin === false)
              ? 'Acceso directo activo'
              : 'Acceso con PIN'}
          </span>
          <span className="opacity-40">•</span>
          <button
            onClick={() => window.location.reload()}
            className="hover:text-slate-600 dark:hover:text-slate-300 transition-colors inline-flex items-center gap-1 font-semibold cursor-pointer"
          >
            <RotateCw size={10} strokeWidth={2.5} />
            Recargar
          </button>
        </div>
      </footer>

      {/* PIN Modal */}
      <LoginPinModal
        isOpen={!!selectedUser}
        onClose={() => setSelectedUser(null)}
        user={selectedUser}
        onSubmit={handlePinSubmit}
      />

      {/* Emergency PIN Reset Modal */}
      {showEmergencyModal && (
        <EmergencyPinResetModal
          usuarios={usuarios}
          onClose={() => setShowEmergencyModal(false)}
          onResetPin={resetPinEmergency}
        />
      )}

      {/* Welcome Modal */}
      <WelcomeModal
        isOpen={showWelcome}
        onClose={handleDismissWelcome}
      />

      {/* Confirmación de desvinculación */}
      {confirmUnpair && (
        <div className="fixed inset-0 z-[300] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 max-w-sm w-full rounded-3xl p-6 shadow-2xl border border-slate-100 dark:border-slate-800 text-center animate-in fade-in zoom-in-95 duration-150">
            <h3 className="text-lg font-black text-slate-800 dark:text-white mb-2">¿Desvincular supervisor?</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed mb-6">
              El supervisor dejará de ver esta caja en tiempo real. Puedes volver a vincularlo después.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmUnpair(false)}
                className="flex-1 py-3 bg-slate-100 hover:bg-slate-200/80 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs rounded-2xl cursor-pointer transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleUnpairConfirm}
                className="flex-1 py-3 bg-rose-500 hover:bg-rose-600 active:scale-95 text-white font-bold text-xs rounded-2xl shadow-lg shadow-rose-500/20 cursor-pointer transition-all"
              >
                Desvincular
              </button>
            </div>
          </div>
        </div>
      )}


    </div>
  );
}

/** Forma resumida para reconocer un ID: primeros 9 y últimos 4 caracteres. */
function shortDeviceId(id) {
  const value = String(id || '');
  return value.length > 14 ? `${value.slice(0, 9)}…${value.slice(-4)}` : value;
}

function WelcomeModal({ isOpen, onClose }) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[300] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 max-w-sm w-full rounded-3xl p-6 shadow-2xl border border-slate-100 dark:border-slate-800 text-center relative animate-in fade-in zoom-in-95 duration-200">
        <div className="flex justify-center mb-4">
          <div className="p-3 bg-emerald-500/10 text-emerald-500 rounded-2xl">
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          </div>
        </div>
        <h3 className="text-lg font-black text-slate-800 dark:text-white mb-2">PreciosAlDía Bodega</h3>
        <p className="text-xs text-slate-500 leading-relaxed mb-6">
          Tu punto de venta rápido y seguro. Selecciona tu perfil para comenzar a operar.
        </p>
        <button
          onClick={onClose}
          className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 active:scale-95 text-white font-bold text-xs rounded-2xl shadow-lg shadow-emerald-500/20 transition-all cursor-pointer"
        >
          Comenzar
        </button>
      </div>
    </div>
  );
}
