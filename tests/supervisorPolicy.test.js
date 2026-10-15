import { describe, expect, it } from 'vitest';
import {
    SUPERVISOR_REMOTE_MUTATIONS_ENABLED,
    SUPERVISOR_REMOTE_PRODUCTS_ENABLED,
    SUPERVISOR_REMOTE_INCOME_ENABLED,
    SUPERVISOR_REMOTE_RATE_ENABLED,
    SUPERVISOR_REMOTE_EGRESS_ENABLED,
} from '../src/config/supervisorPolicy';

describe('Supervisor remote mutation policy', () => {
    it('activa todas las capacidades remotas por defecto', () => {
        expect(SUPERVISOR_REMOTE_MUTATIONS_ENABLED).toBe(true);
        expect(SUPERVISOR_REMOTE_PRODUCTS_ENABLED).toBe(true);
        expect(SUPERVISOR_REMOTE_RATE_ENABLED).toBe(true);
        expect(SUPERVISOR_REMOTE_INCOME_ENABLED).toBe(true);
        expect(SUPERVISOR_REMOTE_EGRESS_ENABLED).toBe(true);
    });
});
