import React, { useState, useEffect, useRef } from 'react';
import {
    Database, Palette, Fingerprint, Upload, Download, Share2, Cloud,
    Check, ChevronRight, Trash2, AlertTriangle, FileText, ZoomIn, ZoomOut, RotateCcw, QrCode
} from 'lucide-react';
import { SectionCard } from '../../SettingsShared';
import { showToast } from '../../Toast';
import AuditLogViewer from '../AuditLogViewer';
import PairingManager from '../PairingManager';
import SystemHealthPanel from '../SystemHealthPanel';
import ConfirmModal from '../../ConfirmModal';
import QRCode from 'qrcode';
import { resetPOSDataToEmpty } from '../../../hooks/useCloudSync';
import { useSecurity } from '../../../hooks/useSecurity';

export default function SettingsTabSistema({
    theme, toggleTheme,
    deviceId, idCopied, setIdCopied,
    isAdmin,
    importStatus, statusMessage,
    handleExport, handleImportClick,
    handleSyncCloud,
    isLicensedCloud = true,
    dataConflictPending, handleDataConflictChoice,
    lastError, onDismissError,
    setIsShareOpen,
    setShowDeleteConfirm,
    triggerHaptic,
}) {
    const [uiScale, setUiScale] = useState(() => {
        const saved = parseInt(localStorage.getItem('ui_scale'));
        return saved >= 60 && saved <= 140 ? saved : 100;
    });
    const [fixingId, setFixingId] = useState(false);
    const [showIdFixConfirm, setShowIdFixConfirm] = useState(false);
    const { fixDuplicateDeviceId } = useSecurity();
    
    const qrCanvasRef = useRef(null);

    // Corrige dos equipos que comparten el mismo ID: esta estación obtiene uno
    // propio y único, conserva sus datos y registra la licencia desde el ID nuevo.
    const handleFixDuplicateId = async () => {
        if (fixingId) return;
        triggerHaptic?.();
        setFixingId(true);
        try {
            const newId = await fixDuplicateDeviceId();
            showToast(`ID único generado para esta estación: ${newId}`, 'success');
        } catch (err) {
            console.warn('[SettingsTabSistema] No se pudo generar ID único:', err);
            showToast('No se pudo generar un ID único para esta estación', 'error');
        } finally {
            setFixingId(false);
        }
    };

    useEffect(() => {
        if (deviceId && qrCanvasRef.current) {
            QRCode.toCanvas(
                qrCanvasRef.current,
                deviceId,
                {
                    width: 140,
                    margin: 1.5,
                    color: {
                        dark: '#1e293b', // slate-800
                        light: '#ffffff'
                    }
                },
                (err) => {
                    if (err) console.error('[SettingsTabSistema] Error dibujando QR de instalacion:', err);
                }
            );
        }
    }, [deviceId]);

    useEffect(() => {
        document.documentElement.style.zoom = `${uiScale}%`;
        localStorage.setItem('ui_scale', uiScale.toString());
    }, [uiScale]);

    const adjustScale = (delta) => {
        setUiScale(prev => {
            const next = Math.max(60, Math.min(140, prev + delta));
            triggerHaptic?.();
            return next;
        });
    };

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
            {/* Datos y Respaldo */}
            <SectionCard icon={Database} title="Datos y Respaldo" subtitle="Exportar, importar y compartir" iconColor="text-cyan-500">
                <div className="p-2.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800/30 rounded-xl flex gap-2.5">
                    <AlertTriangle size={18} className="text-amber-600 dark:text-amber-500 shrink-0 mt-0.5" />
                    <p className="text-[10px] text-amber-800 dark:text-amber-400 leading-relaxed font-bold">
                        PRECAUCION: Al restaurar un backup se sobrescribira por completo todo el historial de ventas, inventario, deudores y configuraciones de este dispositivo.
                    </p>
                </div>

                <div className="space-y-2">
                    <button onClick={handleExport} className="w-full flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors group active:scale-[0.98]">
                        <div className="p-2 bg-brand-light dark:bg-surface-800/30 rounded-lg"><Download size={18} className="text-brand" /></div>
                        <div className="text-left flex-1">
                            <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Exportar Backup</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">Descargar archivo .json</p>
                        </div>
                        <ChevronRight size={16} className="text-slate-300" />
                    </button>

                    <button onClick={handleImportClick} className="w-full flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors group active:scale-[0.98]">
                        <div className="p-2 bg-emerald-50 dark:bg-emerald-900/30 rounded-lg"><Upload size={18} className="text-emerald-500" /></div>
                        <div className="text-left flex-1">
                            <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Importar Backup</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">Restaurar desde archivo</p>
                        </div>
                        <ChevronRight size={16} className="text-slate-300" />
                    </button>

                    <button
                        onClick={() => {
                            if (!isLicensedCloud) {
                                showToast('La sincronización con la nube requiere licencia completa', 'error');
                                return;
                            }
                            handleSyncCloud?.();
                        }}
                        aria-disabled={!isLicensedCloud}
                        title={!isLicensedCloud ? 'Disponible con licencia permanente activa' : undefined}
                        className={`w-full flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700 rounded-xl transition-colors group active:scale-[0.98] ${isLicensedCloud ? 'hover:bg-slate-100 dark:hover:bg-slate-800' : 'opacity-50 cursor-not-allowed'}`}
                    >
                        <div className="p-2 bg-sky-50 dark:bg-sky-900/30 rounded-lg"><Cloud size={18} className="text-sky-500" /></div>
                        <div className="text-left flex-1">
                            <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Sincronizar con la Nube</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">Disponible solo con licencia permanente activa</p>
                        </div>
                        {!isLicensedCloud && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 uppercase tracking-wide">Solo permanente</span>
                        )}
                        <ChevronRight size={16} className="text-slate-300" />
                    </button>

                    <button onClick={() => setIsShareOpen(true)} className="w-full flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors group active:scale-[0.98]">
                        <div className="p-2 bg-brand-light dark:bg-surface-800/30 rounded-lg"><Share2 size={18} className="text-brand" /></div>
                        <div className="text-left flex-1">
                            <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Compartir Inventario</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">Codigo de 6 digitos, 24h</p>
                        </div>
                        <ChevronRight size={16} className="text-slate-300" />
                    </button>
                </div>

                    <button
                        onClick={async () => {
                            const ok = window.confirm('Se descartarán productos, ventas y clientes de ESTE equipo y se publicará un respaldo vacío en la nube. ¿Continuar?');
                            if (!ok) return;
                            try {
                                const result = await resetPOSDataToEmpty();
                                showToast(
                                    result.ok
                                        ? 'Equipo reiniciado: la nube quedó con estado vacío'
                                        : `No se pudo publicar el estado vacío: ${result.result?.error || 'error desconocido'}`,
                                    result.ok ? 'success' : 'error',
                                );
                            } catch (error) {
                                showToast(error?.message || 'No se pudieron reiniciar los datos', 'error');
                            }
                        }}
                        className="w-full flex items-center gap-3 p-3 bg-rose-50 dark:bg-rose-900/20 border border-rose-100 dark:border-rose-800/40 rounded-xl hover:bg-rose-100 dark:hover:bg-rose-900/30 transition-colors group active:scale-[0.98]"
                    >
                        <div className="p-2 bg-rose-100 dark:bg-rose-900/40 rounded-lg"><AlertTriangle size={18} className="text-rose-500" /></div>
                        <div className="text-left flex-1">
                            <p className="text-sm font-bold text-rose-700 dark:text-rose-300">Empezar desde cero</p>
                            <p className="text-xs text-rose-500 dark:text-rose-400">Vacía este equipo y publica el vacío en la nube</p>
                        </div>
                        <ChevronRight size={16} className="text-slate-300" />
                    </button>

                {lastError && (
                    <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 rounded-xl space-y-1.5" role="alert">
                        <div className="flex items-start justify-between gap-2">
                            <p className="text-xs font-bold text-red-700 dark:text-red-400 flex items-center gap-1.5">
                                <AlertTriangle size={14} className="shrink-0 mt-0.5" /> {lastError.title}
                            </p>
                            <button
                                onClick={onDismissError}
                                className="text-red-400 hover:text-red-600 dark:hover:text-red-300 text-xs font-bold px-1"
                                aria-label="Descartar error"
                            >
                                ✕
                            </button>
                        </div>
                        <p className="text-[11px] text-red-600 dark:text-red-500/90 leading-relaxed">{lastError.detail}</p>
                        <p className="text-[11px] text-red-700 dark:text-red-400 font-medium leading-relaxed">💡 {lastError.hint}</p>
                        {lastError.technical && (
                            <p className="text-[9px] text-red-400/70 font-mono break-all pt-1 border-t border-red-100 dark:border-red-800/30">
                                {lastError.technical}
                            </p>
                        )}
                    </div>
                )}

                {dataConflictPending && (
                    <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 rounded-xl space-y-2">
                        <p className="text-xs font-bold text-amber-800 dark:text-amber-400 flex items-center gap-1.5">
                            <AlertTriangle size={14} /> Conflicto de datos detectado
                        </p>
                        <p className="text-[11px] text-amber-700 dark:text-amber-500/90 leading-relaxed">
                            Hay datos tanto en este dispositivo como en la nube. Elige que version conservar:
                        </p>
                        <div className="flex gap-2">
                            <button
                                onClick={() => handleDataConflictChoice('cloud')}
                                className="flex-1 py-2.5 text-xs font-bold text-white bg-sky-500 hover:bg-sky-600 rounded-xl active:scale-95 transition-all"
                            >
                                Usar los de la Nube
                            </button>
                            <button
                                onClick={() => handleDataConflictChoice('local')}
                                className="flex-1 py-2.5 text-xs font-bold text-white bg-emerald-500 hover:bg-emerald-600 rounded-xl active:scale-95 transition-all"
                            >
                                Subir los de este Equipo
                            </button>
                        </div>
                    </div>
                )}

                {importStatus && (
                    <div className={`p-2.5 rounded-xl text-xs font-bold text-center flex items-center justify-center gap-2 ${importStatus === 'success' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'}`}>
                        {importStatus === 'success' ? <Check size={14} /> : <AlertTriangle size={14} />}
                        {statusMessage}
                    </div>
                )}
            </SectionCard>

            {/* Apariencia */}
            <SectionCard icon={Palette} title="Apariencia" subtitle="Estilo visual de la app" iconColor="text-pink-500">
                {/* Zoom / Escala de pantalla */}
                <div>
                    <div className="flex items-center gap-3 mb-3">
                        <ZoomIn size={18} className="text-brand" />
                        <div>
                            <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Tamaño de Pantalla</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Ajusta si la interfaz se ve muy grande o muy pequeña</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => adjustScale(-5)}
                            disabled={uiScale <= 60}
                            className="w-9 h-9 flex items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-brand-light hover:text-brand-dark dark:hover:bg-surface-800/20 dark:hover:text-brand transition-all active:scale-90 disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                            <ZoomOut size={16} />
                        </button>
                        <div className="flex-1 relative">
                            <input
                                type="range"
                                min="60"
                                max="140"
                                step="5"
                                value={uiScale}
                                onChange={e => { setUiScale(parseInt(e.target.value)); triggerHaptic?.(); }}
                                className="w-full h-2 rounded-full appearance-none cursor-pointer bg-slate-200 dark:bg-slate-700 accent-brand"
                            />
                            <div className="flex justify-between mt-1 px-0.5">
                                <span className="text-[9px] text-slate-500 dark:text-slate-400 font-medium">60%</span>
                                <span className="text-[9px] text-slate-500 dark:text-slate-400 font-medium">100%</span>
                                <span className="text-[9px] text-slate-500 dark:text-slate-400 font-medium">140%</span>
                            </div>
                        </div>
                        <button
                            onClick={() => adjustScale(5)}
                            disabled={uiScale >= 140}
                            className="w-9 h-9 flex items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-brand-light hover:text-brand-dark dark:hover:bg-surface-800/20 dark:hover:text-brand transition-all active:scale-90 disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                            <ZoomIn size={16} />
                        </button>
                    </div>
                    <div className="flex items-center justify-between mt-2">
                        <span className="text-xs font-black text-brand-dark dark:text-brand bg-brand-light dark:bg-surface-800/20 px-2.5 py-1 rounded-lg">{uiScale}%</span>
                        {uiScale !== 100 && (
                            <button
                                onClick={() => { setUiScale(100); triggerHaptic?.(); }}
                                className="text-xs font-bold text-slate-550 hover:text-brand flex items-center gap-1 transition-colors"
                            >
                                <RotateCcw size={12} /> Restablecer
                            </button>
                        )}
                    </div>
                </div>
            </SectionCard>

            {/* Dispositivo */}
            <SectionCard icon={Fingerprint} title="Dispositivo" subtitle="Informacion tecnica" iconColor="text-slate-500">
                <div className="flex flex-col items-center justify-center p-3 bg-white dark:bg-slate-950 rounded-2xl border border-slate-200/50 dark:border-slate-800/80 shadow-inner w-fit mx-auto mb-4">
                    <canvas ref={qrCanvasRef} className="w-[140px] h-[140px] rounded-lg" />
                </div>
                <div className="flex items-start justify-between gap-2 p-2.5 bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 rounded-xl">
                    <div className="min-w-0 flex-1">
                        <p className="text-[11px] uppercase tracking-wider font-extrabold text-slate-500 dark:text-slate-400 mb-1">ID de Instalacion</p>
                        <p className="font-mono text-xs font-black text-slate-700 dark:text-slate-200 select-all break-all leading-relaxed">{deviceId || '...'}</p>
                    </div>
                    <button
                        type="button"
                        onClick={() => {
                            if (!deviceId) return;
                            navigator.clipboard.writeText(deviceId).then(() => {
                                setIdCopied(true);
                                setTimeout(() => setIdCopied(false), 2000);
                            });
                        }}
                        className="shrink-0 p-2 rounded-lg text-slate-400 hover:text-teal-500 hover:bg-teal-50 dark:hover:bg-teal-900/20 transition-all mt-1"
                        title={idCopied ? '¡Copiado!' : 'Copiar ID completo'}
                        aria-label="Copiar ID de instalación"
                    >
                        {idCopied ? <Check size={14} className="text-emerald-500" /> : <Fingerprint size={14} />}
                    </button>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">Comparte este ID o escanea su código QR si necesitas soporte técnico o activación de licencia.</p>

                {/* Dos equipos con el mismo ID: separar esta estación */}
                <div className="mt-4 p-3 rounded-2xl border border-amber-200/70 dark:border-amber-800/40 bg-amber-50/50 dark:bg-amber-950/20">
                    <p className="text-[11px] font-bold text-amber-700 dark:text-amber-300">
                        ¿Dos equipos muestran el mismo ID? Genera uno propio y único para esta estación.
                    </p>
                    <button
                        onClick={() => { triggerHaptic?.(); setShowIdFixConfirm(true); }}
                        disabled={fixingId}
                        className="mt-2 w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white text-[11px] font-black uppercase tracking-wider transition-all"
                    >
                        <Fingerprint size={13} />
                        {fixingId ? 'Generando ID único…' : 'Generar ID único para esta estación'}
                    </button>
                    <p className="mt-1.5 text-[10px] text-amber-700/80 dark:text-amber-300/80">
                        No borra ventas, inventario ni la licencia actual; solo cambia el ID de esta estación.
                    </p>
                </div>
            </SectionCard>

            {/* Salud del sistema (Fase 3): reloj vs servidor, último comando y última sincronización */}
            <SystemHealthPanel triggerHaptic={triggerHaptic} />

            {/* Confirmación antes de cambiar el ID de la estación */}
            <ConfirmModal
                isOpen={showIdFixConfirm}
                onClose={() => setShowIdFixConfirm(false)}
                onConfirm={handleFixDuplicateId}
                variant="warning"
                title="¿Generar un ID nuevo para esta estación?"
                message={'Esta estación dejará de usar el ID actual y obtendrá uno propio y único.\n\nTus ventas, inventario y licencia no se borran: solo cambia el ID de esta estación.\n\nSi otra estación muestra el mismo ID, esa conserva el ID actual.'}
                confirmText="Sí, generar ID único"
                cancelText="Cancelar"
            />

            {/* Celular del Supervisor (QR Monitoreo) */}
            {isAdmin && (
                <div className="md:col-span-2 xl:col-span-3">
                    <SectionCard icon={QrCode} title="Celular del Supervisor" subtitle="Monitoreo remoto en tiempo real" iconColor="text-emerald-500">
                        <PairingManager deviceId={deviceId} triggerHaptic={triggerHaptic} />
                    </SectionCard>
                </div>
            )}

            {/* Zona de Peligro — Habilitado para Administradores */}
            {isAdmin && (
                <div className="md:col-span-2 xl:col-span-3">
                    <SectionCard icon={AlertTriangle} title="Zona de Peligro" subtitle="Acciones irreversibles" iconColor="text-red-500">
                        <div className="p-2.5 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800/30 rounded-xl mb-3">
                            <p className="text-xs text-red-750 dark:text-red-400 leading-relaxed font-bold">
                                Esta accion eliminara todo el historial de ventas y reportes estadisticos. El inventario NO sera afectado.
                            </p>
                        </div>
                        <button
                            onClick={() => setShowDeleteConfirm(true)}
                            className="w-full flex items-center gap-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/30 rounded-xl hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors group active:scale-[0.98]"
                        >
                            <div className="p-2 bg-red-100 dark:bg-red-900/40 rounded-lg"><Trash2 size={18} className="text-red-600 dark:text-red-400" /></div>
                            <div className="text-left flex-1">
                                <p className="text-sm font-bold text-red-700 dark:text-red-400">Borrar Historial de Ventas</p>
                                <p className="text-xs text-red-500/80 dark:text-red-400/80">El inventario no se borrara</p>
                            </div>
                        </button>
                    </SectionCard>
                </div>
            )}
        </div>
    );
}
