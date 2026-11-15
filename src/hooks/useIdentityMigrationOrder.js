/**
 * useIdentityMigrationOrder — revisa si esta instalación tiene un aviso de
 * cambio de ID (ver services/identityMigrationOrder.js).
 *
 * Una consulta pequeña al abrir (con un respiro para no competir con el
 * arranque) y luego cada 30 minutos. Al cambiar el ID, installIdentity emite
 * DEVICE_ID_MIGRATED_EVENT y useSecurity actualiza el ID y la licencia.
 */

import { useEffect } from 'react';
import { checkIdentityMigrationOrder } from '../services/identityMigrationOrder';

export const IDENTITY_ORDER_FIRST_CHECK_MS = 20 * 1000;
export const IDENTITY_ORDER_INTERVAL_MS = 30 * 60 * 1000;

export function useIdentityMigrationOrder(deviceId) {
    useEffect(() => {
        if (!deviceId) return undefined;
        let disposed = false;
        let running = false;

        const run = async () => {
            if (disposed || running) return;
            if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
            running = true;
            try {
                const result = await checkIdentityMigrationOrder(deviceId);
                if (result.status === 'migrated') {
                    console.info('[IdentityOrder] ID de la estación actualizado por aviso', {
                        newDeviceId: String(result.newDeviceId).slice(0, 14),
                        confirmed: result.confirmed,
                    });
                }
            } finally {
                running = false;
            }
        };

        const first = setTimeout(run, IDENTITY_ORDER_FIRST_CHECK_MS);
        const interval = setInterval(run, IDENTITY_ORDER_INTERVAL_MS);
        return () => {
            disposed = true;
            clearTimeout(first);
            clearInterval(interval);
        };
    }, [deviceId]);
}

export default useIdentityMigrationOrder;
