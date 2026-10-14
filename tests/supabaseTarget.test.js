import { describe, expect, it } from 'vitest';
import { resolveSupabaseTarget, isSupervisorStagingMode, hasSupabaseBackend } from '../src/config/supabaseTarget.js';

const STAGING_URL = 'https://tdfcpwctvumbdjmifypd.supabase.co';
const PROD_URL = 'https://sodgzkablshladvbtnes.supabase.co';

describe('resolveSupabaseTarget', () => {
    it('usa staging cuando el modo staging tiene URL y clave', () => {
        const target = resolveSupabaseTarget({
            VITE_SUPERVISOR_E2E_STAGING: 'true',
            VITE_SUPABASE_STAGING_URL: STAGING_URL,
            VITE_SUPABASE_STAGING_KEY: 'staging-key',
        });
        expect(target).toEqual({ url: STAGING_URL, key: 'staging-key', mode: 'staging' });
    });

    it('falla cerrado en staging si falta la URL, aunque exista la de producci\u00f3n', () => {
        expect(() => resolveSupabaseTarget({
            VITE_SUPERVISOR_E2E_STAGING: 'true',
            VITE_SUPABASE_URL: PROD_URL,
            VITE_SUPABASE_CLOUD_URL: PROD_URL,
            VITE_SUPABASE_STAGING_KEY: 'staging-key',
        })).toThrow(/Se niega a usar producci\u00f3n/);
    });

    it('falla cerrado en staging si falta la clave', () => {
        expect(() => resolveSupabaseTarget({
            VITE_SUPERVISOR_E2E_STAGING: 'true',
            VITE_SUPABASE_STAGING_URL: STAGING_URL,
        })).toThrow(/Se niega a usar producci\u00f3n/);
    });

    it('rechaza en staging una URL que no es el proyecto de staging', () => {
        expect(() => resolveSupabaseTarget({
            VITE_SUPERVISOR_E2E_STAGING: 'true',
            VITE_SUPABASE_STAGING_URL: PROD_URL,
            VITE_SUPABASE_STAGING_KEY: 'k',
        })).toThrow(/no apunta al proyecto de staging/);
    });

    it('fuera de staging conserva las variables de producci\u00f3n', () => {
        const target = resolveSupabaseTarget({
            VITE_SUPABASE_CLOUD_URL: PROD_URL,
            VITE_SUPABASE_CLOUD_KEY: 'prod-key',
        });
        expect(target).toEqual({ url: PROD_URL, key: 'prod-key', mode: 'production' });
    });

    it('hasSupabaseBackend en staging depende solo del modo, no de la URL de producción', () => {
        expect(hasSupabaseBackend({ VITE_SUPERVISOR_E2E_STAGING: 'true', VITE_SUPABASE_URL: PROD_URL })).toBe(true);
        expect(hasSupabaseBackend({ VITE_SUPERVISOR_E2E_STAGING: 'true' })).toBe(true);
    });

    it('hasSupabaseBackend fuera de staging exige la URL configurada', () => {
        expect(hasSupabaseBackend({ VITE_SUPABASE_URL: PROD_URL })).toBe(true);
        expect(hasSupabaseBackend({})).toBe(false);
    });

    it('detecta el modo staging solo con el valor exacto "true"', () => {
        expect(isSupervisorStagingMode({ VITE_SUPERVISOR_E2E_STAGING: 'true' })).toBe(true);
        expect(isSupervisorStagingMode({ VITE_SUPERVISOR_E2E_STAGING: 'false' })).toBe(false);
        expect(isSupervisorStagingMode({})).toBe(false);
    });
});
