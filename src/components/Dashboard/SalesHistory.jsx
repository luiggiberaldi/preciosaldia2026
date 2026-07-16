import React, { useState } from 'react';
import { Clock, Send, Ban, ChevronDown, ChevronUp, Trash2, Shuffle, Recycle, Receipt, Printer, LockIcon, CornerDownLeft, Smartphone, DollarSign } from 'lucide-react';
import { formatBs, formatCop } from '../../utils/calculatorUtils';
import { getPaymentLabel, getPaymentMethod, PAYMENT_ICONS, toTitleCase, getPaymentIcon } from '../../config/paymentMethods';
import EmptyState from '../EmptyState';
import { printerSerial } from '../../services/PrinterSerial';
import { showToast } from '../Toast';
import CasheaIcon from '../CasheaIcon';
import { usePagination } from '../../hooks/usePagination';
import PaginationBar from '../PaginationBar';

export default function SalesHistory({
    recentSales,
    bcvRate,
    totalSalesCount,
    onVoidSale,
    onShareWhatsApp,
    onDownloadPDF,
    onOpenDeleteModal,
    onRequestClientForTicket,
    onRecycleSale,
    onPrintTicket,
    isAdmin,
    copEnabled,
    copPrimary,
    tasaCop
}) {
    const [expandedSaleId, setExpandedSaleId] = useState(null);
    const [printingId, setPrintingId] = useState(null);

    const {
        currentPage,
        totalPages,
        paginatedItems: paginatedSales,
        goNext,
        goPrev,
        hasNext,
        hasPrev,
        startIndex,
        endIndex,
        totalItems,
    } = usePagination(recentSales, 10);

    const handleThermalPrint = async (e, sale) => {
        e.stopPropagation();
        if (!printerSerial.isSupported()) {
            showToast('Tu navegador no soporta impresoras seriales. Usa Chrome o Edge.', 'error');
            return;
        }
        try {
            if (!printerSerial.isConnected()) {
                const connected = await printerSerial.connect();
                if (!connected) return;
            }
            setPrintingId(sale.id);
            await printerSerial.printTicket(sale, bcvRate);
            showToast('Ticket impreso correctamente', 'success');
        } catch (err) {
            showToast('Error al imprimir: ' + (err.message || 'desconocido'), 'error');
        } finally {
            setPrintingId(null);
        }
    };

    if (recentSales.length === 0) {
        return (
            <div className="mb-20 mt-4">
                <EmptyState
                    icon={Receipt}
                    title="Aún no hay ventas"
                    description="Las ventas recientes aparecerán aquí una vez que comiences a facturar."
                />
            </div>
        );
    }

    return (
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-100 dark:border-slate-800 shadow-sm mb-20">
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-bold text-slate-400 uppercase flex items-center gap-1">
                    <Clock size={12} /> Historial de Ventas
                </h3>
                <div className="flex items-center gap-2">
                    <span className="text-[10px] text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full">{totalSalesCount} histórico</span>
                    {isAdmin && (
                        <button
                            onClick={onOpenDeleteModal}
                            className="text-slate-300 hover:text-red-500 transition-colors bg-slate-50 hover:bg-red-50 p-1.5 rounded-lg"
                            title="Borrar historial"
                        >
                            <Trash2 size={14} />
                        </button>
                    )}
                </div>
            </div>
            <div className="space-y-3">
                {paginatedSales.map(s => {
                    const d = new Date(s.timestamp);
                    const hasCashea = (s.payments && s.payments.some(p => 
                        (p.methodId && p.methodId.toLowerCase().includes('cashea')) || 
                        (p.methodLabel && p.methodLabel.toLowerCase().includes('cashea')) || 
                        p.isCashea
                    )) || (s.casheaUsd > 0) || (s.tipo === 'VENTA_CASHEA');

                    let methodLabel = 'Efectivo';
                    let PayMethodIcon = PAYMENT_ICONS['efectivo_bs'];

                    if (s.tipo === 'VENTA_FIADA') {
                        methodLabel = 'Por Cobrar';
                        PayMethodIcon = Clock;
                    } else if (s.payments && s.payments.length > 1) {
                        methodLabel = hasCashea ? 'Mixto (Cashea)' : 'Pago Mixto';
                        PayMethodIcon = Shuffle;
                    } else if (s.tipo === 'VENTA_CASHEA' || hasCashea) {
                        methodLabel = 'Cashea';
                        PayMethodIcon = Smartphone;
                    } else if (s.payments && s.payments.length === 1) {
                        methodLabel = toTitleCase(s.payments[0].methodLabel);
                        const m = getPaymentMethod(s.payments[0].methodId);
                        if (m) PayMethodIcon = getPaymentIcon(m.id) || m.Icon || null;
                    } else if (s.paymentMethod) {
                        const m = getPaymentMethod(s.paymentMethod);
                        if (m) {
                            methodLabel = toTitleCase(m.label);
                            PayMethodIcon = getPaymentIcon(m.id) || m.Icon || null;
                        }
                    }

                    const isCanceled = s.status === 'ANULADA';
                    const isExpanded = expandedSaleId === s.id;

                    return (
                        <div key={s.id} className={`rounded-xl border transition-all ${isCanceled ? 'bg-red-50/50 border-red-100/50 dark:bg-red-900/10 dark:border-red-900/20' : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200/60 dark:border-slate-700/60'} overflow-hidden`}>
                            <div
                                className="flex items-center gap-3 p-3 cursor-pointer select-none active:bg-slate-100 dark:active:bg-slate-800"
                                onClick={() => setExpandedSaleId(isExpanded ? null : s.id)}
                            >
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                                    isCanceled 
                                        ? 'bg-red-100 opacity-50' 
                                        : hasCashea
                                            ? 'bg-purple-150 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800'
                                            : 'bg-white dark:bg-slate-700 shadow-sm'
                                }`}>
                                    {isCanceled ? (
                                        <Ban size={20} className="text-red-400" />
                                    ) : (s.tipo === 'VENTA_CASHEA' || (hasCashea && !(s.payments && s.payments.length > 1))) ? (
                                        <CasheaIcon size={24} />
                                    ) : PayMethodIcon ? (
                                        <PayMethodIcon size={20} className="text-slate-500 dark:text-slate-400" />
                                    ) : (
                                        <span className="text-xl">💵</span>
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className={`text-sm font-bold flex items-center gap-1.5 truncate ${isCanceled ? 'line-through text-slate-400' : 'text-slate-800 dark:text-slate-200'}`}>
                                        {s.tipo === 'AVANCE_EFECTIVO' ? 'Avance de Efectivo' : (s.customerName || 'Consumidor Final')} 
                                        {s.tipo === 'VENTA_FIADA' && <span className="text-[9px] bg-amber-100 text-amber-600 px-1 rounded uppercase font-black">Fiado</span>}
                                        {hasCashea && <span className="text-[9px] bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-400 px-1.5 py-0.5 rounded uppercase font-black flex items-center gap-0.5"><CasheaIcon size={10} /> Cashea</span>}
                                    </p>
                                    <p className="text-[11px] text-slate-500 flex items-center gap-1">
                                        {s.saleNumber && <span className="font-black text-slate-400">#{String(s.saleNumber).padStart(7, '0')}</span>}
                                        {s.saleNumber && <span>·</span>}
                                        <span>{d.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })}</span> ·
                                        <span>{methodLabel}</span>
                                    </p>
                                </div>
                                <div className="text-right shrink-0">
                                    <p className={`text-sm font-black ${isCanceled ? 'text-slate-400' : copEnabled && copPrimary ? 'text-amber-600 dark:text-amber-400' : 'text-slate-800 dark:text-white'}`}>
                                        {copEnabled && copPrimary
                                            ? `${formatCop((s.totalUsd || 0) * tasaCop)} COP`
                                            : `$${(s.totalUsd || 0).toFixed(2)}`}
                                    </p>
                                    {copEnabled && tasaCop > 0 && (
                                        <p className="text-[10px] font-medium">
                                            {copPrimary
                                                ? <><span className="text-slate-500 dark:text-slate-400">${(s.totalUsd || 0).toFixed(2)}</span><span className="text-slate-300 mx-0.5">|</span></>
                                                : <><span className="text-amber-600 dark:text-amber-400">{formatCop((s.totalUsd || 0) * tasaCop)} COP</span><span className="text-slate-300 mx-0.5">|</span></>}
                                            <span className="text-brand dark:text-brand">{formatBs((s.totalBs || (s.totalUsd || 0) * (s.rate || bcvRate)))} Bs</span>
                                        </p>
                                    )}
                                    <div className="flex justify-end mt-0.5">
                                        {isExpanded ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
                                    </div>
                                </div>
                            </div>

                            {/* Expanded details */}
                            {isExpanded && (
                                <div className="px-3 pb-3 pt-1 border-t border-slate-200 dark:border-slate-700/50 text-sm animate-in fade-in slide-in-from-top-1">
                                    {s.tipo === 'AVANCE_EFECTIVO' ? (
                                        <div className="space-y-1 mb-3 pt-2">
                                            <p className="text-[10px] font-bold uppercase text-slate-400 tracking-wider mb-1">Detalles del Avance</p>
                                            <div className="flex justify-between items-center text-xs text-slate-600 dark:text-slate-400">
                                                <span>Efectivo Entregado:</span>
                                                <strong className="font-bold text-slate-800 dark:text-white">
                                                    {s.currency === 'BS' ? `${formatBs(s.montoEfectivo)} Bs` : `$${s.montoEfectivo.toFixed(2)}`}
                                                </strong>
                                            </div>
                                            <div className="flex justify-between items-center text-xs text-slate-600 dark:text-slate-400">
                                                <span>Comisión Recargada ({s.comisionPct}%):</span>
                                                <strong className="font-bold text-emerald-600 dark:text-emerald-450">
                                                    {s.currency === 'BS' ? `+${formatBs(s.montoComision)} Bs` : `+$${s.montoComision.toFixed(2)}`}
                                                </strong>
                                            </div>
                                            <div className="flex justify-between items-center text-xs text-slate-700 dark:text-slate-200 pt-1 border-t border-slate-200/50 dark:border-slate-800/50">
                                                <span>Total Cobrado:</span>
                                                <strong className="font-black text-brand">
                                                    {s.currency === 'BS' ? `${formatBs(s.totalCobrado)} Bs` : `$${s.totalCobrado.toFixed(2)}`}
                                                </strong>
                                            </div>
                                        </div>
                                    ) : s.items && s.items.length > 0 ? (
                                        <div className="space-y-1 mb-3 pt-2">
                                            <p className="text-[10px] font-bold uppercase text-slate-400 tracking-wider mb-1">Productos ({s.items.length})</p>
                                            {s.items.map((item, i) => (
                                                <div key={i} className={`flex justify-between items-center text-xs ${isCanceled ? 'text-slate-400 line-through' : 'text-slate-600 dark:text-slate-300'}`}>
                                                    <span className="truncate pr-2">
                                                        {item.isWeight ? `${item.qty.toFixed(3)}kg` : `${item.qty}u`} {item.name}
                                                        {(item.isWeight || item.qty !== 1) && (
                                                            <span className="text-[10px] text-slate-400 font-normal ml-1">
                                                                ({item.isWeight ? '' : 'c/u '}{copEnabled && copPrimary && tasaCop > 0 ? `${formatCop(item.priceCop || Math.round(item.priceUsd * tasaCop))} COP` : `$${item.priceUsd.toFixed(2)}`})
                                                            </span>
                                                        )}
                                                    </span>
                                                    <span className="font-medium text-right">
                                                        {copEnabled && copPrimary
                                                            ? <span className="text-amber-600 dark:text-amber-400">{formatCop((item.priceCop || Math.round(item.priceUsd * tasaCop)) * item.qty)} COP</span>
                                                            : <span>${(item.priceUsd * item.qty).toFixed(2)}</span>}
                                                        {copEnabled && tasaCop > 0
                                                            ? <span className="text-slate-400 font-normal ml-1">
                                                                {copPrimary
                                                                    ? <>${(item.priceUsd * item.qty).toFixed(2)} · <span className="text-brand dark:text-brand">{formatBs(item.priceUsd * item.qty * (s.rate || bcvRate))} Bs</span></>
                                                                    : <>{formatCop((item.priceCop || Math.round(item.priceUsd * tasaCop)) * item.qty)} COP · <span className="text-brand dark:text-brand">{formatBs(item.priceUsd * item.qty * (s.rate || bcvRate))} Bs</span></>}
                                                              </span>
                                                            : <span className="text-slate-400 font-normal ml-1">· {formatBs(item.priceUsd * item.qty * (s.rate || bcvRate))} Bs</span>}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <p className="text-xs text-slate-400 mb-3 pt-2">Pago de Deudas (Sin productos)</p>
                                    )}

                                    {s.payments && s.payments.length > 0 && (
                                        <div className="space-y-1 mb-3 pt-2 border-t border-dashed border-slate-200 dark:border-slate-700/50">
                                            <p className="text-[10px] font-bold uppercase text-slate-400 tracking-wider mb-1">Detalle de Pago</p>
                                            {s.payments.map((p, i) => {
                                                const pIsCop = p.currency === 'COP';
                                                const isBs = !pIsCop && (p.currency ? p.currency !== 'USD' : (p.methodId?.includes('_bs') || p.methodId === 'pago_movil'));
                                                const val = pIsCop
                                                    ? 'COP ' + (p.amountInput || (p.amountUsd * (s.tasaCop || tasaCop || 1))).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                                                    : isBs
                                                    ? 'Bs ' + formatBs(p.amountBs || (p.amountUsd * (s.rate || bcvRate)))
                                                    : `$${(p.amountUsd || 0).toFixed(2)}`;
                                                
                                                const isCashea = p.methodId === 'cashea';
                                                
                                                return (
                                                    <div key={i} className={`flex justify-between items-center text-xs ${isCanceled ? 'text-slate-400 line-through' : isCashea ? 'text-purple-650 dark:text-purple-400 font-bold' : 'text-slate-600 dark:text-slate-350'}`}>
                                                        <span className="flex items-center gap-1.5">
                                                            {isCashea && <CasheaIcon size={12} />}
                                                            {p.methodLabel || 'Pago'}
                                                        </span>
                                                        <span className="font-semibold">{val} {p.methodId !== 'cashea' && p.amountUsd > 0 && <span className="text-[10px] font-normal text-slate-450">(${(p.amountUsd || 0).toFixed(2)})</span>}</span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}

                                    <div className="flex justify-between text-[10px] font-medium text-slate-400 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-lg p-2 mb-3">
                                        <div className="flex flex-col gap-0.5">
                                            <span>Ref: {formatBs(s.totalBs)} Bs @ {formatBs(s.rate || bcvRate)}</span>
                                            {s.tasaCop > 0 && <span>COP: {(s.totalCop || (s.totalUsd * s.tasaCop)).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} @ {s.tasaCop}</span>}
                                        </div>
                                        {s.casheaUsd > 0 && (
                                            <div className="flex flex-col gap-0.5 self-start mt-0.5">
                                                <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold px-1.5 py-0.5 rounded-md border border-slate-200 dark:border-slate-700 text-[10px]">
                                                    <span>💵 Inicial: ${((s.totalUsd || 0) - (s.casheaUsd || 0)).toFixed(2)}</span>
                                                </div>
                                                <div className="flex items-center gap-1 bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 font-bold px-1.5 py-0.5 rounded-md border border-purple-200 dark:border-purple-800/40 text-[10px]">
                                                    <span className="flex items-center gap-1"><CasheaIcon size={10} /> Financia Cashea: ${s.casheaUsd.toFixed(2)}</span>
                                                </div>
                                            </div>
                                        )}
                                        {s.changeUsd > 0 && (
                                            <div className="flex items-center gap-1 self-start mt-0.5 bg-orange-50 dark:bg-orange-900/20 text-orange-500 dark:text-orange-400 font-bold px-1.5 py-0.5 rounded-md border border-orange-100 dark:border-orange-800/40">
                                                <CornerDownLeft size={10} />
                                                {copEnabled && tasaCop > 0
                                                    ? copPrimary
                                                        ? <><span>−{formatCop(s.changeUsd * tasaCop)} COP</span><span className="font-normal opacity-75">/ −${s.changeUsd.toFixed(2)} / −{formatBs(s.changeBs || s.changeUsd * (s.rate || bcvRate))} Bs</span></>
                                                        : <><span>−${s.changeUsd.toFixed(2)}</span><span className="font-normal opacity-75">/ −{formatCop(s.changeUsd * tasaCop)} COP / −{formatBs(s.changeBs || s.changeUsd * (s.rate || bcvRate))} Bs</span></>
                                                    : <><span>−${s.changeUsd.toFixed(2)}</span><span className="font-normal opacity-75">/ −{formatBs(s.changeBs || s.changeUsd * (s.rate || bcvRate))} Bs</span></>}
                                            </div>
                                        )}
                                    </div>

                                    <div className="flex flex-wrap items-center gap-2 mt-2">
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                if (!s.customerName || s.customerName === 'Consumidor Final') {
                                                    onRequestClientForTicket(s);
                                                } else {
                                                    onShareWhatsApp(s);
                                                }
                                            }}
                                            className="flex-1 min-w-[120px] whitespace-nowrap py-2 font-bold rounded-lg transition-colors flex justify-center items-center gap-1.5 text-xs shadow-sm bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-200 hover:dark:bg-emerald-900/50 active:scale-95">
                                            <Send size={14} /> Enviar Ticket
                                        </button>
                                        {onDownloadPDF && (
                                            <button
                                                onClick={(e) => { e.stopPropagation(); onDownloadPDF(s); }}
                                                className="py-2 px-3 bg-brand-light dark:bg-surface-800/30 text-brand-dark dark:text-brand hover:bg-brand-light hover:dark:bg-surface-800/50 font-bold rounded-lg transition-colors flex justify-center items-center gap-1.5 text-xs shadow-sm">
                                                PDF
                                            </button>
                                        )}
                                        {onPrintTicket && (
                                            <button
                                                onClick={(e) => { e.stopPropagation(); onPrintTicket(s); }}
                                                className="py-2 px-3 bg-slate-800 dark:bg-slate-700 text-white hover:bg-slate-700 dark:hover:bg-slate-600 font-bold rounded-lg transition-colors flex justify-center items-center gap-1.5 text-xs shadow-sm active:scale-95"
                                                title="Imprimir ticket"
                                            >
                                                <Printer size={14} />
                                                <span>Imprimir</span>
                                            </button>
                                        )}

                                        {isAdmin && !isCanceled && !s.cajaCerrada && (
                                            <button
                                                onClick={(e) => { e.stopPropagation(); onVoidSale(s); }}
                                                className="py-2 px-3 bg-slate-100 dark:bg-slate-900 text-red-600 dark:text-red-400 hover:bg-red-50 hover:dark:bg-red-900/30 font-bold rounded-lg transition-colors flex justify-center items-center gap-1.5 text-xs border border-slate-200 dark:border-slate-800 shadow-sm active:scale-95">
                                                <Ban size={14} /> Anular
                                            </button>
                                        )}
                                        {!isCanceled && s.cajaCerrada && (
                                            <div title="Venta protegida por Cierre de Caja" className="py-2 px-3 bg-slate-50 dark:bg-slate-900 text-slate-400 font-bold rounded-lg flex justify-center items-center gap-1.5 text-[10px] uppercase border border-slate-100 dark:border-slate-800 tracking-wider cursor-not-allowed">
                                                <LockIcon size={12} /> Cerrada
                                            </div>
                                        )}
                                        <button
                                            onClick={(e) => { e.stopPropagation(); onRecycleSale(s); }}
                                            className="py-2 px-3 bg-brand-light dark:bg-surface-800/30 text-brand-dark dark:text-brand hover:bg-brand-light hover:dark:bg-surface-800/50 font-bold rounded-lg transition-colors flex justify-center items-center gap-1.5 text-xs shadow-sm active:scale-95">
                                            <Recycle size={14} />
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
            <PaginationBar
                currentPage={currentPage}
                totalPages={totalPages}
                totalItems={totalItems}
                startIndex={startIndex}
                endIndex={endIndex}
                onNext={goNext}
                onPrev={goPrev}
                hasNext={hasNext}
                hasPrev={hasPrev}
                label="ventas"
            />
        </div>
    );
}
