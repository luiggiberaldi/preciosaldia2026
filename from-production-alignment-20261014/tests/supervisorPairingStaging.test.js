import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { getStagingAnonymousSession } from './helpers/stagingAnonymousSessions.js';

const enabled = process.env.SUPERVISOR_STAGING_PAIRING_E2E === 'true';
const stagingTest = enabled ? it : it.skip;
const STAGING_URL = 'https://tdfcpwctvumbdjmifypd.supabase.co';
// ID nuevo por ejecución: la caja reclama su dueño con su primera sesión.
const PRIMARY_DEVICE_ID = `e2e-box-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
// Formato real que genera la app: mon-<uuid>.
const MONITOR_DEVICE_ID = `mon-${crypto.randomUUID()}`;

function readEnvValue(name) {
    const text = readFileSync('.env', 'utf8');
    return text.match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1]?.trim();
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

        // Identidades reutilizadas por slot para no agotar el límite de signInAnonymously.
        const primary = await getStagingAnonymousSession(key, 'pairing-primary');
        const monitor = await getStagingAnonymousSession(key, 'pairing-monitor');
        const intruder = await getStagingAnonymousSession(key, 'pairing-intruder');
        cleanup.push(primary, monitor, intruder);

        try {
        // 007: la caja emite un código de reclamo y el dueño lo canjea antes de generar tokens.
        const claimCode = await primary.client.rpc('create_owner_claim_code', { p_device_id: PRIMARY_DEVICE_ID });
        expect(claimCode.error).toBeNull();
        const claimed = await primary.client.rpc('claim_owner_device', { p_device_id: PRIMARY_DEVICE_ID, p_code: claimCode.data });
        expect(claimed.data).toMatchObject({ success: true });

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

        // Tras desvincular, el dueño puede generar un código nuevo para la misma caja.
        const regen = await primary.client.rpc('generate_pairing_token', { p_device_id: PRIMARY_DEVICE_ID });
        expect(regen.error).toBeNull();
        expect(typeof regen.data).toBe('string');
        } finally {
            // Revoke even if an assertion failed midway, so no e2e pairing stays active.
            try {
                await monitor.client.rpc('unpair_monitor', { p_device_id: PRIMARY_DEVICE_ID });
            } catch {
                // Already unpaired or never paired; nothing else to clean up.
            }
            // Borra la fila de prueba que creó esta ejecución (solo e2e-%, solo su dueño).
            const { error: delError } = await primary.client.rpc('e2e_delete_pairing', { p_device_id: PRIMARY_DEVICE_ID });
            if (delError) console.warn('[e2e] no se pudo borrar la fila de prueba:', delError.message);
        }
    }, 60_000);
});
