import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';

const enabled = process.env.SUPERVISOR_STAGING_PAIRING_E2E === 'true';
const stagingTest = enabled ? it : it.skip;
const STAGING_URL = 'https://wapczmlwljkrjtfhmqko.supabase.co';
// ID sintético nuevo por ejecución: staging 007 solo acepta e2e-%.
const DEVICE_ID = `e2e-claim-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

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

describe('Código de reclamo de dueño en staging — dos identidades anónimas', () => {
    const clients = [];

    afterAll(async () => {
        for (const client of clients) await client.auth.signOut();
    });

    stagingTest('reclama dueño con código, bloquea al tercero y revoca el reuso', async () => {
        const key = readEnvValue('VITE_SUPABASE_STAGING_KEY');
        expect(key, 'VITE_SUPABASE_STAGING_KEY ausente en .env').toBeTruthy();

        // "box": la caja que muestra el código. "owner": quien lo canjea.
        const box = await createAnonymousClient(key);
        const owner = await createAnonymousClient(key);
        clients.push(box.client, owner.client);

        try {
            // La caja emite el código de reclamo (sin dueño todavía).
            const code = await box.client.rpc('create_owner_claim_code', { p_device_id: DEVICE_ID });
            expect(code.error).toBeNull();
            expect(typeof code.data).toBe('string');

            // Código incorrecto: rechazado.
            const wrong = await owner.client.rpc('claim_owner_device', { p_device_id: DEVICE_ID, p_code: 'NOEXISTE' });
            expect(wrong.data).toMatchObject({ success: false });

            // Código correcto: el dueño queda registrado.
            const claim = await owner.client.rpc('claim_owner_device', { p_device_id: DEVICE_ID, p_code: code.data });
            expect(claim.data).toMatchObject({ success: true, primary_device_id: DEVICE_ID });

            // Reuso del mismo código: rechazado (uso único).
            const reuse = await box.client.rpc('claim_owner_device', { p_device_id: DEVICE_ID, p_code: code.data });
            expect(reuse.data).toMatchObject({ success: false });

            // Tercero (no dueño) no puede generar token de vinculación.
            const stranger = await box.client.rpc('generate_pairing_token', { p_device_id: DEVICE_ID });
            expect(stranger.error).not.toBeNull();

            // Dueño registrado sí puede generar token.
            const token = await owner.client.rpc('generate_pairing_token', { p_device_id: DEVICE_ID });
            expect(token.error).toBeNull();
            expect(typeof token.data).toBe('string');
        } finally {
            // Borra la fila e2e creada por esta ejecución (solo e2e-%, solo su dueño).
            const { error: delError } = await owner.client.rpc('e2e_delete_pairing', { p_device_id: DEVICE_ID });
            if (delError) console.warn('[e2e] no se pudo borrar la fila de prueba:', delError.message);
        }
    }, 60_000);
});
