// v1.2.0: Rebrand al design system "Precios al Día" — colores warm cream + brand cian en elementos inline.
// Nota: SalesHeader.jsx y CartPanel.jsx son subcomponentes fuera de scope; se migran en P2-P4.
import { useState, useEffect, useCallback, useRef, useMemo, useDeferredValue } from 'react';
import { FinancialEngine } from '../core/FinancialEngine';
import { storageService } from '../utils/storageService';
import { useSounds } from '../hooks/useSounds';
import { useVoiceSearch } from '../hooks/useVoiceSearch';
import { useNotifications } from '../hooks/useNotifications';
import { useBarcodeScanner } from '../hooks/useBarcodeScanner';
import { showToast } from '../components/Toast';
import { ShoppingCart, X, DollarSign, CheckCircle2 } from 'lucide-react';
import { useCart } from '../context/CartContext';
import { useProductContext } from '../context/ProductContext';

// Components
import SalesHeader from '../components/Sales/SalesHeader';
import SearchBar from '../components/Sales/SearchBar';
import CategoryBar from '../components/Sales/CategoryBar';
import CartPanel from '../components/Sales/CartPanel';
import ReceiptModal from '../components/Sales/ReceiptModal';
import CheckoutModal from '../components/Sales/CheckoutModal';
import CheckoutModalPOS from '../components/Sales/CheckoutModalPOS';
import CustomAmountModal from '../components/Sales/CustomAmountModal';
import KeyboardHelpModal from '../components/Sales/KeyboardHelpModal';
import DiscountModal from '../components/Sales/DiscountModal';
import CajaCerradaOverlay from '../components/Sales/CajaCerradaOverlay';
import { getLocalISODate } from '../utils/dateHelpers';
import AperturaCajaModal from '../components/Dashboard/AperturaCajaModal';
import HoldsModal from '../components/Sales/HoldsModal';

import ConfirmModal from '../components/ConfirmModal';
import Confetti from '../components/Confetti';
import { useSalesKeyboard } from '../hooks/useSalesKeyboard';
import { buildReceiptWhatsAppUrl } from '../components/Sales/ReceiptShareHelper';

// Extracted hooks
import { useSalesData } from '../hooks/useSalesData';
import { useCheckoutFlow } from '../hooks/useCheckoutFlow';

export default function SalesView({ triggerHaptic, isActive }) {
    const { playAdd, playRemove, playCheckout, playError } = useSounds();
    const { notifyLowStock, notifySaleComplete } = useNotifications();

    // ── Global Context ──────────────────────────────────────
    const { products, setProducts, isLoadingProducts, rateMode, setRateMode, useAutoRate, setUseAutoRate, customRate, setCustomRate, effectiveRate, rates, rateDiscrepancyWarning, copEnabled, copPrimary, tasaCop, autoCopEnabled, setAutoCopEnabled, tasaCopManual, setTasaCopManual, categories, checkoutMode, setCheckoutMode } = useProductContext();

    // ── State ──────────────────────────────────────
    const [showConfetti, setShowConfetti] = useState(false);
    const [showClearCartConfirm, setShowClearCartConfirm] = useState(false);
    const [showCustomAmountModal, setShowCustomAmountModal] = useState(false);
    const [showKeyboardHelp, setShowKeyboardHelp] = useState(false); // Keyboard shortcuts modal state

    // Apertura Caja
    const [isAperturaOpen, setIsAperturaOpen] = useState(false);

    // Cart (from global context)
    const { cart, setCart, cartRef, pendingNavigate, setPendingNavigate, discount, setDiscount } = useCart();
    const [showDiscountModal, setShowDiscountModal] = useState(false);

    // Search
    const searchInputRef = useRef(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [selectedCategory, setSelectedCategory] = useState('todos');

    // Modals
    const [showCheckout, setShowCheckout] = useState(false);
    const [showReceipt, setShowReceipt] = useState(null);
    const [hierarchyPending, setHierarchyPending] = useState(null);
    const [weightPending, setWeightPending] = useState(null);
    const [selectedCustomerId, setSelectedCustomerId] = useState('');

    // Rate config
    const [showRateConfig, setShowRateConfig] = useState(false);

    const [isCartSheetOpen, setIsCartSheetOpen] = useState(false);

    // Ventas en Espera (Listo POS: "ESPERA")
    const [pendingCarts, setPendingCarts] = useState([]);
    const [showHoldsModal, setShowHoldsModal] = useState(false);
    const [holdAlertData, setHoldAlertData] = useState(null); // { title, message, onConfirm } for price/rate discrepancy alerts

    // Cart Navigation State
    const [cartSelectedIndex, setCartSelectedIndex] = useState(-1);

    // ── Sales Data Hook ─────────────────────────────
    const {
        customers, setCustomers,
        paymentMethods,
        isLoadingLocal,
        salesData, setSalesData,
        todayAperturaData, setTodayAperturaData,
    } = useSalesData({ setCart, cartRef, setProducts, isActive });

    const isLoading = isLoadingProducts || isLoadingLocal;

    // Auto-select last item when cart length changes (if user was already interacting with the cart)
    useEffect(() => {
        if (cart.length > 0) {
            setCartSelectedIndex(prev => prev === -1 ? prev : Math.min(prev, cart.length - 1));
        } else if (cart.length === 0) {
            setCartSelectedIndex(-1);
        }
    }, [cart.length]);

    // Cargar ventas en espera desde IndexedDB al iniciar
    useEffect(() => {
        storageService.getItem('bodega_pending_holds_v1', []).then(data => {
            if (Array.isArray(data)) setPendingCarts(data);
        });
    }, []);

    // Función para guardar el carrito activo como "en espera" (Listo POS: ESPERA)
    const handleHoldCart = async (nota = '') => {
        if (cart.length === 0) return;
        triggerHaptic && triggerHaptic();

        // En preciosaldia-bodega, el cliente se selecciona en Checkout, pero podemos
        // verificar si ya tenemos uno seleccionado
        const clienteActual = selectedCustomerId ? customers.find(c => c.id === selectedCustomerId) : null;

        const newHolds = [...pendingCarts, {
            id: Date.now(),
            items: cart,
            discount,
            nota: nota.trim(),
            tasaSnapshot: effectiveRate,
            cliente: clienteActual ? { id: clienteActual.id, nombre: clienteActual.nombre } : null
        }];
        setPendingCarts(newHolds);
        await storageService.setItem('bodega_pending_holds_v1', newHolds);
        setCart([]);
        setDiscount({ type: 'percentage', value: 0 });
        setCartSelectedIndex(-1);
        showToast(nota.trim() ? `Venta "${nota.trim()}" guardada en espera` : `Venta guardada en espera`, 'success');
    };

    // Función para eliminar permanentemente una venta en espera
    const handleDeleteHold = async (holdId) => {
        triggerHaptic && triggerHaptic();
        const newHolds = pendingCarts.filter(h => h.id !== holdId);
        setPendingCarts(newHolds);
        await storageService.setItem('bodega_pending_holds_v1', newHolds);
        showToast('Venta en espera eliminada', 'info');
    };

    // Función para restaurar una venta en espera
    const handleRestoreHold = async (holdId) => {
        const hold = pendingCarts.find(h => h.id === holdId);
        if (!hold) return;
        if (cart.length > 0) {
            showToast('Vacía la cesta actual antes de restaurar una venta en espera.', 'warning');
            return;
        }

        const itemsActualizados = [];
        const reportesCambio = [];

        for (const item of hold.items) {
            // Buscamos el producto en el catálogo cargado en memoria
            const prodActual = products.find(p => p.id === item.id);
            if (!prodActual) {
                reportesCambio.push(`❌ ${item.name} ya no existe en el catálogo.`);
                continue;
            }

            // Validar cambio de precio
            const precioSnapshot = item.priceUsd;
            const precioActual = prodActual.priceUsd || prodActual.precio || 0;
            if (Math.abs(precioSnapshot - precioActual) > 0.01) {
                reportesCambio.push(`💰 ${item.name}: $${precioSnapshot.toFixed(2)} -> $${precioActual.toFixed(2)}`);
            }

            itemsActualizados.push({
                ...item,
                priceUsd: precioActual
            });
        }

        // Validar cambio de tasa
        const tasaSnapshot = hold.tasaSnapshot || 0;
        if (tasaSnapshot > 0 && Math.abs(tasaSnapshot - effectiveRate) > 0.01) {
            reportesCambio.push(`📉 Tasa de cambio: Bs ${tasaSnapshot.toFixed(2)} -> Bs ${effectiveRate.toFixed(2)}`);
        }

        const finalizeRestore = () => {
            setCart(itemsActualizados);
            setDiscount(hold.discount);
            if (hold.cliente && hold.cliente.id) {
                setSelectedCustomerId(hold.cliente.id);
            }
            
            // Eliminar de espera
            const newHolds = pendingCarts.filter(h => h.id !== holdId);
            setPendingCarts(newHolds);
            storageService.setItem('bodega_pending_holds_v1', newHolds);
            setShowHoldsModal(false);
            showToast('Venta cargada en cesta', 'success');
        };

        if (reportesCambio.length > 0) {
            // Mostrar modal de discrepancias reutilizando ConfirmModal de la app
            setHoldAlertData({
                title: 'Actualización de Precios/Tasas',
                message: `Se detectaron cambios desde que estacionaste la venta:\n\n${reportesCambio.join('\n')}\n\n¿Deseas cargar la cesta con los valores actuales?`,
                onConfirm: finalizeRestore
            });
        } else {
            finalizeRestore();
        }
    };

    // Voice
    const handleSetSearchTerm = (text) => { setSearchTerm(text); setSelectedIndex(0); };
    const { isRecording, isProcessingAudio, startRecording, stopRecording } = useVoiceSearch({
        onResult: (text) => {
            if (!text) return;
            const normalizedTerm = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            const bestMatches = products.filter(p => {
                const normalizedName = p.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                return normalizedName.includes(normalizedTerm);
            });

            if (bestMatches.length > 0) {
                // Auto-agregar la primera (mejor) coincidencia
                addToCart(bestMatches[0]);
                handleSetSearchTerm('');
            } else {
                playError();
                showToast(`No encontré ningún producto parecido a "${text}"`, 'warning');
                // Al menos dejamos el texto en el buscador por si el usuario quiere corregirlo manualmente
                handleSetSearchTerm(text);
                searchInputRef.current?.focus();
            }
        },
        triggerHaptic,
    });

    // Barcode Scanner Global
    useBarcodeScanner({
        onScan: (barcode) => {
            if (showCheckout || showReceipt || showClearCartConfirm) return;

            // Pesa electrónica con PLU
            if (barcode.startsWith('21') && barcode.length >= 13) {
                const pluCode = parseInt(barcode.substring(2, 7), 10).toString();
                const weightKg = parseInt(barcode.substring(7, 12), 10) / 1000;
                const p = products.find(p => p.id === pluCode || p.barcode?.includes(pluCode) || p.barcode?.includes(barcode.substring(0, 7)));
                if (p) { addToCart({ ...p, isWeight: true }, weightKg, null, true); return; }
            }

            // Producto regular
            const product = products.find(p => p.barcode === barcode || p.id === barcode);
            if (product) {
                addToCart(product, null, null, true);
            } else {
                playError();
                showToast(`Producto no encontrado (${barcode})`, 'warning');
            }
        },
        enabled: !isLoading && isActive && !!todayAperturaData
    });

    // Paste Barcode Handler (Para cuando el usuario hace Ctrl+V en la barra de búsqueda)
    const handlePasteBarcode = (pastedText) => {
        // Ignoramos si hay popups activos
        if (showCheckout || showReceipt || showClearCartConfirm) return;

        // Intentar Pesa Electrónica
        if (pastedText.startsWith('21') && pastedText.length >= 13) {
            const pluCode = parseInt(pastedText.substring(2, 7), 10).toString();
            const weightKg = parseInt(pastedText.substring(7, 12), 10) / 1000;
            const p = products.find(p => p.id === pluCode || p.barcode?.includes(pluCode) || p.barcode?.includes(pastedText.substring(0, 7)));
            if (p) {
                addToCart({ ...p, isWeight: true }, weightKg, null, true);
                // Limpiamos el texto que se acaba de pegar
                setTimeout(() => setSearchTerm(''), 10);
                return;
            }
        }

        // Buscar producto regular por código de barras o ID exactamente
        const product = products.find(p => p.barcode === pastedText || p.id === pastedText);
        if (product) {
            addToCart(product, null, null, true);
            // Limpiamos la barra tras pegarse
            setTimeout(() => setSearchTerm(''), 10);
        }
        // Si no es un código exacto, no hacemos nada extra, el navegador lo pegará como texto normal para buscar.
    };

    // ── Derived (memos) ───────────────────────────
    const deferredSearchTerm = useDeferredValue(searchTerm);

    const searchResults = useMemo(() => {
        if (deferredSearchTerm.length < 1) return [];
        const normalizedTerm = deferredSearchTerm.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

        return products.filter(p => {
            if (p.barcode?.includes(deferredSearchTerm)) return true;
            const normalizedName = p.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            return normalizedName.includes(normalizedTerm);
        }).slice(0, 6);
    }, [deferredSearchTerm, products]);

    const filteredByCategory = useMemo(() => selectedCategory === 'todos'
        ? products
        : products.filter(p => p.category === selectedCategory), [selectedCategory, products]);

    const {
        subtotalUsd: cartSubtotalUsd,
        subtotalBs: cartSubtotalBs,
        discountAmountUsd,
        discountAmountBs,
        totalUsd: cartTotalUsd,
        totalBs: cartTotalBs,
        totalCop: cartTotalCop
    } = useMemo(() =>
        FinancialEngine.buildCartTotals(cart, discount, effectiveRate, copEnabled ? tasaCop : 0)
    , [cart, discount, effectiveRate, copEnabled, tasaCop]);

    // Variables estáticas para pasar a los componentes hijos
    const discountData = {
        active: discount?.value > 0,
        amountUsd: discountAmountUsd,
        amountBs: discountAmountBs,
        type: discount?.type,
        value: discount?.value
    };

    // ── Current cash float (for soft change warning in CheckoutModal) ──
    const currentFloat = useMemo(() => {
        const todayStr = getLocalISODate(new Date());
        const todayOpen = salesData.filter(s => {
            if (s.cajaCerrada) return false;
            const saleDay = s.timestamp ? getLocalISODate(new Date(s.timestamp)) : todayStr;
            return saleDay === todayStr;
        });
        const bd = FinancialEngine.calculatePaymentBreakdown(todayOpen);
        return {
            usd: bd['efectivo_usd']?.total ?? 0,
            bs:  bd['efectivo_bs']?.total  ?? 0,
        };
    }, [salesData]);

    const cartItemCount = cart.reduce((sum, item) => sum + item.qty, 0);

    const formatBs = (n) => new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

    // Persist cart (With Debounce to avoid blocking UI on rapid scans)
    const isCartInitialized = useRef(false);
    useEffect(() => {
        if (!isCartInitialized.current) { isCartInitialized.current = true; return; }
        const timer = setTimeout(() => {
            if (cart.length > 0) storageService.setItem('bodega_pending_cart_v1', cart);
            else storageService.removeItem('bodega_pending_cart_v1');
        }, 1000);
        return () => clearTimeout(timer);
    }, [cart]);

    // Handle pending navigation from recycled cart (replaces old localStorage approach)
    useEffect(() => {
        if (pendingNavigate && cart.length > 0 && isActive) {
            setPendingNavigate(null);
        }
    }, [pendingNavigate, cart, isActive, setPendingNavigate]);

    // Auto-focus search
    useEffect(() => { if (!isLoading && searchInputRef.current) searchInputRef.current.focus(); }, [isLoading]);

    // Return focus after closing modals
    useEffect(() => { if (!showCheckout && !showReceipt && searchInputRef.current) searchInputRef.current.focus(); }, [showCheckout, showReceipt]);

    // Global keybinds (F9 = checkout, F7 = hold/park, Escape = close modals)
    useEffect(() => {
        const handler = (e) => {
            if (e.key === 'F9') { e.preventDefault(); if (cart.length > 0 && !showCheckout && !showReceipt) setShowCheckout(true); }
            if (e.key === 'F7') {
                e.preventDefault();
                if (cart.length > 0 && !showCheckout && !showReceipt && !showHoldsModal) {
                    handleHoldCart();
                }
            }
            if (e.key === 'Escape') {
                if (showCheckout) { setShowCheckout(false); setSelectedCustomerId(''); }
                else if (showReceipt) { setShowReceipt(null); setSelectedCustomerId(''); }
                else if (showHoldsModal) { setShowHoldsModal(false); }
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [cart, showCheckout, showReceipt, showHoldsModal, pendingCarts]);

    // ── Checkout Flow Hook ──────────────────────────
    const { handleCheckout, handleCreateCustomer, handleSaveApertura, isProcessing } = useCheckoutFlow({
        cart, cartTotalUsd, cartTotalBs, cartSubtotalUsd,
        selectedCustomerId, customers, setCustomers, products, setProducts,
        effectiveRate, tasaCop, copEnabled, discountData, useAutoRate,
        setSalesData, setShowReceipt, setShowCheckout, setSelectedCustomerId,
        setCart, setCartSelectedIndex, setShowConfetti, setTodayAperturaData, setIsAperturaOpen,
        playCheckout, playError, notifyLowStock, notifySaleComplete, triggerHaptic
    });

    // ── Callbacks ─────────────────────────────────
    const addToCart = useCallback((product, qtyOverride = null, forceMode = null, isBarcodeSource = false) => {
        triggerHaptic && triggerHaptic();

        // Validación temprana: rechazar productos sin precio válido
        if (!product.priceUsdt || isNaN(product.priceUsdt) || product.priceUsdt <= 0) {
            playError();
            showToast('Este producto no tiene precio válido. Edítalo primero.', 'warning');
            return;
        }

        // Validación temprana de stock (si la configuración lo exige)
        const allowNegativeStock = localStorage.getItem('allow_negative_stock') === 'true';
        const currentStock = parseFloat(product.stock) || 0;
        if (!allowNegativeStock && currentStock <= 0) {
            playError();
            showToast(`${product.name}: sin stock`, 'warning');
            return;
        }

        playAdd();

        if (product.sellByUnit && product.unitPriceUsd && !forceMode && !qtyOverride) { setHierarchyPending(product); return; }
        if ((product.unit === 'kg' || product.unit === 'litro') && !qtyOverride) { setWeightPending(product); return; }

        // When priceCop is the source of truth, derive USD from COP at current rate
        let priceToUse = (product.priceCop && tasaCop > 0)
            ? product.priceCop / tasaCop
            : (parseFloat(product.priceUsdt) || 0);
        let cartId = product.id;
        let cartName = product.name;
        let qtyToAdd = qtyOverride || 1;

        if (forceMode === 'unit') {
            const unitCop = product.unitPriceCop || (product.priceCop ? Math.round(product.priceCop / (product.unitsPerPackage || 1)) : null);
            priceToUse = (unitCop && tasaCop > 0) ? unitCop / tasaCop : product.unitPriceUsd;
            cartId = product.id + '_unit';
            cartName = product.name + ' (Ud.)';
        }

        // Pre-calculate stock check BEFORE setCart to avoid React StrictMode double-firing
        if (!allowNegativeStock) {
            const currentCart = cartRef.current;
            const existingInCart = currentCart.find(i => i.id === cartId && i.priceUsd === priceToUse);
            const addingQty = existingInCart ? (qtyOverride || 1) : qtyToAdd;
            const existingQtyForThis = existingInCart ? existingInCart.qty : 0;
            const newQty = existingQtyForThis + addingQty;
            const stockNeeded = forceMode === 'unit' ? newQty / (product.unitsPerPackage || 1) : newQty;

            const otherCartItems = currentCart.filter(i => (i._originalId || i.id) === product.id && i.id !== cartId);
            const otherStockUsed = otherCartItems.reduce((sum, item) => {
                if (item._mode === 'unit') return sum + (item.qty / (item._unitsPerPackage || 1));
                return sum + item.qty;
            }, 0);

            if (stockNeeded + otherStockUsed > currentStock) {
                playError();
                showToast(`${product.name}: stock maximo alcanzado`, 'warning');
                return;
            }
        }

        // Soft warning when allowNegativeStock is ON but stock just ran out
        if (allowNegativeStock && currentStock > 0) {
            const currentCart = cartRef.current;
            const existingInCart = currentCart.find(i => i.id === cartId && i.priceUsd === priceToUse);
            const existingQtyForThis = existingInCart ? existingInCart.qty : 0;
            const newQty = existingQtyForThis + (qtyOverride || 1);
            const stockNeeded = forceMode === 'unit' ? newQty / (product.unitsPerPackage || 1) : newQty;

            const otherCartItems = currentCart.filter(i => (i._originalId || i.id) === product.id && i.id !== cartId);
            const otherStockUsed = otherCartItems.reduce((sum, item) => {
                if (item._mode === 'unit') return sum + (item.qty / (item._unitsPerPackage || 1));
                return sum + item.qty;
            }, 0);

            if (stockNeeded + otherStockUsed > currentStock) {
                showToast(`${product.name}: stock agotado, vendiendo sin inventario`, 'info');
            }
        }

        setCart(prev => {
            const existing = prev.find(i => i.id === cartId && i.priceUsd === priceToUse);
            if (existing && !qtyOverride) return prev.map(i => i.id === cartId ? { ...i, qty: i.qty + 1 } : i);
            if (existing && qtyOverride) return prev.map(i => i.id === cartId ? { ...i, qty: i.qty + qtyOverride } : i);

            const itemCostBs = product.costBs || (product.costUsd ? product.costUsd * effectiveRate : 0);
            const itemPriceCop = forceMode === 'unit'
                ? (product.unitPriceCop || (product.priceCop ? Math.round(product.priceCop / (product.unitsPerPackage || 1)) : null))
                : (product.priceCop || null);
            return [{
                ...product, id: cartId, name: cartName, priceUsd: priceToUse,
                priceCop: itemPriceCop,
                exactBs: product.exactBs || null,
                costBs: forceMode === 'unit' ? itemCostBs / (product.unitsPerPackage || 1) : itemCostBs,
                costUsd: forceMode === 'unit' ? (product.costUsd || 0) / (product.unitsPerPackage || 1) : (product.costUsd || 0),
                qty: qtyToAdd, isWeight: !!qtyOverride,
                _originalId: product.id, _mode: forceMode || 'package', _unitsPerPackage: product.unitsPerPackage || 1,
            }, ...prev];
        });
        handleSetSearchTerm('');
        setHierarchyPending(null);

        // --- LISTO POS Flow: blur/focus search dynamic based on source ---
        setTimeout(() => {
            if (isBarcodeSource) {
                searchInputRef.current?.focus();
                searchInputRef.current?.select();
                setCartSelectedIndex(-1); // Resetea navegación en la cesta
            } else {
                searchInputRef.current?.blur();
                setCartSelectedIndex(0); // Enfoca el ítem para +/- rápido
            }
        }, 50);
    }, [triggerHaptic, effectiveRate, tasaCop]);

    // Recalculate priceUsd for cart items with priceCop when tasaCop changes
    useEffect(() => {
        if (!tasaCop || tasaCop <= 0) return;
        setCart(prev => {
            const needsUpdate = prev.some(i => i.priceCop && i.priceCop > 0);
            if (!needsUpdate) return prev;
            return prev.map(i => {
                if (i.priceCop && i.priceCop > 0) {
                    return { ...i, priceUsd: i.priceCop / tasaCop };
                }
                return i;
            });
        });
    }, [tasaCop]);

    const updateQty = (id, delta) => {
        triggerHaptic && triggerHaptic();
        if (delta < 0) playRemove();

        const allowNeg = localStorage.getItem('allow_negative_stock') === 'true';

        // Pre-check stock BEFORE setCart to avoid React StrictMode double toast
        if (!allowNeg && delta > 0) {
            const currentCart = cartRef.current;
            const cartItem = currentCart.find(i => i.id === id);
            if (cartItem) {
                const originalId = cartItem._originalId || cartItem.id;
                const productData = products.find(p => p.id === originalId);
                if (productData) {
                    const availableStock = parseFloat(productData.stock) || 0;
                    const newQty = Math.round((cartItem.qty + delta) * 1000) / 1000;
                    const totalUsed = currentCart.reduce((sum, item) => {
                        if ((item._originalId || item.id) !== originalId) return sum;
                        if (item.id === id) return sum;
                        if (item._mode === 'unit') return sum + (item.qty / (item._unitsPerPackage || 1));
                        return sum + item.qty;
                    }, 0);
                    const thisItemStock = cartItem._mode === 'unit' ? newQty / (cartItem._unitsPerPackage || 1) : newQty;
                    if (totalUsed + thisItemStock > availableStock) {
                        playError();
                        showToast(`${cartItem.name}: stock maximo alcanzado`, 'warning');
                        return;
                    }
                }
            }
        }

        setCart(prev => prev.map(i => {
            if (i.id !== id) return i;
            let newQty = Math.round((i.qty + delta) * 1000) / 1000;
            if (newQty < 0) newQty = 0;
            return newQty === 0 ? null : { ...i, qty: newQty };
        }).filter(Boolean));
    };

    const removeFromCart = (id) => {
        triggerHaptic && triggerHaptic();
        playRemove();
        setCart(prev => prev.filter(i => i.id !== id));
    };

    const handleSearchKeyDown = (e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex(prev => Math.min(prev + 1, searchResults.length - 1)); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex(prev => Math.max(prev - 1, 0)); }
        else if (e.key === 'ArrowRight') {
            // Jump to cart navigation if items exist
            if (cart.length > 0) {
                e.preventDefault();
                searchInputRef.current?.blur();
            }
        }
        else if (e.key === 'Enter') {
            e.preventDefault();
            const trimmedTerm = searchTerm.trim();

            // 1. Coincidencia exacta de código de barras o ID primero (pistola enfocada)
            if (trimmedTerm.length >= 3) {
                const exactMatch = products.find(p => p.barcode === trimmedTerm || p.id === trimmedTerm);
                if (exactMatch) {
                    addToCart(exactMatch, null, null, true);
                    handleSetSearchTerm('');
                    return;
                }
            }

            // 2. Barcode de balanza/pesa electrónica (prefijo 21)
            if (trimmedTerm.startsWith('21') && trimmedTerm.length >= 13) {
                const pluCode = parseInt(trimmedTerm.substring(2, 7), 10).toString();
                const weightKg = parseInt(trimmedTerm.substring(7, 12), 10) / 1000;
                const p = products.find(p => p.id === pluCode || p.barcode?.includes(pluCode) || p.barcode?.includes(trimmedTerm.substring(0, 7)));
                if (p) { addToCart({ ...p, isWeight: true }, weightKg, null, true); handleSetSearchTerm(''); return; }
            }

            // 3. Fallbacks de selección
            if (searchResults[selectedIndex]) {
                addToCart(searchResults[selectedIndex]);
            } else if (searchResults.length === 1) {
                addToCart(searchResults[0]);
            }
        }
    };

    const handleAddCustomAmount = (amount, currency) => {
        let amountUsd = 0;
        let exactBsToStore = null;

        if (currency === 'USD') {
            amountUsd = parseFloat(amount.toFixed(2));
            // exactBsToStore remains null to float with effectiveRate
        } else if (currency === 'COP') {
            const tasaCopVal = typeof tasaCop !== 'undefined' ? tasaCop : (parseFloat(localStorage.getItem('tasa_cop')) || 4150);
            amountUsd = parseFloat((amount / tasaCopVal).toFixed(2));
            // exactBsToStore remains null to float with effectiveRate
        } else {
            // Default BS
            amountUsd = parseFloat((amount / effectiveRate).toFixed(2));
            exactBsToStore = parseFloat(amount);
        }

        if (amountUsd <= 0) return;

        const customProduct = {
            id: `custom_${Date.now()}`,
            name: 'Venta Libre',
            priceUsdt: amountUsd, // Usamos priceUsdt para que la validación temprana lo acepte
            exactBs: exactBsToStore, // Monto exacto original en Bs, o null si debe flotar
            costBs: 0,
            costUsd: 0,
            unit: 'unidad',
            category: 'otros',
            stock: 9999,
        };

        addToCart(customProduct);
        setShowCustomAmountModal(false);
    };

    // ==========================================
    // KEYBOARD SHORTCUTS (LISTO POS Port)
    // ==========================================
    useSalesKeyboard({
        todayAperturaData, showCheckout, showReceipt, hierarchyPending, weightPending,
        showClearCartConfirm, showCustomAmountModal, showRateConfig, showKeyboardHelp,
        showDiscountModal, searchInputRef, setCartSelectedIndex, setShowClearCartConfirm,
        cartRef, setShowCheckout, cartSelectedIndex, updateQty, removeFromCart
    });

    // ── Loading ───────────────────────────────────
    if (isLoading) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center">
                <div className="w-8 h-8 rounded-full border-4 border-slate-200 dark:border-slate-800 border-t-emerald-500 animate-spin" />
            </div>
        );
    }

    // ── Render ─────────────────────────────────────
    return (
        <div className="flex-1 min-h-0 flex flex-col dark:bg-slate-950 p-2 sm:p-4 sm:pb-4 overflow-hidden relative">

            {/* Header + Rate Config */}
            <SalesHeader
                effectiveRate={effectiveRate}
                rateMode={rateMode} setRateMode={setRateMode}
                useAutoRate={useAutoRate} setUseAutoRate={setUseAutoRate}
                customRate={customRate} setCustomRate={setCustomRate}
                rates={rates}
                showRateConfig={showRateConfig} setShowRateConfig={setShowRateConfig}
                setShowKeyboardHelp={setShowKeyboardHelp}
                triggerHaptic={triggerHaptic}
                copEnabled={copEnabled} copPrimary={copPrimary} tasaCop={tasaCop}
                autoCopEnabled={autoCopEnabled} setAutoCopEnabled={setAutoCopEnabled}
                tasaCopManual={tasaCopManual} setTasaCopManual={setTasaCopManual}
            />

            {/* Banner de Advertencia de Discrepancia de Tasas */}
            {rateDiscrepancyWarning && (
                <div className="mx-4 lg:mx-0 mb-3 bg-amber-500/10 dark:bg-amber-500/5 backdrop-blur-sm border border-amber-500/20 text-amber-800 dark:text-amber-300 px-4 py-3 rounded-2xl flex items-center justify-between gap-3 animate-in slide-in-from-top-4 duration-300">
                    <div className="flex items-center gap-2.5">
                        <span className="text-lg">⚠️</span>
                        <div className="text-left">
                            <p className="text-xs font-black uppercase tracking-wider">Tasas en Conflicto Detectadas</p>
                            <p className="text-[10px] text-amber-700/80 dark:text-amber-400/70 font-semibold leading-tight">
                                Google Script: <span className="font-bold text-amber-900 dark:text-amber-200">{rateDiscrepancyWarning.lowest.toFixed(2)} Bs</span> vs. 
                                DolarApi: <span className="font-bold text-amber-900 dark:text-amber-200">{rateDiscrepancyWarning.highest.toFixed(2)} Bs</span>. 
                                Se seleccionó automáticamente la más alta para proteger tus ventas.
                            </p>
                        </div>
                    </div>
                    <span className="text-[9px] bg-amber-500/20 text-amber-800 dark:text-amber-300 px-1.5 py-0.5 rounded font-black tracking-widest uppercase shrink-0">
                        {rateDiscrepancyWarning.diff}% DIF
                    </span>
                </div>
            )}

            {!todayAperturaData ? (
                <CajaCerradaOverlay
                    cartCount={cart.length}
                    onOpenApertura={() => setIsAperturaOpen(true)}
                />
            ) : (
                <>


                    {/* ── Split Layout: Products (left) + Cart Sidebar (right) on desktop ── */}
                    <div className="flex-1 min-h-0 flex flex-col lg:flex-row lg:gap-4">

                        {/* ── Left Column: Search + Categories ── */}
                        <div className="flex-1 min-h-0 flex flex-col lg:min-w-0 overflow-y-auto lg:overflow-hidden" style={{ WebkitOverflowScrolling: 'touch' }}>
                            {/* ── ZONA SUPERIOR: Buscador + Tasa (fila horizontal en desktop) ── */}
                            <div className="shrink-0 mb-3 flex items-stretch gap-3">
                                {/* Buscador: ocupa todo el espacio */}
                                <div className="flex-1 bg-white dark:bg-slate-900 rounded-2xl sm:rounded-3xl p-3 sm:p-4 shadow-sm border border-slate-100 dark:border-slate-800 relative">
                                    <SearchBar
                                        ref={searchInputRef}
                                        searchTerm={searchTerm}
                                        onSearchChange={handleSetSearchTerm}
                                        onKeyDown={handleSearchKeyDown}
                                        onPasteBarcode={handlePasteBarcode}
                                        searchResults={searchResults}
                                        selectedIndex={selectedIndex} setSelectedIndex={setSelectedIndex}
                                        effectiveRate={effectiveRate}
                                        addToCart={addToCart}
                                        isRecording={isRecording} isProcessingAudio={isProcessingAudio} startRecording={startRecording} stopRecording={stopRecording}
                                        hierarchyPending={hierarchyPending} setHierarchyPending={setHierarchyPending}
                                        weightPending={weightPending} setWeightPending={setWeightPending}
                                        copEnabled={copEnabled} copPrimary={copPrimary} tasaCop={tasaCop}
                                    />
                                </div>

                                {/* Tasa de Referencia Flotante (estilo Listo POS 2026) — solo visible en desktop (lg:flex) */}
                                <button
                                    onClick={() => setShowRateConfig(v => !v)}
                                    className="hidden lg:flex shrink-0 flex-col items-center justify-center bg-white dark:bg-slate-900 rounded-2xl sm:rounded-3xl px-5 border border-slate-100 dark:border-slate-800 shadow-sm hover:border-brand/40 transition-all min-w-[100px] gap-0.5"
                                >
                                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                                        {copEnabled && copPrimary ? 'TASA COP' : 'TASA BCV'}
                                    </span>
                                    <span className="text-base font-black text-brand leading-none tabular-nums">
                                        {copEnabled && copPrimary
                                            ? Math.round(tasaCop).toLocaleString('es-CO')
                                            : formatBs(effectiveRate).replace('.', ',')}
                                    </span>
                                    {!useAutoRate && <span className="text-[8px] bg-brand-light dark:bg-surface-800/30 text-brand-dark dark:text-brand px-1 rounded font-bold">MAN</span>}
                                </button>
                            </div>

                            {/* Category Chips + Product Grid */}
                            {!showCheckout && !showReceipt && (
                                <CategoryBar
                                    selectedCategory={selectedCategory} setSelectedCategory={setSelectedCategory}
                                    filteredByCategory={filteredByCategory}
                                    addToCart={addToCart}
                                    triggerHaptic={triggerHaptic}
                                    searchTerm={searchTerm}
                                    onOpenCustomAmount={() => setShowCustomAmountModal(true)}
                                    copEnabled={copEnabled}
                                    copPrimary={copPrimary}
                                    tasaCop={tasaCop}
                                    effectiveRate={effectiveRate}
                                    products={products}
                                    categories={categories}
                                    onClearCart={() => { triggerHaptic && triggerHaptic(); setShowClearCartConfirm(true); }}
                                    onHoldCart={handleHoldCart}
                                    pendingCartsCount={pendingCarts.length}
                                    onRestoreHold={handleRestoreHold}
                                    pendingCarts={pendingCarts}
                                    onOpenHelp={() => setShowKeyboardHelp(true)}
                                    onOpenHolds={() => setShowHoldsModal(true)}
                                    cart={cart}
                                />
                    )}
                </div>

                {/* ── Right Column: Cart Sidebar — desktop only ── */}
                <div className="hidden lg:flex lg:w-[380px] lg:shrink-0 lg:flex-col">
                    <CartPanel
                        cart={cart} effectiveRate={effectiveRate}
                        cartSubtotalUsd={cartSubtotalUsd} cartSubtotalBs={cartSubtotalBs}
                        cartTotalUsd={cartTotalUsd} cartTotalBs={cartTotalBs} cartTotalCop={cartTotalCop} cartItemCount={cartItemCount}
                        discountData={discountData} onOpenDiscount={() => setShowDiscountModal(true)}
                        updateQty={updateQty} removeFromCart={removeFromCart}
                        onCheckout={() => { triggerHaptic && triggerHaptic(); setShowCheckout(true); }}
                        onClearCart={() => { triggerHaptic && triggerHaptic(); setShowClearCartConfirm(true); }}
                        triggerHaptic={triggerHaptic}
                        cartSelectedIndex={cartSelectedIndex}
                        copEnabled={copEnabled}
                        copPrimary={copPrimary}
                        tasaCop={tasaCop}
                    />
                </div>

            </div>

            {/* ── Mobile Cart FAB & Bottom Sheet (lg:hidden) ── */}
            <div className="lg:hidden">
                {/* Floating Action Button — v1.2.0: bg-brand (cian) en vez de emerald */}
                {cart.length > 0 && !isCartSheetOpen && !showCheckout && !showReceipt && (
                    <button
                        onClick={() => { triggerHaptic && triggerHaptic(); setIsCartSheetOpen(true); }}
                        className="fixed bottom-[max(5rem,env(safe-area-inset-bottom)+4.5rem)] left-4 right-4 bg-brand hover:bg-brand-dark text-white p-4 rounded-2xl shadow-primary-tone flex items-center justify-between z-40 active:scale-95 transition-all animate-in slide-in-from-bottom"
                    >
                        <div className="flex items-center gap-3">
                            <div className="bg-white/20 p-2 rounded-xl">
                                <ShoppingCart size={20} />
                            </div>
                            <div className="text-left">
                                <div className="text-xs font-bold text-white/80 uppercase tracking-wider">Ver Cesta</div>
                                <div className="font-black leading-none">{cartItemCount} artículo{cartItemCount !== 1 && 's'}</div>
                            </div>
                        </div>
                        <div className="text-right">
                            <div className="text-2xl font-black leading-none">
                                {copEnabled && copPrimary && tasaCop > 0
                                    ? `${new Intl.NumberFormat('es-CO').format(Math.round(cartTotalCop))} COP`
                                    : `$${cartTotalUsd.toFixed(2)}`}
                            </div>
                            <div className="text-xs font-bold text-white/80 mt-1">Bs {formatBs(cartTotalBs)}</div>
                        </div>
                    </button>
                )}

                {/* Bottom Sheet Overlay — v1.2.0: cart panel con bg-surface-2 */}
                {isCartSheetOpen && !showCheckout && !showReceipt && (
                    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-surface-950/60 backdrop-blur-sm animate-in fade-in duration-200 pb-[max(0px,env(safe-area-inset-bottom))]"
                         onClick={() => setIsCartSheetOpen(false)}>
                        <div className="bg-surface-2 dark:bg-surface-950 w-full rounded-t-3xl shadow-tone-lg flex flex-col max-h-[85vh] animate-in slide-in-from-bottom-full duration-300"
                             onClick={e => e.stopPropagation()}>
                            <div className="shrink-0 flex justify-center pt-3 pb-2" onClick={() => setIsCartSheetOpen(false)}>
                                <div className="w-12 h-1.5 bg-surface-300 dark:bg-surface-700 rounded-full cursor-pointer" />
                            </div>
                            <div className="shrink-0 px-4 pb-3 flex items-center justify-between border-b border-surface-200 dark:border-surface-700">
                                <h3 className="font-black text-surface-700 dark:text-surface-100 text-lg flex items-center gap-2">
                                    <ShoppingCart size={20} className="text-brand" /> Cesta Actual
                                </h3>
                                <button onClick={() => setIsCartSheetOpen(false)} className="p-2 -mr-2 text-surface-400 hover:text-surface-600 dark:hover:text-surface-200 transition-colors">
                                    <X size={20} />
                                </button>
                            </div>
                            <div className="flex-1 overflow-y-auto">
                                <CartPanel
                                    cart={cart} effectiveRate={effectiveRate}
                                    cartSubtotalUsd={cartSubtotalUsd} cartSubtotalBs={cartSubtotalBs}
                                    cartTotalUsd={cartTotalUsd} cartTotalBs={cartTotalBs} cartTotalCop={cartTotalCop} cartItemCount={cartItemCount}
                                    discountData={discountData} onOpenDiscount={() => setShowDiscountModal(true)}
                                    updateQty={updateQty} removeFromCart={removeFromCart}
                                    onCheckout={() => { triggerHaptic && triggerHaptic(); setShowCheckout(true); setIsCartSheetOpen(false); }}
                                    onClearCart={() => { triggerHaptic && triggerHaptic(); setShowClearCartConfirm(true); }}
                                    triggerHaptic={triggerHaptic}
                                    cartSelectedIndex={cartSelectedIndex}
                                    copEnabled={copEnabled}
                                    copPrimary={copPrimary}
                                    tasaCop={tasaCop}
                                />
                            </div>
                        </div>
                    </div>
                )}
            </div>
            </>
            )}

            {/* Checkout Modal — modo dinámico según preferencia del usuario */}
            {showCheckout && (() => {
                const sharedProps = {
                    onClose: () => { setShowCheckout(false); setSelectedCustomerId(''); },
                    cartSubtotalUsd, cartSubtotalBs: cartSubtotalUsd * effectiveRate,
                    cartTotalUsd, cartTotalBs, cartTotalCop,
                    discountData, effectiveRate,
                    customers, selectedCustomerId, setSelectedCustomerId,
                    paymentMethods,
                    onConfirmSale: handleCheckout, onCreateCustomer: handleCreateCustomer,
                    triggerHaptic,
                    copEnabled, copPrimary, tasaCop,
                    currentFloatUsd: currentFloat.usd,
                    currentFloatBs: currentFloat.bs,
                    onSwitchMode: setCheckoutMode,
                    isProcessing,
                };
                return checkoutMode === 'pos'
                    ? <CheckoutModalPOS {...sharedProps} />
                    : <CheckoutModal {...sharedProps} />;
            })()}

            {/* Receipt Modal */}
            <ReceiptModal
                receipt={showReceipt}
                onClose={() => { setShowReceipt(null); setSelectedCustomerId(''); }}
                onShareWhatsApp={(r) => { window.open(buildReceiptWhatsAppUrl(r, effectiveRate), '_blank'); }}
                currentRate={effectiveRate}
                copPrimary={copPrimary}
            />

            {/* Custom Amount Modal */}
            {showCustomAmountModal && (
                <CustomAmountModal
                    onClose={() => setShowCustomAmountModal(false)}
                    onConfirm={handleAddCustomAmount}
                    effectiveRate={effectiveRate}
                    triggerHaptic={triggerHaptic}
                />
            )}

            {/* Clear Cart Confirm */}
            <ConfirmModal
                isOpen={showClearCartConfirm}
                onClose={() => setShowClearCartConfirm(false)}
                onConfirm={() => { setCart([]); setDiscount({ type: 'percentage', value: 0 }); setShowClearCartConfirm(false); setCartSelectedIndex(-1); }}
                title="¿Vaciar toda la cesta?"
                message="Todos los productos serán eliminados de la cesta actual. Esta acción no se puede deshacer."
                confirmText="Sí, vaciar"
                variant="cart"
            />

            {/* Discount Modal */}
            {showDiscountModal && (
                <DiscountModal
                    currentDiscount={discount}
                    onApply={(newDiscount) => {
                        setDiscount(newDiscount);
                        setShowDiscountModal(false);
                    }}
                    onClose={() => setShowDiscountModal(false)}
                    cartSubtotalUsd={cartSubtotalUsd}
                    effectiveRate={effectiveRate}
                    tasaCop={tasaCop}
                    copEnabled={copEnabled}
                    copPrimary={copPrimary}
                />
            )}

            {/* Confetti */}
            {showConfetti && <Confetti onDone={() => setShowConfetti(false)} />}

            {/* Keyboard Shortcuts Help Modal (Desktop Only) */}
            <KeyboardHelpModal
                isOpen={showKeyboardHelp}
                onClose={() => setShowKeyboardHelp(false)}
            />

            {/* Apertura Caja Modal */}
            <AperturaCajaModal
                isOpen={isAperturaOpen}
                onClose={() => setIsAperturaOpen(false)}
                onConfirm={handleSaveApertura}
                copEnabled={copEnabled}
                copPrimary={copPrimary}
            />

            {/* Holds Modal */}
            {showHoldsModal && (
                <HoldsModal
                    tickets={pendingCarts}
                    onRecuperar={handleRestoreHold}
                    onEliminar={handleDeleteHold}
                    onClose={() => setShowHoldsModal(false)}
                    effectiveRate={effectiveRate}
                />
            )}

            {/* Price/Rate Discrepancy Alert Modal */}
            <ConfirmModal
                isOpen={!!holdAlertData}
                onClose={() => setHoldAlertData(null)}
                onConfirm={() => {
                    if (holdAlertData && holdAlertData.onConfirm) {
                        holdAlertData.onConfirm();
                    }
                }}
                title={holdAlertData?.title || 'Actualización de Datos'}
                message={holdAlertData?.message || ''}
                confirmText="Cargar de todas formas"
                cancelText="Cancelar"
                variant="warning"
            />
        </div>
    );
}
