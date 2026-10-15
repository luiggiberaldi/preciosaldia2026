import { describe, expect, it } from 'vitest';
import { applySupervisorUserCommand } from '../src/services/supervisorUserCommand';

const pinHash = 'pbkdf2$250000$c2FsdA==$aGFzaA==';

function makeStorage(initialUsers = []) {
    const values = {
        'abasto-auth-storage': {
            state: {
                usuarios: initialUsers,
                usuarioActivo: null,
            },
        },
    };
    return {
        values,
        async getItem(key, fallback) { return values[key] ?? fallback; },
        async setItem(key, value) { values[key] = value; },
    };
}

describe('Supervisor user commands', () => {
    it('creates a user from a PBKDF2 hash without persisting a plaintext PIN', async () => {
        const storage = makeStorage([{ id: 1, nombre: 'Admin', rol: 'ADMIN', pin: pinHash }]);

        const result = await applySupervisorUserCommand(storage, {
            action: 'add',
            nombre: 'Caja 2',
            rol: 'CAJERO',
            pinHash,
        });

        expect(result.user).toMatchObject({ nombre: 'Caja 2', rol: 'CAJERO' });
        expect(storage.values['abasto-auth-storage'].state.usuarios[1]).toMatchObject({ pin: pinHash });
        expect(storage.values['bodega_users_catalog_v1'][1]).not.toHaveProperty('pin');
    });

    it('updates a PIN and rejects deletion of the last administrator', async () => {
        const storage = makeStorage([{ id: 1, nombre: 'Admin', rol: 'ADMIN', pin: pinHash }]);

        await expect(applySupervisorUserCommand(storage, {
            action: 'change_pin',
            userId: 1,
            pinHash: '123456',
        })).rejects.toThrow('PIN remoto');

        await expect(applySupervisorUserCommand(storage, {
            action: 'delete',
            userId: 1,
        })).rejects.toThrow('último administrador');
    });
});
