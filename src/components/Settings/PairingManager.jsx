import React, { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { supabaseCloud } from '../../config/supabaseCloud';
import { showToast } from '../Toast';
import { 
    QrCode, Trash2, KeyRound, Loader2, CheckCircle2, 
    Smartphone, ShieldAlert, RefreshCw, X 
} from 'lucide-react';

export default function PairingManager({ deviceId, triggerHaptic }) {
    const [pairingState, setPairingState] = useState('idle'); // 'idle', 'generating', 'show_qr', 'loading_status', 'paired'
    const [pairedDevice, setPairedDevice] = useState(null);
    const [token, setToken] = useState('');
    const [timeLeft, setTimeLeft] = useState(0);
    const [checkingStatus, setCheckingStatus] = useState(false);
    
    const canvasRef = useRef(null);
    const timerRef = useRef(null);
    const pollRef = useRef(null);

    // 1. Verificar estado de vinculación inicial
    const checkCurrentPairing = async () => {
        if (!supabaseCloud || !deviceId) return;
        setCheckingStatus(true);
        try {
            const { data, error } = await supabaseCloud
                .from('device_pairings')
                .select('*')
                .eq('primary_device_id', deviceId)
                .maybeSingle();

            if (error) throw error;

            if (data && data.monitor_device_id) {
                setPairedDevice(data.monitor_device_id);
                setPairingState('paired');
            } else {
                setPairedDevice(null);
                setPairingState('idle');
            }
        } catch (err) {
            console.warn('[PairingManager] Fallo al verificar vinculación:', err);
        } finally {
            setCheckingStatus(false);
        }
    };

    useEffect(() => {
        checkCurrentPairing();
        return () => {
            clearInterval(timerRef.current);
            clearInterval(pollRef.current);
        };
    }, [deviceId]);

    // 2. Iniciar generación de QR
    const handleGenerateQR = async () => {
        if (!supabaseCloud || !deviceId) {
            showToast('Sin conexión a la nube', 'error');
            return;
        }

        triggerHaptic?.();
        setPairingState('generating');

        try {
            const { data: generatedToken, error } = await supabaseCloud.rpc('generate_pairing_token', {
                p_device_id: deviceId
            });

            if (error) throw error;

            setToken(generatedToken);
            setPairingState('show_qr');
            setTimeLeft(300); // 5 minutos (300 segundos)

            // Temporizador de expiración
            clearInterval(timerRef.current);
            timerRef.current = setInterval(() => {
                setTimeLeft(prev => {
                    if (prev <= 1) {
                        clearInterval(timerRef.current);
                        clearInterval(pollRef.current);
                        setPairingState('idle');
                        setToken('');
                        showToast('El código QR ha expirado', 'warning');
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);

            // Polling para detectar cuando el monitor se vincule (cada 3 segundos)
            clearInterval(pollRef.current);
            pollRef.current = setInterval(async () => {
                try {
                    const { data, error: pollError } = await supabaseCloud
                        .from('device_pairings')
                        .select('monitor_device_id')
                        .eq('primary_device_id', deviceId)
                        .maybeSingle();

                    if (!pollError && data && data.monitor_device_id) {
                        clearInterval(timerRef.current);
                        clearInterval(pollRef.current);
                        triggerHaptic?.();
                        setPairedDevice(data.monitor_device_id);
                        setPairingState('paired');
                        showToast('¡Celular del supervisor vinculado con éxito!', 'success');
                    }
                } catch (e) {}
            }, 3000);

        } catch (err) {
            console.error('[PairingManager] Error generando token:', err);
            showToast('Error al generar el token QR', 'error');
            setPairingState('idle');
        }
    };

    // 3. Dibujar código QR en Canvas localmente
    useEffect(() => {
        if (pairingState === 'show_qr' && token && canvasRef.current) {
            QRCode.toCanvas(
                canvasRef.current, 
                token, 
                { 
                    width: 180, 
                    margin: 1.5,
                    color: {
                        dark: '#1e293b', // slate-800
                        light: '#ffffff'
                    }
                }, 
                (err) => {
                    if (err) console.error('[PairingManager] QR canvas error:', err);
                }
            );
        }
    }, [pairingState, token]);

    // 4. Cancelar emparejamiento / Cerrar QR
    const handleCancelPairing = () => {
        triggerHaptic?.();
        clearInterval(timerRef.current);
        clearInterval(pollRef.current);
        setPairingState('idle');
        setToken('');
    };

    // 5. Desvincular monitor
    const handleUnpair = async () => {
        if (!window.confirm('¿Seguro que deseas desvincular el celular del supervisor? Perderá el acceso de monitoreo.')) return;
        triggerHaptic?.();
        setCheckingStatus(true);

        try {
            const { error } = await supabaseCloud.rpc('unpair_monitor', {
                p_device_id: deviceId
            });

            if (error) throw error;

            setPairedDevice(null);
            setPairingState('idle');
            showToast('Dispositivo desvinculado con éxito', 'success');
        } catch (err) {
            console.error('[PairingManager] Error al desvincular:', err);
            showToast('Error al desvincular el dispositivo', 'error');
        } finally {
            setCheckingStatus(false);
        }
    };

    const formatTimeLeft = (sec) => {
        const min = Math.floor(sec / 60);
        const s = sec % 60;
        return `${min}:${s < 10 ? '0' : ''}${s}`;
    };

    return (
        <div className="space-y-4">
            {checkingStatus && pairingState !== 'show_qr' ? (
                <div className="p-6 flex justify-center text-slate-400 gap-2 items-center">
                    <Loader2 className="animate-spin text-emerald-500" size={20} />
                    <span className="text-xs font-bold">Verificando estado de enlace...</span>
                </div>
            ) : pairingState === 'paired' ? (
                /* Estado: Vinculado */
                <div className="space-y-4">
                    <div className="p-4 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-800/30 rounded-2xl flex gap-3 items-start">
                        <CheckCircle2 className="text-emerald-500 shrink-0 mt-0.5" size={20} />
                        <div>
                            <h4 className="text-sm font-black text-emerald-800 dark:text-emerald-400">Celular del supervisor vinculado</h4>
                            <p className="text-[11px] text-emerald-700 dark:text-emerald-500 leading-normal mt-1">
                                Un dispositivo externo tiene acceso en tiempo real a las estadísticas y el inventario del negocio en modo solo lectura.
                            </p>
                        </div>
                    </div>

                    <div className="bg-slate-50 dark:bg-slate-800/30 border border-slate-100 dark:border-slate-800 p-4 rounded-2xl flex flex-col gap-4">
                        <div className="flex items-center gap-3">
                            <Smartphone className="text-emerald-500" size={24} />
                            <div>
                                <span className="text-[9px] uppercase tracking-wider font-bold text-slate-400 block">Celular Conectado</span>
                                <span className="text-xs font-bold text-slate-700 dark:text-slate-200 block">
                                    Dispositivo en vivo (Modo Supervisor Activo)
                                </span>
                            </div>
                        </div>
                        
                        <button
                            onClick={handleUnpair}
                            className="w-full py-2.5 bg-rose-500 hover:bg-rose-600 text-white font-black text-xs rounded-xl flex items-center justify-center gap-2 shadow-md shadow-rose-500/15 active:scale-[0.97] transition-all"
                        >
                            <Trash2 size={14} />
                            <span>Desactivar Modo Supervisor (Desvincular)</span>
                        </button>
                    </div>
                </div>
            ) : pairingState === 'show_qr' ? (
                /* Estado: Mostrando QR */
                <div className="flex flex-col items-center justify-center p-6 border border-slate-200 dark:border-slate-700/50 rounded-3xl bg-slate-50/50 dark:bg-slate-900/10 space-y-4 relative">
                    <button 
                        onClick={handleCancelPairing}
                        className="absolute top-4 right-4 p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-800 transition-colors"
                    >
                        <X size={16} />
                    </button>

                    <div className="text-center space-y-1">
                        <h4 className="text-xs font-black text-slate-800 dark:text-white">Escanea para Vincular Celular</h4>
                        <p className="text-[10px] text-slate-400 font-bold">
                            Abre la app en el celular del supervisor, ve a "Modo Supervisor" y escanea.
                        </p>
                    </div>

                    {/* Contenedor del QR */}
                    <div className="p-3 bg-white border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm">
                        <canvas ref={canvasRef}></canvas>
                    </div>

                    {/* Código de Respaldo */}
                    <button 
                        onClick={() => {
                            if (!token) return;
                            navigator.clipboard.writeText(token);
                            triggerHaptic?.();
                            showToast('Código manual copiado', 'success');
                        }}
                        className="text-center space-y-1 hover:opacity-80 active:scale-95 transition-all group focus:outline-none block mx-auto"
                        title="Hacer clic para copiar"
                    >
                        <span className="text-[9px] uppercase tracking-wider font-black text-slate-400 group-hover:text-emerald-500 transition-colors flex items-center justify-center gap-1.5">
                            Código Manual
                            <span className="text-[8px] bg-slate-100 dark:bg-slate-800 text-slate-400 group-hover:bg-emerald-500/10 group-hover:text-emerald-500 px-1.5 py-0.5 rounded font-bold uppercase transition-all">Copiar</span>
                        </span>
                        <div className="text-2xl font-black tracking-widest text-slate-800 dark:text-white font-outfit select-all group-hover:text-emerald-500 transition-colors">
                            {token}
                        </div>
                    </button>

                    <div className="text-[10px] text-slate-400 font-bold flex items-center gap-1.5">
                        <RefreshCw className="animate-spin text-emerald-500 shrink-0" size={10} />
                        <span>Esperando escaneo... Expira en {formatTimeLeft(timeLeft)}</span>
                    </div>
                </div>
            ) : (
                /* Estado: Idle / Generar QR */
                <div className="space-y-4">
                    <div className="p-4 bg-slate-50 dark:bg-slate-800/30 border border-slate-100 dark:border-slate-800 rounded-2xl flex gap-3 items-start">
                        <QrCode className="text-slate-400 shrink-0 mt-0.5" size={20} />
                        <div>
                            <h4 className="text-xs font-black text-slate-700 dark:text-slate-200">Monitoreo Remoto por QR</h4>
                            <p className="text-[10px] text-slate-400 leading-normal mt-1">
                                Vincula el teléfono del supervisor para ver las ventas y productos en vivo. <strong>Nota: Requiere conexión a internet activa en ambos dispositivos.</strong>
                            </p>
                        </div>
                    </div>

                    <button
                        onClick={handleGenerateQR}
                        disabled={pairingState === 'generating'}
                        className="w-full py-3.5 bg-emerald-500 hover:bg-emerald-600 text-white font-black text-xs rounded-2xl flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/25 disabled:opacity-50 disabled:shadow-none transition-all"
                    >
                        {pairingState === 'generating' ? (
                            <>
                                <Loader2 className="animate-spin" size={16} />
                                <span>Generando código QR...</span>
                            </>
                        ) : (
                            <>
                                <QrCode size={16} />
                                <span>Vincular Celular del Supervisor</span>
                            </>
                        )}
                    </button>
                </div>
            )}
        </div>
    );
}
