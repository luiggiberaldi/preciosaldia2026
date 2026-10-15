import { useEffect } from 'react';
import { supabaseCloud } from '../config/supabaseCloud';
import { pushLocalSync, pushCloudSync } from './useCloudSync';
import { storageService } from '../utils/storageService';
import { useAuthStore } from './store/useAuthStore';
import { withLock } from '../utils/withLock';
import { showToast } from '../components/Toast';
import { ensureSupervisorSession } from '../services/supervisorAuth';
import { AppliedCommandGuard, validateSupervisorCommand } from '../services/supervisorContracts';
import { fetchPendingSupervisorCommands } from '../services/supervisorCommandService';
import { applySupervisorInventoryBatchTransaction } from '../services/supervisorInventoryCommand';
import { applySupervisorProductCommand } from '../services/supervisorProductCommand';
import { applySupervisorUserCommand } from '../services/supervisorUserCommand';

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

function isRetryableAckError(error) {
    const status = Number(error?.status || error?.statusCode);
    if ([400, 401, 403, 404, 409, 422].includes(status)) return false;
    if (typeof status === 'number' && status >= 500) return true;
    return !status;
}

async function ackCommand(commandId, status, ackPayload = {}, errorMessage = null) {
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            const { error } = await supabaseCloud.rpc('ack_supervisor_command', {
                p_command_id: commandId,
                p_status: status,
                p_ack_payload: ackPayload,
                p_error_message: errorMessage,
            });
            if (error) throw error;
            return;
        } catch (error) {
            lastError = error;
            if (!isRetryableAckError(error) || attempt === 2) throw error;
            await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        }
    }
    throw lastError || new Error('No se pudo confirmar la orden');
}

const APPLIED_COMMANDS_KEY = 'supervisor_applied_commands_v1';

function shortSupervisorId(value) {
    if (!value || typeof value !== 'string') return null;
    return value.length > 12 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}

function supervisorLog(message, details = {}) {
    console.info(`[SupervisorReceiver] ${message}`, details);
}

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
        if (!supabaseCloud || !deviceId || !enabled) {
            supervisorLog('Listener no iniciado', {
                reason: !supabaseCloud ? 'supabase_no_disponible' : !deviceId ? 'device_id_no_definido' : 'feature_flag_desactivada',
                deviceId: shortSupervisorId(deviceId),
                enabled,
                pairingMode: localStorage.getItem('pda_pairing_mode') || 'primary',
            });
            return undefined;
        }

        let disposed = false;
        const appliedCommands = new AppliedCommandGuard();
        supervisorLog('Listener iniciando', {
            deviceId: shortSupervisorId(deviceId),
            enabled,
            pairingMode: localStorage.getItem('pda_pairing_mode') || 'primary',
        });
        let channel = null;

        const handlePairingRevoked = (event) => {
            if (event.detail?.deviceId && event.detail.deviceId !== deviceId) return;
            if (channel) {
                supabaseCloud.removeChannel(channel).catch(() => {});
                channel = null;
            }
            supervisorLog('Listener detenido: vínculo revocado', { deviceId: shortSupervisorId(deviceId) });
        };
        const handlePairingActive = (event) => {
            if (event.detail?.deviceId && event.detail.deviceId !== deviceId) return;
            if (!channel && !disposed) initialize();
        };
        window.addEventListener('supervisor_pairing_revoked', handlePairingRevoked);
        window.addEventListener('supervisor_pairing_active', handlePairingActive);

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

            window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: 'bodega_rate_mode', source: 'remote' } }));
            window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: 'bodega_custom_rate', source: 'remote' } }));
        };

        const applyProductCommand = async (payload) => {
            let result;
            await withLock('pos_write_lock', async () => {
                const currentProducts = await storageService.getItem('bodega_products_v1', []) || [];
                result = applySupervisorProductCommand(currentProducts, payload);

                await storageService.setItem('bodega_products_v1', result.products);
                const pushResult = await pushCloudSync('bodega_products_v1', result.products, true);
                if (!pushResult.ok && !pushResult.skipped) {
                    await storageService.setItem('bodega_products_v1', currentProducts);
                    throw new Error(pushResult.error);
                }
                window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: 'bodega_products_v1', source: 'remote' } }));
            });

            return {
                commandId: payload.commandId,
                action: result.action,
                productId: result.productId,
                status: 'applied',
            };
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

                window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: 'bodega_products_v1', source: 'remote' } }));
                window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: 'bodega_sales_v1', source: 'remote' } }));
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

                window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: 'bodega_sales_v1', source: 'remote' } }));
            });
        };

        const applyUserCommand = async (payload) => {
            const result = await applySupervisorUserCommand(storageService, payload, {
                // Zustand persiste en localStorage; actualizarlo aquí mantiene
                // la sesión viva y evita que la caja siga usando un catálogo
                // de usuarios anterior hasta el próximo reinicio.
                onUsersChanged: users => useAuthStore.setState({ usuarios: users }),
            });
            window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: 'abasto-auth-storage', source: 'remote' } }));
            window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: 'bodega_users_catalog_v1', source: 'remote' } }));
            return result;
        };

        const processCommand = async (row) => {
            if (disposed || !row || row.status !== 'pending') return;

            supervisorLog('Orden recibida', {
                commandId: shortSupervisorId(row.command_id),
                type: row.command_type,
                status: row.status,
                targetDeviceId: shortSupervisorId(row.target_device_id),
            });

            const command = rowToCommand(row, deviceId);
            const validation = validateSupervisorCommand(command, {
                targetDeviceId: deviceId,
                monitorDeviceId: row.actor_auth_id,
            });
            if (!validation.valid) {
                console.warn('[SupervisorReceiver] Orden rechazada por validación', {
                    commandId: shortSupervisorId(row.command_id),
                    reason: validation.error,
                });
                await ackCommand(row.command_id, 'rejected', {}, validation.error);
                return;
            }
            const remembered = await readAppliedCommand(row.command_id);
            if (remembered) {
                await ackCommand(row.command_id, remembered.status, remembered.ackPayload, remembered.errorMessage);
                return;
            }
            if (!appliedCommands.accept(row.command_id, command.expiresAt)) return;

            let appliedPayload = null;
            try {
                appliedPayload = { commandId: row.command_id };
                if (command.type === 'supervisor.rate.set') {
                    await applyRateCommand(command.payload);
                    supervisorLog('Tasa aplicada localmente', {
                        commandId: shortSupervisorId(row.command_id),
                        rateMode: command.payload?.rateMode,
                        customRate: command.payload?.rateMode === 'manual' ? command.payload?.customRate : null,
                    });
                    showToast('💱 Tasa actualizada por el Supervisor', 'success');
                } else if (command.type === 'supervisor.product.create') {
                    appliedPayload = await applyProductCommand({ ...command.payload, action: 'create', commandId: row.command_id });
                    showToast('📦 Producto creado por el Supervisor', 'success');
                } else if (command.type === 'supervisor.product.update') {
                    appliedPayload = await applyProductCommand({
                        action: 'edit',
                        product: { id: command.payload.productId, ...command.payload.patch },
                        baseUpdatedAt: command.payload.baseUpdatedAt,
                        commandId: row.command_id,
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
                    appliedPayload = await applyUserCommand({
                        ...command.payload,
                        action: command.type === 'supervisor.user.create'
                            ? 'add'
                            : command.type === 'supervisor.user.pin.change'
                                ? 'change_pin'
                                : command.type === 'supervisor.user.update'
                                    ? 'edit'
                                    : 'delete',
                    });
                    showToast('👤 Usuario actualizado por el Supervisor', 'success');
                } else {
                    throw new Error('Tipo de comando no soportado');
                }

                // Guardar primero el resultado local evita repetir la operación
                // si el ACK se pierde. El siguiente intento solo confirma.
                await rememberAppliedCommand(row.command_id, {
                    status: 'applied',
                    ackPayload: appliedPayload,
                    errorMessage: null,
                    expiresAt: command.expiresAt,
                });
                try {
                    await ackCommand(row.command_id, 'applied', appliedPayload);
                } catch (ackError) {
                    supervisorLog('ACK aplicado pendiente de reintento', {
                        commandId: shortSupervisorId(row.command_id),
                        error: ackError?.message || ackError,
                    });
                    return;
                }
                supervisorLog('ACK enviado', {
                    commandId: shortSupervisorId(row.command_id),
                    status: 'applied',
                });
            } catch (error) {
                const errorMessage = error?.message || 'Error aplicando comando';
                console.error('[SupervisorReceiver] Error aplicando orden', {
                    commandId: shortSupervisorId(row.command_id),
                    error: errorMessage,
                });
                await rememberAppliedCommand(row.command_id, {
                    status: 'failed',
                    ackPayload: {},
                    errorMessage,
                    expiresAt: command.expiresAt,
                });
                try {
                    await ackCommand(row.command_id, 'failed', {}, errorMessage);
                } catch (ackError) {
                    supervisorLog('ACK fallido pendiente de reintento', {
                        commandId: shortSupervisorId(row.command_id),
                        error: ackError?.message || ackError,
                    });
                }
                console.error('[RemoteCommands] Comando rechazado:', error);
            }
        };

        const loadPendingCommands = async () => {
            const { data: rows, error } = await fetchPendingSupervisorCommands(supabaseCloud, deviceId);

            supervisorLog('Consulta de órdenes pendientes', {
                targetDeviceId: shortSupervisorId(deviceId),
                count: rows?.length || 0,
                error: error?.message || null,
            });

            if (error) {
                console.warn('[RemoteCommands] No se pudieron recuperar órdenes pendientes:', error.message);
                return;
            }

            // Realtime cubre órdenes nuevas; esta recuperación cubre las que se
            // emitieron mientras la caja estaba cerrada, sin conexión o recargando.
            for (const row of rows || []) {
                if (disposed) break;
                try {
                    await processCommand(row);
                } catch (commandError) {
                    console.error('[RemoteCommands] Error recuperando orden pendiente:', commandError);
                }
            }
        };

        const initialize = async () => {
            const { session, error } = await ensureSupervisorSession();
            if (error || !session) {
                console.warn('[SupervisorReceiver] Sesión no disponible', {
                    deviceId: shortSupervisorId(deviceId),
                    error: error?.message || 'sin sesión',
                });
                return;
            }
            if (disposed) return;

            supervisorLog('Sesión Auth lista', {
                deviceId: shortSupervisorId(deviceId),
                authUserId: shortSupervisorId(session.user?.id),
            });

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
                .subscribe((status, error) => {
                    supervisorLog('Estado Realtime', {
                        deviceId: shortSupervisorId(deviceId),
                        status,
                        error: error?.message || null,
                    });
                });

            await loadPendingCommands();
        };

        initialize();

        return () => {
            disposed = true;
            window.removeEventListener('supervisor_pairing_revoked', handlePairingRevoked);
            window.removeEventListener('supervisor_pairing_active', handlePairingActive);
            if (channel) supabaseCloud.removeChannel(channel).catch(() => {});
        };
    }, [deviceId, enabled]);
}
