const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function requireProductId(value) {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new Error('Producto inválido');
    }
    return value;
}

function requireProduct(product) {
    if (!isRecord(product)) throw new Error('Producto inválido');
    const id = requireProductId(product.id);
    if (typeof product.name !== 'string' || product.name.trim() === '') {
        throw new Error('El nombre del producto es obligatorio');
    }
    return { ...product, id };
}

export const EDITABLE_PRODUCT_FIELDS = Object.freeze([
    'name',
    'barcode',
    'priceUsd',
    'priceUsdt',
    'pricingMode',
    'priceBsUsdRef',
    'priceCop',
    'costUsd',
    'costBs',
    'costFactor',
    'unit',
    'packagingType',
    'granelUnit',
    'unitsPerPackage',
    'sellByUnit',
    'unitPriceUsd',
    'unitPriceCop',
    'category',
    'lowStockAlert',
    'ivaRate',
    'image',
]);

export function resolveEffectivePriceUsd(product = {}) {
    if (!product || typeof product !== 'object') return null;
    // Precedencia explícita: priceUsd prevalece sobre el alias histórico priceUsdt
    const candidate = product.priceUsd !== undefined && product.priceUsd !== null
        ? product.priceUsd
        : product.priceUsdt;
    if (candidate === undefined || candidate === null) return null;
    const num = Number(candidate);
    return Number.isFinite(num) ? num : null;
}

export function normalizeProductFieldValue(key, value, product = {}) {
    // 1. Resolver alias de precio con precedencia explícita (priceUsd > priceUsdt)
    // antes del chequeo de null/undefined. De esta forma, si product solo tiene
    // priceUsd, solo tiene priceUsdt o ambos, ambos campos obtienen el mismo valor canónico.
    if (key === 'priceUsd' || key === 'priceUsdt') {
        return resolveEffectivePriceUsd(product);
    }

    if (value === undefined || value === null) return null;

    switch (key) {
        case 'name':
        case 'category':
        case 'unit':
        case 'packagingType':
        case 'granelUnit':
        case 'image':
            return typeof value === 'string' ? value.trim() : String(value);

        case 'barcode': {
            const str = typeof value === 'string' ? value.trim() : String(value);
            return str.length > 0 ? str : null;
        }

        case 'priceBsUsdRef':
        case 'priceCop':
        case 'costUsd':
        case 'costBs':
        case 'costFactor':
        case 'unitsPerPackage':
        case 'unitPriceUsd':
        case 'unitPriceCop':
        case 'lowStockAlert':
        case 'ivaRate': {
            const num = Number(value);
            return Number.isFinite(num) ? num : null;
        }

        case 'pricingMode':
            return value === 'dual_usd' ? 'dual_usd' : 'tasa_dia';

        case 'sellByUnit':
            return Boolean(value);

        default:
            return value;
    }
}

export function buildProductRevision(product) {
    if (!product || typeof product !== 'object') return null;
    const tuple = EDITABLE_PRODUCT_FIELDS.map(field =>
        normalizeProductFieldValue(field, product[field], product)
    );
    return JSON.stringify(tuple);
}

export function extractEditableProductPatch(source = {}) {
    if (!isRecord(source)) return {};
    const patch = {};
    for (const key of EDITABLE_PRODUCT_FIELDS) {
        if (key in source && source[key] !== undefined) {
            patch[key] = source[key];
        }
    }
    return patch;
}

export function applySupervisorProductCommand(currentProducts, payload = {}, options = {}) {
    const products = Array.isArray(currentProducts) ? currentProducts : [];
    const { action, product, productId, baseUpdatedAt } = payload;
    let baseRevision;
    if (payload.baseRevision !== undefined && payload.product?.baseRevision !== undefined) {
        baseRevision = payload.baseRevision === payload.product.baseRevision
            ? payload.baseRevision
            : null;
    } else {
        baseRevision = payload.baseRevision !== undefined ? payload.baseRevision : payload.product?.baseRevision;
    }

    if (!['create', 'edit', 'delete'].includes(action)) {
        throw new Error('Acción de producto inválida');
    }

    if (action === 'delete') {
        const id = requireProductId(productId);
        const nextProducts = products.filter(item => item.id !== id);
        return {
            action,
            productId: id,
            product: null,
            products: nextProducts,
            changed: nextProducts.length !== products.length,
        };
    }

    const requestedId = action === 'edit' ? product?.id : product?.id;
    const existingIndex = products.findIndex(item => item.id === requestedId);

    if (action === 'edit' && existingIndex === -1) {
        throw new Error('Producto no encontrado en la caja');
    }

    if (action === 'create' && existingIndex !== -1) {
        throw new Error('El producto ya existe en la caja');
    }

    if (action === 'edit' && existingIndex !== -1) {
        const existing = products[existingIndex];

        // 1. Control temporal: baseUpdatedAt es metadato temporal. Si se envía,
        // debe ser válida y no posterior al reloj de la caja (sin tolerancias arbitrarias).
        if (baseUpdatedAt !== undefined && baseUpdatedAt !== null) {
            const parsedBase = Date.parse(baseUpdatedAt);
            if (Number.isNaN(parsedBase)) {
                throw new Error('Fecha base inválida');
            }
            const getNow = typeof options?.now === 'function'
                ? options.now
                : () => (typeof options?.now === 'number' ? options.now : Date.now());
            const currentNow = getNow();
            if (parsedBase > currentNow) {
                throw new Error('La fecha base no puede ser futura');
            }
        }

        // 2. Control de concurrencia optimista determinista: OBLIGATORIO
        // Rechaza revisión ausente, null, vacía, de tipo no string o distinta,
        // aun si baseUpdatedAt está presente y parece válida. Sin fallback de timestamp.
        if (typeof baseRevision !== 'string' || baseRevision.trim() === '') {
            throw new Error('Revisión base ausente o inválida');
        }

        const currentRevision = buildProductRevision(existing);
        if (currentRevision !== baseRevision) {
            throw new Error('El producto cambió mientras lo editabas; vuelve a cargarlo');
        }
    }

    let nextProduct;
    if (action === 'edit') {
        const existing = products[existingIndex];
        const patch = extractEditableProductPatch(product);
        const candidate = {
            ...existing,
            ...patch,
            id: existing.id,
            // Proteger estrictamente existencias, lotes e historial de la caja
            stock: existing.stock,
            stockInLotes: existing.stockInLotes,
            lots: existing.lots,
            movements: existing.movements,
            initialStock: existing.initialStock,
            // Generar timestamp local y nunca aceptar timestamps adversariales del payload
            updatedAt: new Date().toISOString(),
        };
        nextProduct = requireProduct(candidate);
    } else {
        // En creación se conserva el producto entrante incluyendo stock inicial
        nextProduct = requireProduct(product);
    }

    if (typeof nextProduct.name !== 'string' || nextProduct.name.trim() === '') {
        throw new Error('El nombre del producto es obligatorio');
    }

    const nextProducts = existingIndex === -1
        ? [nextProduct, ...products]
        : products.map((item, index) => index === existingIndex ? nextProduct : item);

    return {
        action,
        productId: nextProduct.id,
        product: nextProduct,
        products: nextProducts,
        changed: true,
    };
}

export default {
    applySupervisorProductCommand,
    buildProductRevision,
    extractEditableProductPatch,
    resolveEffectivePriceUsd,
    EDITABLE_PRODUCT_FIELDS,
    normalizeProductFieldValue,
};
