import React, { useState, useMemo } from 'react';
import { Download, CheckCircle2, X } from 'lucide-react';
import { useAuthStore } from '../../hooks/store/useAuthStore';
import UserCard from './UserCard';
import LoginPinModal from './LoginPinModal';

export default function LockScreen({ onOpenPairing, installPrompt, onInstall, showIOSButton, onShowIOSInstall }) {
  const { usuarios, login, loginDirect, requireCajeroPin } = useAuthStore();
  const [selectedUser, setSelectedUser] = useState(null);
  const [showPwaInfoModal, setShowPwaInfoModal] = useState(false);
  const [showWelcome, setShowWelcome] = useState(() => {
    return localStorage.getItem('pda_welcome_dismissed') !== 'true';
  });

  const isStandalone = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  }, []);

  const handleUserClick = (user) => {
    if (user?.rol === 'CAJERO' && requireCajeroPin === false) {
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
      const success = await onInstall();
      if (success) return;
    }
    if (showIOSButton && onShowIOSInstall) {
      onShowIOSInstall();
      return;
    }
    setShowPwaInfoModal(true);
  };

  return (
    <div className="fixed inset-0 z-[250] bg-slate-50 text-slate-800 font-sans overflow-hidden flex flex-col">
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

      <div className="relative z-10 flex flex-col items-center justify-center flex-1 p-6">
        {/* Header */}
        <div className="text-center mb-14">
          <div className="flex justify-center mb-6">
            <img src="./logo.png" alt="Logo" className="h-24 sm:h-32 w-auto object-contain drop-shadow-md" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-light tracking-[0.15em] text-slate-600">
            Quien esta{' '}
            <strong className="text-slate-900 font-bold">operando</strong>?
          </h1>
        </div>

        {/* User Grid */}
        <div className="w-full grid grid-cols-2 md:flex md:flex-row md:flex-wrap md:justify-center gap-8 sm:gap-14 max-w-[320px] md:max-w-5xl mx-auto">
          {usuarios.map(user => (
            <UserCard
              key={user.id}
              user={user}
              onClick={() => handleUserClick(user)}
            />
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="relative z-10 pb-6 text-center flex flex-col items-center gap-3">
        <p className="text-[10px] text-slate-400 font-medium tracking-wider">
          {requireCajeroPin === false ? 'PIN de 6 dígitos para Administrador (Cajero sin PIN)' : 'PIN de 6 dígitos para todos los usuarios'}
        </p>
        <button
          onClick={() => window.location.reload()}
          className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400/70 hover:text-slate-500 transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.5"/></svg>
          Recargar
        </button>

        <button
          onClick={onOpenPairing}
          className="mt-3 px-5 py-2.5 bg-slate-100 hover:bg-slate-200/80 active:scale-95 text-slate-600 hover:text-slate-800 border border-slate-200/60 rounded-2xl text-[10px] font-bold uppercase tracking-wider transition-all shadow-sm flex items-center gap-2"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-500"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>
          Entrar en Modo Supervisor
        </button>
      </div>

      {/* PIN Modal */}
      <LoginPinModal
        isOpen={!!selectedUser}
        onClose={() => setSelectedUser(null)}
        user={selectedUser}
        onSubmit={handlePinSubmit}
      />

      {/* Welcome Modal */}
      <WelcomeModal
        isOpen={showWelcome}
        onClose={handleDismissWelcome}
      />

      {/* PWA Info Modal (Manual instructions for Desktop/Mobile Chrome & Safari) */}
      {showPwaInfoModal && (
        <div className="fixed inset-0 z-[300] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 max-w-md w-full rounded-3xl p-6 shadow-2xl border border-slate-100 dark:border-slate-800 text-left relative animate-in fade-in zoom-in-95 duration-200">
            <button
              onClick={() => setShowPwaInfoModal(false)}
              className="absolute top-4 right-4 p-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full text-slate-500 transition-colors"
            >
              <X size={16} />
            </button>
            <div className="flex items-center gap-3 mb-4">
              <div className="p-3 bg-emerald-500/10 text-emerald-600 rounded-2xl">
                <Download size={22} strokeWidth={2.5} />
              </div>
              <div>
                <h3 className="text-base font-extrabold text-slate-900 dark:text-white">Instalar PreciosAlDía PWA</h3>
                <p className="text-xs text-slate-500">Acceso directo sin barra de navegador</p>
              </div>
            </div>
            <div className="space-y-3 text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl border border-slate-100 dark:border-slate-800">
              <p className="font-bold text-slate-800 dark:text-slate-200">En Chrome / Edge (Computadora o Android):</p>
              <ol className="list-decimal pl-4 space-y-1">
                <li>Haz clic en el icono de <strong>Instalar</strong> en la barra de direcciones (arriba a la derecha ⊕) o el menú de 3 puntos.</li>
                <li>Selecciona <strong>"Instalar PreciosAlDía..."</strong> o <strong>"Agregar a la pantalla principal"</strong>.</li>
              </ol>
              <p className="font-bold text-slate-800 dark:text-slate-200 mt-3">En iPhone / iPad (Safari):</p>
              <ol className="list-decimal pl-4 space-y-1">
                <li>Toca el botón <strong>Compartir</strong> (cuadro con flecha arriba ⎘).</li>
                <li>Desliza hacia abajo y selecciona <strong>"Agregar al inicio"</strong>.</li>
              </ol>
            </div>
            <button
              onClick={() => setShowPwaInfoModal(false)}
              className="w-full mt-5 py-3 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-2xl shadow-md transition-all active:scale-98 cursor-pointer"
            >
              Entendido
            </button>
          </div>
        </div>
      )}
    </div>
  );
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
