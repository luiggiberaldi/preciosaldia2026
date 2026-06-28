import React, { useState, useEffect, useRef } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { supabaseCloud } from '../config/supabaseCloud';
import { showToast } from './Toast';
import { ArrowLeft, Camera, ShieldAlert, KeyRound, Loader2, ArrowRight } from 'lucide-react';

export default function PairingScanScreen({ onCancel, triggerHaptic }) {
    const [scanMethod, setScanMethod] = useState('camera'); // 'camera' o 'manual'
    const [manualCode, setManualCode] = useState('');
    const [loading, setLoading] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');
    const scannerRef = useRef(null);

    // Detección de cámara y render de html5-qrcode
    useEffect(() => {
        if (scanMethod !== 'camera') {
            if (scannerRef.current) {
                scannerRef.current.clear().catch(() => {});
                scannerRef.current = null;
            }
            return;
        }

        // Crear una instancia de scanner
        const html5QrcodeScanner = new Html5QrcodeScanner(
            'qr-reader-container', 
            { 
                fps: 10, 
                qrbox: { width: 250, height: 250 },
                aspectRatio: 1.0
            },
            /* verbose= */ false
        );

        const onScanSuccess = async (decodedText) => {
            if (loading) return;
            triggerHaptic?.();
            
            // Detener scanner temporalmente
            html5QrcodeScanner.pause();
            
            const cleanToken = decodedText.trim().toUpperCase();
            if (cleanToken.length === 6) {
                await executePairing(cleanToken);
            } else {
                showToast('Formato de código QR inválido', 'error');
                html5QrcodeScanner.resume();
            }
        };

        const onScanFailure = (error) => {
            // Fails silenciosos de lectura (normal durante el escaneo continuo)
        };

        html5QrcodeScanner.render(onScanSuccess, onScanFailure);
        scannerRef.current = html5QrcodeScanner;

        return () => {
            if (scannerRef.current) {
                scannerRef.current.clear().catch(() => {});
                scannerRef.current = null;
            }
        };
    }, [scanMethod]);

    // Ejecutar el emparejamiento con el token
    const executePairing = async (token) => {
        if (!supabaseCloud) {
            showToast('Sin conexión a la nube', 'error');
            return;
        }

        setLoading(true);
        setErrorMsg('');

        try {
            // Obtener el device_id local para registrarlo como monitor
            let monitorId = localStorage.getItem('pda_device_id');
            if (!monitorId) {
                // Generar uno de respaldo si por algún motivo no existe
                monitorId = 'mon_' + Math.random().toString(36).substring(2, 15);
                localStorage.setItem('pda_device_id', monitorId);
            }

            // Llamar al RPC en Supabase
            const { data, error } = await supabaseCloud.rpc('pair_monitor_device', {
                p_token: token.trim().toUpperCase(),
                p_monitor_device_id: monitorId
            });

            if (error) throw error;

            if (data && data.success) {
                // Éxito: Guardar credenciales de emparejamiento
                localStorage.setItem('pda_paired_device_id', data.primary_device_id);
                localStorage.setItem('pda_pairing_mode', 'monitor');
                showToast('¡Vinculado con éxito! Cargando monitor...', 'success');
                
                // Forzar reinicio de la app para cargar la nueva vista limpia
                setTimeout(() => {
                    window.location.reload();
                }, 1500);
            } else {
                setErrorMsg(data?.message || 'Error desconocido al vincular.');
                if (scannerRef.current) scannerRef.current.resume();
            }
        } catch (err) {
            console.error('[PairingScanScreen] Error al vincular:', err);
            setErrorMsg(err.message || 'Error de conexión con el servidor.');
            if (scannerRef.current) scannerRef.current.resume();
        } finally {
            setLoading(false);
        }
    };

    const handleManualSubmit = (e) => {
        e.preventDefault();
        if (manualCode.length !== 6) {
            setErrorMsg('El código debe tener exactamente 6 caracteres.');
            return;
        }
        executePairing(manualCode);
    };

    return (
        <div className="fixed inset-0 z-[300] bg-slate-50 dark:bg-slate-950 flex flex-col justify-between p-6 overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between w-full max-w-md mx-auto">
                <button 
                    onClick={onCancel}
                    className="p-2.5 rounded-2xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-900 border border-slate-200 dark:border-slate-800 transition-colors"
                >
                    <ArrowLeft size={18} />
                </button>
                <span className="text-xs font-black uppercase tracking-wider text-slate-400">Modo Supervisor</span>
                <div className="w-10"></div>
            </div>

            {/* Centro */}
            <div className="flex-1 flex flex-col items-center justify-center max-w-md w-full mx-auto my-8 space-y-6">
                <div className="text-center space-y-2">
                    <h2 className="text-2xl font-black text-slate-800 dark:text-white">Conectar a mi caja</h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 px-4 leading-relaxed">
                        Escanea el código QR desde la pantalla de la caja de tu negocio para sincronizar los datos en tiempo real.
                    </p>
                </div>

                {/* Tabs de Selección de Método */}
                <div className="flex bg-slate-100 dark:bg-slate-900 p-1 rounded-2xl w-full">
                    <button
                        onClick={() => { triggerHaptic?.(); setScanMethod('camera'); setErrorMsg(''); }}
                        className={`flex-1 py-2 text-xs font-black rounded-xl transition-all duration-300 ${
                            scanMethod === 'camera' 
                                ? 'bg-white dark:bg-slate-800 text-slate-800 dark:text-white shadow-sm' 
                                : 'text-slate-400 hover:text-slate-600'
                        }`}
                    >
                        Escanear QR
                    </button>
                    <button
                        onClick={() => { triggerHaptic?.(); setScanMethod('manual'); setErrorMsg(''); }}
                        className={`flex-1 py-2 text-xs font-black rounded-xl transition-all duration-300 ${
                            scanMethod === 'manual' 
                                ? 'bg-white dark:bg-slate-800 text-slate-800 dark:text-white shadow-sm' 
                                : 'text-slate-400 hover:text-slate-600'
                        }`}
                    >
                        Código de 6 letras
                    </button>
                </div>

                {/* Área de Cámara */}
                {scanMethod === 'camera' && (
                    <div className="w-full aspect-square bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl overflow-hidden flex flex-col justify-center items-center relative group">
                        {loading && (
                            <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm z-10 flex flex-col justify-center items-center text-white gap-2">
                                <Loader2 className="animate-spin text-emerald-400" size={32} />
                                <span className="text-xs font-black">Vinculando...</span>
                            </div>
                        )}
                        <div id="qr-reader-container" className="w-full h-full"></div>
                    </div>
                )}

                {/* Área Manual */}
                {scanMethod === 'manual' && (
                    <form onSubmit={handleManualSubmit} className="w-full bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 p-6 rounded-3xl shadow-sm space-y-4">
                        <div className="space-y-1">
                            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Código de vinculación</label>
                            <input 
                                type="text"
                                maxLength={6}
                                value={manualCode}
                                onChange={(e) => setManualCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                                placeholder="Escribe el código de 6 letras"
                                className={`w-full py-3.5 px-4 border border-slate-200 dark:border-slate-700/60 dark:bg-slate-800 rounded-2xl text-center focus:outline-none focus:border-emerald-500 transition-all ${
                                    manualCode 
                                        ? 'text-xl font-black uppercase tracking-widest text-slate-800 dark:text-white' 
                                        : 'text-xs font-bold text-slate-400 placeholder-slate-400'
                                }`}
                                disabled={loading}
                            />
                        </div>

                        <button 
                            type="submit" 
                            disabled={loading || manualCode.length !== 6}
                            className="w-full py-3.5 bg-emerald-500 hover:bg-emerald-600 text-white font-black text-xs rounded-2xl flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/25 disabled:opacity-50 disabled:shadow-none transition-all"
                        >
                            {loading ? (
                                <>
                                    <Loader2 className="animate-spin" size={16} />
                                    <span>Vinculando...</span>
                                </>
                            ) : (
                                <>
                                    <span>Vincular Dispositivo</span>
                                    <ArrowRight size={16} />
                                </>
                            )}
                        </button>
                    </form>
                )}

                {/* Mensaje de Error */}
                {errorMsg && (
                    <div className="p-4 bg-rose-50 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-800/30 rounded-2xl flex gap-3 items-start w-full">
                        <ShieldAlert className="text-rose-500 shrink-0 mt-0.5" size={18} />
                        <div className="text-[11px] font-semibold text-rose-700 dark:text-rose-400 leading-normal">
                            {errorMsg}
                        </div>
                    </div>
                )}
            </div>

            {/* Footer */}
            <div className="text-center max-w-xs mx-auto">
                <p className="text-[10px] text-slate-400 leading-relaxed font-medium">
                    El código de vinculación de 6 letras se muestra en el dispositivo principal debajo del código QR de emparejamiento.
                </p>
            </div>
        </div>
    );
}
