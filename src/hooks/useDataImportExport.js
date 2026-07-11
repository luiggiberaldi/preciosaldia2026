import { useState } from 'react';
import { storageService } from '../utils/storageService';
import localforage from 'localforage';
import { showToast } from '../components/Toast';
import { IDB_KEYS, LS_KEYS, PROTECTED_KEYS } from '../config/backupKeys';

/**
 * Hook that encapsulates JSON import/export and delete-all-data logic.
 *
 * @param {Object}   params
 * @param {Function} params.auditLog
 * @param {Function} [params.triggerHaptic]
 * @param {Function} params.setImportStatus  – shared status setter (from useCloudBackup)
 * @param {Function} params.setStatusMessage – shared message setter (from useCloudBackup)
 */
export function useDataImportExport({
    auditLog,
    triggerHaptic,
    setImportStatus,
    setStatusMessage,
}) {
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [deleteInput, setDeleteInput] = useState('');

    const handleExport = async () => {
        try {
            setImportStatus('loading');
            setStatusMessage('Generando backup completo...');

            // HOOK-041: usa las listas canónicas de backupKeys.js.
            const idbData = {};
            for (const key of IDB_KEYS) {
                const data = await storageService.getItem(key, null);
                if (data !== null) idbData[key] = data;
            }

            const lsData = {};
            for (const key of LS_KEYS) {
                const val = localStorage.getItem(key);
                if (val !== null) lsData[key] = val;
            }

            const backupData = {
                timestamp: new Date().toISOString(),
                version: '2.0',
                appName: 'TasasAlDia_Bodegas',
                data: { idb: idbData, ls: lsData }
            };

            const blob = new Blob([JSON.stringify(backupData)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `backup_tasasaldia_completo_${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            setStatusMessage('Backup completo descargado.');
            setImportStatus('success');
            auditLog('SISTEMA', 'BACKUP_EXPORTADO', 'Backup completo exportado');
            setTimeout(() => setImportStatus(null), 3000);
        } catch (error) {
            console.error(error);
            setStatusMessage('Error al generar backup.');
            setImportStatus('error');
        }
    };

    const handleFileChange = (event) => {
        const file = event.target.files[0];
        if (!file) return;
        event.target.value = '';
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                setImportStatus('loading');
                setStatusMessage('Validando archivo...');
                const json = JSON.parse(e.target.result);

                if (!json.data) throw new Error('Formato invalido: falta campo "data".');

                // ── FASE 1: LIMPIEZA SELECTIVA (HOOK-025) ─────────────────────────
                // HOOK-025: NO usar `localforage.clear()` — borraría flags críticos
                // como `pda_demo_flag_v1` y `bodega_autobackup_v1`. Borramos solo
                // las claves explícitas del catálogo canónico (IDB_KEYS / LS_KEYS),
                // preservando las que estén en PROTECTED_KEYS.
                setStatusMessage('Limpiando datos del dispositivo...');
                for (const key of IDB_KEYS) {
                    if (PROTECTED_KEYS.includes(key)) continue;
                    try { await localforage.removeItem(key); } catch (_) { /* noop */ }
                }

                // Limpiar localStorage de la app (preservando sesión de Supabase sb-*)
                // y PROTECTED_KEYS (HOOK-025).
                for (const key of LS_KEYS) {
                    if (PROTECTED_KEYS.includes(key)) continue;
                    localStorage.removeItem(key);
                }

                // ── FASE 2: RESTAURACIÓN (directo a localforage, sin eventos) ───────
                setStatusMessage('Restaurando backup...');

                if (json.version === '2.0' && json.data.idb) {
                    for (const [key, value] of Object.entries(json.data.idb)) {
                        await localforage.setItem(key, value);
                    }
                    if (json.data.ls) {
                        for (const [key, value] of Object.entries(json.data.ls)) {
                            localStorage.setItem(key, value);
                        }
                    }
                } else {
                    // Compatibilidad legado (backups anteriores a v2.0)
                    const legacyIdbMap = {
                        bodega_products_v1: json.data.bodega_products_v1,
                        bodega_accounts_v2: json.data.bodega_accounts_v2,
                        my_categories_v1:   json.data.my_categories_v1,
                    };
                    for (const [key, value] of Object.entries(legacyIdbMap)) {
                        if (!value) continue;
                        const parsed = typeof value === 'string' ? JSON.parse(value) : value;
                        await localforage.setItem(key, parsed);
                    }
                    const legacyLsKeys = [
                        'street_rate_bs', 'catalog_use_auto_usdt', 'catalog_custom_usdt_price',
                        'catalog_show_cash_price', 'monitor_rates_v12', 'business_name', 'business_rif'
                    ];
                    for (const key of legacyLsKeys) {
                        if (json.data[key]) localStorage.setItem(key, json.data[key]);
                    }
                }

                setImportStatus('success');
                setStatusMessage('Restauracion completa. Sincronizando con la nube...');
                localStorage.setItem('pda_backup_imported_flag', 'true');
                auditLog('SISTEMA', 'BACKUP_IMPORTADO', `Backup restaurado (${json.source || 'archivo'}) — ${Object.keys(json.data.idb || {}).join(', ')}`);
                triggerHaptic?.();

                // Damos tiempo a guardar los datos antes de reiniciar
                setTimeout(() => window.location.reload(), 1200);
            } catch (error) {
                console.error('[IMPORT ERROR]', error);
                setImportStatus('error');
                setStatusMessage('Error: El archivo esta corrupto o es invalido.');
            }
        };
        reader.readAsText(file);
    };

    const handleDeleteAllData = async () => {
        if (deleteInput !== 'ELIMINAR') return;
        try {
            triggerHaptic && triggerHaptic();
            await storageService.setItem('bodega_sales_v1', []);
            auditLog('SISTEMA', 'HISTORIAL_BORRADO', 'Historial de ventas eliminado completamente');
            showToast('Historial de ventas eliminado exitosamente', 'success');
            setTimeout(() => window.location.reload(), 1500);
        } catch (err) {
            showToast('Error eliminando historial', 'error');
        }
    };

    return {
        showDeleteConfirm,
        setShowDeleteConfirm,
        deleteInput,
        setDeleteInput,
        handleExport,
        handleFileChange,
        handleDeleteAllData,
    };
}
