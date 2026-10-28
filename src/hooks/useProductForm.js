import { useReducer, useCallback } from 'react';
import { unShiftBarcode } from '../utils/barcodeNormalizer';
import {
    getGranelUnitMode,
    GRANEL_MODE_GR_ML,
    isGranelProduct,
    isLiquidProduct,
    normalizePackagingType,
    kgToGrams,
    formatStockDisplay,
} from '../utils/granel';

/**
 * Hook para el formulario de producto.
 *
 * HOOK-029: Antes tenía 22 `useState` individuales. Cada `setState` causa un
 * re-render del componente. Cuando `populateForm` seteaba 17 campos en
 * secuencia, se disparaban 17 re-renders. Ahora usamos `useReducer` con un
 * único estado; las acciones batchean los cambios en una sola actualización.
 *
 * API pública: idéntica a la versión anterior (mismos `[value, setter]` pares
 * en el return), para no romper a los callers.
 */

const INITIAL_STATE = {
    editingId: null,
    name: '',
    barcode: '',
    priceUsd: '',
    priceBs: '',
    pricingMode: 'tasa_dia',
    priceBsUsdRef: '',
    costUsd: '',
    costBs: '',
    costFactor: '0',
    stock: '',
    unit: 'unidad',
    unitsPerPackage: '',
    sellByUnit: false,
    unitPriceUsd: '',
    category: 'otros',
    lowStockAlert: '5',
    image: undefined,
    packagingType: 'suelto',
    stockInLotes: '',
    granelUnit: 'kg',
    // IVA por producto: '' = usar la tasa general; 'exento' = 0%.
    ivaMode: '',
    isFormShaking: false,
};

function reducer(state, action) {
    if (action.type === 'SET') {
        return { ...state, [action.field]: action.value };
    }
    if (action.type === 'RESET') {
        return { ...INITIAL_STATE };
    }
    if (action.type === 'PATCH') {
        // Batch update — usado por populateForm para evitar N re-renders.
        return { ...state, ...action.patch };
    }
    return state;
}

/**
 * Prepara el estado inicial del formulario a partir de un producto existente.
 * Soporta modo dual de granel ('kg_lt' vs 'gr_ml'):
 *   - En modo gr_ml, el stock en kg (ej. 2.500) se presenta en gramos enteros (2500).
 *   - En modo kg_lt, el stock se mantiene en decimal estándar (2.5).
 */
export function prepareProductFormState(product, effectiveRate, granelMode = getGranelUnitMode()) {
    const currentPriceUsd = product.priceUsdt || product.priceUsd || 0;
    const currentCostUsd = product.costUsd || (product.costBs && effectiveRate > 0 ? product.costBs / effectiveRate : 0);
    const currentCostBs = currentCostUsd > 0 && effectiveRate > 0 ? (currentCostUsd * effectiveRate) : (product.costBs || 0);

    const u = product.unit || 'unidad';
    // FIX-EMPAQUE-001: el empaque manda (sin adivinanzas por granelUnit).
    const isGranel = isGranelProduct(product);

    let initialStock = product.stock ?? '';
    if (isGranel && product.stock !== undefined && product.stock !== null && product.stock !== '') {
        const cleanedStock = String(product.stock).trim().replace(/\s/g, '').replace(/,/g, '.');
        const numStock = Number(cleanedStock);
        if (Number.isFinite(numStock)) {
            if (granelMode === GRANEL_MODE_GR_ML) {
                // Si el modo es gr_ml, el stock almacenado en kg (ej. 2.500 kg)
                // se presenta en el campo como 2500 (gramos) para edición cómoda.
                initialStock = numStock > 0 ? String(kgToGrams(numStock)) : '0';
            } else {
                // Si el modo es kg_lt, se mantiene la visualización estándar decimal (2.500).
                initialStock = formatStockDisplay(numStock, true);
            }
        }
    }

    const patch = {
        editingId: product.id,
        name: product.name,
        barcode: product.barcode || '',
        priceUsd: currentPriceUsd > 0 ? currentPriceUsd.toString() : '',
        priceBs: currentPriceUsd > 0 ? (currentPriceUsd * effectiveRate).toFixed(2) : '',
        pricingMode: product.pricingMode || (product.priceBsUsdRef > 0 ? 'dual_usd' : 'tasa_dia'),
        priceBsUsdRef: product.priceBsUsdRef != null ? product.priceBsUsdRef.toString() : '',
        costUsd: currentCostUsd > 0 ? currentCostUsd.toFixed(2) : '',
        costBs: currentCostBs > 0 ? currentCostBs.toFixed(2) : '',
        // Con costo y precio manda el factor REAL (un ajuste masivo o una
        // edición remota pudo dejar desfasado el guardado); el guardado solo
        // sirve cuando falta uno de los dos.
        costFactor: currentPriceUsd > 0 && currentCostUsd > 0
            ? (currentCostUsd / currentPriceUsd).toFixed(3)
            : (product.costFactor != null ? product.costFactor.toString() : '0'),
        stock: initialStock,
        unit: product.unit || 'unidad',
        unitsPerPackage: product.unitsPerPackage || '',
        sellByUnit: product.sellByUnit || false,
        unitPriceUsd: product.unitPriceUsd ? product.unitPriceUsd.toString() : '',
        category: product.category || 'otros',
        lowStockAlert: product.lowStockAlert ?? 5,
        image: product.image,
        ivaMode: product.ivaRate === 0 ? 'exento' : '',
    };

    // FIX-EMPAQUE-001: el empaque se normaliza al cargar — traduce valores ajenos
    // ('unidad', 'bulto'...) y deriva los vacíos — para que el botón correcto
    // aparezca marcado en el formulario en vez de dejar todo sin selección.
    patch.packagingType = normalizePackagingType(product);

    if (isGranel || patch.packagingType === 'granel') {
        patch.granelUnit = isLiquidProduct(product) ? 'litro' : 'kg';
    } else {
        patch.granelUnit = 'kg';
    }

    // Stock in lotes
    if (product.stockInLotes) {
        patch.stockInLotes = product.stockInLotes.toString();
    } else if (u === 'paquete' && product.unitsPerPackage && product.stock) {
        patch.stockInLotes = Math.floor(product.stock / (product.unitsPerPackage || 1)).toString();
    } else {
        patch.stockInLotes = '';
    }

    return patch;
}

export function useProductForm() {
    const [state, dispatch] = useReducer(reducer, INITIAL_STATE);

    // HOOK-029: factory de setters estables (no se re-crean en cada render).
    // Cada setter es una función que hace `dispatch({ type: 'SET', field, value })`.
    const makeSetter = useCallback((field) => (value) => {
        dispatch({ type: 'SET', field, value });
    }, []);

    const setEditingId = useCallback((v) => dispatch({ type: 'SET', field: 'editingId', value: v }), []);
    const setName = useCallback((v) => dispatch({ type: 'SET', field: 'name', value: v }), []);
    const setBarcode = useCallback((v) => {
        const normalized = typeof v === 'string' ? unShiftBarcode(v) || v : v;
        dispatch({ type: 'SET', field: 'barcode', value: normalized });
    }, []);
    const setPriceUsd = useCallback((v) => dispatch({ type: 'SET', field: 'priceUsd', value: v }), []);
    const setPriceBs = useCallback((v) => dispatch({ type: 'SET', field: 'priceBs', value: v }), []);
    const setPricingMode = useCallback((v) => dispatch({ type: 'SET', field: 'pricingMode', value: v }), []);
    const setPriceBsUsdRef = useCallback((v) => dispatch({ type: 'SET', field: 'priceBsUsdRef', value: v }), []);
    const setCostUsd = useCallback((v) => dispatch({ type: 'SET', field: 'costUsd', value: v }), []);
    const setCostBs = useCallback((v) => dispatch({ type: 'SET', field: 'costBs', value: v }), []);
    const setCostFactor = useCallback((v) => dispatch({ type: 'SET', field: 'costFactor', value: v }), []);
    const setStock = useCallback((v) => dispatch({ type: 'SET', field: 'stock', value: v }), []);
    const setUnit = useCallback((v) => dispatch({ type: 'SET', field: 'unit', value: v }), []);
    const setUnitsPerPackage = useCallback((v) => dispatch({ type: 'SET', field: 'unitsPerPackage', value: v }), []);
    const setSellByUnit = useCallback((v) => dispatch({ type: 'SET', field: 'sellByUnit', value: v }), []);
    const setUnitPriceUsd = useCallback((v) => dispatch({ type: 'SET', field: 'unitPriceUsd', value: v }), []);
    const setCategory = useCallback((v) => dispatch({ type: 'SET', field: 'category', value: v }), []);
    const setLowStockAlert = useCallback((v) => dispatch({ type: 'SET', field: 'lowStockAlert', value: v }), []);
    const setImage = useCallback((v) => dispatch({ type: 'SET', field: 'image', value: v }), []);
    const setPackagingType = useCallback((v) => dispatch({ type: 'SET', field: 'packagingType', value: v }), []);
    const setStockInLotes = useCallback((v) => dispatch({ type: 'SET', field: 'stockInLotes', value: v }), []);
    const setGranelUnit = useCallback((v) => dispatch({ type: 'SET', field: 'granelUnit', value: v }), []);
    const setIsFormShaking = useCallback((v) => dispatch({ type: 'SET', field: 'isFormShaking', value: v }), []);
    const setIvaMode = useCallback((v) => dispatch({ type: 'SET', field: 'ivaMode', value: v }), []);

    const resetForm = useCallback(() => {
        dispatch({ type: 'RESET' });
    }, []);

    const populateForm = useCallback((product, effectiveRate, granelMode) => {
        const patch = prepareProductFormState(product, effectiveRate, granelMode);
        dispatch({ type: 'PATCH', patch });
    }, []);

    // `makeSetter` se exporta para callers que quieran setters dinámicos (raro).
    return {
        editingId: state.editingId, setEditingId,
        name: state.name, setName,
        barcode: state.barcode, setBarcode,
        priceUsd: state.priceUsd, setPriceUsd,
        priceBs: state.priceBs, setPriceBs,
        pricingMode: state.pricingMode, setPricingMode,
        priceBsUsdRef: state.priceBsUsdRef, setPriceBsUsdRef,
        costUsd: state.costUsd, setCostUsd,
        costBs: state.costBs, setCostBs,
        costFactor: state.costFactor, setCostFactor,
        stock: state.stock, setStock,
        unit: state.unit, setUnit,
        unitsPerPackage: state.unitsPerPackage, setUnitsPerPackage,
        sellByUnit: state.sellByUnit, setSellByUnit,
        unitPriceUsd: state.unitPriceUsd, setUnitPriceUsd,
        category: state.category, setCategory,
        lowStockAlert: state.lowStockAlert, setLowStockAlert,
        image: state.image, setImage,
        packagingType: state.packagingType, setPackagingType,
        stockInLotes: state.stockInLotes, setStockInLotes,
        granelUnit: state.granelUnit, setGranelUnit,
        ivaMode: state.ivaMode, setIvaMode,
        isFormShaking: state.isFormShaking, setIsFormShaking,
        resetForm,
        populateForm,
        // Exponer para tests / devtools.
        _makeSetter: makeSetter,
    };
}
