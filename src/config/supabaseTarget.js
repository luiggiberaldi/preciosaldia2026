// Fuente única del proyecto Supabase al que habla la app.
// En modo staging E2E NUNCA cae en la URL de producción: si falta la URL o la
// clave de staging, el build/arranque falla en lugar de usar producción.

export const STAGING_PROJECT_REF = 'wapczmlwljkrjtfhmqko';
export const PRODUCTION_PROJECT_REF = 'sodgzkablshladvbtnes';

// Recibe un objeto con solo las claves necesarias. No usar import.meta.env completo:
// Vite lo inlinea entero en el bundle y expone la URL de producción.
export function isSupervisorStagingMode(env) {
    return env?.VITE_SUPERVISOR_E2E_STAGING === 'true';
}

/**
 * Resuelve URL y clave del proyecto. En staging exige variables de staging;
 * fuera de staging usa las variables de producción como antes.
 */
/**
 * Variables que decide la guardia de backend. En staging se decide solo por el modo:
 * una VITE_SUPABASE_URL de producción presente no debe activar funciones de staging.
 */
export function supabaseBackendEnv() {
    return {
        VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
        VITE_SUPERVISOR_E2E_STAGING: import.meta.env.VITE_SUPERVISOR_E2E_STAGING,
    };
}

/** Indica si hay backend configurado, sin exponer la URL en el bundle. */
export function hasSupabaseBackend(env) {
    if (isSupervisorStagingMode(env)) return true;
    return Boolean(env?.VITE_SUPABASE_URL);
}

export function resolveSupabaseTarget(env) {
    if (isSupervisorStagingMode(env)) {
        const url = env.VITE_SUPABASE_STAGING_URL;
        const key = env.VITE_SUPABASE_STAGING_KEY;
        if (!url || !key) {
            throw new Error(
                '[supabaseTarget] Modo staging sin VITE_SUPABASE_STAGING_URL/KEY. ' +
                'Se niega a usar producción; define las variables de staging.'
            );
        }
        if (!String(url).includes(STAGING_PROJECT_REF)) {
            throw new Error('[supabaseTarget] VITE_SUPABASE_STAGING_URL no apunta al proyecto de staging.');
        }
        return { url, key, mode: 'staging' };
    }

    return {
        url: env.VITE_SUPABASE_CLOUD_URL || env.VITE_SUPABASE_URL,
        key: env.VITE_SUPABASE_CLOUD_KEY || env.VITE_SUPABASE_ANON_KEY,
        mode: 'production',
    };
}
