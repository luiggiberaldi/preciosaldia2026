import React, { createContext, useContext, useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { storageService } from '../utils/storageService';
import { BODEGA_CATEGORIES } from '../config/categories';
import { pushLocalSync, pushCloudSync } from '../hooks/useCloudSync';
import { useRateContext } from './RateContext';

const ProductContext = createContext();

const normalizeCategories = (cats) => {
    const list = Array.isArray(cats) ? cats : [];
    return list.map(cat => {
        if (!cat) return null;
        if (typeof cat === 'string') {
            return {
                id: cat.toLowerCase().replace(/\s+/g, '_'),
                label: cat.charAt(0).toUpperCase() + cat.slice(1),
                icon: '📦',
                color: 'slate'
            };
        }
        if (typeof cat === 'object') {
            const label = cat.label || cat.name || cat.id || 'Categoría';
            const id = cat.id || label.toLowerCase().replace(/\s+/g, '_');
            return {
                ...cat,
                id,
                label,
                icon: cat.icon || '📦',
                color: cat.color || 'slate'
            };
        }
        return null;
    }).filter(Boolean);
};

export function ProductProvider({ children }) {
    const rateState = useRateContext();

    const [products, setProducts] = useState([]);
    const [categories, setRawCategories] = useState(() => normalizeCategories(BODEGA_CATEGORIES));
    const setCategories = useCallback((cats) => {
        setRawCategories(prev => {
            const next = typeof cats === 'function' ? cats(prev) : cats;
            return normalizeCategories(next);
        });
    }, []);
    const [isLoadingProducts, setIsLoadingProducts] = useState(true);

    // Guard ref: prevents infinite loop when auto-save fires app_storage_update
    const savingRef = useRef(false);
    const hasMountedRef = useRef(false);
    const productsRef = useRef(products);
    useEffect(() => {
        productsRef.current = products;
    }, [products]);

    // CHECKOUT MODE — 'basic' (barras móviles) | 'pos' (2 columnas, estilo Listo POS)
    const [checkoutMode, setCheckoutModeState] = useState(() => {
        const saved = localStorage.getItem('checkout_mode');
        if (saved) return saved;
        // Detectar por defecto basado en viewport (PC/Escritorio: >= 1024px)
        const isPC = typeof window !== 'undefined' && window.innerWidth >= 1024;
        return isPC ? 'pos' : 'basic';
    });
    const setCheckoutMode = (mode) => {
        setCheckoutModeState(mode);
        localStorage.setItem('checkout_mode', mode);
    };

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
        if (!rateState?.copEnabled || !rateState?.tasaCop || rateState.tasaCop <= 0) return;
        if (localStorage.getItem('priceCop_migration_v1') === 'done') return;

        const needsMigration = products.some(p => p.priceUsdt > 0 && (p.priceCop == null || p.priceCop <= 0));
        if (!needsMigration) {
            localStorage.setItem('priceCop_migration_v1', 'done');
            return;
        }

        const migrated = products.map(p => {
            if (p.priceUsdt > 0 && (p.priceCop == null || p.priceCop <= 0) && rateState.copEnabled && rateState.tasaCop > 0) {
                const priceCop = Math.round(p.priceUsdt * rateState.tasaCop);
                const unitPriceCop = p.unitPriceUsd > 0
                    ? Math.round(p.unitPriceUsd * rateState.tasaCop)
                    : null;
                return { ...p, priceCop, ...(unitPriceCop ? { unitPriceCop } : {}) };
            }
            return p;
        });

        setProducts(migrated);
        localStorage.setItem('priceCop_migration_v1', 'done');
    }, [isLoadingProducts, products.length, rateState?.copEnabled, rateState?.tasaCop]);

    // Set Initial Street Rate (from BCV)
    useEffect(() => {
        if (!rateState?.streetRate && rateState?.rates?.bcv?.price > 0 && !localStorage.getItem('street_rate_bs')) {
            rateState.setStreetRate(rateState.rates.bcv.price);
        }
    }, [rateState?.rates?.bcv?.price, rateState?.streetRate, rateState?.setStreetRate]);

    // Auto-save products and categories with Debounce (Performance Fix)
    useEffect(() => {
        if (isLoadingProducts) return;

        if (!hasMountedRef.current) {
            hasMountedRef.current = true;
            return;
        }

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
                setTimeout(() => { savingRef.current = false; }, 50);
            });
        }, 1000);

        return () => {
            clearTimeout(timer);
        };
    }, [products, categories, isLoadingProducts]);

    // Listener para actualizar productos/categorías si cambian en otra pestaña/componente
    useEffect(() => {
        const handleStorageChange = (e) => {
            if (e.key === 'bodega_products_v1') {
                storageService.getItem('bodega_products_v1', []).then(updatedProducts => {
                    if (JSON.stringify(updatedProducts) !== JSON.stringify(productsRef.current)) {
                        setProducts(updatedProducts);
                    }
                });
            }
            if (e.key === 'my_categories_v1') {
                storageService.getItem('my_categories_v1', BODEGA_CATEGORIES).then(updatedCategories => setCategories(updatedCategories));
            }
        };

        const handleAppStorageUpdate = async (e) => {
            if (savingRef.current) return;
            const key = e.detail?.key;
            if (!key) return;

            if (key === 'bodega_products_v1') {
                const updatedProducts = await storageService.getItem('bodega_products_v1', []);
                if (JSON.stringify(updatedProducts) !== JSON.stringify(productsRef.current)) {
                    setProducts(updatedProducts);
                }
            }
            if (key === 'my_categories_v1') {
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
        setProducts(prevProducts => {
            const updated = prevProducts.map(p => {
                if (p.id === productId) {
                    const allowNeg = localStorage.getItem('allow_negative_stock') === 'true';
                    const newStock = (p.stock ?? 0) + delta;
                    return { ...p, stock: allowNeg ? newStock : Math.max(0, newStock) };
                }
                return p;
            });
            storageService.setItem('bodega_products_v1', updated);
            return updated;
        });
    }, []);

    // HOOK-005: Envolver `value` en useMemo con deps correctas para evitar que
    // TODOS los consumidores se re-rendericen en cada render del Provider.
    // Las setters de useState son estables y no necesitan estar en deps.
    const value = useMemo(() => ({
        ...rateState,
        products,
        setProducts,
        categories,
        setCategories,
        isLoadingProducts,
        checkoutMode,
        setCheckoutMode,
        adjustStock
    }), [
        rateState,
        products,
        categories,
        isLoadingProducts,
        checkoutMode,
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
