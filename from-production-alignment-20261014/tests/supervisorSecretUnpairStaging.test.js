import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { getStagingAnonymousSession } from './helpers/stagingAnonymousSessions.js';

const enabled = process.env.SUPERVISOR_STAGING_PAIRING_E2E === 'true';
const stagingTest = enabled ? it : it.skip;
const STAGING_URL = 'https://tdfcpwctvumbdjmifypd.supabase.co';
const SUFFIX = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const PRIMARY_DEVICE_ID = `e2e-secret-box-${SUFFIX}`;
// Formato real que genera la app: mon-<uuid>.
const MONITOR_DEVICE_ID = `mon-${crypto.randomUUID()}`;
// Clave aleatoria de 32 bytes en hex, como la genera la app del monitor.
const SECRET = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
const WRONG_SECRET = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');

function readEnvValue(name) {
    const text = readFileSync('.env', 'utf8');
    return text.match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1]?.trim();
}

describe('Supervisor desvinculación con secreto en staging', () => {
    const sessions = [];

    afterAll(async () => {
        for (const { client } of sessions) {
            await client.auth.signOut();
        }
    });

    stagingTest('vincula con secreto, rechaza secreto erróneo, reintenta tras respuesta perdida y limpia', async () => {
        const key = readEnvValue('VITE_SUPABASE_STAGING_KEY');
        expect(key, 'VITE_SUPABASE_STAGING_KEY ausente en .env').toBeTruthy();

        const owner = await getStagingAnonymousSession(key, 'secret-owner');
        const monitor = await getStagingAnonymousSession(key, 'secret-monitor');
        sessions.push(owner, monitor);

        try {
            // 007: la caja emite un código de reclamo y el dueño lo canjea antes de generar tokens.
            const claimCode = await owner.client.rpc('create_owner_claim_code', { p_device_id: PRIMARY_DEVICE_ID });
            expect(claimCode.error).toBeNull();
            const claimed = await owner.client.rpc('claim_owner_device', { p_device_id: PRIMARY_DEVICE_ID, p_code: claimCode.data });
            expect(claimed.data).toMatchObject({ success: true });

            const gen = await owner.client.rpc('generate_pairing_token', { p_device_id: PRIMARY_DEVICE_ID });
            expect(gen.error).toBeNull();
            const token = gen.data;

            // Vinculación con secreto.
            const pair = await monitor.client.rpc('pair_monitor_device_with_secret', {
                p_token: token,
                p_monitor_device_id: MONITOR_DEVICE_ID,
                p_secret: SECRET,
            });
            expect(pair.error).toBeNull();
            expect(pair.data).toMatchObject({ success: true, primary_device_id: PRIMARY_DEVICE_ID });

            // Pérdida de respuesta en la vinculación: el mismo monitor y secreto recupera el vínculo.
            const pairRetry = await monitor.client.rpc('pair_monitor_device_with_secret', {
                p_token: token,
                p_monitor_device_id: MONITOR_DEVICE_ID,
                p_secret: SECRET,
            });
            expect(pairRetry.error).toBeNull();
            expect(pairRetry.data).toMatchObject({ success: true, primary_device_id: PRIMARY_DEVICE_ID });

            // Un secreto erróneo no puede desvincular.
            const wrong = await monitor.client.rpc('unpair_monitor_with_secret', {
                p_device_id: PRIMARY_DEVICE_ID,
                p_secret: WRONG_SECRET,
            });
            expect(wrong.error).not.toBeNull();

            // Desvinculación correcta.
            const unpair = await monitor.client.rpc('unpair_monitor_with_secret', {
                p_device_id: PRIMARY_DEVICE_ID,
                p_secret: SECRET,
            });
            expect(unpair.error).toBeNull();
            expect(unpair.data).toBe(true);

            // Reintento tras respuesta perdida: debe ser idempotente.
            const unpairRetry = await monitor.client.rpc('unpair_monitor_with_secret', {
                p_device_id: PRIMARY_DEVICE_ID,
                p_secret: SECRET,
            });
            expect(unpairRetry.error).toBeNull();
            expect(unpairRetry.data).toBe(true);
        } finally {
            // Limpieza: borra solo la fila e2e creada por esta ejecución, como el test existente.
            const { error: delError } = await owner.client.rpc('e2e_delete_pairing', { p_device_id: PRIMARY_DEVICE_ID });
            if (delError) console.warn('[e2e] no se pudo borrar la fila de prueba:', delError.message);
        }
    }, 60_000);
});
