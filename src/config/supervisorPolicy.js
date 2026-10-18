// Política del Modo Supervisor.
// Todas las capacidades con contrato y receptor implementados quedan activas
// por defecto. Cada bandera conserva un interruptor de contención para poder
// apagar una capacidad sin publicar otro cambio de código.
const isEnabled = (name, fallback = true) => {
    const value = import.meta.env?.[name];
    return value == null ? fallback : value !== 'false';
};

export const SUPERVISOR_REMOTE_MUTATIONS_ENABLED = isEnabled('VITE_SUPERVISOR_REMOTE_MUTATIONS_ENABLED');
export const SUPERVISOR_REMOTE_PRODUCTS_ENABLED = isEnabled('VITE_SUPERVISOR_REMOTE_PRODUCTS_ENABLED');
export const SUPERVISOR_REMOTE_INCOME_ENABLED = isEnabled('VITE_SUPERVISOR_REMOTE_INCOME_ENABLED');
export const SUPERVISOR_REMOTE_RATE_ENABLED = isEnabled('VITE_SUPERVISOR_REMOTE_RATE_ENABLED');
export const SUPERVISOR_REMOTE_EGRESS_ENABLED = isEnabled('VITE_SUPERVISOR_REMOTE_EGRESS_ENABLED');
// Fase 5: TTL extendido por tipo (5 min para catálogo/inventario/usuarios).
// Default FALSE hasta el rollout: la migración debe estar aplicada en
// producción y los receivers actualizados antes de encenderlo.
export const SUPERVISOR_EXTENDED_TTL_ENABLED = isEnabled('VITE_SUPERVISOR_EXTENDED_TTL_ENABLED', false);

export default {
    SUPERVISOR_REMOTE_MUTATIONS_ENABLED,
    SUPERVISOR_REMOTE_PRODUCTS_ENABLED,
    SUPERVISOR_REMOTE_INCOME_ENABLED,
    SUPERVISOR_REMOTE_RATE_ENABLED,
    SUPERVISOR_REMOTE_EGRESS_ENABLED,
    SUPERVISOR_EXTENDED_TTL_ENABLED,
};
