import React from 'react';
import { Users, Lock } from 'lucide-react';
import { SectionCard } from '../../SettingsShared';
import UsersManager from '../UsersManager';
import { Toggle } from '../../SettingsShared';

export default function SettingsTabUsuarios({
    requireLogin, setRequireLogin,
    autoLockMinutes, setAutoLockMinutes,
    showToast, triggerHaptic,
}) {
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
            <div className="md:col-span-2 xl:col-span-3">
                <SectionCard icon={Users} title="Usuarios y Roles" subtitle="Gestiona quien opera la app" iconColor="text-brand">
                    <UsersManager triggerHaptic={triggerHaptic} />
                </SectionCard>
            </div>

            <div className="md:col-span-2 xl:col-span-3">
                <SectionCard icon={Lock} title="Seguridad" subtitle="Control de acceso por PIN" iconColor="text-rose-500">
                    {/* Toggle login requerido */}
                    <div className="flex items-center justify-between mb-4 border-b border-slate-100 dark:border-slate-800 pb-4">
                        <div>
                            <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Pedir PIN al iniciar</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Si se desactiva, entrará directo como Administrador.</p>
                        </div>
                        <Toggle
                            enabled={requireLogin}
                            color="rose"
                            onChange={() => {
                                const newVal = !requireLogin;
                                if (setRequireLogin) setRequireLogin(newVal);
                                triggerHaptic?.();
                                showToast(newVal ? 'PIN activado para inicio' : 'Acceso directo activado', 'success');
                            }}
                        />
                    </div>

                    {/* Bloqueo automático — solo si PIN está activo */}
                    {requireLogin && (
                        <div>
                            <label className="text-[11px] uppercase tracking-wider font-extrabold text-slate-500 dark:text-slate-400 block mb-1.5">Bloqueo Automático</label>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">Tu sesión se bloqueará tras estos minutos de inactividad.</p>
                            <div className="grid grid-cols-4 gap-2 max-w-sm">
                                {[
                                    { val: '1', label: '1m' },
                                    { val: '3', label: '3m' },
                                    { val: '5', label: '5m' },
                                    { val: '10', label: '10m' }
                                ].map(opt => (
                                    <button
                                        key={opt.val}
                                        onClick={() => {
                                            setAutoLockMinutes(opt.val);
                                            localStorage.setItem('admin_auto_lock_minutes', opt.val);
                                            triggerHaptic?.();
                                        }}
                                        className={`py-2 text-xs font-bold rounded-xl transition-all border ${autoLockMinutes === opt.val
                                            ? 'bg-rose-50 dark:bg-rose-900/20 border-rose-400 text-rose-700 dark:text-rose-300 shadow-sm'
                                            : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                                        }`}
                                    >
                                        {opt.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </SectionCard>
            </div>
        </div>
    );
}
