// Sugerencias rápidas del asistente según el rol: el Cajero no consulta montos globales,
// deudas ni cuadre financiero (misma política que el contexto y el motor offline).

const SUGGESTIONS = Object.freeze([
    { id: 'vuelto', label: 'Vuelto Cambiario', prompt: '¿Cómo me ayuda el POS a calcular el vuelto o cambio?', adminOnly: false },
    { id: 'cuadre', label: 'Cuadre de Hoy', prompt: '¿Cuánto llevo vendido hoy en total y cuál es el desglose por método de pago?', adminOnly: true },
    { id: 'stock', label: 'Stock Crítico', prompt: '¿Cuáles son los productos con bajo stock o agotados en mi inventario?', adminOnly: false },
    { id: 'cobrar', label: 'Cuentas por Cobrar', prompt: '¿Cuáles clientes tienen deudas pendientes en el negocio?', adminOnly: true },
    { id: 'ventas', label: 'Últimas Ventas', prompt: '¿Muestras el detalle completo de las últimas ventas registradas?', adminOnly: true },
    { id: 'anular', label: 'Anular una venta', prompt: '¿Cómo anulo una venta?', adminOnly: false },
    { id: 'supervisor', label: 'Celular del Supervisor', prompt: '¿Cómo vinculo el celular del Supervisor y qué puedo hacer desde ahí?', adminOnly: false },
]);

export function getChatSuggestions(rol) {
    const isCajero = (rol || 'CAJERO') === 'CAJERO';
    return SUGGESTIONS.filter((s) => !(isCajero && s.adminOnly));
}
