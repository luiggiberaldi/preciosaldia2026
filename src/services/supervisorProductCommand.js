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

export function applySupervisorProductCommand(currentProducts, payload = {}) {
    const products = Array.isArray(currentProducts) ? currentProducts : [];
    const { action, product, productId, baseUpdatedAt } = payload;

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

    if (action === 'edit' && baseUpdatedAt && existingIndex !== -1) {
        const currentUpdatedAt = products[existingIndex]?.updatedAt;
        if (currentUpdatedAt && Date.parse(currentUpdatedAt) > Date.parse(baseUpdatedAt)) {
            throw new Error('El producto cambió mientras lo editabas; vuelve a cargarlo');
        }
    }

    const incoming = requireProduct(action === 'edit'
        ? { ...products[existingIndex], ...(isRecord(product) ? product : {}) }
        : product);

    const nextProduct = existingIndex === -1
        ? incoming
        : { ...products[existingIndex], ...incoming, id: incoming.id };

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

export default { applySupervisorProductCommand };
