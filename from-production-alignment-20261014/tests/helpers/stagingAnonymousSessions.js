import { createClient } from '@supabase/supabase-js';

// Cache por proceso: los E2E de staging reutilizan identidades anónimas para no
// agotar el límite de tasa de signInAnonymously de Supabase.
const STAGING_URL = 'https://wapczmlwljkrjtfhmqko.supabase.co';
const pool = new Map();

export async function getStagingAnonymousSession(key, slot) {
    const cached = pool.get(slot);
    if (cached) return cached;

    const client = createClient(STAGING_URL, key, {
        auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.auth.signInAnonymously();
    if (error || !data?.user?.id) throw error || new Error('No se pudo crear identidad anónima de staging');

    const session = { client, userId: data.user.id };
    pool.set(slot, session);
    return session;
}

export async function disposeStagingAnonymousSessions() {
    for (const { client } of pool.values()) {
        await client.auth.signOut();
    }
    pool.clear();
}
