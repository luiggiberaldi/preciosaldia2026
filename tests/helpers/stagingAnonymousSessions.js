import { createClient } from '@supabase/supabase-js';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Pool a nivel de proceso: con `--no-isolate` (un solo worker) todos los archivos de
// staging comparten estas identidades anónimas.
//
// Además, las identidades se persisten en un archivo local ignorado por git
// (.staging-test-sessions.json) y se reutilizan entre corridas. Así no se crea una
// identidad anónima nueva en cada ejecución y no se agota el límite de tasa de
// signInAnonymously de Supabase. Si un slot guardado ya no sirve, se crea uno nuevo.
const STAGING_URL = 'https://wapczmlwljkrjtfhmqko.supabase.co';
const STORE_PATH = resolve(process.cwd(), '.staging-test-sessions.json');
const pool = new Map();

function readStore() {
    if (!existsSync(STORE_PATH)) return {};
    try {
        return JSON.parse(readFileSync(STORE_PATH, 'utf8')) ?? {};
    } catch {
        return {};
    }
}

function writeStore(store) {
    writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), { encoding: 'utf8', mode: 0o600 });
}

function makeClient(key) {
    return createClient(STAGING_URL, key, {
        auth: { persistSession: false, autoRefreshToken: false },
    });
}

export async function getStagingAnonymousSession(key, slot) {
    const cached = pool.get(slot);
    if (cached) return cached;

    const store = readStore();
    const saved = store[slot];
    if (saved?.access_token && saved?.refresh_token) {
        const client = makeClient(key);
        const { data, error } = await client.auth.setSession({
            access_token: saved.access_token,
            refresh_token: saved.refresh_token,
        });
        if (!error && data?.session?.user?.id) {
            const session = { client, userId: data.session.user.id };
            pool.set(slot, session);
            // Persiste la sesión renovada, si el SDK rotó los tokens.
            store[slot] = {
                access_token: data.session.access_token,
                refresh_token: data.session.refresh_token,
            };
            writeStore(store);
            return session;
        }
        // Token caducado o revocado: se crea una identidad nueva para este slot.
    }

    const client = makeClient(key);
    const { data, error } = await client.auth.signInAnonymously();
    if (error || !data?.user?.id || !data?.session) {
        throw error || new Error('No se pudo crear identidad anónima de staging');
    }

    store[slot] = {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
    };
    writeStore(store);

    const session = { client, userId: data.user.id };
    pool.set(slot, session);
    return session;
}

// Cierra las sesiones del proceso sin borrar las guardadas, para reutilizarlas en la
// siguiente corrida. Usa resetStagingSessionStore() para olvidarlas por completo.
export async function disposeStagingAnonymousSessions() {
    pool.clear();
}

export function resetStagingSessionStore() {
    pool.clear();
    if (existsSync(STORE_PATH)) unlinkSync(STORE_PATH);
}
