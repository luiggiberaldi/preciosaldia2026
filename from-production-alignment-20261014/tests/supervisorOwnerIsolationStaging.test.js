import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { getStagingAnonymousSession } from './helpers/stagingAnonymousSessions.js';

const enabled = process.env.SUPERVISOR_STAGING_PAIRING_E2E === 'true';
const stagingTest = enabled ? it : it.skip;
const STAGING_URL = 'https://wapczmlwljkrjtfhmqko.supabase.co';
const SUFFIX = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const PRIMARY_DEVICE_ID = `e2e-iso-box-${SUFFIX}`;
// Formato real que genera la app: mon-<uuid>.
const MONITOR_DEVICE_ID = `mon-${crypto.randomUUID()}`;

function readEnvValue(name) {
    const text = readFileSync('.env', 'utf8');
    return text.match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1]?.trim();
}

describe('Supervisor aislamiento entre dueños en staging', () => {
    const sessions = [];

    afterAll(async () => {
        for (const { client } of sessions) {
            await client.auth.signOut();
        }
    });

    stagingTest('una identidad ajena no puede borrar ni desvincular la caja de otro dueño', async () => {
        const key = readEnvValue('VITE_SUPABASE_STAGING_KEY');
        expect(key, 'VITE_SUPABASE_STAGING_KEY ausente en .env').toBeTruthy();

        const owner = await getStagingAnonymousSession(key, 'isolation-owner');
        const monitor = await getStagingAnonymousSession(key, 'isolation-monitor');
        const stranger = await getStagingAnonymousSession(key, 'isolation-stranger');
        sessions.push(owner, monitor, stranger);

        try {
            // 007: la caja emite un código de reclamo y el dueño lo canjea antes de generar tokens.
            const claimCode = await owner.client.rpc('create_owner_claim_code', { p_device_id: PRIMARY_DEVICE_ID });
            expect(claimCode.error).toBeNull();
            const claimed = await owner.client.rpc('claim_owner_device', { p_device_id: PRIMARY_DEVICE_ID, p_code: claimCode.data });
            expect(claimed.data).toMatchObject({ success: true });

            const gen = await owner.client.rpc('generate_pairing_token', { p_device_id: PRIMARY_DEVICE_ID });
            expect(gen.error).toBeNull();

            const pair = await monitor.client.rpc('pair_monitor_device', {
                p_token: gen.data,
                p_monitor_device_id: MONITOR_DEVICE_ID,
            });
            expect(pair.data).toMatchObject({ success: true, primary_device_id: PRIMARY_DEVICE_ID });

            // Una identidad ajena no puede borrar la fila del dueño mientras el vínculo está activo.
            const strangerDelete = await stranger.client.rpc('e2e_delete_pairing', { p_device_id: PRIMARY_DEVICE_ID });
            expect(strangerDelete.data).toBe(false);

            // Ni desvincularla por la RPC clásica.
            const strangerUnpair = await stranger.client.rpc('unpair_monitor', { p_device_id: PRIMARY_DEVICE_ID });
            expect(strangerUnpair.error).not.toBeNull();

            // La fila sigue intacta: el monitor legítimo continúa vinculado.
            const { data: row } = await owner.client
                .from('device_pairings')
                .select('monitor_auth_id, revoked_at')
                .eq('primary_device_id', PRIMARY_DEVICE_ID)
                .maybeSingle();
            expect(row?.monitor_auth_id).toBe(monitor.userId);
            expect(row?.revoked_at).toBeNull();
        } finally {
            // Limpieza: el monitor desvincula y el dueño borra su propia fila sintética.
            try {
                await monitor.client.rpc('unpair_monitor', { p_device_id: PRIMARY_DEVICE_ID });
            } catch {
                // Ya desvinculada o nunca vinculada.
            }
            const { error: delError } = await owner.client.rpc('e2e_delete_pairing', { p_device_id: PRIMARY_DEVICE_ID });
            if (delError) console.warn('[e2e] no se pudo borrar la fila de prueba:', delError.message);
        }
    }, 60_000);
});
