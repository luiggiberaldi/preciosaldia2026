import React from 'react';
import { Tag, Banknote, AlertTriangle, Box, Minus, Plus, Pencil, Trash2, Package, Layers, Clock, Printer, FileText } from 'lucide-react';
import { CATEGORY_COLORS, CATEGORY_ICONS, UNITS } from '../../config/categories';
import { formatUsd, formatBs, formatCop, smartCashRounding, getCop, getUsd } from '../../utils/calculatorUtils';
import { showToast } from '../Toast';

export default function ProductCard({
    product: p,
    effectiveRate,
    streetRate,
    categories,
    onAdjustStock,
    copEnabled,
    copPrimary,
    tasaCop,
    daysRemaining,
    isSelected,
    onToggleSelect,
    onPrint,
    readOnly = false,

    onEdit,
    onDelete
}) {
    const effectiveUsd = getUsd(p, tasaCop);
    const valBs = effectiveUsd * effectiveRate;
    const valCop = getCop(p, tasaCop);
    const isLowStock = (p.stock ?? 0) <= (p.lowStockAlert ?? 5);
    const margin = p.costBs > 0 ? ((valBs - p.costBs) / p.costBs * 100) : null;
    const catInfo = categories.find(c => c.id === p.category);
    const unitInfo = UNITS.find(u => u.id === p.unit);
    const efectivoPrecio = streetRate > 0 ? `$${smartCashRounding(valBs / streetRate)}` : null;

    const copyTicketDebugLog = (e) => {
        e.stopPropagation();
        const mode = localStorage.getItem('label_currency_mode') || 'mixto';
        const suffix = mode === 'mixto' ? '_mixto' : '_unico';
        
        const isMixto = mode === 'mixto';
        const defNameX = isMixto ? '-1.5' : '1';
        const defNameY = isMixto ? '2' : '0';
        const defPriceX = isMixto ? '-1.5' : '1';
        const defPriceY = isMixto ? '-7.5' : '-3';
        const defSecPriceX = isMixto ? '-1.5' : '1';
        const defSecPriceY = isMixto ? '-3' : '2';
        const defFooterX = isMixto ? '-1.5' : '1';
        const defFooterY = isMixto ? '-1' : '1';

        const defFontName = isMixto ? '5' : '1';
        const defFontPrice = isMixto ? '10' : '6';
        const defFontSecPrice = isMixto ? '12.5' : '0';
        const defFontFooter = isMixto ? '4' : '2';

        const nameX = parseFloat(localStorage.getItem(`label_offset_name_x${suffix}`) || defNameX);
        const nameY = parseFloat(localStorage.getItem(`label_offset_name_y${suffix}`) || defNameY);
        const priceX = parseFloat(localStorage.getItem(`label_offset_price_x${suffix}`) || defPriceX);
        const priceYOffset = parseFloat(localStorage.getItem(`label_offset_price_y${suffix}`) || defPriceY);
        const secPriceX = parseFloat(localStorage.getItem(`label_offset_sec_price_x${suffix}`) || defSecPriceX);
        const secPriceYOffset = parseFloat(localStorage.getItem(`label_offset_sec_price_y${suffix}`) || defSecPriceY);
        const footerX = parseFloat(localStorage.getItem(`label_offset_footer_x${suffix}`) || defFooterX);
        const footerYOffset = parseFloat(localStorage.getItem(`label_offset_footer_y${suffix}`) || defFooterY);

        const fontName = parseFloat(localStorage.getItem(`label_offset_font_name${suffix}`) || defFontName);
        const fontPrice = parseFloat(localStorage.getItem(`label_offset_font_price${suffix}`) || defFontPrice);
        const fontSecPrice = parseFloat(localStorage.getItem(`label_offset_font_sec_price${suffix}`) || defFontSecPrice);
        const fontFooter = parseFloat(localStorage.getItem(`label_offset_font_footer${suffix}`) || defFontFooter);

        // --- CÁLCULO FÍSICO DE COORDENADAS REALES (Misma lógica que labelGenerator.js) ---
        const LABEL_W = 58;
        const hasSecondaryPrice = copEnabled && tasaCop > 0;
        let labelH = mode === 'mixto' ? 60 : (hasSecondaryPrice ? 50 : 44);
        const marginX = 4.5;
        const marginY = 3.5;

        // Eje central compensado
        let centerX = mode === 'mixto' ? (LABEL_W / 2 - 3) : (LABEL_W / 2 + 0.5);

        // 1. TÍTULO
        const titleStartY = marginY + 2.5; // 6 mm
        const finalTitleY = titleStartY + nameY;
        let titleFontSize = (mode === 'bs' || mode === 'usd') ? 11.5 : 10;
        let calcTitleFontSize = titleFontSize + fontName;
        if (calcTitleFontSize < 5) calcTitleFontSize = 5;
        // Altura del bloque de título
        const isLongName = p.name.length > 18;
        const linesCount = isLongName ? 2 : 1;
        const titleHeight = linesCount * (calcTitleFontSize * 0.3527 * 1.25);
        const titleEndY = titleStartY + titleHeight;

        // 2. FOOTER
        const footerY = labelH - marginY - 2;
        const finalFooterY = footerY + footerYOffset;
        const footerStartY = hasSecondaryPrice ? footerY - 5.5 : footerY - 1.5;

        // 3. PRECIOS
        const freeSpace = footerStartY - titleEndY;
        let finalPriceFontSize = (mode === 'mixto' ? 24 : 28) + fontPrice;
        if (finalPriceFontSize < 5) finalPriceFontSize = 5;
        let finalSecondaryFontSize = 11 + fontSecPrice;
        if (finalSecondaryFontSize < 5) finalSecondaryFontSize = 5;

        let priceHeight = finalPriceFontSize * 0.3527 * 0.75;
        let secondaryHeight = finalSecondaryFontSize * 0.3527 * 0.75;
        const showSecondary = mode === 'mixto';
        let priceBlockHeight = showSecondary ? (priceHeight + secondaryHeight + 3.5) : priceHeight;

        // Proporcional
        const maxAllowedBlockHeight = freeSpace * 0.82;
        if (priceBlockHeight > maxAllowedBlockHeight && maxAllowedBlockHeight > 4) {
            const scaleFactor = maxAllowedBlockHeight / priceBlockHeight;
            finalPriceFontSize = Math.max(5, finalPriceFontSize * scaleFactor);
            finalSecondaryFontSize = Math.max(5, finalSecondaryFontSize * scaleFactor);
            priceHeight = finalPriceFontSize * 0.3527 * 0.75;
            secondaryHeight = finalSecondaryFontSize * 0.3527 * 0.75;
            priceBlockHeight = showSecondary ? (priceHeight + secondaryHeight + 3.5) : priceHeight;
        }

        const calculatedPriceY = titleEndY + ((freeSpace - priceBlockHeight) / 2) + priceHeight;
        const finalPriceY = calculatedPriceY + priceYOffset;

        const calculatedSecPriceY = calculatedPriceY + secondaryHeight + 3.5;
        const finalSecPriceY = calculatedSecPriceY + secPriceYOffset;

        // Formatear texto del log con coordenadas reales en mm
        const logString = `=== COORDENADAS FÍSICAS DE ETIQUETA REAL (jsPDF) ===
Producto: ${p.name.toUpperCase()}
Modo Moneda: ${mode.toUpperCase()}
Dimensiones de Hoja: ${LABEL_W}mm ancho x ${labelH}mm alto
Tasa BCV: ${effectiveRate} Bs | Tasa COP: ${tasaCop || 'N/A'}
Margen Horizontal Central (Compensado): X = ${centerX.toFixed(2)} mm

--- ELEMENTOS Y COORDENADAS FÍSICAS EN PAPEL ---
[TÍTULO DEL PRODUCTO]
  * X Central (Base): ${centerX.toFixed(2)} mm  |  Con Desplazamiento X: ${(centerX + nameX).toFixed(2)} mm
  * Y Baseline (Base): ${titleStartY.toFixed(2)} mm  |  Con Calibración Y: ${finalTitleY.toFixed(2)} mm
  * Tamaño Fuente: ${calcTitleFontSize.toFixed(1)} pt  |  Líneas Estimadas: ${linesCount}

[PRECIO PRINCIPAL]
  * X Central (Base): ${centerX.toFixed(2)} mm  |  Con Desplazamiento X: ${(centerX + priceX).toFixed(2)} mm
  * Y Baseline (Base): ${calculatedPriceY.toFixed(2)} mm  |  Con Calibración Y: ${finalPriceY.toFixed(2)} mm
  * Tamaño Fuente: ${finalPriceFontSize.toFixed(1)} pt

${showSecondary ? `[PRECIO SECUNDARIO]
  * X Central (Base): ${centerX.toFixed(2)} mm  |  Con Desplazamiento X: ${(centerX + secPriceX).toFixed(2)} mm
  * Y Baseline (Base): ${calculatedSecPriceY.toFixed(2)} mm  |  Con Calibración Y: ${finalSecPriceY.toFixed(2)} mm
  * Tamaño Fuente: ${finalSecondaryFontSize.toFixed(1)} pt` : '[PRECIO SECUNDARIO]: Inactivo en este modo'}

[PIE DE PÁGINA (BARCODE/FECHA)]
  * X Central (Base): ${centerX.toFixed(2)} mm  |  Con Desplazamiento X: ${(centerX + footerX).toFixed(2)} mm
  * Y Baseline (Base): ${footerY.toFixed(2)} mm  |  Con Calibración Y: ${finalFooterY.toFixed(2)} mm
  * Tamaño Fuente: ${(6.5 + fontFooter).toFixed(1)} pt`;

        navigator.clipboard.writeText(logString).then(() => {
            showToast('¡Coordenadas reales copiadas al portapapeles!', 'success');
        }).catch((err) => {
            console.error('Error al copiar log:', err);
            showToast('Error al copiar coordenadas reales', 'error');
        });
    };

    return (
        <div className={`bg-white dark:bg-slate-900 rounded-2xl shadow-sm border flex flex-col overflow-hidden group ${isLowStock ? 'border-amber-300 dark:border-amber-700' : 'border-slate-100 dark:border-slate-800'} ${isSelected ? 'ring-2 ring-brand border-brand shadow-brand/20 bg-brand/5 dark:bg-brand/10' : ''}`}>
            {/* Image */}
            <div className="w-full h-24 lg:h-20 bg-white dark:bg-slate-900 overflow-hidden relative shrink-0">
                {/* Select Checkbox */}
                <div className="absolute top-1 left-1 z-10 w-6 h-6 flex items-center justify-center bg-white/80 dark:bg-slate-900/80 rounded backdrop-blur-sm">
                    <input type="checkbox" checked={isSelected} onChange={onToggleSelect} className="w-4 h-4 rounded border-slate-300 text-brand focus:ring-brand cursor-pointer shadow-sm" />
                </div>
                {p.image ? (
                    <img src={p.image} className="w-full h-full object-contain p-1" alt={p.name} loading="lazy" />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-300 dark:text-slate-600">
                        <Tag size={24} />
                    </div>
                )}
                {/* Category badge */}
                {catInfo && catInfo.id !== 'otros' && (
                    <div className={`absolute top-1 left-8 text-[9px] font-bold px-1.5 py-0.5 rounded flex items-center gap-0.5 ${CATEGORY_COLORS[catInfo.color] || ''}`}>
                        {(() => { const CatIcon = CATEGORY_ICONS[catInfo.id]; return CatIcon ? <CatIcon size={9} /> : catInfo.icon; })()} {catInfo.label}
                    </div>
                )}
                {/* Low stock alert */}
                {isLowStock && (
                    <div className="absolute top-1 right-1 bg-amber-500/90 backdrop-blur-sm text-white text-[9px] font-black px-1.5 py-0.5 rounded flex items-center gap-0.5">
                        <AlertTriangle size={9} /> Bajo
                    </div>
                )}
            </div>

            {/* Info */}
            <div className="p-3 lg:p-2.5 flex flex-col flex-1">
                <h3 className="font-bold text-slate-700 dark:text-slate-200 text-[13px] lg:text-[12px] leading-tight line-clamp-2 mb-2">{p.name}</h3>

                {/* Units per package info */}
                {p.unit === 'paquete' && p.unitsPerPackage && (
                    <div className="flex items-center gap-1 text-[10px] font-bold text-brand dark:text-brand mb-2 mt-[-4px]">
                        <Package size={11} /> Bulto · {p.unitsPerPackage} uds
                    </div>
                )}

                <div className="flex justify-between items-end mb-3">
                    <div>
                        {copEnabled && tasaCop > 0 ? (
                            copPrimary ? (
                                <>
                                    <p className="text-lg lg:text-base font-black text-amber-600 dark:text-amber-400 leading-none">
                                        {formatCop(valCop)} <span className="text-[10px] font-bold text-amber-600/50 dark:text-amber-400/50">COP {(p.unit === 'kg' || p.unit === 'litro') ? `/ ${unitInfo?.short || 'ud'}` : ''}</span>
                                    </p>
                                    <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                                        <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 px-1.5 py-0.5 rounded">{formatUsd(effectiveUsd)} USD</span>
                                        <span className="text-[10px] font-bold text-brand-dark dark:text-brand bg-brand-light dark:bg-surface-800/20 px-1.5 py-0.5 rounded">{formatBs(valBs)} Bs</span>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <p className="text-lg lg:text-base font-black text-emerald-600 dark:text-emerald-400 leading-none">
                                        {formatUsd(effectiveUsd)} <span className="text-[10px] font-bold text-emerald-600/50 dark:text-emerald-400/50">USD {(p.unit === 'kg' || p.unit === 'litro') ? `/ ${unitInfo?.short || 'ud'}` : ''}</span>
                                    </p>
                                    <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                                        <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-1.5 py-0.5 rounded">{formatCop(valCop)} COP</span>
                                        <span className="text-[10px] font-bold text-brand-dark dark:text-brand bg-brand-light dark:bg-surface-800/20 px-1.5 py-0.5 rounded">{formatBs(valBs)} Bs</span>
                                    </div>
                                </>
                            )
                        ) : (
                            <>
                                <p className="text-lg lg:text-base font-black text-emerald-600 dark:text-emerald-400 leading-none">
                                    {formatUsd(effectiveUsd)} <span className="text-[10px] font-bold text-emerald-600/50 dark:text-emerald-400/50">USD {(p.unit === 'kg' || p.unit === 'litro') ? `/ ${unitInfo?.short || 'ud'}` : ''}</span>
                                </p>
                                <p className="text-[11px] font-bold text-slate-400 mt-1">{formatBs(valBs)} Bs</p>
                            </>
                        )}
                        {p.unit === 'paquete' && p.sellByUnit && (
                            <p className="text-[10px] font-bold text-brand dark:text-brand mt-0.5 flex items-center gap-0.5">
                                <Layers size={10} />
                                {copEnabled && tasaCop > 0
                                    ? copPrimary
                                        ? `${formatCop(p.unitPriceCop || (p.priceCop ? Math.round(p.priceCop / (p.unitsPerPackage || 1)) : Math.round((p.unitPriceUsd ?? effectiveUsd / (p.unitsPerPackage || 1)) * tasaCop)))} COP / ud · $${(p.unitPriceUsd ?? effectiveUsd / (p.unitsPerPackage || 1)).toFixed(2)}`
                                        : `$${(p.unitPriceUsd ?? effectiveUsd / (p.unitsPerPackage || 1)).toFixed(2)} / ud · ${formatCop(p.unitPriceCop || (p.priceCop ? Math.round(p.priceCop / (p.unitsPerPackage || 1)) : Math.round((p.unitPriceUsd ?? effectiveUsd / (p.unitsPerPackage || 1)) * tasaCop)))} COP`
                                    : `$${(p.unitPriceUsd ?? effectiveUsd / (p.unitsPerPackage || 1)).toFixed(2)} / ud`
                                }
                            </p>
                        )}
                    </div>
                    {!readOnly && margin !== null && (
                        <span className={`text-[10px] font-black px-2 py-1 rounded-lg ${margin >= 0 ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400' : 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400'}`}>
                            {margin >= 0 ? '+' : ''}{margin.toFixed(0)}%
                        </span>
                    )}
                </div>

                {/* Stock Control Prominente */}
                <div className="mt-auto pt-2 border-t border-slate-100 dark:border-slate-800">
                    <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-800/50 rounded-xl p-1">
                        {!readOnly && (
                        <button onClick={() => onAdjustStock(p.id, -1)} className="w-10 h-10 rounded-lg bg-white dark:bg-slate-700 flex items-center justify-center text-slate-500 hover:text-red-500 shadow-sm active:scale-95 transition-all">
                            <Minus size={18} strokeWidth={2.5} />
                        </button>
                        )}
                        <div className="flex flex-col items-center justify-center px-2 text-center min-w-[50px]">
                            <span className={`text-base font-black leading-none mb-0.5 ${isLowStock ? 'text-amber-500' : 'text-slate-700 dark:text-slate-200'}`}>
                                {p.stock ?? 0}
                            </span>
                            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider leading-none">{(p.unit === 'kg' || p.unit === 'litro') ? unitInfo?.short : 'UND'}</span>
                            {p.unit === 'paquete' && p.unitsPerPackage > 0 && Math.floor((p.stock ?? 0) / p.unitsPerPackage) > 0 && (
                                <span className="text-[8px] text-slate-400 leading-none">= {Math.floor((p.stock ?? 0) / p.unitsPerPackage)} bultos</span>
                            )}
                        </div>
                        {!readOnly && (
                        <button onClick={() => onAdjustStock(p.id, 1)} className="w-10 h-10 rounded-lg bg-white dark:bg-slate-700 flex items-center justify-center text-slate-500 hover:text-emerald-500 shadow-sm active:scale-95 transition-all">
                            <Plus size={18} strokeWidth={2.5} />
                        </button>
                        )}
                    </div>

                    {/* Days Remaining Badge */}
                    {daysRemaining !== null && daysRemaining !== undefined && (
                        <div className={`flex items-center justify-center gap-1 mt-1.5 py-1 rounded-lg text-[10px] font-bold ${
                            daysRemaining <= 3
                                ? 'bg-red-50 dark:bg-red-900/20 text-red-500'
                                : daysRemaining <= 7
                                    ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-500'
                                    : 'bg-brand-light dark:bg-surface-800/20 text-brand'
                        }`}>
                            <Clock size={10} />
                            {daysRemaining <= 3
                                ? `Agotado en ~${daysRemaining}d`
                                : `~${daysRemaining} dias de stock`
                            }
                        </div>
                    )}
                </div>
            </div>

            {/* Actions */}
            <div className="flex border-t border-slate-100 dark:border-slate-800 bg-slate-50/30 dark:bg-slate-800/20">
                <button 
                    onClick={onPrint} 
                    className="flex-1 py-2 flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-brand hover:bg-brand/10 transition-colors border-r border-slate-100 dark:border-slate-800" 
                    title="Imprimir Etiqueta"
                >
                    <Printer size={15} />
                </button>

                {!readOnly && (
                    <button 
                        onClick={() => onEdit(p)} 
                        className="flex-1 py-2 flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/30 transition-colors border-r border-slate-100 dark:border-slate-800"
                    >
                        <Pencil size={15} />
                    </button>
                )}
                {!readOnly && (
                    <button 
                        onClick={() => onDelete(p.id)} 
                        className="flex-1 py-2 flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
                    >
                        <Trash2 size={15} />
                    </button>
                )}
            </div>
        </div >
    );
}
