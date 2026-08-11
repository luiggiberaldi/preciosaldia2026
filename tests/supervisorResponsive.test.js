import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ownerMonitor = readFileSync('src/views/OwnerMonitorView.jsx', 'utf8');
const remoteUsers = readFileSync('src/components/Monitor/RemoteUsersManager.jsx', 'utf8');
const supervisorSelect = readFileSync('src/components/Monitor/SupervisorSelect.jsx', 'utf8');
const inventoryBatchModal = readFileSync('src/components/Monitor/SupervisorInventoryBatchModal.jsx', 'utf8');
const rateModal = readFileSync('src/components/Monitor/SupervisorRateModal.jsx', 'utf8');

describe('Supervisor responsive controls', () => {
    it('mantiene el header sticky y preparado para móviles con safe-area', () => {
        expect(ownerMonitor).toContain('sticky top-0');
        expect(ownerMonitor).toContain('safe-area-inset-top');
        expect(ownerMonitor).toContain('flex-col');
        expect(ownerMonitor).toContain('sm:flex-row');
        expect(ownerMonitor).toContain('w-full sm:w-auto');
    });

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

    it('guía el ajuste por lote con acciones claras, resumen y flags separados', () => {
        expect(inventoryBatchModal).toContain('solo se aplicará cuando la caja lo confirme');
        expect(inventoryBatchModal).toContain('¿Qué quieres hacer?');
        expect(inventoryBatchModal).toContain('Stock después del movimiento');
        expect(inventoryBatchModal).toContain('role="radiogroup"');
        expect(inventoryBatchModal).toContain('SUPERVISOR_REMOTE_EGRESS_ENABLED');
        expect(inventoryBatchModal).not.toContain('<select');
    });
});
