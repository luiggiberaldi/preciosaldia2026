import { useState } from 'react';
import { ShieldCheck, Link2, Loader2 } from 'lucide-react';
import { showToast } from '../Toast';
import { claimDeviceCredential } from '../../utils/backupRelay';
import { hasDeviceCredential } from '../../utils/estacionCredential';

/**
 * Vinculación del respaldo de emergencia con la Estación (plan de fixeo F3).
 *
 * El admin genera un código de 8 caracteres en la Estación (Dispositivos →
 * «Vincular respaldo»). Aquí se escribe una vez y la caja queda con su propia
 * llave para la vía de emergencia de respaldos. El respaldo normal no depende
 * de esto.
 */
export default function EstacionBackupLink({ deviceId }) {
    const [linked, setLinked] = useState(() => hasDeviceCredential());
    const [code, setCode] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    async function handleLink() {
        if (!deviceId || busy) return;
        setBusy(true);
        setError('');
        const res = await claimDeviceCredential(deviceId, code);
        setBusy(false);
        if (res.ok) {
            setLinked(true);
            setCode('');
            showToast('Respaldo de emergencia vinculado', 'success');
        } else {
            setError(res.error || 'No se pudo vincular.');
        }
    }

    if (linked) {
        return (
            <div className="flex items-center gap-3 p-3 min-h-[56px] bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800/40 rounded-xl">
                <div className="p-2 bg-emerald-100 dark:bg-emerald-900/40 rounded-lg"><ShieldCheck size={18} className="text-emerald-600" /></div>
                <div className="text-left flex-1 min-w-0">
                    <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Respaldo de emergencia vinculado</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">Si la nube no reconoce este equipo, la Estación guarda el respaldo por él.</p>
                </div>
                <button
                    type="button"
                    onClick={() => setLinked(false)}
                    className="text-[11px] font-bold text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 px-2"
                    title="Usar un código nuevo (p. ej. si la Estación te dio otro)"
                >
                    Cambiar
                </button>
            </div>
        );
    }

    return (
        <div className="p-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700 rounded-xl space-y-2">
            <div className="flex items-center gap-2">
                <Link2 size={16} className="text-sky-500" />
                <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Respaldo de emergencia</p>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
                Pide a soporte un <strong>código de vinculación</strong> y escríbelo aquí una sola vez.
            </p>
            <div className="flex gap-2">
                <input
                    type="text"
                    inputMode="text"
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    maxLength={9}
                    placeholder="ABCD-EFGH"
                    aria-label="Código de vinculación"
                    value={code}
                    onChange={(e) => { setCode(e.target.value.toUpperCase()); setError(''); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleLink(); }}
                    className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono text-sm tracking-widest text-slate-700 dark:text-slate-200 uppercase"
                />
                <button
                    type="button"
                    onClick={handleLink}
                    disabled={busy || code.replace(/[\s-]/g, '').length !== 8}
                    className="px-4 py-2 text-xs font-bold text-white bg-sky-500 hover:bg-sky-600 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 transition-all inline-flex items-center gap-1.5"
                >
                    {busy ? <Loader2 size={14} className="animate-spin" /> : null}
                    Vincular
                </button>
            </div>
            {error && <p className="text-[11px] font-bold text-red-600 dark:text-red-400" role="alert">{error}</p>}
        </div>
    );
}
