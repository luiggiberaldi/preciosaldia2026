import React, { useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useProductContext } from '../../context/ProductContext';
import { findSimilarNames } from '../../utils/similarName';

/**
 * Aviso en vivo (sin bloquear) bajo el campo de nombre: muestra artículos existentes con nombre
 * igual o parecido mientras se escribe. `exceptId` es el artículo que se está editando.
 */
export default function SimilarNameHint({ name, exceptId = null, products: productsProp }) {
    const ctx = useProductContext();
    const products = productsProp ?? ctx?.products ?? [];
    const matches = useMemo(
        () => findSimilarNames(products, name, { exceptId, limit: 3 }),
        [products, name, exceptId],
    );
    if (matches.length === 0) return null;

    const exact = matches.find((m) => m.exact);
    const others = matches.filter((m) => m !== exact);

    return (
        <div
            role="status"
            aria-live="polite"
            data-testid="similar-name-hint"
            className="mt-1.5 ml-1 flex items-start gap-1.5 rounded-xl border border-amber-300/80 bg-amber-50 px-2.5 py-1.5 text-xs font-bold text-amber-800 dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-300"
        >
            <AlertTriangle size={14} className="shrink-0 mt-0.5" aria-hidden="true" />
            <span>
                {exact
                    ? `Ya existe «${exact.product.name}»${others.length ? ` (también parecido: ${others.map((m) => `«${m.product.name}»`).join(', ')})` : ''}.`
                    : `Nombre parecido a: ${matches.map((m) => `«${m.product.name}»`).join(', ')}.`}
            </span>
        </div>
    );
}
