// Pestaña «Vender» del Supervisor (plan 2026-10-29, F3): venta de CONTADO que
// la caja principal re-precia y registra. El vendedor solo ve «registrada»
// cuando la caja confirma (G9); mientras tanto no debe entregar la mercancía.
// La pantalla reutiliza las piezas de la caja (buscador, categorías, cesta y
// cobro) sin las acciones que la venta remota no admite: monto libre, espera,
// descuentos, aportes y atajos de teclado. El avance de efectivo aparece si la
// caja lo tiene activo (ajuste sincronizado; la caja lo vuelve a validar).
import React, { useCallback, useEffect, useMemo, useRef, useState, useDeferredValue } from 'react';
import { Printer, ShoppingCart, Store, Trash2, UserRound, X } from 'lucide-react';
import SearchBar from '../Sales/SearchBar';
import CategoryBar from '../Sales/CategoryBar';
import CartPanel from '../Sales/CartPanel';
import CheckoutModal from '../Sales/CheckoutModal';
import CheckoutModalPOS from '../Sales/CheckoutModalPOS';
import CashAdvanceModal from '../Sales/CashAdvanceModal';
import ConfirmModal from '../ConfirmModal';
import { showToast } from '../Toast';
import { useProductContext } from '../../context/ProductContext';
import { FinancialEngine } from '../../core/FinancialEngine';
import { getCartIvaOpts } from '../../config/taxConfig';
import { getActivePaymentMethods } from '../../config/paymentMethods';
import { SUPERVISOR_REMOTE_SALES_ENABLED } from '../../config/supervisorPolicy';
import { formatBs, formatUsd } from '../../utils/calculatorUtils';
import { adjustStockValue, calculateItemStockDeduction, isGranelProduct, parseCartQuantity } from '../../utils/granel';
import { compareProductsByName, productMatchesSearch } from '../../utils/searchMatch';
import { buildCashAdvanceCartLine } from '../../utils/cashAdvance';
import { printThermalTicket } from '../../utils/ticketGenerator';
import {
    REMOTE_SALE_FORBIDDEN_METHODS,
    REMOTE_SALE_LIMITS,
    buildRemoteCartLine,
    buildRemoteSalePayload,
    validateRemoteSalePayload,
} from '../../services/supervisorSaleCommand';
import { REMOTE_SALE_TYPE, sendRemoteSale, waitRemoteSaleOutcome } from '../../services/supervisorSaleSender';
import { reportSupervisorCommandOutcome } from '../../services/supervisorCommandDiagnostics';

export const SELLER_NAME_KEY = 'pda_monitor_seller_name';
const SEARCH_MAX_RESULTS = 50;
const VIEW_MODE_KEY = 'pos_search_view_mode';
const VIEW_MODES = ['hybrid', 'list', 'grid'];

const readAdvanceSettings = () => ({
    enabled: localStorage.getItem('allow_cash_advance') === 'true',
    defaultPct: Math.max(0, parseFloat(localStorage.getItem('cash_advance_default_pct') || '10') || 0),
});

// Cobro dinámico (misma regla que la caja, ProductContext.effectiveCheckoutMode):
// pantalla de PC → modo POS de dos columnas; teléfono/tablet → modo móvil.
const MOBILE_UA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;
export const detectCheckoutMode = (width = window.innerWidth, userAgent = navigator?.userAgent || '') =>
    (width >= 1024 && !MOBILE_UA.test(userAgent) ? 'pos' : 'basic');

const refLineId = (ref) => (ref.mode === 'unit' ? `${ref.productId}_unit` : ref.productId);

function SellerNameForm({ initial, onSave, onCancel }) {
    const [value, setValue] = useState(initial || '');
    const trimmed = value.trim();
    return (
        <form
            className="space-y-3"
            onSubmit={(e) => { e.preventDefault(); if (trimmed) onSave(trimmed.slice(0, REMOTE_SALE_LIMITS.MAX_SELLER_NAME)); }}
        >
            <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400">Nombre de este punto de venta</label>
            <input
                autoFocus
                value={value}
                onChange={(e) => setValue(e.target.value)}
                maxLength={REMOTE_SALE_LIMITS.MAX_SELLER_NAME}
                placeholder="Ej: Tienda 2 – María"
                aria-label="Nombre del vendedor"
                className="w-full form-input border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2.5 text-sm font-bold dark:bg-slate-950"
            />
            <p className="text-[11px] text-slate-500">Sale en cada venta, ticket y reporte de la caja principal.</p>
            <div className="flex gap-2">
                {onCancel && <button type="button" onClick={onCancel} className="flex-1 py-2.5 rounded-xl border text-xs font-bold text-slate-500">Cancelar</button>}
                <button type="submit" disabled={!trimmed} className="flex-1 py-2.5 rounded-xl bg-brand-dark disabled:opacity-40 text-white text-xs font-black">Guardar</button>
            </div>
        </form>
    );
}

function OutcomeCard({ state, onNewSale, onBackToCart, onPrint, onCancel }) {
    const { phase, outcome } = state;
    if (phase === 'sending' || phase === 'waiting' || phase === 'received' || phase === 'cancelling') {
        return (
            <div role="status" data-testid="remote-sale-status" className="rounded-2xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-4 space-y-1">
                <div className="w-7 h-7 rounded-full border-4 border-amber-200 border-t-amber-500 animate-spin mb-2" />
                <p className="text-sm font-black text-amber-800 dark:text-amber-300">
                    {phase === 'received'
                        ? 'La caja principal recibió la venta, registrando…'
                        : phase === 'cancelling' ? 'Cancelando la venta…' : 'Enviando a la caja principal…'}
                </p>
                <p className="text-xs font-bold text-amber-700 dark:text-amber-400">No entregues la mercancía todavía.</p>
                {phase === 'waiting' && (
                    <p className="text-[11px] text-amber-700/80 dark:text-amber-400/80 pt-1">
                        La caja principal debe tener la app abierta para tomarla. Si no la toma en 2 minutos, la venta se cancela sola y no se cobra nada.
                    </p>
                )}
                {outcome?.cancelRefused && (
                    <p className="text-[11px] font-bold text-amber-800 dark:text-amber-300 pt-1">
                        Ya no se puede cancelar: la caja principal la está registrando. Espera el resultado.
                    </p>
                )}
                {/* Cancelar solo mientras la caja NO la haya tomado: el servidor
                    rechaza anular una orden ya recibida (nunca queda a medias). */}
                {phase === 'waiting' && !outcome?.cancelRefused && (
                    <button type="button" onClick={onCancel} className="mt-2 w-full py-2.5 rounded-xl border border-amber-300 bg-white dark:bg-slate-900 text-amber-800 dark:text-amber-300 text-xs font-black">
                        Cancelar venta
                    </button>
                )}
            </div>
        );
    }
    if (phase === 'registered') {
        return (
            <div role="status" data-testid="remote-sale-status" className="rounded-2xl border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 p-4 space-y-3">
                <p className="text-base font-black text-emerald-800 dark:text-emerald-300">
                    ✅ Venta #{outcome.saleNumber ?? '—'} registrada en la caja principal
                </p>
                {outcome.warnings?.length > 0 && (
                    <ul className="text-xs text-amber-700 list-disc pl-4">{outcome.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
                )}
                <div className="flex gap-2">
                    {outcome.sale && (
                        <button type="button" onClick={onPrint} className="flex-1 py-2.5 rounded-xl border border-emerald-300 text-emerald-800 text-xs font-black flex items-center justify-center gap-1.5">
                            <Printer size={14} /> Imprimir ticket
                        </button>
                    )}
                    <button type="button" onClick={onNewSale} className="flex-1 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-black">Nueva venta</button>
                </div>
            </div>
        );
    }
    const tone = phase === 'unresolved' ? 'amber' : 'red';
    return (
        <div role="alert" data-testid="remote-sale-status" className={`rounded-2xl border p-4 space-y-3 ${tone === 'red' ? 'border-red-300 bg-red-50 dark:bg-red-950/30' : 'border-amber-300 bg-amber-50 dark:bg-amber-950/30'}`}>
            <p className={`text-sm font-black ${tone === 'red' ? 'text-red-700 dark:text-red-300' : 'text-amber-800 dark:text-amber-300'}`}>
                {phase === 'rejected' ? 'Venta rechazada por la caja principal' : phase === 'unresolved' ? 'Venta sin confirmar' : 'La venta no se registró'}
            </p>
            <p className="text-xs text-slate-700 dark:text-slate-300">{outcome?.error}</p>
            {outcome?.priceChanges?.length > 0 && (
                <ul className="text-xs text-slate-600 dark:text-slate-400 list-disc pl-4">
                    {outcome.priceChanges.map((c) => (
                        <li key={c.productId}>{c.name}: USD {formatUsd(c.from)} → USD {formatUsd(c.to)}</li>
                    ))}
                </ul>
            )}
            <button type="button" onClick={onBackToCart} className="w-full py-2.5 rounded-xl border text-xs font-black text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900">Volver al carrito</button>
        </div>
    );
}

export default function RemoteSalePanel({ targetDeviceId, available = true, shiftOpen = true, triggerHaptic }) {
    const { products = [], categories = [], effectiveRate, tasaCop, copEnabled, copPrimary } = useProductContext();
    const [sellerName, setSellerName] = useState(() => localStorage.getItem(SELLER_NAME_KEY) || '');
    const [editingSeller, setEditingSeller] = useState(false);
    const searchInputRef = useRef(null);
    const [searchTerm, setSearchTerm] = useState('');
    const deferredSearchTerm = useDeferredValue(searchTerm);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [selectedCategory, setSelectedCategory] = useState('todos');
    const [viewMode, setViewMode] = useState(() => {
        const stored = localStorage.getItem(VIEW_MODE_KEY);
        return VIEW_MODES.includes(stored) ? stored : 'hybrid';
    });
    const [hierarchyPending, setHierarchyPending] = useState(null);
    const [weightPending, setWeightPending] = useState(null);
    // El carrito guarda solo producto + modo + cantidad; precios y nombres salen
    // SIEMPRE del catálogo vigente (si la caja cambia un precio, se refleja solo).
    const [cartRefs, setCartRefs] = useState([]);
    // Avances de efectivo: no salen del catálogo; se guardan aparte.
    const [advances, setAdvances] = useState([]);
    const [advanceSettings, setAdvanceSettings] = useState(readAdvanceSettings);
    const [showCashAdvance, setShowCashAdvance] = useState(false);
    const [paymentMethods, setPaymentMethods] = useState([]);
    const [checkoutOpen, setCheckoutOpen] = useState(false);
    const [checkoutMode, setCheckoutMode] = useState(() => detectCheckoutMode());
    const [isCartSheetOpen, setIsCartSheetOpen] = useState(false);
    const [confirmClear, setConfirmClear] = useState(false);
    const [saleState, setSaleState] = useState({ phase: 'idle', outcome: null });
    const cancelRequestedRef = useRef(false);

    useEffect(() => {
        let alive = true;
        getActivePaymentMethods().then((methods) => {
            if (!alive) return;
            setPaymentMethods(methods.filter((m) => !m.isVirtual && !m.isInternalCredit && !REMOTE_SALE_FORBIDDEN_METHODS.includes(m.id)));
        }).catch(() => {});
        return () => { alive = false; };
    }, []);

    // Los ajustes de la caja llegan por la sincronización (app_storage_update).
    useEffect(() => {
        const refresh = () => setAdvanceSettings(readAdvanceSettings());
        window.addEventListener('app_storage_update', refresh);
        window.addEventListener('storage', refresh);
        return () => {
            window.removeEventListener('app_storage_update', refresh);
            window.removeEventListener('storage', refresh);
        };
    }, []);

    const ctx = useMemo(() => ({ effectiveRate, tasaCop }), [effectiveRate, tasaCop]);
    const productsById = useMemo(() => new Map(products.map((p) => [String(p.id), p])), [products]);

    const cart = useMemo(() => cartRefs
        .map((ref) => {
            const product = productsById.get(ref.productId);
            return product ? buildRemoteCartLine(product, { mode: ref.mode, qty: ref.qty }, ctx) : null;
        })
        .filter(Boolean)
        .concat(advances.map((a) => buildCashAdvanceCartLine(a, effectiveRate, a.id))), [cartRefs, productsById, ctx, advances, effectiveRate]);

    const totals = useMemo(
        () => FinancialEngine.buildCartTotals(cart, null, effectiveRate, copEnabled ? tasaCop : 0, false, getCartIvaOpts()),
        [cart, effectiveRate, tasaCop, copEnabled],
    );

    // Solo productos con precio: la caja rechaza los que no lo tienen.
    const sellable = useMemo(() => products.filter((p) => Number(p.priceUsdt) > 0).sort(compareProductsByName), [products]);
    const searchResults = useMemo(() => {
        if (deferredSearchTerm.length < 1) return [];
        return sellable.filter((p) => productMatchesSearch(p, deferredSearchTerm)).slice(0, SEARCH_MAX_RESULTS);
    }, [deferredSearchTerm, sellable]);
    const filteredByCategory = useMemo(() => (selectedCategory === 'todos'
        ? sellable
        : sellable.filter((p) => p.category === selectedCategory)), [selectedCategory, sellable]);

    const handleSearchChange = useCallback((value) => {
        setSearchTerm(value);
        setSelectedIndex(0);
    }, []);

    const handleViewModeChange = (mode) => {
        if (!VIEW_MODES.includes(mode)) return;
        setViewMode(mode);
        localStorage.setItem(VIEW_MODE_KEY, mode);
    };

    // Unidades de stock que ya ocupan OTRAS líneas del mismo producto.
    const stockUsedByOthers = (productId, exceptLineId) => cart
        .filter((line) => String(line._originalId) === productId && line.id !== exceptLineId)
        .reduce((sum, line) => sum + calculateItemStockDeduction(line), 0);

    // Mismo flujo que la caja (SalesView.addToCart): popup bulto/unidad, peso a
    // granel y aviso de stock. La caja vuelve a validar todo al registrar.
    const addToCart = (product, qtyOverride = null, forceMode = null) => {
        triggerHaptic?.();
        if (!(Number(product.priceUsdt) > 0)) {
            showToast('Este producto no tiene precio válido.', 'warning');
            return;
        }
        const allowNegativeStock = localStorage.getItem('allow_negative_stock') === 'true';
        const currentStock = parseFloat(product.stock) || 0;
        if (!allowNegativeStock && currentStock <= 0) {
            showToast(`${product.name}: sin stock`, 'warning');
            return;
        }
        if (product.sellByUnit && product.unitPriceUsd && !forceMode && !qtyOverride) { setHierarchyPending(product); return; }
        const granel = isGranelProduct(product);
        if (granel && !qtyOverride) { setWeightPending(product); return; }

        const qtyToAdd = parseCartQuantity(qtyOverride ?? 1, granel);
        if (qtyToAdd === null || qtyToAdd <= 0) {
            showToast(`${product.name}: la cantidad debe ser un número entero`, 'warning');
            return;
        }
        const mode = forceMode === 'unit' ? 'unit' : 'package';
        const productId = String(product.id);
        const lineId = mode === 'unit' ? `${productId}_unit` : productId;
        const existing = cartRefs.find((r) => refLineId(r) === lineId);
        if (!existing && cartRefs.length >= REMOTE_SALE_LIMITS.MAX_ITEMS) {
            showToast(`Máximo ${REMOTE_SALE_LIMITS.MAX_ITEMS} productos por venta remota`, 'warning');
            return;
        }
        const newQty = existing ? adjustStockValue(existing.qty, qtyToAdd, granel) : qtyToAdd;
        if (!allowNegativeStock) {
            const needed = calculateItemStockDeduction({ ...product, qty: newQty, _mode: mode, _unitsPerPackage: product.unitsPerPackage || 1 });
            if (needed + stockUsedByOthers(productId, lineId) > currentStock) {
                showToast(`${product.name}: stock maximo alcanzado`, 'warning');
                return;
            }
        }
        setCartRefs((prev) => {
            const found = prev.find((r) => refLineId(r) === lineId);
            if (found) return prev.map((r) => (r === found ? { ...r, qty: newQty } : r));
            return [{ productId, mode, qty: newQty }, ...prev];
        });
        setSearchTerm('');
        setHierarchyPending(null);
    };

    const updateQty = (lineId, delta) => {
        triggerHaptic?.();
        const line = cart.find((l) => l.id === lineId);
        if (!line) return;
        const granel = isGranelProduct(line);
        const newQty = adjustStockValue(line.qty, delta, granel);
        if (delta > 0 && localStorage.getItem('allow_negative_stock') !== 'true') {
            const product = productsById.get(String(line._originalId));
            const available = parseFloat(product?.stock) || 0;
            const needed = calculateItemStockDeduction({ ...line, qty: newQty });
            if (needed + stockUsedByOthers(String(line._originalId), lineId) > available) {
                showToast(`${line.name}: stock maximo alcanzado`, 'warning');
                return;
            }
        }
        setCartRefs((prev) => prev
            .map((r) => (refLineId(r) === lineId ? { ...r, qty: newQty } : r))
            .filter((r) => r.qty > 0));
    };

    const removeFromCart = (lineId) => {
        triggerHaptic?.();
        setCartRefs((prev) => prev.filter((r) => refLineId(r) !== lineId));
        setAdvances((prev) => prev.filter((a) => a.id !== lineId));
    };

    const handleConfirmCashAdvance = (data) => {
        if (advances.length >= REMOTE_SALE_LIMITS.MAX_CASH_ADVANCES) {
            showToast(`Máximo ${REMOTE_SALE_LIMITS.MAX_CASH_ADVANCES} avances por venta`, 'warning');
            return;
        }
        setAdvances((prev) => [...prev, {
            id: `advance_${globalThis.crypto.randomUUID()}`,
            currency: data.currency === 'BS' ? 'BS' : 'USD',
            montoEfectivo: data.montoEfectivo,
            comisionPct: data.comisionPct,
        }]);
        setShowCashAdvance(false);
        showToast('Avance de efectivo agregado al carrito', 'success');
    };

    const clearCart = () => { setCartRefs([]); setAdvances([]); };

    // El modo se decide al abrir el cobro según la pantalla actual; dentro del
    // cobro el vendedor puede cambiarlo (onSwitchMode) solo para esa venta.
    const openCheckout = () => {
        // La caja rechazaría la venta (G4): no se abre el cobro con el turno cerrado.
        if (!shiftOpen) return;
        triggerHaptic?.();
        setCheckoutMode(detectCheckoutMode());
        setIsCartSheetOpen(false);
        setCheckoutOpen(true);
    };

    const handleSearchKeyDown = (e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex((i) => Math.min(i + 1, searchResults.length - 1)); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex((i) => Math.max(i - 1, 0)); return; }
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const raw = searchTerm.trim();
        if (!raw) return;
        const exact = sellable.find((p) => p.barcode === raw || String(p.id) === raw);
        const pick = exact
            || (viewMode === 'grid' ? searchResults[0] : searchResults[selectedIndex])
            || (searchResults.length === 1 ? searchResults[0] : null);
        if (pick) addToCart(pick);
    };

    const saveSeller = (name) => {
        localStorage.setItem(SELLER_NAME_KEY, name);
        setSellerName(name);
        setEditingSeller(false);
    };

    const handleConfirmSale = async (payments, changeBreakdown) => {
        const saleId = globalThis.crypto.randomUUID();
        const isBsPayment = payments.some((p) => p.currency === 'BS' && Number(p.amountBs) > 0);
        const finalTotals = FinancialEngine.buildCartTotals(cart, null, effectiveRate, copEnabled ? tasaCop : 0, isBsPayment, getCartIvaOpts());
        const payload = buildRemoteSalePayload({
            saleId,
            seller: { name: sellerName, deviceId: localStorage.getItem('pda_device_id') },
            cart,
            payments,
            changeBreakdown,
            totals: finalTotals,
            rate: effectiveRate,
        });
        const check = validateRemoteSalePayload(payload);
        if (!check.ok) {
            showToast(check.error, 'error');
            return;
        }

        setCheckoutOpen(false);
        setIsCartSheetOpen(false);
        cancelRequestedRef.current = false;
        setSaleState({ phase: 'sending', outcome: null });
        const sent = await sendRemoteSale({ targetDeviceId, payload });
        if (!sent.ok) {
            reportSupervisorCommandOutcome({ type: REMOTE_SALE_TYPE, status: sent.status || 'failed', error: sent.error });
            setSaleState({ phase: 'failed', outcome: { error: sent.error } });
            return;
        }
        setSaleState({ phase: 'waiting', outcome: null });
        const outcome = await waitRemoteSaleOutcome({
            commandId: sent.commandId,
            ackPromise: sent.ackPromise,
            isCancelRequested: () => cancelRequestedRef.current,
            onProgress: (p) => {
                if (p === 'received') setSaleState({ phase: 'received', outcome: null });
                if (p === 'cancel_refused') setSaleState({ phase: 'received', outcome: { cancelRefused: true } });
            },
        });
        reportSupervisorCommandOutcome({
            commandId: sent.commandId,
            type: REMOTE_SALE_TYPE,
            status: outcome.phase === 'registered' ? outcome.status : (outcome.phase === 'rejected' ? 'rejected' : 'failed'),
            error: outcome.error || null,
        });
        setSaleState({ phase: outcome.phase, outcome });
        if (outcome.phase === 'registered') clearCart();
    };

    if (!SUPERVISOR_REMOTE_SALES_ENABLED) {
        return (
            <div data-testid="remote-sale-panel" className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 text-center space-y-2">
                <Store size={28} className="mx-auto text-slate-300" />
                <p className="text-sm font-black text-slate-700 dark:text-slate-200">Ventas remotas no habilitadas</p>
                <p className="text-xs text-slate-500">Esta función se activa por etapas. Pide que la habiliten para este negocio.</p>
            </div>
        );
    }

    if (!sellerName || editingSeller) {
        return (
            <div data-testid="remote-sale-panel" className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 max-w-md">
                <h2 className="text-base font-black text-slate-800 dark:text-white mb-3 flex items-center gap-2"><UserRound size={18} /> ¿Quién vende desde aquí?</h2>
                <SellerNameForm initial={sellerName} onSave={saveSeller} onCancel={sellerName ? () => setEditingSeller(false) : null} />
            </div>
        );
    }

    const busy = ['sending', 'waiting', 'received'].includes(saleState.phase);
    const checkoutBlocked = !available || !shiftOpen || busy || totals.totalUsd <= 0.01 || paymentMethods.length === 0;
    const cartPanelProps = {
        cart,
        effectiveRate,
        cartSubtotalUsd: totals.subtotalUsd,
        cartSubtotalBs: totals.subtotalBs,
        cartBaseUsd: totals.baseUsd,
        cartIvaUsd: totals.ivaUsd,
        cartTotalUsd: totals.totalUsd,
        cartTotalBs: totals.totalBs,
        cartTotalCop: totals.totalCop,
        cartItemCount: cart.length,
        discountData: null,
        updateQty,
        removeFromCart,
        onClearCart: () => setConfirmClear(true),
        triggerHaptic,
        cartSelectedIndex: -1,
        copEnabled,
        copPrimary,
        tasaCop,
        showShortcuts: false,
        checkoutDisabled: checkoutBlocked,
    };

    return (
        <div data-testid="remote-sale-panel" className={`flex flex-col lg:flex-row lg:gap-4 lg:h-[calc(100dvh-12rem)] lg:min-h-[560px] ${cart.length > 0 ? 'pb-20 lg:pb-0' : ''}`}>
            {/* ── Columna izquierda: vendedor + buscador + categorías y productos ── */}
            <div className="flex-1 min-w-0 min-h-0 flex flex-col lg:overflow-hidden">
                <div className="shrink-0 mb-2 flex items-center justify-between gap-2 px-1">
                    <button type="button" onClick={() => setEditingSeller(true)} className="min-w-0 flex items-center gap-1.5 text-[11px] font-bold text-slate-500">
                        <UserRound size={13} className="shrink-0" />
                        <span className="truncate">Vendedor: <span className="text-slate-800 dark:text-slate-200">{sellerName}</span> · cambiar</span>
                    </button>
                    <span className="shrink-0 text-[10px] font-black uppercase tracking-wide text-slate-400">Solo contado</span>
                </div>
                {!available && (
                    <p role="alert" className="shrink-0 mb-2 text-xs font-bold text-amber-700 bg-amber-50 rounded-xl p-2">Sin conexión con la caja principal: no se puede vender ahora.</p>
                )}
                {available && !shiftOpen && (
                    <p role="alert" data-testid="remote-sale-shift-closed" className="shrink-0 mb-2 text-xs font-bold text-red-700 bg-red-50 dark:bg-red-950/30 dark:text-red-300 rounded-xl p-2.5">
                        La caja principal está cerrada: abre el turno en la caja para poder vender desde aquí.
                    </p>
                )}
                <div className="shrink-0 mb-3 bg-white dark:bg-slate-900 rounded-2xl sm:rounded-3xl p-3 sm:p-4 shadow-sm border border-slate-100 dark:border-slate-800 relative z-30" aria-label="Buscar producto para vender">
                    <SearchBar
                        ref={searchInputRef}
                        searchTerm={searchTerm}
                        onSearchChange={handleSearchChange}
                        onKeyDown={handleSearchKeyDown}
                        searchResults={searchResults}
                        selectedIndex={selectedIndex}
                        setSelectedIndex={setSelectedIndex}
                        posSearchViewMode={viewMode}
                        onViewModeChange={handleViewModeChange}
                        effectiveRate={effectiveRate}
                        addToCart={addToCart}
                        hierarchyPending={hierarchyPending}
                        setHierarchyPending={setHierarchyPending}
                        weightPending={weightPending}
                        setWeightPending={setWeightPending}
                        copEnabled={copEnabled}
                        copPrimary={copPrimary}
                        tasaCop={tasaCop}
                    />
                </div>
                <CategoryBar
                    selectedCategory={selectedCategory}
                    setSelectedCategory={setSelectedCategory}
                    filteredByCategory={filteredByCategory}
                    addToCart={addToCart}
                    triggerHaptic={triggerHaptic}
                    searchTerm={searchTerm}
                    deferredSearchTerm={deferredSearchTerm}
                    posSearchViewMode={viewMode}
                    copEnabled={copEnabled}
                    copPrimary={copPrimary}
                    tasaCop={tasaCop}
                    effectiveRate={effectiveRate}
                    products={sellable}
                    categories={categories}
                    onClearCart={cart.length > 0 ? () => setConfirmClear(true) : undefined}
                    cart={cart}
                    allowCashAdvance={advanceSettings.enabled}
                    onOpenCashAdvance={() => setShowCashAdvance(true)}
                    showShortcuts={false}
                />
            </div>

            {/* ── Columna derecha: cesta (escritorio) ── */}
            <div className="hidden lg:flex lg:w-[380px] lg:shrink-0 lg:flex-col">
                <CartPanel {...cartPanelProps} onCheckout={openCheckout} />
            </div>

            {/* ── Móvil: botón flotante de la cesta + hoja inferior (igual que la caja) ── */}
            <div className="lg:hidden">
                {cart.length > 0 && !isCartSheetOpen && !checkoutOpen && (
                    <button
                        type="button"
                        onClick={() => { triggerHaptic?.(); setIsCartSheetOpen(true); }}
                        className="fixed bottom-[calc(max(0.5rem,env(safe-area-inset-bottom))+4.75rem)] sm:bottom-6 left-4 right-4 max-w-lg sm:mx-auto bg-[#006A71] hover:bg-[#005B61] text-white p-3.5 px-4 rounded-2xl shadow-xl shadow-[#006A71]/25 border border-white/20 flex items-center justify-between z-40 active:scale-95 transition-all"
                    >
                        <div className="flex items-center gap-3">
                            <div className="bg-white/20 p-2 rounded-xl shrink-0"><ShoppingCart size={20} /></div>
                            <div className="text-left">
                                <div className="text-[10px] font-bold text-white/80 uppercase tracking-wider">Ver Cesta</div>
                                <div className="font-black text-sm leading-none">{cart.length} artículo{cart.length !== 1 && 's'}</div>
                            </div>
                        </div>
                        <div className="text-right">
                            <div className="text-xl font-black leading-none">${formatUsd(totals.totalUsd)}</div>
                            <div className="text-[10px] font-bold text-white/80 mt-1">Bs {formatBs(totals.totalBs)}</div>
                        </div>
                    </button>
                )}
                {isCartSheetOpen && !checkoutOpen && (
                    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-surface-950/60 backdrop-blur-sm" onClick={() => setIsCartSheetOpen(false)}>
                        <div className="bg-surface-200 dark:bg-surface-950 w-full rounded-t-3xl shadow-tone-lg flex flex-col max-h-[85dvh]" onClick={(e) => e.stopPropagation()}>
                            <div className="shrink-0 flex justify-center pt-3 pb-2" onClick={() => setIsCartSheetOpen(false)}>
                                <div className="w-12 h-1.5 bg-surface-300 dark:bg-surface-700 rounded-full cursor-pointer" />
                            </div>
                            <div className="shrink-0 px-4 pb-3 flex items-center justify-between border-b border-surface-200 dark:border-surface-700">
                                <h3 className="font-black text-surface-700 dark:text-surface-100 text-lg flex items-center gap-2">
                                    <ShoppingCart size={20} className="text-brand" /> Cesta Actual
                                </h3>
                                <div className="flex items-center gap-1.5">
                                    {cart.length > 0 && (
                                        <button type="button" onClick={() => setConfirmClear(true)} className="flex items-center gap-1 py-1.5 px-3 bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 rounded-xl text-xs font-bold border border-rose-200/50 dark:border-rose-900/40">
                                            <Trash2 size={14} /><span>Vaciar</span>
                                        </button>
                                    )}
                                    <button type="button" onClick={() => setIsCartSheetOpen(false)} aria-label="Cerrar cesta" className="p-2 -mr-2 text-surface-400 rounded-full min-h-[44px] min-w-[44px] flex items-center justify-center">
                                        <X size={20} />
                                    </button>
                                </div>
                            </div>
                            <CartPanel {...cartPanelProps} onCheckout={openCheckout} />
                        </div>
                    </div>
                )}
            </div>

            {/* Estado de la venta enviada: tapa la pantalla para no vender dos veces. */}
            {saleState.phase !== 'idle' && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/50 backdrop-blur-sm p-4">
                    <div className="w-full max-w-sm">
                        <OutcomeCard
                            state={saleState}
                            onNewSale={() => setSaleState({ phase: 'idle', outcome: null })}
                            onBackToCart={() => setSaleState({ phase: 'idle', outcome: null })}
                            onPrint={() => printThermalTicket(saleState.outcome.sale, saleState.outcome.sale.rate || effectiveRate)}
                            onCancel={() => {
                                cancelRequestedRef.current = true;
                                setSaleState({ phase: 'cancelling', outcome: null });
                            }}
                        />
                    </div>
                </div>
            )}

            <ConfirmModal
                isOpen={confirmClear}
                onClose={() => setConfirmClear(false)}
                onConfirm={() => { clearCart(); setConfirmClear(false); }}
                title="¿Vaciar toda la cesta?"
                message="Todos los productos serán eliminados de la cesta actual."
                confirmText="Sí, vaciar"
                variant="cart"
            />

            {showCashAdvance && advanceSettings.enabled && (
                <CashAdvanceModal
                    onClose={() => setShowCashAdvance(false)}
                    onConfirm={handleConfirmCashAdvance}
                    effectiveRate={effectiveRate}
                    paymentMethods={paymentMethods}
                    defaultCommissionPct={advanceSettings.defaultPct}
                    copEnabled={copEnabled}
                    tasaCop={tasaCop}
                    triggerHaptic={triggerHaptic}
                />
            )}

            {checkoutOpen && (() => {
                const checkoutProps = {
                    onClose: () => setCheckoutOpen(false),
                    cart,
                    cartSubtotalUsd: totals.subtotalUsd,
                    cartSubtotalBs: totals.subtotalBs,
                    cartTotalUsd: totals.totalUsd,
                    cartTotalBs: totals.totalBs,
                    cartTotalCop: totals.totalCop,
                    cartBaseUsd: totals.baseUsd,
                    cartIvaUsd: totals.ivaUsd,
                    discountData: null,
                    effectiveRate,
                    customers: [],
                    selectedCustomerId: '',
                    setSelectedCustomerId: () => {},
                    paymentMethods,
                    onConfirmSale: handleConfirmSale,
                    triggerHaptic,
                    copEnabled,
                    copPrimary,
                    tasaCop,
                    onSwitchMode: setCheckoutMode,
                    isProcessing: busy,
                };
                return checkoutMode === 'pos'
                    ? <CheckoutModalPOS {...checkoutProps} allowCredit={false} />
                    : <CheckoutModal {...checkoutProps} />;
            })()}
        </div>
    );
}
