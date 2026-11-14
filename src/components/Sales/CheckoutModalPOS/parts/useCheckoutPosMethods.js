// Extraído de CheckoutModalPOS/index.jsx (COBRO fase 2): mismo código y mismo orden de cálculo.
import { usePaymentState } from '../hooks/usePaymentState';

export function useCheckoutPosMethods({ paymentMethods, copEnabled }) {
    // Separar métodos por tipo para los inputs
    const metodosActivos = paymentMethods.filter(m => !m.disabled && m.enabled !== false && !m.isInternalCredit && !m.isVirtual);
    const metodosDivisa = metodosActivos.filter(m => m.currency === 'USD');
    const metodosBs = metodosActivos.filter(m => m.currency === 'BS').sort((a, b) => {
        const isCashA = a.label?.toLowerCase().includes('efectivo');
        const isCashB = b.label?.toLowerCase().includes('efectivo');
        if (isCashA && !isCashB) return -1;
        if (!isCashA && isCashB) return 1;
        return 0;
    });
    const metodosCop = copEnabled ? metodosActivos.filter(m => m.currency === 'COP') : [];

    // Re-mapeo: paymentMethods de bodega usan {id, label, currency} pero los hooks
    // de Listo POS esperan {id, nombre, tipo}. Normalizamos aquí.
    const metodosNormalizados = metodosActivos.map(m => ({
        ...m,
        nombre: m.label || m.nombre || m.id,
        tipo: m.currency === 'BS' ? 'BS' : m.currency === 'COP' ? 'COP' : 'DIVISA',
        icono: m.icon || m.icono || 'DollarSign',
        // Referencia (últimos 4): 'required' bloquea el cobro sin ella; 'optional' solo la pide.
        requiereRef: m.refMode === 'required',
        pideRef: m.refMode === 'required' || m.refMode === 'optional',
        refFormat: m.refFormat === 'alnum' ? 'alnum' : 'digits',
    }));
    const metodosDivisaNorm = metodosNormalizados.filter(m => m.tipo === 'DIVISA');
    const metodosBsNorm = metodosNormalizados.filter(m => m.tipo === 'BS').sort((a, b) => {
        const isCashA = a.nombre.toLowerCase().includes('efectivo');
        const isCashB = b.nombre.toLowerCase().includes('efectivo');
        if (isCashA && !isCashB) return -1;
        if (!isCashA && isCashB) return 1;
        return 0;
    });
    const metodosCopNorm = copEnabled ? metodosNormalizados.filter(m => m.tipo === 'COP') : [];

    // ─── STATE ─────────────────────────────────────────────
    const {
        modo, setModo,
        clienteSeleccionado, setClienteSeleccionado,
        pagos, setPagos,
        referencias, setReferencias,
        pagoSaldoFavor, setPagoSaldoFavor,
        activeInputId, setActiveInputId,
        activeInputType, setActiveInputType,
        inputRefs,
        val,
    } = usePaymentState(null, metodosNormalizados, false);

    return {
        setClienteSeleccionado, clienteSeleccionado, metodosBsNorm, activeInputId, val, pagos,
        metodosNormalizados, pagoSaldoFavor, metodosDivisaNorm, metodosCopNorm, modo, setModo, setPagos,
        setReferencias, inputRefs, referencias, setPagoSaldoFavor, setActiveInputId, activeInputType,
        setActiveInputType,
    };
}
