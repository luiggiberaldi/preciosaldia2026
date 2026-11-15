import React, { useState, useEffect, useRef } from 'react';
import { Loader2, Rocket, ShoppingCart, Package, Receipt, Zap, Banknote, Home, Settings, BarChart3, ShieldCheck, Sparkles } from 'lucide-react';
import { RELEASE_NOTES } from '../data/releaseNotes';
import {
    notasPendientes,
    formatearFecha,
    leerUltimaVersionVista,
    guardarUltimaVersionVista,
    versionDesdeNovedades,
    instalacionEnUso,
} from '../utils/releaseNotes';

// Nombre (texto) -> ícono. Las notas llegan como JSON, por eso se guardan por nombre.
const ICONOS = { carrito: ShoppingCart, paquete: Package, factura: Receipt, rayo: Zap, dinero: Banknote, inicio: Home, ajustes: Settings, grafico: BarChart3, escudo: ShieldCheck, estrella: Sparkles };

const CURRENT_VERSION = import.meta.env.VITE_APP_VERSION || '0.0.0';

/**
 * Aviso de actualización con novedades (A-001/B-003).
 *  - Modo "actualización": hay una versión nueva esperando. Muestra qué trae
 *    (pide /release-notes.json sin caché, porque esta versión aún no la conoce)
 *    y deja al cajero elegir cuándo aplicarla sin perder una venta en curso.
 *  - Modo "novedades": ya se actualizó y no ha visto las notas → se muestran una sola vez.
 */
export function UpdateBanner() {
    const [updateReady, setUpdateReady] = useState(false);
    const [isUpdating, setIsUpdating] = useState(false);
    const [dismissed, setDismissed] = useState(false);
    const [remoteNotes, setRemoteNotes] = useState(null);
    const [showOlder, setShowOlder] = useState(false);
    const [whatsNew, setWhatsNew] = useState(() => {
        const desde = versionDesdeNovedades(leerUltimaVersionVista(), instalacionEnUso());
        if (!desde) { guardarUltimaVersionVista(CURRENT_VERSION); return []; }
        return notasPendientes(RELEASE_NOTES, desde, CURRENT_VERSION);
    });
    const fetched = useRef(false);

    useEffect(() => {
        const handleUpdateAvailable = () => setUpdateReady(true);
        // main.jsx puede detectar el SW antes de que React monte este componente.
        // Consultar también la marca persistente evita perder la actualización.
        if (window.__pdaSwUpdateAvailable) setUpdateReady(true);
        window.addEventListener('sw-update-available', handleUpdateAvailable);
        return () => window.removeEventListener('sw-update-available', handleUpdateAvailable);
    }, []);

    useEffect(() => {
        if (!updateReady || fetched.current) return;
        fetched.current = true;
        fetch('/release-notes.json', { cache: 'no-store' })
            .then((r) => (r.ok ? r.json() : []))
            .then((json) => setRemoteNotes(Array.isArray(json) ? json : []))
            .catch(() => setRemoteNotes([])); // sin internet: el aviso sale igual, sin notas
    }, [updateReady]);

    const updateNotes = updateReady ? notasPendientes(remoteNotes, CURRENT_VERSION) : [];
    const notes = updateReady ? updateNotes : whatsNew;
    const visible = !dismissed && (updateReady || whatsNew.length > 0);

    const closeWhatsNew = () => {
        guardarUltimaVersionVista(CURRENT_VERSION);
        setWhatsNew([]);
    };

    const applyUpdate = async () => {
        if (isUpdating) return;
        setIsUpdating(true);
        // Ya vio estas notas: tras recargar no se repiten como "novedades".
        if (updateNotes[0]) guardarUltimaVersionVista(updateNotes[0].version);

        try {
            // 1. Si vite-plugin-pwa nos proveyó la función de update oficial:
            if (typeof window.__pdaUpdateSW === 'function') {
                await window.__pdaUpdateSW(true);
                return;
            }

            // 2. Fallback estándar para Service Worker nativo:
            if ('serviceWorker' in navigator) {
                const reg = await navigator.serviceWorker.getRegistration();
                if (reg && reg.waiting) {
                    let refreshing = false;
                    navigator.serviceWorker.addEventListener('controllerchange', () => {
                        if (!refreshing) {
                            refreshing = true;
                            window.location.reload();
                        }
                    });

                    reg.waiting.postMessage({ type: 'SKIP_WAITING' });

                    // Respaldo de seguridad por si controllerchange tarda
                    setTimeout(() => {
                        if (!refreshing) {
                            refreshing = true;
                            window.location.reload();
                        }
                    }, 1200);
                    return;
                }
            }

            window.location.reload();
        } catch (err) {
            console.error('[UpdateBanner] Error al aplicar actualización:', err);
            window.location.reload();
        }
    };

    if (!visible) return null;

    const [latest, ...older] = notes;
    const onLater = () => (updateReady ? setDismissed(true) : closeWhatsNew());

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="update-modal-title"
            data-testid="update-modal"
            className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-slate-950/55 backdrop-blur-sm"
        >
            <div
                style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}
                className="w-full sm:max-w-md max-h-[90dvh] overflow-y-auto bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 rounded-t-3xl sm:rounded-3xl shadow-2xl px-5 pt-5 sm:p-6"
            >
                <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-2xl bg-teal-600 text-white grid place-items-center shrink-0"><Rocket size={22} strokeWidth={2.2} /></div>
                    <div className="min-w-0">
                        <h2 id="update-modal-title" className="font-black text-lg leading-tight">
                            {updateReady ? 'Nueva actualización disponible' : '¡Ya tienes lo nuevo!'}
                        </h2>
                        {latest && (
                            <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-slate-500 dark:text-slate-400">
                                <span className="font-bold px-2 py-0.5 rounded-full bg-teal-100 text-teal-800 dark:bg-teal-500/15 dark:text-teal-300">Versión {latest.version}</span>
                                <span>{formatearFecha(latest.fecha)}</span>
                            </div>
                        )}
                    </div>
                </div>

                {latest ? (
                    <div className="mt-4">
                        <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">Qué hay de nuevo</h3>
                        <ul className="grid gap-2">
                            {latest.mejoras.slice(0, 4).map((m) => {
                                const Icono = ICONOS[m.icono] || Sparkles;
                                return (
                                <li key={m.titulo} className="flex gap-3 items-start p-3 rounded-2xl border border-slate-200 dark:border-slate-800">
                                    <span className="w-8 h-8 rounded-xl bg-teal-100 dark:bg-teal-500/15 grid place-items-center shrink-0 text-teal-700 dark:text-teal-300"><Icono size={17} strokeWidth={2.2} /></span>
                                    <span className="text-sm leading-snug">
                                        <b className="block">{m.titulo}</b>
                                        <span className="text-slate-500 dark:text-slate-400">{m.texto}</span>
                                    </span>
                                </li>
                            );})}
                        </ul>
                        {older.length > 0 && (
                            <div className="mt-3 pt-3 border-t border-dashed border-slate-200 dark:border-slate-800 text-sm text-slate-500 dark:text-slate-400">
                                {!showOlder ? (
                                    <button type="button" onClick={() => setShowOlder(true)} className="underline font-semibold">
                                        Ver también lo de {older.length === 1 ? 'la versión' : 'las versiones'} {older.map((o) => o.version).join(', ')}
                                    </button>
                                ) : (
                                    older.map((o) => (
                                        <p key={o.version} className="mb-1">
                                            <b className="text-slate-700 dark:text-slate-200">Versión {o.version}:</b>{' '}
                                            {o.mejoras.slice(0, 4).map((m) => m.titulo).join(' · ')}
                                        </p>
                                    ))
                                )}
                            </div>
                        )}
                    </div>
                ) : (
                    <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">Hay una versión nueva de Precios Al Día con mejoras y arreglos.</p>
                )}

                <div className="flex gap-2.5 mt-5">
                    <button
                        disabled={isUpdating}
                        onClick={onLater}
                        className="flex-1 min-h-11 rounded-2xl border border-slate-200 dark:border-slate-700 font-bold text-sm disabled:opacity-50"
                    >
                        {updateReady ? 'Después' : 'Entendido'}
                    </button>
                    {updateReady && (
                        <button
                            disabled={isUpdating}
                            onClick={applyUpdate}
                            className="flex-[1.4] min-h-11 rounded-2xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-sm flex items-center justify-center gap-1.5 disabled:opacity-80"
                        >
                            {isUpdating ? (<><Loader2 size={14} className="animate-spin" /><span>Actualizando...</span></>) : <span>Actualizar ahora</span>}
                        </button>
                    )}
                </div>
                {updateReady && <p className="text-[11px] text-center text-slate-500 dark:text-slate-400 mt-2.5">La app se reinicia en unos segundos. No pierdes tus datos.</p>}
            </div>
        </div>
    );
}

export default UpdateBanner;
