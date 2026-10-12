// FIN-017: Reemplaza Math.round(raw/safeRate*100)/100 por divR + round2 de dinero.js.
// FIN-030: Mantiene `priceUsdt` (typo histórico) pero añade alias `priceUsd` (mismo valor)
//          para migración gradual hacia el nombre canónico.
import { round2, divR, mulR, round0 } from './dinero.js';
import { CurrencyService } from '../services/CurrencyService.js'; // FIN-017-pattern: safeParse en vez de parseFloat.
import {
    isGranelProduct,
    isLiquidProduct,
    parseStockInput,
    getGranelUnitMode,
    GRANEL_MODE_GR_ML,
    parseWeightToCanonical,
    parseGranelThreshold,
} from './granel.js'; // GRANEL-001 / GRANEL-DUAL: decimales SOLO para productos a granel y conversión dual.

export function deriveCostFactorUpdate(editOrder, editedField, { cost, price, factor }) {
    const nextOrder = [...(editOrder || []).filter(field => field !== editedField), editedField].slice(-2);
    const [first, second] = nextOrder;
    if (!first || !second) return { editOrder: nextOrder, field: null, value: null };

    const derivedField = ['cost', 'price', 'factor'].find(field => field !== first && field !== second);
    if (derivedField === 'factor' && price > 0 && cost > 0) {
        return { editOrder: nextOrder, field: 'factor', value: cost / price };
    }
    if (derivedField === 'price' && factor > 0 && cost > 0) {
        return { editOrder: nextOrder, field: 'price', value: cost / factor };
    }
    if (derivedField === 'cost' && price > 0 && factor > 0) {
        return { editOrder: nextOrder, field: 'cost', value: price * factor };
    }
    return { editOrder: nextOrder, field: null, value: null };
}

export function buildProductPayload(formData, effectiveRate) {
    const {
        name,
        barcode,
        priceUsd,
        priceBs,
        priceCop,
        costUsd,
        costBs,
        stock,
        stockInLotes,
        packagingType,
        unitsPerPackage,
        granelUnit,
        sellByUnit,
        unitPriceUsd,
        unitPriceCop,
        category,
        lowStockAlert
    } = formData;

    const formattedName = name.replace(/(^\w{1})|(\s+\w{1})/g, letter => letter.toUpperCase());
    // FIN-022-pattern: validar tasa antes de usarla (sin fallback silencioso a 1).
    const safeRate = effectiveRate > 0 ? effectiveRate : 1;

    // FIN-017: usar divR (división redondeada) en vez de Math.round(raw/safeRate*100)/100.
    // safeParse para normalizar input del usuario (maneja coma decimal y separadores de miles).
    const finalPriceUsd = priceUsd
        ? round2(CurrencyService.safeParse(priceUsd))
        : (priceBs ? divR(CurrencyService.safeParse(priceBs), safeRate) : 0);
    const finalCostUsd = costUsd
        ? round2(CurrencyService.safeParse(costUsd))
        : (costBs ? divR(CurrencyService.safeParse(costBs), safeRate) : 0);
    const finalCostBs = costBs
        ? round2(CurrencyService.safeParse(costBs))
        : (costUsd ? mulR(CurrencyService.safeParse(costUsd), safeRate) : 0);

    // COP: guardar el valor exacto que escribió el usuario (sin redondeo de ida/vuelta).
    // COP es entero por convención; redondeamos a entero con round2 (no hay decimales).
    const finalPriceCop = priceCop && CurrencyService.safeParse(priceCop) > 0 ? round2(CurrencyService.safeParse(priceCop)) : null;

    // Map packagingType → unit legacy
    let legacyUnit = 'unidad';
    if (packagingType === 'lote') legacyUnit = 'paquete';
    else if (packagingType === 'granel') legacyUnit = isLiquidProduct(granelUnit) ? 'litro' : 'kg';

    const isLote = packagingType === 'lote';
    // Para productos de tipo Suelto o Granel, también guardamos unitsPerPackage si fue
    // configurado voluntariamente (permite ajuste por bulto en StockBatchModal).
    const parsedUnitsPerPkg = unitsPerPackage ? Math.max(1, parseInt(unitsPerPackage) || 1) : 1;
    const autoUnitPrice = parsedUnitsPerPkg > 1 ? divR(finalPriceUsd, parsedUnitsPerPkg) : finalPriceUsd;
    const finalUnitPrice = sellByUnit && unitPriceUsd ? round2(CurrencyService.safeParse(unitPriceUsd)) : autoUnitPrice;

    // Unit price in COP for lote products
    const finalUnitPriceCop = isLote && sellByUnit && unitPriceCop && CurrencyService.safeParse(unitPriceCop) > 0
        ? round2(CurrencyService.safeParse(unitPriceCop))
        : (isLote && sellByUnit && finalPriceCop && parsedUnitsPerPkg > 1
            ? divR(finalPriceCop, parsedUnitsPerPkg)
            : null);

    // GRANEL-001 / GRANEL-DUAL: Solo los productos a granel aceptan decimales en stock (hasta 3).
    // En modo gr_ml, las entradas en gramos o mililitros se convierten canónicamente a kg / Litros.
    // Todo lo demás (unidad, paquete, lote, suelto) permanece estrictamente entero.
    const isGranel = packagingType
        ? packagingType === 'granel'
        : isGranelProduct({ packagingType, granelUnit, unit: legacyUnit });
    let finalStock = 0;
    if (isLote && stockInLotes && parsedUnitsPerPkg > 0) {
        finalStock = round0((Number(stockInLotes) || 0) * parsedUnitsPerPkg);
    } else if (stock !== null && stock !== undefined && stock !== '') {
        if (isGranel) {
            const activeGranelMode = formData.granelUnitMode || getGranelUnitMode();
            if (activeGranelMode === GRANEL_MODE_GR_ML) {
                const cleaned = String(stock).trim().replace(/\s/g, '').replace(/,/g, '.');
                const num = Number(cleaned);
                if (Number.isFinite(num) && num === 0) {
                    finalStock = 0;
                } else {
                    finalStock = parseWeightToCanonical(stock, GRANEL_MODE_GR_ML) ?? 0;
                }
            } else {
                finalStock = parseStockInput(stock, true) ?? 0;
            }
        } else {
            finalStock = parseStockInput(stock, false) ?? 0;
        }
    }

    // GRANEL-001: alerta de stock bajo con el mismo guardarraíl de tipado
    // (granel admite hasta 3 decimales; el resto cae a entero, con fallback a 5).
    const activeGranelMode = formData.granelUnitMode || getGranelUnitMode();
    const finalLowStockAlert = lowStockAlert !== null && lowStockAlert !== undefined && lowStockAlert !== ''
        ? (isGranel
            ? (formData.lowStockAlertCanonical === true
                ? (parseStockInput(lowStockAlert, true) ?? 5)
                : (parseGranelThreshold(lowStockAlert, activeGranelMode) ?? 5))
            : (parseStockInput(lowStockAlert, false) ?? 5))
        : 5;

    // Doble Precio y modalidad de precios (dual_usd / tasa_dia)
    const rawPricingMode = formData.pricingMode || 'tasa_dia';
    const rawBsUsdRef = formData.priceBsUsdRef;

    const parsedBsUsdRef = (rawBsUsdRef && CurrencyService.safeParse(rawBsUsdRef) > 0)
        ? round2(CurrencyService.safeParse(rawBsUsdRef))
        : null;

    const pricingMode = (rawPricingMode === 'dual_usd' && parsedBsUsdRef !== null)
        ? 'dual_usd'
        : 'tasa_dia';

    const priceBsUsdRef = pricingMode === 'dual_usd' ? parsedBsUsdRef : null;

    return {
        name: formattedName,
        barcode: barcode ? barcode.trim() : null,
        // FIN-030: mantener `priceUsdt` (typo histórico) + alias `priceUsd` para migración gradual.
        priceUsdt: finalPriceUsd,
        priceUsd: finalPriceUsd,
        pricingMode: pricingMode,
        priceBsUsdRef: priceBsUsdRef,
        priceCop: finalPriceCop,
        costUsd: finalCostUsd,
        costBs: finalCostBs,
        ...(formData.costFactor !== undefined ? {
            costFactor: formData.costFactor !== null && formData.costFactor !== '' && Number.isFinite(Number(formData.costFactor))
                ? Number(formData.costFactor)
                : null,
        } : {}),
        stock: finalStock,
        unit: legacyUnit,
        packagingType: packagingType,
        granelUnit: isGranel ? (isLiquidProduct(granelUnit) ? 'litro' : 'kg') : null,
        unitsPerPackage: parsedUnitsPerPkg,
        sellByUnit: isLote ? sellByUnit : false,
        unitPriceUsd: isLote && sellByUnit ? finalUnitPrice : null,
        unitPriceCop: isLote && sellByUnit ? finalUnitPriceCop : null,
        stockInLotes: isLote && stockInLotes ? parseInt(stockInLotes) : null,
        category: category,
        lowStockAlert: finalLowStockAlert,
    };
}
