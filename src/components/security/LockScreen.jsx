import React, { useState } from 'react';
import { useAuthStore } from '../../hooks/store/useAuthStore';
import UserCard from './UserCard';
import LoginPinModal from './LoginPinModal';

export default function LockScreen({ onOpenPairing }) {
  const { usuarios, login } = useAuthStore();
  const [selectedUser, setSelectedUser] = useState(null);
  const [showWelcome, setShowWelcome] = useState(() => {
    return localStorage.getItem('pda_welcome_dismissed') !== 'true';
  });

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

  return (
    <div className="fixed inset-0 z-[250] bg-slate-50 text-slate-800 font-sans overflow-hidden flex flex-col">
      {/* Background glow */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-[30%] -left-[15%] w-[600px] h-[600px] bg-sky-500/10 rounded-full blur-[120px]" />
        <div className="absolute -bottom-[30%] -right-[15%] w-[600px] h-[600px] bg-teal-400/10 rounded-full blur-[120px]" />
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
              onClick={() => setSelectedUser(user)}
            />
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="relative z-10 pb-6 text-center flex flex-col items-center gap-3">
        {/* SEC-017: todos los roles usan 6 dígitos (PIN_POLICY.MIN_LENGTH). */}
        <p className="text-[10px] text-slate-400 font-medium tracking-wider">
          PIN de 6 dígitos para todos los usuarios
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
    </div>
  );
}

function WelcomeModal({ isOpen, onClose }) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[300] bg-slate-900/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 rounded-[2rem] p-6 sm:p-8 max-w-md w-full shadow-2xl border border-slate-100 dark:border-slate-800 text-center animate-in zoom-in-95 duration-300">
        <div className="w-16 h-16 bg-cyan-50 dark:bg-cyan-950/30 rounded-2xl flex items-center justify-center mx-auto mb-4 animate-bounce">
          <span className="text-3xl">👋</span>
        </div>
        
        <h2 className="text-2xl font-black text-slate-900 dark:text-white mb-2 leading-tight">
          ¡Te damos la bienvenida!
        </h2>
        
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
          Precios al Día está listo para usar. Sigue estos sencillos pasos para empezar:
        </p>

        <div className="text-left space-y-4 mb-6">
          <div className="flex gap-3 items-start">
            <div className="w-6 h-6 rounded-full bg-brand text-white flex items-center justify-center font-bold text-xs shrink-0 mt-0.5 shadow-md">
              1
            </div>
            <div>
              <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200">Ingresa con el PIN inicial</h4>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Selecciona <strong>Administrador</strong> o <strong>Cajero</strong> e ingresa el código de fábrica: <code className="bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded font-mono text-brand font-bold text-sm">000000</code> (seis ceros).
              </p>
            </div>
          </div>

          <div className="flex gap-3 items-start">
            <div className="w-6 h-6 rounded-full bg-brand text-white flex items-center justify-center font-bold text-xs shrink-0 mt-0.5 shadow-md">
              2
            </div>
            <div>
              <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200">Configura tus accesos</h4>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Ve a <strong>Ajustes → Usuarios</strong> (dentro del panel de Admin) para cambiar tu PIN por uno seguro y agregar a tu personal.
              </p>
            </div>
          </div>

          <div className="flex gap-3 items-start">
            <div className="w-6 h-6 rounded-full bg-brand text-white flex items-center justify-center font-bold text-xs shrink-0 mt-0.5 shadow-md">
              3
            </div>
            <div>
              <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200">Carga inventario y vende</h4>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Agrega tus productos en la pestaña <strong>Inventario</strong> y empieza a facturar desde la pestaña <strong>Vender</strong>.
              </p>
            </div>
          </div>
        </div>

        <button
          onClick={onClose}
          className="w-full py-3 bg-brand hover:bg-brand-dark text-white font-bold rounded-xl shadow-lg active:scale-95 transition-transform text-sm"
        >
          ¡Entendido, comenzar!
        </button>
      </div>
    </div>
  );
}
