import { useState, useCallback } from 'react';
import { round2 } from '../utils/dinero';
import { showToast } from '../components/Toast';
import { useAuthStore } from './store/useAuthStore';
import { buildGastoInternoRecord } from '../utils/gastoInterno';
import { saveGastoInterno, saveAutoconsumo, voidGastoInterno } from '../services/gastosInternosService';

export const GASTO_CATEGORIES = [
    { id: 'insumos',      label: 'Insumos',          icon: '📦' },
    { id: 'servicios',    label: 'Servicios',         icon: '💡' },
    { id: 'transporte',   label: 'Transporte',        icon: '🚗' },
    { id: 'personal',     label: 'Personal',          icon: '👤' },
    { id: 'mantenimiento',label: 'Mantenimiento',     icon: '🔧' },
    { id: 'autoconsumo',  label: 'Autoconsumo',       icon: '🏠' },
    { id: 'otros',        label: 'Otros',             icon: '📝' },
];

const currentUser = () => useAuthStore.getState()?.usuarioActivo || null;

// Nómina F0: la escritura vive en services/gastosInternosService.js (candado,
// lectura fresca, confirmación y caja abierta para efectivo). Este hook solo
// arma los datos, avisa en pantalla y refresca la lista.
export function useGastosInternos({ bcvRate, tasaCop, copEnabled, triggerHaptic, auditLog, setSales }) {
    const [isAddGastoOpen, setIsAddGastoOpen] = useState(false);

    // ─── Gasto de caja normal (sin movimiento de inventario) ────────────────
    const registrarGasto = useCallback(async ({ description, category, amountUsd, amountBs, methodId, currency, note }) => {
        triggerHaptic && triggerHaptic();

        let record;
        try {
            record = buildGastoInternoRecord({
                description, category, amountUsd, amountBs, methodId, currency, note,
                bcvRate, tasaCop, copEnabled, usuario: currentUser(),
            });
        } catch (err) {
            showToast(err.message, 'warning');
            return false;
        }

        try {
            const updatedSales = await saveGastoInterno(record);
            setSales(updatedSales);
        } catch (err) {
            showToast(err.message || 'No se pudo registrar el gasto', 'error');
            return false;
        }

        showToast('Gasto registrado con éxito', 'success');
        auditLog('CAJA', 'REGISTRO_GASTO', `Gasto registrado: "${record.description}" - $${Math.abs(record.totalUsd).toFixed(2)}`);
        setIsAddGastoOpen(false);
        return true;
    }, [setSales, bcvRate, tasaCop, copEnabled, triggerHaptic, auditLog]);

    // ─── Autoconsumo: retiro de mercancía por el dueño ──────────────────────
    /**
     * @param {Object} params
     * @param {string}  params.description   - Descripción editable generada automáticamente
     * @param {Array}   params.items         - [{ id, name, qty, costUsd, priceUsd }]
     * @param {'costo'|'venta'} params.valoracion - Criterio de valoración del retiro
     * @param {string}  params.note          - Nota opcional
     * @param {number}  params.totalUsd      - Total ya calculado externamente
     * @param {number}  params.totalBs       - Total ya calculado externamente
     */
    const registrarAutoconsumo = useCallback(async ({ description, items, valoracion = 'costo', note, totalUsd, totalBs }) => {
        triggerHaptic && triggerHaptic();

        if (!items || items.length === 0) {
            showToast('Selecciona al menos un producto', 'warning');
            return false;
        }

        const usd = round2(Math.abs(Number(totalUsd) || 0));
        const bs = round2(Math.abs(Number(totalBs) || 0));
        const usuario = currentUser();
        const gasto = {
            id:           crypto.randomUUID(),
            timestamp:    new Date().toISOString(),
            tipo:         'GASTO_INTERNO',
            category:     'autoconsumo',
            isAutoconsumo: true,
            afectaCaja:   false,       // NO afecta el cuadre de caja física
            cajaCerrada:  false,
            valoracion,
            description:  String(description || '').trim(),
            note:         note?.trim() || '',
            totalUsd:     -usd,
            totalBs:      -bs,
            ...(copEnabled && { totalCop: -round2(usd * tasaCop) }),
            paymentMethod: 'autoconsumo',
            payments: [{
                methodId:    'autoconsumo',
                amountUsd:   -usd,
                amountBs:    -bs,
                currency:    'USD',
                methodLabel: 'Autoconsumo de Inventario'
            }],
            // Guardamos los ítems con su qty para poder revertir el stock al anular
            items: items.map(i => ({
                id:       i.id,
                name:     i.name,
                qty:      i.qty,
                costUsd:  i.costUsd  || 0,
                priceUsd: i.priceUsd || 0,
            })),
            actor:   usuario?.nombre || 'Sin sesión',
            actorId: usuario?.id ?? null,
        };

        try {
            const allowNegative = localStorage.getItem('allow_negative_stock') === 'true';
            const updatedSales = await saveAutoconsumo(gasto, items, { allowNegative });
            setSales(updatedSales);
        } catch (err) {
            showToast(err.message || 'Error al registrar el retiro', 'error');
            return false;
        }

        showToast('Retiro de inventario registrado', 'success');
        auditLog('CAJA', 'AUTOCONSUMO', `Retiro de ${items.length} producto(s) - $${usd.toFixed(2)}`);
        setIsAddGastoOpen(false);
        return true;
    }, [setSales, tasaCop, copEnabled, triggerHaptic, auditLog]);

    // ─── Anulación (con reversión de stock si es autoconsumo) ───────────────
    const anularGasto = useCallback(async (gastoId) => {
        triggerHaptic && triggerHaptic();

        // Guard de seguridad: Cajeros no pueden borrar/anular gastos
        const authState = useAuthStore.getState();
        if (authState?.requireLogin && authState?.usuarioActivo?.rol === 'CAJERO') {
            showToast('Los cajeros no tienen permiso para anular gastos', 'warning');
            return false;
        }

        let result;
        try {
            result = await voidGastoInterno(gastoId, { usuario: authState?.usuarioActivo || null });
        } catch (err) {
            showToast(err.message || 'No se pudo anular el gasto', 'warning');
            return false;
        }

        setSales(result.updatedSales);
        const label = result.gasto.isAutoconsumo ? 'Autoconsumo anulado y stock devuelto' : 'Gasto anulado con éxito';
        showToast(label, 'success');
        auditLog('CAJA', 'ANULAR_GASTO', `Gasto anulado: "${result.gasto.description}"`);
        return true;
    }, [setSales, triggerHaptic, auditLog]);

    return {
        isAddGastoOpen,
        setIsAddGastoOpen,
        registrarGasto,
        registrarAutoconsumo,
        anularGasto,
        categories: GASTO_CATEGORIES
    };
}
