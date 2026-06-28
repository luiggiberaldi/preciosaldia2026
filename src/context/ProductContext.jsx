import React, { createContext, useContext, useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { storageService } from '../utils/storageService';
import { BODEGA_CATEGORIES } from '../config/categories';
// HOOK-011: Tras la eliminación del monkeypatch global de localStorage por el Agente B
// (SEC-009), los callers que escriben claves `LOCAL_KEYS` deben invocar `pushLocalSync`
// explícitamente para que el cambio se propague a `sync_documents` (colección 'local').
import { pushLocalSync } from '../hooks/useCloudSync';

const ProductContext = createContext();

export function ProductProvider({ children, rates }) {
    const [products, setProducts] = useState([]);
    const [categories, setCategories] = useState(BODEGA_CATEGORIES);
    const [isLoadingProducts, setIsLoadingProducts] = useState(true);

    // Guard ref: prevents infinite loop when auto-save fires app_storage_update
    const savingRef = useRef(false);

    // MARKET LOGIC - Street Rate
    const [streetRate, setStreetRate] = useState(() => {
        const saved = localStorage.getItem('street_rate_bs');
        return saved ? parseFloat(saved) : 0;
    });

    // GLOBAL RATE LOGIC — rateMode: 'bcv' | 'euro' | 'usdt' | 'manual'
    // Backward-compat: si existía bodega_use_auto_rate=false se migra a 'manual'
    const [rateMode, setRateMode] = useState(() => {
        const saved = localStorage.getItem('bodega_rate_mode');
        if (saved && ['bcv', 'euro', 'usdt', 'manual'].includes(saved)) return saved;
        // Migrar desde el toggle antiguo
        const oldAuto = localStorage.getItem('bodega_use_auto_rate');
        return (oldAuto === 'false') ? 'manual' : 'bcv';
    });
    const [customRate, setCustomRate] = useState(() => {
        const saved = localStorage.getItem('bodega_custom_rate');
        return saved && parseFloat(saved) > 0 ? saved : '';
    });
    // Alias de compatibilidad: useAutoRate=true cuando no es manual
    const useAutoRate = rateMode !== 'manual';
    const setUseAutoRate = (val) => {
        if (val) {
            setRateMode(prev => ['bcv', 'euro', 'usdt'].includes(prev) ? prev : 'bcv');
        } else {
            setRateMode('manual');
        }
    };

    // AUTO COP LOGIC
    const [copEnabled, setCopEnabled] = useState(() => {
        return localStorage.getItem('cop_enabled') === 'true';
    });
    const [autoCopEnabled, setAutoCopEnabled] = useState(() => {
        return localStorage.getItem('auto_cop_enabled') === 'true';
    });
    const [tasaCopManual, setTasaCopManual] = useState(() => {
        return localStorage.getItem('tasa_cop') || '';
    });
    const [copPrimary, setCopPrimary] = useState(() => {
        return localStorage.getItem('cop_primary') === 'true';
    });

    // effectiveRate según el modo seleccionado
    const effectiveRate = (() => {
        if (rateMode === 'euro') return rates?.euro?.price || rates?.bcv?.price || 1;
        if (rateMode === 'usdt') return rates?.usdt?.price || rates?.bcv?.price || 1;
        if (rateMode === 'manual') return parseFloat(customRate) > 0 ? parseFloat(customRate) : (rates?.bcv?.price || 1);
        return rates?.bcv?.price || 1; // 'bcv' (default)
    })();
    
    // Calcula el COP efectivo. rates.autoCopRate es calculado en useRates basado en TRM y la Brecha USDT/BCV.
    const tasaCop = autoCopEnabled && rates?.autoCopRate?.price 
        ? rates.autoCopRate.price 
        : (parseFloat(tasaCopManual) > 0 ? parseFloat(tasaCopManual) : 4150);

    // Initial Load
    useEffect(() => {
        let isMounted = true;
        const loadData = async () => {
            const savedProducts = await storageService.getItem('bodega_products_v1', []);
            const savedCategories = await storageService.getItem('my_categories_v1', BODEGA_CATEGORIES);
            if (isMounted) {
                setProducts(savedProducts);
                setCategories(savedCategories);
                setIsLoadingProducts(false);
            }
        };
        loadData();
        return () => { isMounted = false; };
    }, []);

    // One-time migration: assign priceCop to existing products that don't have it
    useEffect(() => {
        if (isLoadingProducts || products.length === 0) return;
        if (!copEnabled || !tasaCop || tasaCop <= 0) return;
        if (localStorage.getItem('priceCop_migration_v1') === 'done') return;

        const needsMigration = products.some(p => p.priceUsdt > 0 && (p.priceCop == null || p.priceCop <= 0));
        if (!needsMigration) {
            localStorage.setItem('priceCop_migration_v1', 'done');
            return;
        }

        const migrated = products.map(p => {
            if (p.priceUsdt > 0 && (p.priceCop == null || p.priceCop <= 0)) {
                const priceCop = Math.round(p.priceUsdt * tasaCop);
                const unitPriceCop = p.unitPriceUsd > 0
                    ? Math.round(p.unitPriceUsd * tasaCop)
                    : null;
                return { ...p, priceCop, ...(unitPriceCop ? { unitPriceCop } : {}) };
            }
            return p;
        });

        setProducts(migrated);
        localStorage.setItem('priceCop_migration_v1', 'done');
    }, [isLoadingProducts, products.length, copEnabled, tasaCop]);

    // Set Initial Street Rate (from BCV)
    useEffect(() => {
        if (!streetRate && rates.bcv?.price > 0 && !localStorage.getItem('street_rate_bs')) {
            setStreetRate(rates.bcv.price);
        }
    }, [rates.bcv?.price, streetRate]);

    // Auto-save products and categories with Debounce (Performance Fix)
    // HOOK-018: Setear `savingRef.current = true` ANTES del setTimeout para que
    // el handler de `app_storage_update` (disparado por el setItem dentro del
    // callback, o por un push cloud que llega entre el schedule y el fire) vea
    // el flag activo y NO dispare un re-fetch que pisaría el save en curso.
    useEffect(() => {
        if (isLoadingProducts) return;

        // Setear el guard ANTES de agendar el timeout (HOOK-018).
        savingRef.current = true;

        const timer = setTimeout(() => {
            const savePromises = [];
            if (products.length > 0) {
                savePromises.push(storageService.setItem('bodega_products_v1', products));
            } else {
                savePromises.push(storageService.removeItem('bodega_products_v1'));
            }
            savePromises.push(storageService.setItem('my_categories_v1', categories));
            Promise.all(savePromises).finally(() => {
                // Reset guard after microtask queue flushes
                setTimeout(() => { savingRef.current = false; }, 50);
            });
        }, 1000); // 1 segundo de debounce

        return () => {
            clearTimeout(timer);
            // Si el efecto se re-corre antes del fire (cambio rápido de products),
            // dejamos el guard en true — el siguiente run lo reseteará al final.
            // No tocamos savingRef aquí: lo gestiona el callback del setTimeout.
        };
    }, [products, categories, isLoadingProducts]);

    useEffect(() => {
        if (streetRate > 0) localStorage.setItem('street_rate_bs', streetRate.toString());
    }, [streetRate]);

    useEffect(() => {
        localStorage.setItem('bodega_rate_mode', rateMode);
        localStorage.setItem('bodega_use_auto_rate', JSON.stringify(rateMode !== 'manual'));
        pushLocalSync('bodega_use_auto_rate', rateMode !== 'manual');
        pushLocalSync('bodega_rate_mode', rateMode);
        if (customRate) {
            localStorage.setItem('bodega_custom_rate', customRate.toString());
            pushLocalSync('bodega_custom_rate', parseFloat(customRate));
        }
    }, [rateMode, customRate]);

    // Listener para actualizar si cambia en otra pestaña/componente
    useEffect(() => {
        const handleStorageChange = (e) => {
            if (e.key === 'bodega_custom_rate') {
                if (e.newValue && parseFloat(e.newValue) > 0) setCustomRate(e.newValue);
            }
            if (e.key === 'bodega_rate_mode') {
                if (e.newValue) setRateMode(e.newValue);
            }
            if (e.key === 'bodega_use_auto_rate') {
                // HOOK-022: antes catch silencioso; loguear en dev para detectar corrupción.
                try { setUseAutoRate(!!JSON.parse(e.newValue)); }
                catch (err) { console.warn('[ProductContext] storage bodega_use_auto_rate parse error:', err); }
            }
            if (e.key === 'cop_enabled') {
                setCopEnabled(e.newValue === 'true');
            }
            if (e.key === 'auto_cop_enabled') {
                setAutoCopEnabled(e.newValue === 'true');
            }
            if (e.key === 'tasa_cop') {
                setTasaCopManual(e.newValue);
            }
            if (e.key === 'cop_primary') {
                setCopPrimary(e.newValue === 'true');
            }
            if (e.key === 'bodega_products_v1') {
                // If modified in another tab, fetch it
                storageService.getItem('bodega_products_v1', []).then(updatedProducts => setProducts(updatedProducts));
            }
            if (e.key === 'my_categories_v1') {
                storageService.getItem('my_categories_v1', BODEGA_CATEGORIES).then(updatedCategories => setCategories(updatedCategories));
            }
        };

        // Mantener app_storage_update por si algún componente viejo sigue usándolo para sincronizar
        // aunque ahora ProductContext centraliza todo.
        const handleAppStorageUpdate = async (e) => {
            if (savingRef.current) return;

            if (e.detail?.key === 'bodega_products_v1') {
                const updatedProducts = await storageService.getItem('bodega_products_v1', []);
                setProducts(updatedProducts);
            }
            if (e.detail?.key === 'my_categories_v1') {
                const updatedCategories = await storageService.getItem('my_categories_v1', BODEGA_CATEGORIES);
                setCategories(updatedCategories);
            }
        };

        window.addEventListener('storage', handleStorageChange);
        window.addEventListener('app_storage_update', handleAppStorageUpdate);
        return () => {
            window.removeEventListener('storage', handleStorageChange);
            window.removeEventListener('app_storage_update', handleAppStorageUpdate);
        };
    }, []);

    // HOOK-005: Memoizar adjustStock para que el objeto `value` del Provider
    // sea estable entre renders cuando los productos no cambian.
    const adjustStock = useCallback((productId, delta) => {
        setProducts(prevProducts => prevProducts.map(p => {
            if (p.id === productId) {
                const allowNeg = localStorage.getItem('allow_negative_stock') === 'true';
                const newStock = (p.stock ?? 0) + delta;
                return { ...p, stock: allowNeg ? newStock : Math.max(0, newStock) };
            }
            return p;
        }));
    }, []);

    // HOOK-005: Envolver `value` en useMemo con deps correctas para evitar que
    // TODOS los consumidores se re-rendericen en cada render del Provider.
    // Las setters de useState son estables y no necesitan estar en deps.
    const value = useMemo(() => ({
        products,
        setProducts,
        categories,
        setCategories,
        isLoadingProducts,
        streetRate,
        setStreetRate,
        rateMode,
        setRateMode,
        useAutoRate,
        setUseAutoRate,
        customRate,
        setCustomRate,
        effectiveRate,
        rates,
        copEnabled,
        setCopEnabled,
        autoCopEnabled,
        setAutoCopEnabled,
        tasaCopManual,
        setTasaCopManual,
        copPrimary,
        setCopPrimary,
        tasaCop,
        adjustStock
    }), [
        products,
        categories,
        isLoadingProducts,
        streetRate,
        useAutoRate,
        customRate,
        effectiveRate,
        copEnabled,
        autoCopEnabled,
        tasaCopManual,
        copPrimary,
        tasaCop,
        adjustStock,
    ]);

    return (
        <ProductContext.Provider value={value}>
            {children}
        </ProductContext.Provider>
    );
}

export const useProductContext = () => {
    const context = useContext(ProductContext);
    if (!context) {
        throw new Error("useProductContext must be used within a ProductProvider");
    }
    return context;
};
