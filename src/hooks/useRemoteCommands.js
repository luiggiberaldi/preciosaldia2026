import { useEffect } from 'react';
import { supabaseCloud } from '../config/supabaseCloud';
import { pushLocalSync, pushCloudSync } from './useCloudSync';
import { storageService } from '../utils/storageService';
import { withLock } from '../utils/withLock';
import { showToast } from '../components/Toast';
import { ensureSupervisorSession } from '../services/supervisorAuth';
import { AppliedCommandGuard, validateSupervisorCommand } from '../services/supervisorContracts';
import { applySupervisorInventoryBatchTransaction } from '../services/supervisorInventoryCommand';

function rowToCommand(row, deviceId) {
    const issuedAt = new Date(row.issued_at).getTime();
    const expiresAt = new Date(row.expires_at).getTime();
    return {
        commandId: row.command_id,
        type: row.command_type,
        monitorDeviceId: row.actor_auth_id,
        targetDeviceId: row.target_device_id,
        issuedAt,
        expiresAt,
        payload: row.payload,
        schemaVersion: row.schema_version || 1,
        deviceId,
    };
}

async function ackCommand(commandId, status, ackPayload = {}, errorMessage = null) {
    const { error } = await supabaseCloud.rpc('ack_supervisor_command', {
        p_command_id: commandId,
        p_status: status,
        p_ack_payload: ackPayload,
        p_error_message: errorMessage,
    });
    if (error) throw error;
}

const APPLIED_COMMANDS_KEY = 'supervisor_applied_commands_v1';

async function readAppliedCommand(commandId) {
    const stored = await storageService.getItem(APPLIED_COMMANDS_KEY, {});
    const entry = stored?.[commandId];
    if (!entry || Number(entry.expiresAt) <= Date.now()) return null;
    return entry;
}

async function rememberAppliedCommand(commandId, entry) {
    const stored = await storageService.getItem(APPLIED_COMMANDS_KEY, {});
    const now = Date.now();
    const activeEntries = Object.fromEntries(
        Object.entries(stored || {}).filter(([, value]) => Number(value?.expiresAt) > now)
    );
    activeEntries[commandId] = entry;
    const limitedEntries = Object.fromEntries(Object.entries(activeEntries).slice(-1000));
    await storageService.setItem(APPLIED_COMMANDS_KEY, limitedEntries);
}

export function useRemoteCommands(deviceId, enabled = true) {
    useEffect(() => {
        if (!supabaseCloud || !deviceId || !enabled) return undefined;

        let disposed = false;
        const appliedCommands = new AppliedCommandGuard();
        let channel = null;

        const applyRateCommand = async (payload) => {
            const { rateMode, customRate } = payload || {};
            if (!['bcv', 'euro', 'usdt', 'manual'].includes(rateMode)) {
                throw new Error('Modo de tasa no permitido');
            }
            if (rateMode === 'manual' && !(Number(customRate) > 0 && Number.isFinite(Number(customRate)))) {
                throw new Error('Tasa personalizada inválida');
            }

            localStorage.setItem('bodega_rate_mode', rateMode);
            localStorage.setItem('bodega_use_auto_rate', String(rateMode !== 'manual'));
            pushLocalSync('bodega_rate_mode', rateMode);
            pushLocalSync('bodega_use_auto_rate', String(rateMode !== 'manual'));

            if (rateMode === 'manual') {
                localStorage.setItem('bodega_custom_rate', String(customRate));
                pushLocalSync('bodega_custom_rate', String(customRate));
            }

            window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: 'bodega_rate_mode' } }));
            window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: 'bodega_custom_rate' } }));
        };

        const applyProductCommand = async (payload) => {
            const { action, product, productId } = payload || {};
            if (!['create', 'edit', 'delete'].includes(action)) throw new Error('Acción de producto inválida');
            if (action !== 'delete' && (!product || typeof product.id !== 'string')) throw new Error('Producto inválido');
            if (action === 'delete' && typeof productId !== 'string') throw new Error('Producto inválido');

            await withLock('pos_write_lock', async () => {
                const currentProducts = await storageService.getItem('bodega_products_v1', []) || [];
                let updatedProducts;

                if (action === 'delete') {
                    updatedProducts = currentProducts.filter(item => item.id !== productId);
                } else if (action === 'edit') {
                    updatedProducts = currentProducts.map(item => item.id === product.id ? { ...item, ...product } : item);
                } else {
                    const exists = currentProducts.some(item => item.id === product.id);
                    updatedProducts = exists
                        ? currentProducts.map(item => item.id === product.id ? { ...item, ...product } : item)
                        : [product, ...currentProducts];
                }

                await storageService.setItem('bodega_products_v1', updatedProducts);
                const pushResult = await pushCloudSync('bodega_products_v1', updatedProducts, true);
                if (!pushResult.ok && !pushResult.skipped) throw new Error(pushResult.error);
                window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: 'bodega_products_v1' } }));
            });
        };

        const applyInventoryBatchCommand = async (payload, commandId) => {
            let adjustment;
            await withLock('pos_write_lock', async () => {
                adjustment = await applySupervisorInventoryBatchTransaction({
                    storage: storageService,
                    pushSync: pushCloudSync,
                    payload,
                    commandId,
                });

                window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: 'bodega_products_v1' } }));
                window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: 'bodega_sales_v1' } }));
            });

            return {
                commandId,
                productId: payload.productId,
                unitsDelta: adjustment.unitsDelta,
                stockBefore: adjustment.stockBefore,
                stockAfter: adjustment.stockAfter,
                status: 'applied',
            };
        };

        const applyShiftCommand = async (payload) => {
            const { action, shiftId, cierreId } = payload || {};
            if (!['close', 'reopen'].includes(action)
                || typeof shiftId !== 'string'
                || typeof cierreId !== 'string') {
                throw new Error('Acción de turno inválida');
            }

            await withLock('pos_write_lock', async () => {
                const sales = (await storageService.getItem('bodega_sales_v1', [])) || [];
                const targetShiftId = String(shiftId);
                const targetCierreId = String(cierreId);

                if (action === 'close') {
                    const alreadyClosed = sales.some(sale => (
                        sale.tipo === 'REGISTRO_CIERRE'
                        && (String(sale.cierreId) === targetCierreId || String(sale.shiftId) === targetShiftId)
                    ));
                    if (alreadyClosed) return;

                    const opening = sales.find(sale => (
                        sale.tipo === 'APERTURA_CAJA'
                        && (String(sale.id) === targetShiftId || String(sale.shiftId) === targetShiftId)
                        && !sale.cajaCerrada
                    ));
                    if (!opening) throw new Error('Turno activo no encontrado');

                    const updated = sales.map(sale => {
                        const belongsToShift = String(sale.id) === String(opening.id)
                            || String(sale.shiftId) === targetShiftId
                            || (!sale.cajaCerrada
                                && sale.timestamp
                                && new Date(sale.timestamp) >= new Date(opening.timestamp));
                        return belongsToShift
                            ? { ...sale, cajaCerrada: true, cierreId: targetCierreId, shiftId: targetShiftId }
                            : sale;
                    });
                    updated.push({
                        id: `cierre_${targetCierreId}`,
                        tipo: 'REGISTRO_CIERRE',
                        cierreId: targetCierreId,
                        shiftId: targetShiftId,
                        cajaCerrada: true,
                        timestamp: new Date().toISOString(),
                        summary: {
                            cashier: { nombre: 'Supervisor (Remoto)', rol: 'DUEÑO' },
                            remote: true,
                        },
                    });
                    await storageService.setItem('bodega_sales_v1', updated);
                    const pushResult = await pushCloudSync('bodega_sales_v1', updated, true);
                    if (!pushResult.ok && !pushResult.skipped) throw new Error(pushResult.error);
                } else {
                    const hasClose = sales.some(sale => (
                        sale.tipo === 'REGISTRO_CIERRE' && String(sale.cierreId) === targetCierreId
                    ));
                    if (!hasClose) return;
                    const updated = sales
                        .filter(sale => !(sale.tipo === 'REGISTRO_CIERRE' && String(sale.cierreId) === targetCierreId))
                        .map(sale => String(sale.cierreId) === targetCierreId
                            ? { ...sale, cajaCerrada: false, cierreId: undefined, shiftId: undefined }
                            : sale);
                    await storageService.setItem('bodega_sales_v1', updated);
                    const pushResult = await pushCloudSync('bodega_sales_v1', updated, true);
                    if (!pushResult.ok && !pushResult.skipped) throw new Error(pushResult.error);
                }

                window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: 'bodega_sales_v1' } }));
            });
        };

        const processCommand = async (row) => {
            if (disposed || !row || row.status !== 'pending') return;

            const command = rowToCommand(row, deviceId);
            const validation = validateSupervisorCommand(command, {
                targetDeviceId: deviceId,
                monitorDeviceId: row.actor_auth_id,
            });
            if (!validation.valid) {
                await ackCommand(row.command_id, 'rejected', {}, validation.error);
                return;
            }
            const remembered = await readAppliedCommand(row.command_id);
            if (remembered) {
                await ackCommand(row.command_id, remembered.status, remembered.ackPayload, remembered.errorMessage);
                return;
            }
            if (!appliedCommands.accept(row.command_id, command.expiresAt)) return;

            try {
                let appliedPayload = { commandId: row.command_id };
                if (command.type === 'supervisor.rate.set') {
                    await applyRateCommand(command.payload);
                    showToast('💱 Tasa actualizada por el Supervisor', 'success');
                } else if (command.type === 'supervisor.product.create') {
                    await applyProductCommand({ ...command.payload, action: 'create' });
                    showToast('📦 Producto creado por el Supervisor', 'success');
                } else if (command.type === 'supervisor.product.update') {
                    await applyProductCommand({
                        action: 'edit',
                        product: { id: command.payload.productId, ...command.payload.patch },
                    });
                    showToast('📦 Producto actualizado por el Supervisor', 'success');
                } else if (command.type === 'supervisor.product.delete') {
                    await applyProductCommand({ action: 'delete', productId: command.payload.productId });
                    showToast('📦 Producto eliminado por el Supervisor', 'success');
                } else if (command.type === 'supervisor.inventory.batch.adjust') {
                    appliedPayload = await applyInventoryBatchCommand(command.payload, row.command_id);
                } else if (command.type === 'supervisor.shift.close' || command.type === 'supervisor.shift.reopen') {
                    await applyShiftCommand({
                        action: command.type.endsWith('.close') ? 'close' : 'reopen',
                        shiftId: command.payload.shiftId,
                        cierreId: command.payload.cierreId,
                    });
                    showToast('🔒 Acción de turno aplicada por el Supervisor', 'info');
                } else if (command.type.startsWith('supervisor.user.')) {
                    // Los PINs no deben viajar por comandos remotos. Esta capacidad
                    // queda bloqueada hasta definir un flujo de credencial segura.
                    throw new Error('Gestión remota de usuarios temporalmente bloqueada');
                } else {
                    throw new Error('Tipo de comando no soportado');
                }

                await ackCommand(row.command_id, 'applied', appliedPayload);
                await rememberAppliedCommand(row.command_id, {
                    status: 'applied',
                    ackPayload: appliedPayload,
                    errorMessage: null,
                    expiresAt: command.expiresAt,
                });
            } catch (error) {
                const errorMessage = error?.message || 'Error aplicando comando';
                await ackCommand(row.command_id, 'failed', {}, errorMessage);
                await rememberAppliedCommand(row.command_id, {
                    status: 'failed',
                    ackPayload: {},
                    errorMessage,
                    expiresAt: command.expiresAt,
                });
                console.error('[RemoteCommands] Comando rechazado:', error);
            }
        };

        const initialize = async () => {
            const { session, error } = await ensureSupervisorSession();
            if (disposed || error || !session) return;

            channel = supabaseCloud
                .channel(`supervisor-commands:${deviceId}`)
                .on('postgres_changes', {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'supervisor_commands',
                    filter: `target_device_id=eq.${deviceId}`,
                }, ({ new: row }) => {
                    processCommand(row).catch((commandError) => {
                        console.error('[RemoteCommands] Error inesperado:', commandError);
                    });
                })
                .subscribe();
        };

        initialize();

        return () => {
            disposed = true;
            if (channel) supabaseCloud.removeChannel(channel).catch(() => {});
        };
    }, [deviceId, enabled]);
}
