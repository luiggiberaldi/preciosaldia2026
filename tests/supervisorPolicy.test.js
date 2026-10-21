import { describe, expect, it, vi } from 'vitest';

describe('Supervisor remote mutation guardrail', () => {
    it('mantiene deshabilitadas las mutaciones remotas durante la contención', async () => {
        // supervisorPolicy lee import.meta.env al importarse: el test fija las flags
        // para no depender del .env.local del entorno (que habilita flags para E2E).
        vi.stubEnv('VITE_SUPERVISOR_REMOTE_MUTATIONS_ENABLED', 'false');
        vi.stubEnv('VITE_SUPERVISOR_REMOTE_RATE_ENABLED', 'false');
        vi.stubEnv('VITE_SUPERVISOR_REMOTE_EGRESS_ENABLED', 'false');
        vi.resetModules();
        const {
            SUPERVISOR_REMOTE_MUTATIONS_ENABLED,
            SUPERVISOR_REMOTE_RATE_ENABLED,
            SUPERVISOR_REMOTE_EGRESS_ENABLED,
        } = await import('../src/config/supervisorPolicy');
        expect(SUPERVISOR_REMOTE_MUTATIONS_ENABLED).toBe(false);
        expect(SUPERVISOR_REMOTE_RATE_ENABLED).toBe(false);
        expect(SUPERVISOR_REMOTE_EGRESS_ENABLED).toBe(false);
        vi.unstubAllEnvs();
    });
});
