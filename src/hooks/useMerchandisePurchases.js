// Compras de mercancía: lectura en vivo y escritura (la escritura publica sola
// por storageService → familia por mes en la nube).
import { useCallback, useEffect, useState } from 'react';
import { storageService } from '../utils/storageService';
import { MERCHANDISE_PURCHASES_KEY, removePurchase, upsertPurchase } from '../utils/merchandisePurchases';
import { logEvent } from '../services/auditService';
import { useAuthStore } from './store/useAuthStore';

const readList = async () => {
    const value = await storageService.getItem(MERCHANDISE_PURCHASES_KEY, []);
    return Array.isArray(value) ? value : [];
};

export function useMerchandisePurchases({ enabled = true } = {}) {
    const [purchases, setPurchases] = useState([]);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        if (!enabled) return undefined;
        let mounted = true;
        const load = async () => {
            const list = await readList();
            if (mounted) { setPurchases(list); setLoaded(true); }
        };
        load();
        const onUpdate = (event) => {
            if (event?.detail?.key === MERCHANDISE_PURCHASES_KEY) load();
        };
        window.addEventListener('app_storage_update', onUpdate);
        return () => {
            mounted = false;
            window.removeEventListener('app_storage_update', onUpdate);
        };
    }, [enabled]);

    // Siempre sobre lo guardado (no sobre el estado de React): otra pestaña o
    // el sync pudo escribir entre medio.
    const savePurchase = useCallback(async (purchase, { isEdit = false } = {}) => {
        const next = upsertPurchase(await readList(), purchase);
        await storageService.setItem(MERCHANDISE_PURCHASES_KEY, next);
        setPurchases(next);
        logEvent(
            'PROVEEDOR',
            isEdit ? 'COMPRA_EDITADA' : 'COMPRA_REGISTRADA',
            `${purchase.supplier}: $${purchase.amountUsd} (${purchase.date})`,
            useAuthStore.getState().usuarioActivo,
        );
    }, []);

    const deletePurchase = useCallback(async (purchase) => {
        const next = removePurchase(await readList(), purchase.id);
        await storageService.setItem(MERCHANDISE_PURCHASES_KEY, next);
        setPurchases(next);
        logEvent(
            'PROVEEDOR',
            'COMPRA_ELIMINADA',
            `${purchase.supplier}: $${purchase.amountUsd} (${purchase.date})`,
            useAuthStore.getState().usuarioActivo,
        );
    }, []);

    return { purchases, loaded, savePurchase, deletePurchase };
}
