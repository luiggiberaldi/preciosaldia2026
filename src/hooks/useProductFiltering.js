import { useMemo, useDeferredValue } from 'react';
import { isLowStockProduct } from '../utils/granel';
import { matchesSearch as matchesSearchFields } from '../utils/searchMatch';
import { marginOverPricePercent } from '../utils/productCostFactor';
import { DUPLICATE_CODE_FILTER, findDuplicateCodeIndex } from '../utils/barcodeAssign';

export function useProductFiltering(products, searchTerm, activeCategory, sortField, sortDir, effectiveRate) {
    const deferredSearchTerm = useDeferredValue(searchTerm);

    const filteredProducts = useMemo(() => {
        // Revisión de códigos repetidos: solo los artículos que comparten código, agrupados.
        const dupIndex = activeCategory === DUPLICATE_CODE_FILTER ? findDuplicateCodeIndex(products) : null;
        let result = products.filter(p => {
            const matchesSearch = matchesSearchFields([p.name, p.barcode], deferredSearchTerm);
            if (dupIndex) return matchesSearch && dupIndex.has(String(p.id));
            if (activeCategory === 'bajo-stock') {
                return matchesSearch && isLowStockProduct(p);
            }
            const matchesCategory = activeCategory === 'todos' || p.category === activeCategory;
            return matchesSearch && matchesCategory;
        });

        if (dupIndex && !sortField) {
            result = [...result].sort((a, b) => dupIndex.get(String(a.id)).localeCompare(dupIndex.get(String(b.id))));
        }

        // Apply sort if active
        if (sortField) {
            result = [...result].sort((a, b) => {
                let valA, valB;
                switch (sortField) {
                    case 'name': valA = a.name.toLowerCase(); valB = b.name.toLowerCase(); break;
                    case 'price': valA = a.priceUsdt || 0; valB = b.priceUsdt || 0; break;
                    case 'stock': valA = a.stock ?? 0; valB = b.stock ?? 0; break;
                    case 'margin': {
                        const costA = a.costUsd || (a.costBs && effectiveRate > 0 ? a.costBs / effectiveRate : 0);
                        const costB = b.costUsd || (b.costBs && effectiveRate > 0 ? b.costBs / effectiveRate : 0);
                        valA = marginOverPricePercent(a.priceUsdt, costA) ?? -999;
                        valB = marginOverPricePercent(b.priceUsdt, costB) ?? -999;
                        break;
                    }
                    default: valA = 0; valB = 0;
                }
                if (valA < valB) return sortDir === 'asc' ? -1 : 1;
                if (valA > valB) return sortDir === 'asc' ? 1 : -1;
                return 0;
            });
        }
        return result;
    }, [products, deferredSearchTerm, activeCategory, sortField, sortDir, effectiveRate]);

    return { filteredProducts };
}
