import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../src/config/supabaseCloud', () => ({ supabaseCloud: null }));

const store = new Map();
beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
        clear: () => store.clear(),
    });
});

const { checkIdentityMigrationOrder } = await import('../src/services/identityMigrationOrder.js');
const { migrateDeviceIdentity } = await import('../src/security/installIdentity.js');

const OLD = 'PDA-V2-333D310EA8EFAB0B2261EF0BCB675980';
const NEW = 'PDA-V2-0123456789ABCDEF0123456789ABCDEF';
const ORDER = { id: 'ord-1', oldDeviceId: OLD, newDeviceId: NEW };
const session = async () => ({ user: { id: 'u-1' } });

function fakeClient(order, { getError = null, completeResult = { success: true } } = {}) {
    const calls = [];
    return {
        calls,
        rpc: vi.fn(async (name, args) => {
            calls.push([name, args]);
            if (name === 'get_my_identity_migration_order') return { data: order, error: getError };
            if (name === 'complete_identity_migration_order') return { data: completeResult, error: null };
            return { data: null, error: { message: 'desconocida' } };
        }),
    };
}

describe('checkIdentityMigrationOrder', () => {
    it('sin aviso no cambia nada', async () => {
        const client = fakeClient(null);
        const migrate = vi.fn();
        const r = await checkIdentityMigrationOrder(OLD, { client, getSession: session, migrate });
        expect(r.status).toBe('none');
        expect(migrate).not.toHaveBeenCalled();
        expect(client.calls.map((c) => c[0])).toEqual(['get_my_identity_migration_order']);
    });

    it('sin sesión no consulta', async () => {
        const client = fakeClient(ORDER);
        const r = await checkIdentityMigrationOrder(OLD, { client, getSession: async () => null });
        expect(r.status).toBe('no_session');
        expect(client.rpc).not.toHaveBeenCalled();
    });

    it('nunca crea una sesión anónima nueva', async () => {
        const signInAnonymously = vi.fn();
        const client = { ...fakeClient(ORDER), auth: { getSession: async () => ({ data: { session: null } }), signInAnonymously } };
        const r = await checkIdentityMigrationOrder(OLD, { client });
        expect(r.status).toBe('no_session');
        expect(signInAnonymously).not.toHaveBeenCalled();
        expect(client.rpc).not.toHaveBeenCalled();
    });

    it('si la base no tiene la función, no hace nada', async () => {
        const client = fakeClient(null, { getError: { code: 'PGRST202' } });
        const migrate = vi.fn();
        const r = await checkIdentityMigrationOrder(OLD, { client, getSession: session, migrate });
        expect(r.status).toBe('error');
        expect(migrate).not.toHaveBeenCalled();
    });

    it('con aviso y el ID viejo: adopta el ID nuevo y confirma', async () => {
        store.set('pda_device_id', OLD);
        const client = fakeClient(ORDER);
        const r = await checkIdentityMigrationOrder(OLD, { client, getSession: session });
        expect(r).toMatchObject({ status: 'migrated', newDeviceId: NEW, confirmed: true });
        expect(store.get('pda_device_id')).toBe(NEW);
        expect(store.get('pda_previous_device_id_v1')).toBe(OLD);
        expect(client.calls[1]).toEqual(['complete_identity_migration_order', { p_order_id: 'ord-1', p_device_id: NEW }]);
    });

    it('si ya tiene el ID nuevo (confirmación perdida): solo confirma', async () => {
        const client = fakeClient(ORDER);
        const migrate = vi.fn();
        const r = await checkIdentityMigrationOrder(NEW, { client, getSession: session, migrate });
        expect(r.status).toBe('migrated');
        expect(migrate).not.toHaveBeenCalled();
    });

    it('si el ID guardado ya no es el viejo, no cambia nada', async () => {
        store.set('pda_device_id', 'PDA-V2-FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF');
        const client = fakeClient(ORDER);
        const r = await checkIdentityMigrationOrder(OLD, { client, getSession: session });
        expect(r.status).toBe('not_applied');
        expect(store.get('pda_device_id')).toBe('PDA-V2-FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF');
        expect(client.calls.map((c) => c[0])).not.toContain('complete_identity_migration_order');
    });

    it('aviso con ID nuevo inválido: no cambia nada', async () => {
        store.set('pda_device_id', OLD);
        const client = fakeClient({ ...ORDER, newDeviceId: 'PDA-V2-abc' });
        const r = await checkIdentityMigrationOrder(OLD, { client, getSession: session });
        expect(r.status).toBe('invalid');
        expect(store.get('pda_device_id')).toBe(OLD);
    });

    it('ID actual distinto del viejo y del nuevo: no cambia nada', async () => {
        const client = fakeClient(ORDER);
        const migrate = vi.fn();
        const r = await checkIdentityMigrationOrder('PDA-V2-AAAAAAAA', { client, getSession: session, migrate });
        expect(r.status).toBe('mismatch');
        expect(migrate).not.toHaveBeenCalled();
    });
});

describe('migrateDeviceIdentity con ID asignado', () => {
    it('adopta el ID dado, guarda el anterior y limpia la caché de licencia', () => {
        store.set('pda_device_id', OLD);
        store.set('pda_license_cache', '{"x":1}');
        const r = migrateDeviceIdentity({ newDeviceId: NEW, expectedCurrentId: OLD });
        expect(r).toEqual({ deviceId: NEW, previousDeviceId: OLD });
        expect(store.get('pda_device_id')).toBe(NEW);
        expect(store.has('pda_license_cache')).toBe(false);
    });

    it('se niega si el ID actual no es el esperado', () => {
        store.set('pda_device_id', OLD);
        const r = migrateDeviceIdentity({ newDeviceId: NEW, expectedCurrentId: 'PDA-V2-OTRO' });
        expect(r.skipped).toBe('CURRENT_ID_MISMATCH');
        expect(store.get('pda_device_id')).toBe(OLD);
    });

    it('se niega con un ID de formato inválido', () => {
        store.set('pda_device_id', OLD);
        expect(migrateDeviceIdentity({ newDeviceId: 'cualquier-cosa' }).skipped).toBe('INVALID_NEW_ID');
        expect(store.get('pda_device_id')).toBe(OLD);
    });

    it('sin opciones sigue generando un ID aleatorio (botón de Ajustes)', () => {
        store.set('pda_device_id', OLD);
        const r = migrateDeviceIdentity();
        expect(r.previousDeviceId).toBe(OLD);
        expect(r.deviceId).toMatch(/^PDA-V2-[0-9A-F]{32}$/);
    });
});

describe('20261115_identity_migration_orders.sql', () => {
    const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/20261115_identity_migration_orders.sql'), 'utf8')
        .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').replace(/[ \t]+/g, ' ');

    it('la tabla queda cerrada: RLS, sin políticas y sin permisos públicos', () => {
        expect(sql).toMatch(/enable row level security/);
        expect(sql).toMatch(/revoke all on table public\.identity_migration_orders from public, anon, authenticated/);
        expect(sql).not.toMatch(/create policy/i);
        expect(sql).not.toMatch(/grant [a-z, ]+ on table/i);
    });

    it('solo devuelve y completa avisos de la propia sesión', () => {
        const getFn = sql.slice(sql.indexOf('function public.get_my_identity_migration_order'), sql.indexOf('function public.complete_identity_migration_order'));
        expect(getFn).toMatch(/target_user_id = auth\.uid\(\)/);
        expect(getFn).toMatch(/status = 'pending'/);
        expect(getFn).toMatch(/expires_at > now\(\)/);
        const doneFn = sql.slice(sql.indexOf('function public.complete_identity_migration_order'));
        expect(doneFn).toMatch(/target_user_id = auth\.uid\(\)/);
        expect(doneFn).toMatch(/new_device_id = p_device_id/);
    });

    it('las funciones no se abren a anon', () => {
        expect(sql).not.toMatch(/grant execute[^;]+to anon/i);
        expect(sql).toMatch(/grant execute on function public\.get_my_identity_migration_order\(text\) to authenticated/);
    });

    it('va en una sola transacción', () => {
        expect(sql.trim().startsWith('begin;')).toBe(true);
        expect(sql.trim().endsWith('commit;')).toBe(true);
    });
});
