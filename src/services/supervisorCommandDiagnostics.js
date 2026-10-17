// ── Diagnóstico de comandos del supervisor ───────────────────────────────────
// Une, por commandId, dos fuentes que ya existen en la caja y el monitor:
//   1. La telemetría del ACK (supervisorAckTelemetry): estado del comando,
//      hitos y latencias (ACK, estado durable, publicación, plomo del ACK).
//   2. Las reconciliaciones en segundo plano (lote incierto resuelto solo,
//      revisión manual del lote y reconciliación de filas): qué resolvió la
//      caja, cuándo y desde qué flujo.
// El resultado es una fila de diagnóstico por comando + estadísticas globales
// (p50/p95 del ACK, como el presupuesto del test de rendimiento).
//
// Todo es best-effort y nunca lanza: el diagnóstico jamás interrumpe los flujos.

import { storageService } from '../utils/storageService';
import {
    clearAckTelemetry,
    flushAckTelemetry,
    getAckTelemetryEntries,
    readAckTelemetry,
} from './supervisorAckTelemetry';

export const SUPERVISOR_RECONCILIATIONS_KEY = 'supervisor_reconciliations_v1';
export const RECONCILIATIONS_MAX_ENTRIES = 100;

let reconciliations = [];
let pendingWrite = Promise.resolve();

/** Registro de una reconciliación resuelta por commandId. */
export function recordReconciliation({
    commandId,
    source,
    via = 'auto',
    outcome,
    status = null,
    detail = null,
    at = new Date().toISOString(),
} = {}) {
    try {
        const id = String(commandId || '');
        if (!id || !['lote', 'fila'].includes(source) || !['applied', 'failed'].includes(outcome)) return null;
        const entry = {
            commandId: id,
            source,
            via,
            outcome,
            status,
            detail,
            at,
        };
        reconciliations.push(entry);
        if (reconciliations.length > RECONCILIATIONS_MAX_ENTRIES) {
            reconciliations = reconciliations.slice(-RECONCILIATIONS_MAX_ENTRIES);
        }
        pendingWrite = pendingWrite
            .then(() => storageService.setItem(SUPERVISOR_RECONCILIATIONS_KEY, reconciliations))
            .catch(() => {
                // Sin almacenamiento disponible el registro sigue vivo en memoria.
            });
        return entry;
    } catch {
        return null;
    }
}

export function getReconciliations() {
    return reconciliations.map(entry => ({ ...entry }));
}

export async function readReconciliations({ storage = storageService } = {}) {
    try {
        const stored = await storage.getItem(SUPERVISOR_RECONCILIATIONS_KEY, []);
        return Array.isArray(stored) && stored.length ? stored : getReconciliations();
    } catch {
        return getReconciliations();
    }
}

export function flushReconciliations() {
    return pendingWrite;
}

/** Percentil por rango (ceil(p·N)−1), la misma definición del test de rendimiento. */
export function percentileOf(values = [], p = 0.95) {
    const sorted = values
        .map(Number)
        .filter(Number.isFinite)
        .sort((a, b) => a - b);
    if (!sorted.length) return null;
    const rank = Math.max(1, Math.ceil(p * sorted.length));
    return sorted[rank - 1];
}

export function shortCommandId(value) {
    const id = String(value || '');
    return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

export function commandTypeLabel(type) {
    switch (type) {
        case 'supervisor.inventory.batch.adjust': return 'Lote de inventario';
        case 'supervisor.product.create': return 'Producto · alta';
        case 'supervisor.product.update': return 'Producto · edición';
        case 'supervisor.product.delete': return 'Producto · baja';
        case 'supervisor.rate.set': return 'Tasa';
        case 'supervisor.shift.close': return 'Cierre de turno';
        case 'supervisor.shift.reopen': return 'Reapertura de turno';
        default: return type ? String(type).replace('supervisor.', '') : 'Sin tipo';
    }
}

export function statusChipLabel(status) {
    switch (status) {
        case 'applied': return 'Aplicado';
        case 'applied_with_warnings': return 'Con advertencias';
        case 'rejected': return 'Rechazado';
        case 'cancelled': return 'Cancelado';
        case 'expired': return 'Expirado';
        case 'failed': return 'Fallido';
        case 'ack_failed': return 'ACK fallido';
        default: return status ? String(status) : 'Sin ACK';
    }
}

export function formatAckMs(value) {
    // null/undefined significan «sin medir» (Number(null) sería 0 y mentiría).
    return value != null && Number.isFinite(Number(value)) ? `${Number(value)} ms` : '—';
}

/**
 * Mezcla telemetría y reconciliaciones por commandId en filas de diagnóstico
 * (más reciente primero) + estadísticas globales del ACK.
 */
export function buildCommandDiagnostics({ telemetry = [], reconciliations: recs = [] } = {}) {
    const byCommand = new Map();
    telemetry.forEach(entry => {
        if (!entry?.commandId) return;
        byCommand.set(String(entry.commandId), {
            commandId: String(entry.commandId),
            type: entry.type || null,
            status: entry.status || null,
            acknowledgedEarly: Boolean(entry.acknowledgedEarly),
            error: entry.error || null,
            startedAt: entry.startedAt || null,
            finishedAt: entry.finishedAt || null,
            metrics: { ...(entry.metrics || {}) },
            reconciliations: [],
        });
    });
    recs.forEach(entry => {
        if (!entry?.commandId) return;
        const id = String(entry.commandId);
        let row = byCommand.get(id);
        if (!row) {
            // Reconciliación sin telemetría propia (p. ej. hecha por el monitor):
            // igual aparece, con lo que se sabe.
            row = {
                commandId: id,
                type: null,
                status: entry.outcome === 'applied' ? 'applied' : 'failed',
                acknowledgedEarly: false,
                error: null,
                startedAt: null,
                finishedAt: null,
                metrics: {},
                reconciliations: [],
            };
            byCommand.set(id, row);
        }
        row.reconciliations.push({
            source: entry.source,
            via: entry.via || 'auto',
            outcome: entry.outcome,
            status: entry.status || null,
            detail: entry.detail || null,
            at: entry.at || null,
        });
        // Una reconciliación que resuelve el comando aclara su estado final.
        if (!row.status || row.status === 'pending') {
            row.status = entry.outcome === 'applied' ? 'applied' : 'failed';
        }
    });

    const rows = [...byCommand.values()].map(row => ({
        ...row,
        reconcileCount: row.reconciliations.length,
    })).sort((a, b) => String(b.finishedAt || '').localeCompare(String(a.finishedAt || '')));

    const ackSamples = rows.map(row => row.metrics.ackLatencyMs).filter(value => Number.isFinite(Number(value))).map(Number);
    const summary = {
        total: rows.length,
        withAck: ackSamples.length,
        applied: rows.filter(row => row.status === 'applied' || row.status === 'applied_with_warnings').length,
        failed: rows.filter(row => ['failed', 'rejected', 'cancelled', 'expired', 'ack_failed'].includes(row.status)).length,
        reconciled: rows.filter(row => row.reconcileCount > 0).length,
        confirmAfterPublish: rows.filter(row => Number(row.metrics.ackLeadMs) < 0).length,
        ackP50Ms: percentileOf(ackSamples, 0.5),
        ackP95Ms: percentileOf(ackSamples, 0.95),
        ackMaxMs: ackSamples.length ? Math.max(...ackSamples) : null,
        ackAvgMs: ackSamples.length
            ? Math.round((ackSamples.reduce((sum, value) => sum + value, 0) / ackSamples.length) * 10) / 10
            : null,
    };
    return { rows, summary };
}

/**
 * Carga completa desde producción: telemetría persistida (o memoria) +
 * reconciliaciones persistidas (o memoria), ya mezcladas.
 */
export async function loadCommandDiagnostics({ storage = storageService } = {}) {
    try {
        await Promise.all([flushAckTelemetry(), flushReconciliations()]);
        const [telemetry, recs] = await Promise.all([
            readAckTelemetry({ storage }),
            readReconciliations({ storage }),
        ]);
        return buildCommandDiagnostics({ telemetry, reconciliations: recs });
    } catch {
        return buildCommandDiagnostics({
            telemetry: getAckTelemetryEntries(),
            reconciliations: getReconciliations(),
        });
    }
}

/** Limpia ambas fuentes (memoria y persistencia). */
export async function clearCommandDiagnostics({ storage = storageService } = {}) {
    reconciliations = [];
    await Promise.all([
        clearAckTelemetry({ storage }).catch(() => {}),
        storage.setItem(SUPERVISOR_RECONCILIATIONS_KEY, []).catch(() => {}),
    ]);
}

export default {
    SUPERVISOR_RECONCILIATIONS_KEY,
    RECONCILIATIONS_MAX_ENTRIES,
    recordReconciliation,
    getReconciliations,
    readReconciliations,
    flushReconciliations,
    percentileOf,
    shortCommandId,
    commandTypeLabel,
    statusChipLabel,
    formatAckMs,
    buildCommandDiagnostics,
    loadCommandDiagnostics,
    clearCommandDiagnostics,
};
