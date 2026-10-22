import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const scanner = readFileSync('src/components/PairingScanScreen.jsx', 'utf8');
const pairingManager = readFileSync('src/components/Settings/PairingManager.jsx', 'utf8');
const pairingService = readFileSync('src/services/supervisorPairingService.js', 'utf8');
const monitorSync = readFileSync('src/hooks/useMonitorSync.js', 'utf8');
const cloudSync = readFileSync('src/hooks/useCloudSync.js', 'utf8');
const ownerMonitor = readFileSync('src/views/OwnerMonitorView.jsx', 'utf8');
const pairingState = readFileSync('src/services/supervisorPairingState.js', 'utf8');
const twoDevicePairingSql = readFileSync('supabase/migrations/20261015_999_supervisor_pairing_two_devices.sql', 'utf8');

describe('Supervisor lifecycle guardrails', () => {
    it('evita doble lectura QR y timers de reinicio huérfanos', () => {
        expect(scanner).toContain('scanInFlightRef');
        expect(scanner).toContain('restartTimerRef');
        expect(scanner).toContain('startPromiseRef');
        expect(scanner).toContain('mountedRef.current = false');
    });

    it('limpia y reintenta Realtime sin duplicar el canal', () => {
        expect(monitorSync).toContain('subscriptionRef.current = null');
        expect(monitorSync).toContain('scheduleReconnect');
        expect(monitorSync).toContain('supabaseCloud.removeChannel(channel)');
        expect(monitorSync).toContain('initInFlightRef');
    });

    it('detiene polling cuando la consulta falla repetidamente y confirma el servidor', () => {
        expect(pairingManager).not.toContain(".select('*')");
        expect(pairingManager).toContain('watchPairing');
        expect(pairingService).toContain('consecutiveFailures');
        expect(pairingManager).toContain('Revisa la conexión');
        expect(pairingManager).toContain('stillPaired');
    });

    it('genera el QR sin esperar el snapshot y usa reconciliación protegida por hash', () => {
        expect(pairingManager).toContain('createPairingToken({ deviceId })');
        // Fase 1 (2026-10-20): el snapshot va en segundo plano, DESPUÉS del token,
        // con hash (forceUnconditional=false) y allowBeforePairing=true. Jamás se
        // espera (sin `await syncBeforeIssue`): un maletón lento no expira el código.
        expect(pairingService).toContain('syncSnapshot(deviceId, false, true)');
        expect(pairingService).not.toContain('await syncBeforeIssue(');
        expect(pairingService).toContain('publishSnapshotInBackground(normalizedDeviceId');
        expect(pairingService.indexOf("rpc('generate_pairing_token'"))
            .toBeLessThan(pairingService.indexOf('publishSnapshotInBackground(normalizedDeviceId'));
        expect(cloudSync).toContain('return { ok: true, error: null, pushed }');
        expect(monitorSync).toContain('getSupervisorRecoveryIntervalMs()');
        // Fase 4: el pull del monitor ya no filtra doc_id por allowlist en el
        // servidor (la familia `bodega_sales_v1:<periodo>` no cabe en ella).
        // La misma guarda vive ahora en dos piezas: la selección de claves en
        // cliente (allowlist + familia de ventas) y el fetch de payloads SOLO
        // por ids explícitos permitidos (SEC-002: nunca se descarga un doc
        // fuera de contrato).
        expect(monitorSync).toContain('SUPERVISOR_SYNC_KEYS.includes(doc.doc_id) || isSalesSyncDocId(doc.doc_id)');
        expect(monitorSync).toContain(".in('doc_id', targetDocIds)");
        expect(monitorSync).not.toContain(".in('doc_id', SUPERVISOR_SYNC_KEYS)");
        expect(cloudSync).toContain('forceSyncAllPOSData(deviceId, false)');
        expect(cloudSync).not.toContain('forceSyncAllPOSData(deviceId, true)');
    });

    it('estampa en el push el deviceId registrado (evita RLS por identidad distinta)', () => {
        expect(cloudSync).toContain('pushCloudSync(key, val, forceUnconditional, allowBeforePairing, activeDeviceId)');
        expect(cloudSync).toContain('const stampDeviceId = deviceIdOverride || _currentDeviceId;');
        expect(cloudSync).toContain('device_id: stampDeviceId');
    });

    it('usa la sesión Auth del dueño o del monitor para el pairing', () => {
        expect(pairingManager).toContain("ensureSupervisorSession()");
        expect(pairingManager).toContain("rpc('unpair_monitor'");
        expect(pairingManager).not.toContain('ensureDeviceSessionRegistered');
        expect(pairingManager).not.toContain('Reclamar dueño');
        expect(pairingManager).not.toContain('create_owner_claim_code');
        expect(pairingManager).not.toContain('claim_owner_device');
    });

    it('revoca desde el monitor usando su propio device_id', () => {
        expect(ownerMonitor).toContain("const monitorDeviceId = localStorage.getItem('pda_device_id');");
        expect(ownerMonitor).toContain("const targets = [...new Set([monitorDeviceId, primaryDeviceId].filter(Boolean))];");
        expect(ownerMonitor).toContain(".select('monitor_auth_id, revoked_at')");
        expect(ownerMonitor).not.toContain(".select('monitor_auth_id, monitor_auth_id_2, revoked_at')");
    });

    it('limita la caja a dos supervisores y permite limpiar ambos slots desde el owner', () => {
        expect(twoDevicePairingSql).toContain('monitor_device_id_2 text');
        expect(twoDevicePairingSql).toContain("v_active_count >= 2");
        expect(twoDevicePairingSql).toContain('monitor_device_id_2 = NULL');
        expect(pairingManager).toContain('MAX_PAIRED_SUPERVISORS = 2');
        expect(pairingState).toContain('monitor_device_id_2');
    });

    // Comportamiento nuevo (propuesta 5, 2026-10-18): el test cambia de
    // "bloquea cuando está desconectado" a "guarda en la cola local", que es lo
    // que pide el plan de propuestas aprobado: los cambios esperan guardados y
    // se suben solos cuando vuelve la conexión.
    it('sin conexión los cambios esperan en la cola local en vez de bloquearse', () => {
        expect(ownerMonitor).toContain('remoteActionsAvailable');
        expect(ownerMonitor).toContain('enqueueSupervisorCommand');
        expect(ownerMonitor).toContain('LocalQueueBanner');
        expect(ownerMonitor).toContain('Cambio guardado en la cola');
    });
});
