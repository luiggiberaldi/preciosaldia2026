import { useState, useEffect, useRef } from 'react';
import { storageService } from '../utils/storageService';

const SALES_KEY = 'bodega_sales_v1';

export function useDashboardData(isActive, requestPermission) {
    const [sales, setSales] = useState([]);
    const [customers, setCustomers] = useState([]);
    const [isLoadingLocal, setIsLoadingLocal] = useState(true);
    const hasRequestedPermRef = useRef(false);

    useEffect(() => {
        if (!isActive) return;
        let mounted = true;
        const load = async () => {
            const [savedSales, savedCustomers] = await Promise.all([
                storageService.getItem(SALES_KEY, []),
                storageService.getItem('bodega_customers_v1', []),
            ]);
            if (mounted) {
                setSales(savedSales);
                setCustomers(savedCustomers);
                setIsLoadingLocal(false);
            }
        };
        load();
        // Solicitar permiso de notificaciones al primer uso
        if (!hasRequestedPermRef.current) { hasRequestedPermRef.current = true; requestPermission(); }
        return () => { mounted = false; };
    }, [isActive]);

    const refreshData = async () => {
        const [savedSales, savedCustomers] = await Promise.all([
            storageService.getItem(SALES_KEY, []),
            storageService.getItem('bodega_customers_v1', []),
        ]);
        setSales(savedSales);
        setCustomers(savedCustomers);
    };

    // Ventas escritas fuera de esta vista (ventas remotas del supervisor,
    // sincronización) se reflejan sin recargar la página.
    useEffect(() => {
        if (!isActive) return;
        let timer = null;
        const onStorageUpdate = (e) => {
            const key = e?.detail?.key;
            if (key !== SALES_KEY && key !== 'bodega_customers_v1') return;
            clearTimeout(timer);
            timer = setTimeout(refreshData, 50);
        };
        window.addEventListener('app_storage_update', onStorageUpdate);
        return () => {
            clearTimeout(timer);
            window.removeEventListener('app_storage_update', onStorageUpdate);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshData solo usa setters estables
    }, [isActive]);

    return { sales, setSales, customers, setCustomers, isLoadingLocal, refreshData };
}
