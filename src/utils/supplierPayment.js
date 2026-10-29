/**
 * Registro `PAGO_PROVEEDOR` que se guarda en `bodega_sales_v1` (puro, sin I/O).
 * Lo comparten el pago normal y la factura cargada como «ya pagada», para que
 * ambos aparezcan igual en Reportes › Gastos, el arqueo y el estado de cuenta.
 */
export function buildSupplierPaymentRecord({
    supplier,
    amountUsd,
    amountBs,
    amountCop,
    exchangeRate,
    rateType,
    paymentMethod,
    currencyMode,
    retiraCaja,
    invoiceId = null,
    description = null,
    tasaCop = 0,
    copEnabled = false,
    timestamp = new Date().toISOString(),
    id = crypto.randomUUID(),
}) {
    const totalEnUsd = amountUsd;
    const totalEnBs = amountBs;
    const totalEnCop = currencyMode === 'COP' ? amountCop : (amountUsd * tasaCop);

    return {
        id,
        timestamp,
        tipo: 'PAGO_PROVEEDOR',
        supplierId: supplier.id,
        supplierName: supplier.name,
        exchangeRate,
        rateType: rateType || 'bcv',
        totalBs: -totalEnBs,
        totalUsd: -totalEnUsd,
        ...(copEnabled && { totalCop: -totalEnCop }),
        paymentMethod,
        afectaCaja: retiraCaja, // sostiene si descuenta de caja
        ...(invoiceId && { invoiceId }), // factura elegida; sin ella el pago se reparte FIFO
        ...(description && { description }), // texto del estado de cuenta (app y PDF)
        payments: [{
            methodId: paymentMethod,
            amountUsd: currencyMode === 'USD' ? -totalEnUsd : 0,
            amountBs: currencyMode === 'BS' ? -totalEnBs : 0,
            ...(copEnabled && { amountCop: currencyMode === 'COP' ? -totalEnCop : 0 }),
            currency: currencyMode,
            methodLabel: retiraCaja ? 'Pago a Proveedor' : 'Pago Externo a Proveedor',
        }],
        items: [{ name: `Pago a proveedor: ${supplier.name}${retiraCaja ? '' : ' (Externo)'}`, qty: 1, priceUsd: -totalEnUsd, costBs: 0 }],
    };
}
