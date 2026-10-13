const formatDecimal = (value, maximumFractionDigits) => new Intl.NumberFormat('en-US', {
    maximumFractionDigits,
    useGrouping: false,
}).format(value);

export function costFactorFromMarginPercent(value) {
    if (value === null || value === undefined || String(value).trim() === '') return '';
    const marginPercent = Number(value);
    if (!Number.isFinite(marginPercent)) return '';
    return formatDecimal(1 - marginPercent / 100, 3);
}

export function formatCostFactorAsMarginPercent(costFactor) {
    const factor = Number(costFactor);
    if (!costFactor || !Number.isFinite(factor) || factor <= 0) return '';
    return formatDecimal((1 - factor) * 100, 1);
}
