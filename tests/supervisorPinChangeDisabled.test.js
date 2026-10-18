import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    SUPERVISOR_COMMAND_TYPES,
    validateSupervisorCommand,
} from '../src/services/supervisorContracts';

const remoteUsers = readFileSync('src/components/Monitor/RemoteUsersManager.jsx', 'utf8');

const NOW = 1_000_000;
const PIN_HASH = 'pbkdf2$250000$c2FsdA==$aGFzaA==';

const baseCommand = (overrides = {}) => ({
    type: 'supervisor.user.pin.change',
    commandId: 'command-pin-0001',
    targetDeviceId: 'caja-1',
    monitorDeviceId: 'monitor-1',
    issuedAt: NOW,
    expiresAt: NOW + 30_000,
    payload: { userId: 1, pinHash: PIN_HASH },
    ...overrides,
});

const validate = (command) => validateSupervisorCommand(command, {
    targetDeviceId: 'caja-1',
    monitorDeviceId: 'monitor-1',
    now: NOW,
});

describe('el PIN ya no se puede cambiar desde el supervisor', () => {
    it('supervisor.user.pin.change dejó de ser un tipo de comando permitido', () => {
        expect(SUPERVISOR_COMMAND_TYPES).not.toContain('supervisor.user.pin.change');
    });

    it('un comando de cambio de PIN se rechaza al emitir y al aplicar', () => {
        const result = validate(baseCommand());
        expect(result.valid).toBe(false);
        expect(result.error).toBe('Tipo de comando no permitido');
    });

    it('una edición de usuario no puede esconder un cambio de PIN en el patch', () => {
        const result = validate(baseCommand({
            type: 'supervisor.user.update',
            payload: { userId: 1, patch: { nombre: 'Ana', pinHash: PIN_HASH } },
        }));
        expect(result.valid).toBe(false);
        expect(result.error).toBe('Payload inválido');
    });

    it('una edición de usuario tampoco puede llevar el PIN arriba, ni en claro ni hasheado', () => {
        for (const sneaky of [{ newPin: '123456' }, { pin: PIN_HASH }, { plainPin: '123456' }, { pinHash: PIN_HASH }]) {
            const result = validate(baseCommand({
                type: 'supervisor.user.update',
                payload: { userId: 1, ...sneaky, patch: { nombre: 'Ana' } },
            }));
            expect(result.valid).toBe(false);
            expect(result.error).toBe('Payload inválido');
        }
    });

    it('la edición de nombre/rol sigue funcionando sin campos de PIN', () => {
        const result = validate(baseCommand({
            type: 'supervisor.user.update',
            payload: { userId: 1, patch: { nombre: 'Ana', rol: 'CAJERO' } },
        }));
        expect(result.valid).toBe(true);
    });

    it('la interfaz del supervisor ya no ofrece resetear ni cambiar PINs', () => {
        expect(remoteUsers).not.toContain('Resetear PIN');
        expect(remoteUsers).not.toContain('supervisor.user.pin.change');
        expect(remoteUsers).not.toContain('change_pin');
        expect(remoteUsers).not.toContain('handleResetPin');
    });

    it('el alta de usuarios sigue exigiendo su PIN inicial hasheado', () => {
        const result = validate(baseCommand({
            type: 'supervisor.user.create',
            payload: { nombre: 'Caja 2', rol: 'CAJERO', pinHash: PIN_HASH },
        }));
        expect(result.valid).toBe(true);
    });
});
