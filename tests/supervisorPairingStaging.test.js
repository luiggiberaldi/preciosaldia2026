import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';

const enabled = process.env.SUPERVISOR_STAGING_PAIRING_E2E === 'true';
const stagingTest = enabled ? it : it.skip;
const STAGING_URL = 'https://tdfcpwctvumbdjmifypd.supabase.co';
const PRIMARY_DEVICE_ID = 'e2e-primary-device';
const MONITOR_DEVICE_ID = 'e2e-monitor-device';

function readEnvValue(name) {
    const text = readFileSync('.env', 'utf8');
    return text.match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1]?.trim();
}

async function createAnonymousClient(key) {
    const client = createClient(STAGING_URL, key, {
        auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.auth.signInAnonymously();
    if (error || !data?.user?.id) throw error || new Error('No se pudo crear identidad anónima de staging');
    return { client, userId: data.user.id };
}

describe('Supervisor pairing en staging — dos identidades anónimas', () => {
    const cleanup = [];

    afterAll(async () => {
        // Sign out only. The pairing itself is revoked in the test's finally block.
        for (const { client } of cleanup) {
            await client.auth.signOut();
        }
    });

    stagingTest('genera, vincula, rechaza reuso y desvincula sin tocar producción', async () => {
        const key = readEnvValue('VITE_SUPABASE_STAGING_KEY');
        expect(key, 'VITE_SUPABASE_STAGING_KEY ausente en .env').toBeTruthy();

        const primary = await createAnonymousClient(key);
        const monitor = await createAnonymousClient(key);
        const intruder = await createAnonymousClient(key);
        cleanup.push(primary, monitor, intruder);

        try {
        // Dueño genera token.
        const gen = await primary.client.rpc('generate_pairing_token', { p_device_id: PRIMARY_DEVICE_ID });
        expect(gen.error).toBeNull();
        expect(typeof gen.data).toBe('string');
        const token = gen.data;

        // Clave anónima sin sesión no puede generar token.
        const anonCli = createClient(STAGING_URL, key, { auth: { persistSession: false } });
        const anonGen = await anonCli.rpc('generate_pairing_token', { p_device_id: PRIMARY_DEVICE_ID });
        expect(anonGen.error).not.toBeNull();

        // Monitor vincula con el token.
        const pair = await monitor.client.rpc('pair_monitor_device', {
            p_token: token,
            p_monitor_device_id: MONITOR_DEVICE_ID,
        });
        expect(pair.error).toBeNull();
        expect(pair.data).toMatchObject({ success: true, primary_device_id: PRIMARY_DEVICE_ID });

        // Reuso del mismo token es rechazado.
        const reuse = await intruder.client.rpc('pair_monitor_device', {
            p_token: token,
            p_monitor_device_id: MONITOR_DEVICE_ID,
        });
        expect(reuse.data).toMatchObject({ success: false });

        // Identificador no sintético es rechazado.
        const badGen = await primary.client.rpc('generate_pairing_token', {
            p_device_id: 'real-customer-device-123',
        });
        expect(badGen.error).not.toBeNull();

        // Tercero no puede desvincular.
        const strangerUnpair = await intruder.client.rpc('unpair_monitor', { p_device_id: PRIMARY_DEVICE_ID });
        expect(strangerUnpair.error).not.toBeNull();

        // Monitor activo sí puede desvincular.
        const unpair = await monitor.client.rpc('unpair_monitor', { p_device_id: PRIMARY_DEVICE_ID });
        expect(unpair.error).toBeNull();
        } finally {
            // Revoke even if an assertion failed midway, so no e2e pairing stays active.
            try {
                await monitor.client.rpc('unpair_monitor', { p_device_id: PRIMARY_DEVICE_ID });
            } catch {
                // Already unpaired or never paired; nothing else to clean up.
            }
        }
    }, 60_000);
});
