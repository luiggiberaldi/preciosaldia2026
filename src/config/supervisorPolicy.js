// Política temporal de seguridad del Modo Supervisor.
//
// Las mutaciones remotas permanecen deshabilitadas mientras pairing/RLS/comandos
// no tengan autorización server-side, ACK e idempotencia. El POS local y el
// monitor de solo lectura no dependen de este flag.
export const SUPERVISOR_REMOTE_MUTATIONS_ENABLED = false;
export const SUPERVISOR_REMOTE_INCOME_ENABLED = import.meta.env.VITE_SUPERVISOR_REMOTE_INCOME_ENABLED === 'true';
export const SUPERVISOR_REMOTE_EGRESS_ENABLED = false;

export default {
    SUPERVISOR_REMOTE_MUTATIONS_ENABLED,
    SUPERVISOR_REMOTE_INCOME_ENABLED,
    SUPERVISOR_REMOTE_EGRESS_ENABLED,
};
