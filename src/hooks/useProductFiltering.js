import { useMemo, useDeferredValue } from 'react';
import { isLowStockProduct } from '../utils/granel';
import { matchesSearch as matchesSearchFields } from '../utils/searchMatch';
import { marginOverPricePercent } from '../utils/productCostFactor';

export function useProductFiltering(products, searchTerm, activeCategory, sortField, sortDir, effectiveRate) {
    const deferredSearchTerm = useDeferredValue(searchTerm);

    const filteredProducts = useMemo(() => {
        let result = products.filter(p => {
            const matchesSearch = matchesSearchFields([p.name, p.barcode], deferredSearchTerm);
            if (activeCategory === 'bajo-stock') {
                return matchesSearch && isLowStockProduct(p);
            }
            const matchesCategory = activeCategory === 'todos' || p.category === activeCategory;
            return matchesSearch && matchesCategory;
        });

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
