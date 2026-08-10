import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ownerMonitor = readFileSync('src/views/OwnerMonitorView.jsx', 'utf8');
const remoteUsers = readFileSync('src/components/Monitor/RemoteUsersManager.jsx', 'utf8');
const supervisorSelect = readFileSync('src/components/Monitor/SupervisorSelect.jsx', 'utf8');
const inventoryBatchModal = readFileSync('src/components/Monitor/SupervisorInventoryBatchModal.jsx', 'utf8');
const rateModal = readFileSync('src/components/Monitor/SupervisorRateModal.jsx', 'utf8');

describe('Supervisor responsive controls', () => {
    it('no deja selects nativos cuadrados en las vistas del Supervisor', () => {
        expect(ownerMonitor).not.toContain('<select');
        expect(remoteUsers).not.toContain('<select');
        expect(ownerMonitor).toContain('SupervisorSelect');
        expect(remoteUsers).toContain('SupervisorSelect');
    });

    it('usa menú redondeado, tamaño táctil y roles accesibles', () => {
        expect(supervisorSelect).toContain('rounded-2xl');
        expect(supervisorSelect).toContain('rounded-xl');
        expect(supervisorSelect).toContain('min-h-11');
        expect(supervisorSelect).toContain('role="listbox"');
        expect(supervisorSelect).toContain('role="option"');
        expect(supervisorSelect).toContain("event.key === 'Escape'");
    });

    it('muestra el valor actual de cada tasa en el selector remoto', () => {
        expect(rateModal).toContain('rateValues');
        expect(rateModal).toContain('formatRate');
        expect(rateModal).toContain('Bs/$');
        expect(rateModal).toContain('Bs/€');
        expect(rateModal).toContain('Bs/₮');
    });

    it('mantiene el ajuste por lote detrás de ACK, motivo y flags separados', () => {
        expect(inventoryBatchModal).toContain('ACK');
        expect(inventoryBatchModal).toContain('Motivo obligatorio');
        expect(inventoryBatchModal).toContain('SUPERVISOR_REMOTE_EGRESS_ENABLED');
        expect(inventoryBatchModal).not.toContain('<select');
    });
});
