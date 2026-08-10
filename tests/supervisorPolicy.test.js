import { describe, expect, it } from 'vitest';
import { SUPERVISOR_REMOTE_MUTATIONS_ENABLED } from '../src/config/supervisorPolicy';

describe('Supervisor remote mutation guardrail', () => {
    it('mantiene deshabilitadas las mutaciones remotas durante la contención', () => {
        expect(SUPERVISOR_REMOTE_MUTATIONS_ENABLED).toBe(false);
    });
});
