import { useEffect } from 'react';
import { supabase } from '../core/supabaseClient';
import { sendDeviceHeartbeat } from '../services/deviceHeartbeat';
import { graceMillisFor, remainingDays } from '../config/licensePolicy';

const PRODUCT_ID = 'bodega';

/**
 * Consultas seguidas que deben confirmar que la fila de licencia NO existe
 * antes de quitar el acceso (licencia borrada en la Estación). Con el latido de
 * 3 min son ~6 min: tolera una respuesta suelta rara sin dejar la caja premium
 * para siempre.
 */
export const MISSING_LICENSE_LIMIT = 3;

// Module scope: cache subscriptions when multiple hooks are mounted in parallel

/**
 * Hook that handles heartbeat sending, license status verification,
 * and real-time subscription for license changes.
 *
 * SEC-001/SEC-007: Ya NO minteamos tokens XOR legacy en localStorage.
 * La fuente de verdad es la fila `licenses` en el servidor. Solo actualizamos
 * el estado React (via callbacks) cuando el backend confirma el cambio.
 */
export function useLicenseMonitoring({
    deviceId,
    isPremium,
    isDemo,
    onRevoked,
    onPermanentActivated,
    onDemoActivated,
    onMonthlyActivated,
}) {
    useEffect(() => {
        if (!deviceId || !import.meta.env.VITE_SUPABASE_URL) return;

        const revoke = (message) => {
            localStorage.removeItem('pda_premium_token');
            localStorage.removeItem('pda_license_cache');
            onRevoked(message);
        };

        // Respuestas seguidas que confirmaron que la fila no existe.
        let missingCount = 0;

        const verifyStatus = async () => {
            try {
                let license = null;
                // «No existe» solo cuenta si el RPC (SECURITY DEFINER, ve la fila
                // aunque RLS la oculte) y el SELECT responden sin error y vacíos.
                // Un error o una excepción nunca cuentan: sin red no se quita nada.
                let rpcConfirmedEmpty = false;
                try {
                    const { data, error: rpcErr } = await supabase.rpc('get_license_status', { p_device_id: deviceId });
                    if (!rpcErr) {
                        const record = Array.isArray(data) ? data[0] : data;
                        if (record) {
                            license = record;
                        } else {
                            rpcConfirmedEmpty = true;
                        }
                    }
                } catch (rpcEx) {
                    // Silencioso
                }

                if (!license) {
                    const { data, error } = await supabase
                        .from('licenses')
                        .select('type, is_active, expires_at, created_at')
                        .eq('device_id', deviceId)
                        .eq('product_id', PRODUCT_ID)
                        .maybeSingle();
                    license = data;

                    if (!license) {
                        if (rpcConfirmedEmpty && !error) {
                            missingCount++;
                            if (missingCount >= MISSING_LICENSE_LIMIT && isPremium) {
                                missingCount = 0;
                                revoke("No encontramos la licencia de este equipo. Contacta al administrador.");
                            }
                        }
                        return;
                    }
                }
                missingCount = 0;

                if (license && (license.is_active === false || license.type === 'revoked') && isPremium) {
                    localStorage.removeItem('pda_premium_token');
                    localStorage.removeItem('pda_license_cache');
                    onRevoked("Tu licencia ha sido desactivada. Contacta al administrador.");
                } else if (license && license.is_active === true) {
                    // Verificar si demo venció por fecha
                    if ((license.type === 'demo7' || license.type === 'demo3') && license.expires_at) {
                        const expiresAt = new Date(license.expires_at).getTime();
                        if (Date.now() >= expiresAt && isPremium) {
                            localStorage.removeItem('pda_premium_token');
                            localStorage.removeItem('pda_license_cache');
                            onRevoked("Tu licencia temporal ha finalizado. Esperamos que hayas disfrutado la experiencia completa.");
                            return;
                        }
                    }

                    // Verificar si mensual venció por fecha, incluida la gracia.
                    // La gracia la decide licensePolicy.js (5 días, solo mensual).
                    if (license.type === 'monthly' && license.expires_at) {
                        const expiresAt = new Date(license.expires_at).getTime();
                        const gracePeriodEnd = expiresAt + graceMillisFor('monthly');
                        if (Date.now() >= gracePeriodEnd && isPremium) {
                            localStorage.removeItem('pda_premium_token');
                            localStorage.removeItem('pda_license_cache');
                            onRevoked("Tu suscripción mensual ha expirado y el período de gracia de 5 días ha finalizado. Por favor, regulariza tu pago.");
                            return;
                        }
                    }

                    // Permanente con vencimiento: licensePolicy.js lo respeta sin gracia.
                    if (license.type === 'permanent' && license.expires_at) {
                        const expiresAt = new Date(license.expires_at).getTime();
                        if (Date.now() >= expiresAt && isPremium) {
                            revoke("Tu licencia ha vencido. Contacta al administrador.");
                            return;
                        }
                    }

                    // Sincronizar cache offline
                    const expiresAt = license.expires_at ? new Date(license.expires_at).getTime() : null;
                    localStorage.setItem('pda_license_cache', JSON.stringify({
                        type: license.type,
                        isActive: true,
                        expiresAt: expiresAt,
                        createdAt: license.created_at,
                        deviceId: deviceId,
                        updatedAt: Date.now()
                    }));

                    // Si el backend cambió el tipo de licencia, actualizar estado local.
                    // SEC-001: NO creamos tokens XOR; solo actualizamos estado React.
                    if (license.type === 'permanent' && (!isPremium || isDemo)) {
                        onPermanentActivated();
                    } else if ((license.type === 'demo7' || license.type === 'demo3') && (!isPremium || !isDemo) && license.expires_at) {
                        const expiresAt = new Date(license.expires_at).getTime();
                        if (Date.now() < expiresAt) {
                            onDemoActivated(expiresAt);
                        }
                    } else if (license.type === 'monthly' && license.expires_at) {
                        const expiresAtValue = new Date(license.expires_at).getTime();
                        const gracePeriodEnd = expiresAtValue + graceMillisFor('monthly');
                        if (Date.now() < gracePeriodEnd) {
                            const isGrace = Date.now() >= expiresAtValue;
                            const graceDays = isGrace ? remainingDays(gracePeriodEnd, Date.now()) : 0;
                            if (onMonthlyActivated) {
                                onMonthlyActivated(expiresAtValue, isGrace, graceDays);
                            }
                        }
                    }
                }
            } catch (e) {
                if (import.meta.env?.DEV) {
                    console.warn('[LicenseMonitoring] verifyStatus falló:', e?.message ?? e);
                }
            }
        };

        const sendHeartbeat = async () => {
            verifyStatus();
            try {
                const clientName = localStorage.getItem('business_name') || localStorage.getItem('restaurant_name') || '';
                await sendDeviceHeartbeat(supabase, { deviceId, productId: PRODUCT_ID, clientName });
            } catch (e) {
                if (import.meta.env?.DEV) {
                    console.warn('[LicenseMonitoring] heartbeat falló:', e?.message ?? e);
                }
            }
        };

        sendHeartbeat();
        // Mantener el intervalo actual de presencia; se evita repetir auto_register_device.
        const heartbeatIntervalMs = 3 * 60 * 1000;
        const heartbeatInterval = setInterval(sendHeartbeat, heartbeatIntervalMs);

        const handleVisibility = () => {
            if (document.visibilityState === 'visible') verifyStatus();
        };
        document.addEventListener('visibilitychange', handleVisibility);

        // Egress F5: ya no hay canal Realtime `licenses_sync_`. La tabla
        // `licenses` nunca estuvo en la publicación `supabase_realtime` (el canal
        // no recibía nada) y no se agrega a propósito: el heartbeat la actualiza
        // seguido y cada cambio sería egress. El estado se verifica en cada
        // heartbeat (cada 3 min) y al volver a la pestaña.

        return () => {
            clearInterval(heartbeatInterval);
            document.removeEventListener('visibilitychange', handleVisibility);
        };
    }, [isPremium, isDemo, deviceId]);
}
