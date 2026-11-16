import React, { useState } from 'react';
import { Users, Lock, ShieldAlert } from 'lucide-react';
import { SectionCard } from '../../SettingsShared';
import UsersManager from '../UsersManager';
import { Toggle } from '../../SettingsShared';
import { Modal } from '../../Modal';
import { useAuthStore } from '../../../hooks/store/useAuthStore';
import { adminsWithoutPin, validateNewAdminPin } from '../../../utils/adminPinPolicy';

const PIN_INPUT = 'w-full px-4 py-3 min-h-[48px] text-center text-lg font-black tracking-[0.4em] bg-slate-50 dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 rounded-xl focus:border-brand focus:ring-2 focus:ring-brand/30 outline-none text-slate-800 dark:text-white';

// Pide el PIN nuevo del Administrador antes de activar la pantalla de inicio (o desde el aviso).
function AdminPinModal({ admin, onClose, onDone }) {
    const protegerAdministrador = useAuthStore(s => s.protegerAdministrador);
    const [pin, setPin] = useState('');
    const [confirm, setConfirm] = useState('');
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);

    const onlyDigits = (v) => v.replace(/\D/g, '').slice(0, 12);
    const handleSave = async () => {
        const err = validateNewAdminPin(pin, confirm);
        if (err) { setError(err); return; }
        setSaving(true);
        const res = await protegerAdministrador(admin.id, pin);
        setSaving(false);
        if (!res.ok) { setError(res.error || 'No se pudo guardar el PIN'); return; }
        onDone();
    };

    return (
        <Modal isOpen onClose={onClose} title={`PIN de ${admin.nombre || 'Administrador'}`}>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed mb-4">
                Con la pantalla de inicio activa, el Administrador siempre entra con PIN. Así nadie más puede entrar como dueño.
                Elige un PIN de al menos 6 números (no sirve 000000).
            </p>
            <div className="space-y-3">
                <input type="password" inputMode="numeric" autoComplete="new-password" autoFocus placeholder="PIN nuevo"
                    value={pin} onChange={e => { setPin(onlyDigits(e.target.value)); setError(''); }} className={PIN_INPUT} data-testid="admin-pin-new" />
                <input type="password" inputMode="numeric" autoComplete="new-password" placeholder="Repite el PIN"
                    value={confirm} onChange={e => { setConfirm(onlyDigits(e.target.value)); setError(''); }}
                    onKeyDown={e => { if (e.key === 'Enter') handleSave(); }} className={PIN_INPUT} data-testid="admin-pin-confirm" />
                {error && <p role="alert" className="text-xs font-bold text-rose-600 dark:text-rose-400">{error}</p>}
            </div>
            <div className="flex gap-2 mt-5">
                <button type="button" onClick={onClose} className="flex-1 py-3 min-h-[48px] rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold text-sm active:scale-[0.98]">Cancelar</button>
                <button type="button" onClick={handleSave} disabled={saving} data-testid="admin-pin-save" className="flex-1 py-3 min-h-[48px] rounded-xl bg-brand hover:bg-brand-dark text-white font-bold text-sm active:scale-[0.98] disabled:opacity-60">
                    {saving ? 'Guardando…' : 'Guardar PIN'}
                </button>
            </div>
        </Modal>
    );
}

export default function SettingsTabUsuarios({
    requireLogin, setRequireLogin,
    autoLockMinutes, setAutoLockMinutes,
    showToast, triggerHaptic,
}) {
    const usuarios = useAuthStore(s => s.usuarios);
    const unprotected = adminsWithoutPin(usuarios);
    // Admin al que se le está pidiendo el PIN y si al terminar hay que activar la pantalla de inicio.
    const [pinFor, setPinFor] = useState(null);

    const activateLogin = () => {
        if (setRequireLogin) setRequireLogin(true);
        showToast('Pantalla de inicio activada', 'success');
    };

    const handleToggleLogin = () => {
        triggerHaptic?.();
        if (requireLogin) {
            if (setRequireLogin) setRequireLogin(false);
            showToast('Pantalla de inicio desactivada', 'success');
            return;
        }
        // Antes de activar: el Administrador debe tener PIN propio.
        if (unprotected.length > 0) {
            setPinFor({ admin: unprotected[0], activate: true });
            return;
        }
        activateLogin();
    };

    const handlePinDone = () => {
        const { activate } = pinFor;
        setPinFor(null);
        // Si quedan más administradores sin PIN, se sigue con el siguiente.
        const rest = adminsWithoutPin(useAuthStore.getState().usuarios);
        if (rest.length > 0) { setPinFor({ admin: rest[0], activate }); return; }
        if (activate) activateLogin();
        else showToast('PIN del Administrador guardado', 'success');
    };

    return (
        <div className="cq-grid items-start">
            {requireLogin && unprotected.length > 0 && (
                <div className="col-span-full flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-2xl border border-rose-200 dark:border-rose-800/50 bg-rose-50 dark:bg-rose-950/30" role="alert" data-testid="admin-sin-pin-aviso">
                    <ShieldAlert size={22} className="text-rose-600 dark:text-rose-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-black text-rose-700 dark:text-rose-300">El Administrador entra sin PIN</p>
                        <p className="text-xs text-rose-600/90 dark:text-rose-400/90 mt-0.5">Cualquiera que toque su tarjeta en la pantalla de inicio entra como dueño. Crea su PIN ahora.</p>
                    </div>
                    <button type="button" onClick={() => { triggerHaptic?.(); setPinFor({ admin: unprotected[0], activate: false }); }}
                        className="shrink-0 px-4 py-2.5 min-h-[44px] rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-black active:scale-95">
                        Crear PIN
                    </button>
                </div>
            )}

            <div className="col-span-full">
                <SectionCard icon={Users} title="Usuarios y Roles" subtitle="Gestiona roles y configura el PIN de cada usuario" iconColor="text-brand">
                    <UsersManager triggerHaptic={triggerHaptic} />
                </SectionCard>
            </div>

            <div className="col-span-full">
                <SectionCard icon={Lock} title="Seguridad Global" subtitle="Configuración general de acceso" iconColor="text-rose-500">
                    {/* Toggle login requerido */}
                    <div className="flex items-center justify-between gap-3 mb-4 border-b border-slate-100 dark:border-slate-800 pb-4">
                        <div className="min-w-0">
                            <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Pantalla de Inicio de Sesión</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Si se desactiva, la app entrará directo sin solicitar selección de usuario. Al activarla, el Administrador debe tener PIN.</p>
                        </div>
                        <Toggle enabled={requireLogin} color="rose" onChange={handleToggleLogin} />
                    </div>

                    {/* Bloqueo automático */}
                    {requireLogin && (
                        <div>
                            <label className="text-[11px] uppercase tracking-wider font-extrabold text-slate-500 dark:text-slate-400 block mb-1.5">Bloqueo Automático</label>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">Tu sesión se bloqueará tras estos minutos de inactividad.</p>
                            <div className="grid grid-cols-4 gap-2 max-w-sm">
                                {[
                                    { val: '1', label: '1 min' },
                                    { val: '3', label: '3 min' },
                                    { val: '5', label: '5 min' },
                                    { val: '10', label: '10 min' }
                                ].map(opt => (
                                    <button
                                        key={opt.val}
                                        onClick={() => {
                                            setAutoLockMinutes(opt.val);
                                            localStorage.setItem('admin_auto_lock_minutes', opt.val);
                                            triggerHaptic?.();
                                        }}
                                        className={`py-2.5 min-h-[44px] text-xs font-bold rounded-xl transition-all border ${autoLockMinutes === opt.val
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

            {pinFor && (
                <AdminPinModal admin={pinFor.admin} onClose={() => setPinFor(null)} onDone={handlePinDone} />
            )}
        </div>
    );
}
