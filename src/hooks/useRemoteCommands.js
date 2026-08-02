import { useEffect } from 'react';
import { supabaseCloud } from '../config/supabaseCloud';
import { pushLocalSync, pushCloudSync } from './useCloudSync';
import { storageService } from '../utils/storageService';
import { withLock } from '../utils/withLock';
import { sanitizeUserCatalog } from '../utils/userCatalog';
import { showToast } from '../components/Toast';

export function useRemoteCommands(deviceId) {
    useEffect(() => {
        if (!supabaseCloud) return;

        // Suscribirse al canal global de comandos remotos de La Estación y Supervisor
        const channel = supabaseCloud.channel('system_commands', {
            config: { broadcast: { self: false } }
        });

        channel
            // ── 1. Orden de recarga remota ──
            .on('broadcast', { event: 'force_reload' }, (payload) => {
                const target = payload.payload?.targetDeviceId;
                if (!target || target === 'all' || target === deviceId) {
                    console.log('[RemoteCommands] Recibida orden de recarga remota desde La Estación. Recargando app...');
                    window.location.reload();
                }
            })

            // ── 2. Orden de cambio remoto de tasa ──
            .on('broadcast', { event: 'supervisor_rate_change' }, (payload) => {
                const { targetDeviceId, rateMode, customRate } = payload.payload || {};
                if (targetDeviceId && targetDeviceId !== deviceId) return;

                console.log('[RemoteCommands] Aplicando cambio remoto de tasa:', { rateMode, customRate });
                
                if (rateMode) {
                    localStorage.setItem('bodega_rate_mode', rateMode);
                    localStorage.setItem('bodega_use_auto_rate', (rateMode !== 'manual').toString());
                    pushLocalSync('bodega_rate_mode', rateMode);
                    pushLocalSync('bodega_use_auto_rate', (rateMode !== 'manual').toString());
                }

                if (customRate !== undefined && customRate !== null) {
                    localStorage.setItem('bodega_custom_rate', String(customRate));
                    pushLocalSync('bodega_custom_rate', String(customRate));
                }

                window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: 'bodega_rate_mode' } }));
                window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: 'bodega_custom_rate' } }));
                showToast('💱 Tasa de cambio actualizada remotamente por el Supervisor', 'success');
            })

            // ── 3. Orden de actualización remota de inventario (delta) ──
            .on('broadcast', { event: 'supervisor_product_update' }, async (payload) => {
                const { targetDeviceId, action, product, productId } = payload.payload || {};
                if (targetDeviceId && targetDeviceId !== deviceId) return;

                console.log('[RemoteCommands] Procesando cambio remoto de producto:', { action, productId, product });

                try {
                    await withLock('pos_write_lock', async () => {
                        const currentProducts = await storageService.getItem('bodega_products_v1', []) || [];
                        let updatedProducts = [];

                        if (action === 'delete') {
                            updatedProducts = currentProducts.filter(p => p.id !== productId);
                        } else if (action === 'edit') {
                            updatedProducts = currentProducts.map(p => p.id === product.id ? { ...p, ...product } : p);
                        } else if (action === 'create') {
                            const exists = currentProducts.some(p => p.id === product.id);
                            if (exists) {
                                updatedProducts = currentProducts.map(p => p.id === product.id ? { ...p, ...product } : p);
                            } else {
                                updatedProducts = [product, ...currentProducts];
                            }
                        }

                        await storageService.setItem('bodega_products_v1', updatedProducts);
                        await pushCloudSync('bodega_products_v1', updatedProducts, true);
                        window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: 'bodega_products_v1' } }));
                    });
                    showToast(`📦 Inventario actualizado remotamente (${action})`, 'success');
                } catch (e) {
                    console.error('[RemoteCommands] Error procesando supervisor_product_update:', e);
                }
            })

            // ── 4. Orden de gestión remota de cajeros / usuarios ──
            .on('broadcast', { event: 'supervisor_user_update' }, async (payload) => {
                const { targetDeviceId, action, userId, newPin, nombre, rol, bypassPin } = payload.payload || {};
                if (targetDeviceId && targetDeviceId !== deviceId) return;

                console.log('[RemoteCommands] Procesando actualización remota de usuario:', { action, userId, nombre });

                try {
                    const { useAuthStore } = await import('./store/useAuthStore');
                    const store = useAuthStore.getState();
                    let res;

                    if (action === 'change_pin' && userId && newPin) {
                        res = store.cambiarPin(userId, newPin);
                    } else if (action === 'add' && nombre) {
                        res = store.agregarUsuario(nombre, rol || 'CAJERO', newPin || '000000', bypassPin);
                    } else if (action === 'edit' && userId) {
                        res = store.editarUsuario(userId, { nombre, rol, bypassPin });
                    } else if (action === 'delete' && userId) {
                        res = store.eliminarUsuario(userId);
                    }

                    await res?.done;

                    const freshUsers = useAuthStore.getState().usuarios;
                    localStorage.setItem('bodega_users_catalog_v1', JSON.stringify(freshUsers));
                    const sanitized = sanitizeUserCatalog(freshUsers);
                    await pushCloudSync('bodega_users_catalog_v1', sanitized, true);
                    showToast('👤 Lista de usuarios actualizada remotamente', 'success');
                } catch (e) {
                    console.error('[RemoteCommands] Error procesando supervisor_user_update:', e);
                }
            })
            .subscribe();

        return () => {
            supabaseCloud.removeChannel(channel).catch(() => {});
        };
    }, [deviceId]);
}
