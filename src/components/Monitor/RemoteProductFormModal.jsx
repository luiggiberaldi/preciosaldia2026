import React, { useState, useEffect, useRef } from 'react';
import { Modal } from '../Modal';
import ProductFormQuick from '../Products/ProductFormQuick';
import { useProductContext } from '../../context/ProductContext';
import { buildProductPayload, deriveCostFactorUpdate } from '../../utils/productProcessor';
import { prepareProductFormState } from '../../hooks/useProductForm';
import { getGranelUnitMode } from '../../utils/granel';
import { showToast } from '../Toast';
import { Save } from 'lucide-react';
import { SUPERVISOR_REMOTE_PRODUCTS_ENABLED } from '../../config/supervisorPolicy';
import { sendSupervisorCommand } from '../../services/supervisorCommandService';
import { buildProductRevision, extractEditableProductPatch } from '../../services/supervisorContracts';

export default function RemoteProductFormModal({ isOpen, onClose, targetDeviceId, productToEdit = null, remoteAvailable = true }) {
    const { categories, effectiveRate: bcvRate, copEnabled, copPrimary, tasaCop } = useProductContext();

    // Form fields
    const [name, setName] = useState('');
    const [barcode, setBarcode] = useState('');
    const [category, setCategory] = useState('General');
    const [priceUsd, setPriceUsd] = useState('');
    const [priceBs, setPriceBs] = useState('');
    const [priceCop, setPriceCop] = useState('');
    const [pricingMode, setPricingMode] = useState('tasa_dia');
    const [priceBsUsdRef, setPriceBsUsdRef] = useState('');
    const [ivaMode, setIvaMode] = useState('');

    const [costUsd, setCostUsd] = useState('');
    const [costBs, setCostBs] = useState('');
    const [costCop, setCostCop] = useState('');
    // Factor de costo (igual que en la caja): Costo = Precio × factor.
    // Los 2 últimos campos editados calculan el tercero (cost/price/factor).
    const [costFactor, setCostFactor] = useState('');
    const costEditOrderRef = useRef([]);

    const [stock, setStock] = useState('');
    const [lowStockAlert, setLowStockAlert] = useState('5');
    const [image, setImage] = useState(null);

    const [packagingType, setPackagingType] = useState('suelto');
    const [unitsPerPackage, setUnitsPerPackage] = useState('1');
    const [stockInLotes, setStockInLotes] = useState('');
    const [granelUnit, setGranelUnit] = useState('kg');
    const [sellByUnit, setSellByUnit] = useState(false);
    const [unitPriceUsd, setUnitPriceUsd] = useState('');
    const [unitPriceCop, setUnitPriceCop] = useState('');

    const [isSearchingImage, setIsSearchingImage] = useState(false);
    const [imageMatches, setImageMatches] = useState([]);
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        if (productToEdit) {
            const formState = prepareProductFormState(productToEdit, bcvRate);
            setName(formState.name || '');
            setBarcode(formState.barcode || '');
            setCategory(formState.category || 'General');
            setPriceUsd(formState.priceUsd || '');
            setPriceBs(formState.priceBs || '');
            setPriceCop(productToEdit.priceCop != null ? String(productToEdit.priceCop) : '');
            setPricingMode(formState.pricingMode || 'tasa_dia');
            setPriceBsUsdRef(formState.priceBsUsdRef || '');
            setIvaMode(productToEdit.ivaRate === 0 ? 'exento' : '');

            setCostUsd(formState.costUsd || '');
            setCostBs(formState.costBs || '');
            setCostCop(productToEdit.costCop != null ? String(productToEdit.costCop) : '');
            setCostFactor(formState.costFactor != null ? String(formState.costFactor) : '');
            costEditOrderRef.current = Number(formState.costFactor) > 0 ? ['factor'] : [];

            setStock(formState.stock !== undefined && formState.stock !== null ? String(formState.stock) : '0');
            setLowStockAlert(String(formState.lowStockAlert ?? 5));
            setImage(formState.image || null);
            setImageMatches([]);
            setIsSearchingImage(false);

            setPackagingType(formState.packagingType || 'suelto');
            setUnitsPerPackage(formState.unitsPerPackage != null ? String(formState.unitsPerPackage) : '1');
            setStockInLotes(formState.stockInLotes != null ? String(formState.stockInLotes) : '0');
            setGranelUnit(formState.granelUnit || 'kg');
            setSellByUnit(Boolean(formState.sellByUnit));
            setUnitPriceUsd(formState.unitPriceUsd != null ? String(formState.unitPriceUsd) : '');
            setUnitPriceCop(productToEdit.unitPriceCop != null ? String(productToEdit.unitPriceCop) : '');
        } else {
            setName('');
            setBarcode('');
            setCategory('General');
            setPriceUsd('');
            setPriceBs('');
            setPriceCop('');
            setPricingMode('tasa_dia');
            setPriceBsUsdRef('');
            setIvaMode('');

            setCostUsd('');
            setCostBs('');
            setCostCop('');
            setCostFactor('');
            costEditOrderRef.current = [];

            setStock('');
            setLowStockAlert('5');
            setImage(null);
            setImageMatches([]);
            setIsSearchingImage(false);

            setPackagingType('suelto');
            setUnitsPerPackage('1');
            setStockInLotes('');
            setGranelUnit('kg');
            setSellByUnit(false);
            setUnitPriceUsd('');
            setUnitPriceCop('');
        }
    }, [productToEdit, isOpen]);

    if (!isOpen) return null;

    // ─── Factor de costo: misma lógica que la caja ───
    // Los 2 últimos valores editados (costo, precio, factor) calculan el tercero.
    const deriveFromLastTwoEdits = (editedField, cost, price, factor) => {
        const result = deriveCostFactorUpdate(costEditOrderRef.current, editedField, { cost, price, factor });
        costEditOrderRef.current = result.editOrder;
        if (!result.field) return;

        if (result.field === 'factor') {
            setCostFactor(result.value.toFixed(3));
        } else if (result.field === 'price') {
            setPriceUsd(result.value.toFixed(2));
            if (bcvRate > 0) setPriceBs((result.value * bcvRate).toFixed(2));
        } else {
            setCostUsd(result.value.toFixed(2));
            if (bcvRate > 0) setCostBs((result.value * bcvRate).toFixed(2));
        }
    };

    const removeFromEditOrder = (field) => {
        costEditOrderRef.current = costEditOrderRef.current.filter(item => item !== field);
    };

    // Handlers for currency conversions
    const handlePriceUsdChange = (val) => {
        setPriceUsd(val);
        const usd = parseFloat(val) || 0;
        if (bcvRate > 0 && val) {
            const calculatedBs = (usd * bcvRate).toFixed(2);
            setPriceBs(calculatedBs);
        } else {
            setPriceBs('');
        }
        if (!val || usd <= 0) {
            removeFromEditOrder('price');
            return;
        }
        deriveFromLastTwoEdits('price', parseFloat(costUsd) || 0, usd, parseFloat(costFactor) || 0);
    };

    const handlePriceBsChange = (val) => {
        setPriceBs(val);
        const amountBs = parseFloat(val) || 0;
        if (bcvRate > 0 && val) {
            const calculatedUsd = (amountBs / bcvRate).toFixed(2);
            setPriceUsd(calculatedUsd);
        } else {
            setPriceUsd('');
        }
        if (!val || amountBs <= 0 || bcvRate <= 0) {
            removeFromEditOrder('price');
            return;
        }
        deriveFromLastTwoEdits('price', parseFloat(costUsd) || 0, amountBs / bcvRate, parseFloat(costFactor) || 0);
    };

    const handlePriceCopChange = (val) => {
        setPriceCop(val);
        removeFromEditOrder('price');
    };

    const handleCostUsdChange = (val) => {
        setCostUsd(val);
        const usd = parseFloat(val) || 0;
        if (bcvRate > 0 && val) {
            setCostBs((usd * bcvRate).toFixed(2));
        } else {
            setCostBs('');
        }
        if (!val || usd <= 0) {
            removeFromEditOrder('cost');
            return;
        }
        deriveFromLastTwoEdits('cost', usd, parseFloat(priceUsd) || 0, parseFloat(costFactor) || 0);
    };

    const handleCostBsChange = (val) => {
        setCostBs(val);
        const amountBs = parseFloat(val) || 0;
        if (bcvRate > 0 && val) {
            setCostUsd((amountBs / bcvRate).toFixed(2));
        } else {
            setCostUsd('');
        }
        if (!val || amountBs <= 0 || bcvRate <= 0) {
            removeFromEditOrder('cost');
            return;
        }
        deriveFromLastTwoEdits('cost', amountBs / bcvRate, parseFloat(priceUsd) || 0, parseFloat(costFactor) || 0);
    };

    const handleCostCopChange = (val) => {
        setCostCop(val);
        removeFromEditOrder('cost');
    };

    const handleCostFactorChange = (val) => {
        setCostFactor(val);
        const factor = parseFloat(val) || 0;
        if (factor > 0) {
            deriveFromLastTwoEdits('factor', parseFloat(costUsd) || 0, parseFloat(priceUsd) || 0, factor);
        } else {
            removeFromEditOrder('factor');
        }
    };

    // Límite visible de la foto que viaja dentro del comando (data URL base64).
    const MAX_REMOTE_IMAGE_BYTES = 1024 * 1024;

    const handleImageUpload = (e) => {
        const file = e.target.files?.[0];
        if (file) {
            // Se mide el Blob antes de convertirlo: base64 aumenta ~33% el tamaño.
            if (file.size > MAX_REMOTE_IMAGE_BYTES) {
                showToast(`La imagen supera ${MAX_REMOTE_IMAGE_BYTES / (1024 * 1024)} MB; elige una más liviana`, 'warning');
                e.target.value = '';
                return;
            }
            const reader = new FileReader();
            reader.onloadend = () => setImage(reader.result);
            reader.readAsDataURL(file);
        }
    };

    // Las fotos encontradas se guardan como URL de Storage, no como base64.
    // Así el comando de producto permanece pequeño y no comparte estado con
    // los comandos de ingreso/egreso.
    const handleLoadImageFromUrl = (url) => {
        const trimmedUrl = typeof url === 'string' ? url.trim() : '';
        if (!trimmedUrl.startsWith('http')) {
            showToast('Ingresa un enlace de imagen válido', 'warning');
            return;
        }
        setImage(trimmedUrl);
        showToast('Imagen cargada correctamente', 'success');
    };

    const handleAutoSearchImage = async (productName) => {
        if (!productName || productName.trim().length < 3) {
            showToast('Ingresa un nombre de producto de al menos 3 letras', 'warning');
            return;
        }
        setIsSearchingImage(true);
        setImageMatches([]);
        try {
            const response = await fetch(`/api/search-image?q=${encodeURIComponent(productName.trim())}`);
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.error || 'No se pudo buscar la imagen');
            }
            if (data.success && Array.isArray(data.matches) && data.matches.length > 0) {
                setImageMatches(data.matches);
                showToast(`Encontramos ${data.matches.length} fotos. Elige la correcta.`, 'info');
            } else {
                showToast('No encontramos una foto para este producto', 'info');
            }
        } catch (error) {
            console.error('[RemoteProductImage] Error buscando foto:', error);
            showToast(error?.message || 'No se pudo buscar la foto automáticamente', 'error');
        } finally {
            setIsSearchingImage(false);
        }
    };

    const handleSelectImage = (imageUrl) => {
        if (!imageUrl) return;
        setImage(imageUrl);
        setImageMatches([]);
        showToast('Foto seleccionada', 'success');
    };

    const handleSubmit = async (e) => {
        if (e) e.preventDefault();

        if (!remoteAvailable) {
            showToast('La caja está desconectada; no se puede enviar la orden', 'warning');
            return;
        }

        if (!SUPERVISOR_REMOTE_PRODUCTS_ENABLED) {
            showToast('La edición remota de productos todavía no está habilitada', 'warning');
            return;
        }

        if (!name.trim()) {
            showToast('El nombre del producto es obligatorio', 'error');
            return;
        }

        if (!targetDeviceId) {
            showToast('No hay conexión con la caja registradora', 'error');
            return;
        }

        try {
            setIsSubmitting(true);

            const formData = {
                name,
                barcode,
                priceUsd,
                priceBs,
                priceCop,
                pricingMode,
                priceBsUsdRef,
                costUsd,
                costBs,
                costCop,
                costFactor,
                stock,
                stockInLotes,
                packagingType,
                unitsPerPackage,
                granelUnit,
                sellByUnit,
                unitPriceUsd,
                unitPriceCop,
                category,
                lowStockAlert,
                lowStockAlertCanonical: true,
                ivaMode,
                granelUnitMode: getGranelUnitMode(),
            };

            const processed = buildProductPayload(formData, bcvRate);
            const isEdit = Boolean(productToEdit);

            // Allowlist canónica de campos maestros editables derivada de EDITABLE_PRODUCT_FIELDS.
            // Excluye expresamente stock, stock inicial, lotes, movimientos y timestamps.
            // En edición, pasar de Exento a General debe enviar null explícito (undefined se omitiría
            // y el producto conservaría ivaRate 0). Una tasa personalizada previa no se toca.
            const ivaRateForPatch = processed.ivaRate !== undefined
                ? processed.ivaRate
                : (productToEdit?.ivaRate === 0 ? null : productToEdit?.ivaRate);
            const patch = isEdit ? extractEditableProductPatch({
                ...processed,
                ivaRate: ivaRateForPatch,
                // Una URL remota no tiene ruta Storage autorizada en la caja: se excluye
                // del patch para conservar la imagen actual. Solo viajan fotos locales (data URL).
                image: typeof image === 'string' && image.startsWith('http') ? undefined : (image || null),
            }) : null;

            const productPayload = isEdit ? null : {
                ...processed,
                id: `p_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                image: typeof image === 'string' && image.startsWith('http') ? null : (image || null),
                updatedAt: new Date().toISOString()
            };

            const baseRevision = isEdit ? buildProductRevision(productToEdit) : null;

            const result = await sendSupervisorCommand({
                type: isEdit ? 'supervisor.product.update' : 'supervisor.product.create',
                targetDeviceId,
                payload: isEdit
                    ? {
                        productId: productToEdit.id,
                        baseRevision,
                        baseUpdatedAt: productToEdit.updatedAt || productToEdit.updated_at || null,
                        patch: {
                            ...patch,
                            baseRevision,
                        },
                    }
                    : { product: productPayload },
            });

            if (!result.ok) {
                showToast(result.error, result.status === 'disabled' ? 'warning' : 'error');
                return;
            }

            const ack = await result.ackPromise;
            if (!ack?.ok) {
                showToast(ack?.error || 'La caja no confirmó la orden de producto', 'error');
                return;
            }

            showToast(isEdit ? '✏️ Edición confirmada en la caja' : '➕ Producto creado en la caja', 'success');
            onClose();
        } catch (err) {
            console.error('[RemoteProductFormModal] Error enviando producto:', err);
            showToast('Error al enviar la orden de producto', 'error');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={productToEdit ? "Editar Producto Remoto" : "Nuevo Producto Remoto"}
            size="max-w-2xl"
        >
            <div className="space-y-6">
                <ProductFormQuick
                    image={image} setImage={setImage}
                    name={name} setName={setName}
                    barcode={barcode} setBarcode={setBarcode}
                    category={category} setCategory={setCategory}
                    priceUsd={priceUsd} handlePriceUsdChange={handlePriceUsdChange}
                    priceBs={priceBs} handlePriceBsChange={handlePriceBsChange}
                    pricingMode={pricingMode} setPricingMode={setPricingMode}
                    priceBsUsdRef={priceBsUsdRef} setPriceBsUsdRef={setPriceBsUsdRef}
                    ivaMode={ivaMode} setIvaMode={setIvaMode}
                    handlePriceCopChange={handlePriceCopChange}
                    priceCop={priceCop}
                    costUsd={costUsd} handleCostUsdChange={handleCostUsdChange}
                    costBs={costBs} handleCostBsChange={handleCostBsChange}
                    costCop={costCop} handleCostCopChange={handleCostCopChange}
                    costFactor={costFactor}
                    handleCostFactorChange={handleCostFactorChange}
                    stock={stock} setStock={setStock}
                    lowStockAlert={lowStockAlert} setLowStockAlert={setLowStockAlert}
                    unitsPerPackage={unitsPerPackage} setUnitsPerPackage={setUnitsPerPackage}
                    sellByUnit={sellByUnit} setSellByUnit={setSellByUnit}
                    unitPriceUsd={unitPriceUsd} setUnitPriceUsd={setUnitPriceUsd}
                    unitPriceCop={unitPriceCop} setUnitPriceCop={setUnitPriceCop}
                    packagingType={packagingType} setPackagingType={setPackagingType}
                    stockInLotes={stockInLotes} setStockInLotes={setStockInLotes}
                    granelUnit={granelUnit} setGranelUnit={setGranelUnit}
                    effectiveRate={bcvRate}
                    copEnabled={copEnabled}
                    copPrimary={copPrimary}
                    tasaCop={tasaCop}
                    handleImageUpload={handleImageUpload}
                    categories={categories || []}
                    isSearchingImage={isSearchingImage}
                    handleLoadImageFromUrl={handleLoadImageFromUrl}
                    handleAutoSearchImage={handleAutoSearchImage}
                    imageMatches={imageMatches}
                    setImageMatches={setImageMatches}
                    handleSelectImage={handleSelectImage}
                />

                {/* Actions (Sticky footer para acceso táctil instantáneo) */}
                <div className="sticky bottom-0 -mx-4 -mb-8 sm:-mx-6 sm:-mb-10 px-4 py-3 sm:px-6 sm:py-4 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-100 dark:border-slate-800 flex gap-2.5 sm:gap-3 z-10">
                    <button
                        type="button"
                        onClick={onClose}
                        className="flex-1 min-h-11 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold rounded-xl text-sm transition-colors active:scale-98"
                    >
                        Cancelar
                    </button>
                    <button
                        type="button"
                        onClick={handleSubmit}
                        disabled={isSubmitting}
                        className="flex-1 min-h-11 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-sm transition-all shadow-lg shadow-blue-600/20 active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                        <Save className="w-4 h-4" />
                        <span>{isSubmitting ? 'Guardando en Caja...' : 'Guardar en Caja'}</span>
                    </button>
                </div>
            </div>
        </Modal>
    );
}
