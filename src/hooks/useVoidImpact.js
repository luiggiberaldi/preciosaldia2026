import { useEffect, useState } from 'react';
import { storageService } from '../utils/storageService';
import { CUSTOMER_LEDGER_KEY } from '../utils/customerLedger';
import { previewVoidCustomerImpact, describeVoidImpact } from '../utils/voidImpact';

/**
 * F3 (PLAN-FIXEO-CLIENTES-BILLETERA): al abrir la confirmación de anular una
 * venta, lee el cliente y el ledger frescos y devuelve las líneas del aviso
 * («Cuenta de María: al día → debe $5,00», y «⚠ quedará debiendo…» si aplica).
 */
export function useVoidImpact(sale, rate = 0) {
    const [lines, setLines] = useState([]);
    useEffect(() => {
        let vivo = true;
        setLines([]);
        if (!sale?.customerId) return undefined;
        Promise.all([
            storageService.getItem('bodega_customers_v1', []),
            storageService.getItem(CUSTOMER_LEDGER_KEY, []),
        ]).then(([customers, ledger]) => {
            if (!vivo) return;
            const customer = (Array.isArray(customers) ? customers : []).find(c => c.id === sale.customerId);
            setLines(describeVoidImpact(previewVoidCustomerImpact(sale, customer, ledger), rate));
        }).catch(() => { if (vivo) setLines([]); });
        return () => { vivo = false; };
    }, [sale, rate]);
    return lines;
}
