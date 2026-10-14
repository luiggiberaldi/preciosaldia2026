import { describe, expect, it } from 'vitest';
import { buildProductPayload } from '../src/utils/productProcessor.js';
import { prepareProductFormState } from '../src/hooks/useProductForm.js';
import { resolveLineIvaRate } from '../src/config/taxConfig.js';

const baseForm = {
    name: 'Champu Papeleta',
    priceUsd: '10',
    costUsd: '5',
    stock: '3',
    packagingType: 'suelto',
    category: 'otros',
    lowStockAlert: '5',
};

describe('tasa de IVA por producto', () => {
    it('exento guarda ivaRate 0 en el payload', () => {
        const payload = buildProductPayload({ ...baseForm, ivaMode: 'exento' }, 40);
        expect(payload.ivaRate).toBe(0);
    });

    it('general deja ivaRate indefinido para que la fusión borre un exento anterior', () => {
        const payload = buildProductPayload({ ...baseForm, ivaMode: '' }, 40);
        expect(payload.ivaRate).toBeUndefined();
        const merged = { id: 'p1', priceUsd: 5, ivaRate: 0, ...payload };
        expect(merged.ivaRate).toBeUndefined();
    });

    it('carga un producto exento como modo exento y uno sin campo como general', () => {
        const exento = prepareProductFormState({ id: 'p1', name: 'X', priceUsd: 5, ivaRate: 0 }, 40);
        const general = prepareProductFormState({ id: 'p2', name: 'Y', priceUsd: 5 }, 40);
        expect(exento.ivaMode).toBe('exento');
        expect(general.ivaMode).toBe('');
    });

    it('el exento produce 0% de IVA en el cálculo de la línea aunque el IVA general esté activo', () => {
        const taxConfig = { ivaEnabled: true, ivaRate: 16 };
        const exentoItem = { ivaRate: 0 };
        const generalItem = {};
        expect(resolveLineIvaRate(exentoItem, taxConfig)).toBe(0);
        expect(resolveLineIvaRate(generalItem, taxConfig)).toBe(16);
    });
});
