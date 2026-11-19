import React, { useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useProductContext } from '../../context/ProductContext';
import { findOtherProductWithCode } from '../../utils/barcodeAssign';

/**
 * Aviso en vivo bajo el campo de código de barras: si otro artículo ya tiene ese código, lo dice
 * mientras se escribe (Guardar lo rechazaría igual). `exceptId` es el artículo que se está editando.
 * `products` es opcional: si no llega, se usa el catálogo del contexto.
 */
export default function BarcodeDuplicateHint({ barcode, exceptId = null, products: productsProp }) {
    const ctx = useProductContext();
    const products = productsProp ?? ctx?.products ?? [];
    const owner = useMemo(() => {
        const code = String(barcode ?? '').trim();
        return code ? findOtherProductWithCode(products, code, exceptId) : null;
    }, [products, barcode, exceptId]);
    if (!owner) return null;
    return (
        <p role="alert" data-testid="barcode-duplicate-hint"
            className="mt-1.5 ml-1 flex items-start gap-1.5 text-xs font-bold text-rose-600 dark:text-rose-400">
            <AlertTriangle size={14} className="shrink-0 mt-px" aria-hidden="true" />
            <span>Este código ya lo tiene «{owner.name}». Usa otro código o edita ese artículo.</span>
        </p>
    );
}
