import React, { useState, useEffect } from 'react';
import { Modal } from '../Modal';
import ProductFormQuick from '../Products/ProductFormQuick';
import { useProductContext } from '../../context/ProductContext';
import { buildProductPayload } from '../../utils/productProcessor';
import { supabaseCloud } from '../../config/supabaseCloud';
import { showToast } from '../Toast';
import { Save } from 'lucide-react';

export default function RemoteProductFormModal({ isOpen, onClose, targetDeviceId, productToEdit = null }) {
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

    const [costUsd, setCostUsd] = useState('');
    const [costBs, setCostBs] = useState('');
    const [costCop, setCostCop] = useState('');

    const [stock, setStock] = useState('0');
    const [lowStockAlert, setLowStockAlert] = useState('5');
    const [image, setImage] = useState(null);

    const [packagingType, setPackagingType] = useState('suelto');
    const [unitsPerPackage, setUnitsPerPackage] = useState('1');
    const [stockInLotes, setStockInLotes] = useState('0');
    const [granelUnit, setGranelUnit] = useState('kg');
    const [sellByUnit, setSellByUnit] = useState(false);
    const [unitPriceUsd, setUnitPriceUsd] = useState('');
    const [unitPriceCop, setUnitPriceCop] = useState('');

    const [isSearchingImage, setIsSearchingImage] = useState(false);
    const [imageMatches, setImageMatches] = useState([]);
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        if (productToEdit) {
            setName(productToEdit.name || '');
            setBarcode(productToEdit.barcode || '');
            setCategory(productToEdit.category || 'General');
            setPriceUsd(productToEdit.priceUsd != null ? String(productToEdit.priceUsd) : (productToEdit.priceUsdt != null ? String(productToEdit.priceUsdt) : ''));
            setPriceBs(productToEdit.priceBs != null ? String(productToEdit.priceBs) : '');
            setPriceCop(productToEdit.priceCop != null ? String(productToEdit.priceCop) : '');
            setPricingMode(productToEdit.pricingMode || 'tasa_dia');
            setPriceBsUsdRef(productToEdit.priceBsUsdRef != null ? String(productToEdit.priceBsUsdRef) : '');

            setCostUsd(productToEdit.costUsd != null ? String(productToEdit.costUsd) : (productToEdit.costPrice != null ? String(productToEdit.costPrice) : ''));
            setCostBs(productToEdit.costBs != null ? String(productToEdit.costBs) : '');
            setCostCop(productToEdit.costCop != null ? String(productToEdit.costCop) : '');

            setStock(productToEdit.stock != null ? String(productToEdit.stock) : '0');
            setLowStockAlert(productToEdit.lowStockAlert != null ? String(productToEdit.lowStockAlert) : (productToEdit.minStock != null ? String(productToEdit.minStock) : '5'));
            setImage(productToEdit.image || null);

            setPackagingType(productToEdit.packagingType || 'suelto');
            setUnitsPerPackage(productToEdit.unitsPerPackage != null ? String(productToEdit.unitsPerPackage) : '1');
            setStockInLotes(productToEdit.stockInLotes != null ? String(productToEdit.stockInLotes) : '0');
            setGranelUnit(productToEdit.granelUnit || 'kg');
            setSellByUnit(Boolean(productToEdit.sellByUnit));
            setUnitPriceUsd(productToEdit.unitPriceUsd != null ? String(productToEdit.unitPriceUsd) : '');
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

            setCostUsd('');
            setCostBs('');
            setCostCop('');

            setStock('0');
            setLowStockAlert('5');
            setImage(null);

            setPackagingType('suelto');
            setUnitsPerPackage('1');
            setStockInLotes('0');
            setGranelUnit('kg');
            setSellByUnit(false);
            setUnitPriceUsd('');
            setUnitPriceCop('');
        }
    }, [productToEdit, isOpen]);

    if (!isOpen) return null;

    // Handlers for currency conversions
    const handlePriceUsdChange = (val) => {
        setPriceUsd(val);
        if (bcvRate > 0 && val) {
            const calculatedBs = (parseFloat(val) * bcvRate).toFixed(2);
            setPriceBs(calculatedBs);
        } else {
            setPriceBs('');
        }
    };

    const handlePriceBsChange = (val) => {
        setPriceBs(val);
        if (bcvRate > 0 && val) {
            const calculatedUsd = (parseFloat(val) / bcvRate).toFixed(2);
            setPriceUsd(calculatedUsd);
        } else {
            setPriceUsd('');
        }
    };

    const handlePriceCopChange = (val) => setPriceCop(val);

    const handleCostUsdChange = (val) => {
        setCostUsd(val);
        if (bcvRate > 0 && val) {
            setCostBs((parseFloat(val) * bcvRate).toFixed(2));
        } else {
            setCostBs('');
        }
    };

    const handleCostBsChange = (val) => {
        setCostBs(val);
        if (bcvRate > 0 && val) {
            setCostUsd((parseFloat(val) / bcvRate).toFixed(2));
        } else {
            setCostUsd('');
        }
    };

    const handleCostCopChange = (val) => setCostCop(val);

    const handleImageUpload = (e) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => setImage(reader.result);
            reader.readAsDataURL(file);
        }
    };

    const handleLoadImageFromUrl = (url) => {
        if (url) setImage(url);
    };

    const handleAutoSearchImage = () => {};
    const handleSelectImage = (imgUrl) => setImage(imgUrl);

    const handleSubmit = async (e) => {
        if (e) e.preventDefault();

        if (!name.trim()) {
            showToast('El nombre del producto es obligatorio', 'error');
            return;
        }

        if (!supabaseCloud || !targetDeviceId) {
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
                stock,
                stockInLotes,
                packagingType,
                unitsPerPackage,
                granelUnit,
                sellByUnit,
                unitPriceUsd,
                unitPriceCop,
                category,
                lowStockAlert
            };

            const processed = buildProductPayload(formData, bcvRate);
            const isEdit = Boolean(productToEdit);

            const productPayload = {
                ...processed,
                id: isEdit ? productToEdit.id : `p_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                image: image || null,
                updatedAt: new Date().toISOString()
            };

            const channel = supabaseCloud.channel('system_commands');
            await channel.subscribe();

            await channel.send({
                type: 'broadcast',
                event: 'supervisor_product_update',
                payload: {
                    targetDeviceId,
                    action: isEdit ? 'edit' : 'create',
                    productId: productPayload.id,
                    product: productPayload
                }
            });

            supabaseCloud.removeChannel(channel).catch(() => {});
            showToast(isEdit ? '✏️ Orden de edición enviada a la caja' : '➕ Orden de creación enviada a la caja', 'success');
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
                    handlePriceCopChange={handlePriceCopChange}
                    priceCop={priceCop}
                    costUsd={costUsd} handleCostUsdChange={handleCostUsdChange}
                    costBs={costBs} handleCostBsChange={handleCostBsChange}
                    costCop={costCop} handleCostCopChange={handleCostCopChange}
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

                {/* Actions */}
                <div className="flex gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
                    <button
                        type="button"
                        onClick={onClose}
                        className="flex-1 py-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 font-bold rounded-xl text-sm transition-colors"
                    >
                        Cancelar
                    </button>
                    <button
                        type="button"
                        onClick={handleSubmit}
                        disabled={isSubmitting}
                        className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-sm transition-all shadow-lg shadow-blue-600/20 active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                        <Save className="w-4 h-4" />
                        <span>{isSubmitting ? 'Guardando en Caja...' : 'Guardar en Caja'}</span>
                    </button>
                </div>
            </div>
        </Modal>
    );
}
