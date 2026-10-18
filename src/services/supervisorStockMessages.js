// ── Catálogo compartido de toasts y mensajes de error de stock ──────────────
// Una sola fuente para los dos flujos de ajuste de stock del Supervisor:
//   - fila: ajuste por producto (+/− / edición directa) en OwnerMonitorView y
//     SupervisorInventoryCatalog, sobre el estado optimista de supervisorStockOps;
//   - lote: SupervisorInventoryBatchPanel / SupervisorInventoryBatchModal con el
//     borrador (supervisorInventoryDraft) y el envío (supervisorInventoryBatchSender).
// La misma situación se explica con el MISMO texto en ambos flujos: cambiar la
// redacción aquí la cambia en fila y en lote a la vez.
//
// Cada entrada: { text: string | (params) => string, type } donde `type` es el
// tipo de toast cuando el mensaje se anuncia; los errores de formulario y de
// línea usan solo el texto (stockMessage).

const QUANTITY_FORMAT = { maximumFractionDigits: 3 };

export function formatStockQuantity(value) {
    return Number(value || 0).toLocaleString('es-VE', QUANTITY_FORMAT);
}

function pendingLinesText(count) {
    const label = count === 1 ? '1 línea queda pendiente' : `${count} líneas quedan pendientes`;
    return `${label} para reintentar.`;
}

const STOCK_MESSAGES = {
    // ── Semántica de objetivo (lote) ───────────────────────────────────────
    TARGET_ALREADY_PASSED: {
        text: ({ stock, target }) => `El stock actual (${formatStockQuantity(stock)}) ya pasó tu objetivo (${formatStockQuantity(target)}); revisa la línea`,
        type: 'warning',
    },
    BATCH_ALREADY_AT_TARGET: {
        text: ({ count }) => (count === 1
            ? 'Ya en objetivo: el producto está donde querías, no hubo movimiento'
            : `Ya en objetivo: los ${formatStockQuantity(count)} productos están donde querías, no hubo movimiento`),
        type: 'success',
    },
    // ── Guardas de conexión y permisos (fila y lote) ─────────────────────────
    EGRESS_DISABLED: {
        text: 'Los egresos remotos están deshabilitados',
        type: 'warning',
    },
    BOX_OFFLINE_SEND: {
        text: 'La caja está desconectada; no se puede enviar la orden',
        type: 'warning',
    },
    BOX_OFFLINE_STOCK: {
        text: 'La caja está desconectada; no se puede cambiar el stock',
        type: 'warning',
    },
    BOX_OFFLINE_PENDING: {
        text: 'La caja está desconectada. Conecta la caja para confirmar; las líneas quedarán pendientes.',
        type: 'warning',
    },
    BOX_OFFLINE_INFO: {
        text: 'La caja está desconectada. El movimiento estará disponible cuando vuelva a estar en línea.',
        type: 'info',
    },
    ADJUST_IN_FLIGHT: {
        text: 'Espera la confirmación de la caja antes de ajustar de nuevo',
        type: 'warning',
    },
    PRODUCTS_EDIT_DISABLED: {
        text: 'La edición remota de productos está deshabilitada',
        type: 'warning',
    },

    // ── Ajuste de fila ───────────────────────────────────────────────────────
    STOCK_REVERT: {
        text: 'No se aplicó el cambio de stock; se revirtió el valor provisional',
        type: 'error',
    },
    INVALID_STOCK_WEIGHT: {
        text: 'Escribe una cantidad válida (0 o más, admite decimales)',
        type: 'error',
    },
    INVALID_STOCK_UNITS: {
        text: 'Escribe un número entero mayor o igual a 0',
        type: 'error',
    },
    STOCK_UPDATE_FAILED: {
        text: 'No se pudo actualizar el stock',
        type: 'error',
    },
    BOX_REJECTED_STOCK: {
        text: 'La caja rechazó el cambio de stock',
        type: 'error',
    },
    ORDER_EXPIRED: {
        text: 'La orden expiró en la caja sin aplicarse',
        type: 'error',
    },

    // ── Validación de líneas (compartida por fila y lote) ───────────────────
    PRODUCT_REQUIRED: {
        text: 'Busca y selecciona un producto',
        type: 'error',
    },
    PRODUCT_NOT_FOUND: {
        text: 'Producto no encontrado',
        type: 'error',
    },
    UNIT_INVALID: {
        text: 'Unidad de inventario inválida',
        type: 'error',
    },
    QUANTITY_REQUIRED: {
        text: 'Indica una cantidad mayor que cero.',
        type: 'error',
    },
    UNITS_MUST_BE_INTEGER: {
        text: 'Las unidades contables deben ser enteras',
        type: 'error',
    },
    CONVERSION_NOT_INTEGER: {
        text: 'La conversión debe dar unidades contables enteras',
        type: 'error',
    },
    PACKAGE_FACTOR_MISSING: {
        text: 'Este producto no tiene el bulto configurado. Indica cuántas unidades trae el bulto.',
        type: 'error',
    },
    PACKAGE_FACTOR_INVALID: {
        text: 'Las unidades por bulto deben ser un número entero mayor que cero.',
        type: 'error',
    },
    STOCK_INSUFFICIENT: {
        text: ({ units, stock }) => `No puedes retirar ${formatStockQuantity(units)} unidades: el stock disponible es ${formatStockQuantity(stock)}.`,
        type: 'error',
    },
    STOCK_INSUFFICIENT_HINT: {
        text: 'No hay stock suficiente para este egreso.',
        type: 'error',
    },

    // ── Unidades a granel ───────────────────────────────────────────────────
    MEASURE_ON_NON_GRANEL: {
        text: 'Las unidades de peso o volumen solo aplican a productos a granel',
        type: 'error',
    },
    GRANEL_KIND_UNKNOWN: {
        text: 'No se puede determinar si el producto a granel es sólido o líquido',
        type: 'error',
    },
    GRANEL_LIQUID_UNITS: {
        text: 'Producto líquido: usa lt o ml',
        type: 'error',
    },
    GRANEL_SOLID_UNITS: {
        text: 'Producto sólido: usa kg o g',
        type: 'error',
    },
    GRANEL_RANGE: {
        text: 'Cantidad de granel fuera de rango',
        type: 'error',
    },
    PRESENTATION_ON_GRANEL: {
        text: 'Cajas y bultos no aplican a productos a granel',
        type: 'error',
    },

    // ── Composición del lote ────────────────────────────────────────────────
    REASON_REQUIRED: {
        text: 'Indica el motivo del movimiento',
        type: 'error',
    },
    ADD_PRODUCT_FIRST: {
        text: 'Agrega al menos un producto',
        type: 'error',
    },
    REVIEW_LINES: {
        text: 'Revisa las líneas marcadas antes de enviar',
        type: 'error',
    },
    BATCH_CONTRACT_INVALID: {
        text: 'El lote no cumple el contrato batch v2',
        type: 'error',
    },

    // ── Envío y ACK del lote ────────────────────────────────────────────────
    SEND_FAILED: {
        text: 'No se pudo enviar el movimiento',
        type: 'error',
    },
    BOX_NO_CONFIRM_MOVE: {
        text: 'La caja no confirmó el movimiento',
        type: 'error',
    },
    LINE_INVALID_OR_INSUFFICIENT: {
        text: 'La línea tiene datos inválidos o stock insuficiente',
        type: 'error',
    },
    ACK_TIMEOUT: {
        text: 'La caja no confirmó la orden a tiempo',
        type: 'error',
    },
    PREVIOUS_BATCH_UNCHECKED: {
        text: 'No se pudo verificar el estado del lote anterior. No lo reenvíes todavía.',
        type: 'error',
    },
    PREVIOUS_BATCH_ACTIVE: {
        text: 'Hay un lote anterior sin confirmar en la caja. No se envió este nuevo lote.',
        type: 'error',
    },
    PREVIOUS_ACK_FAILED: {
        text: 'No se pudo consultar el ACK del lote anterior',
        type: 'error',
    },
    BATCH_REJECTED: {
        text: 'La caja rechazó el lote',
        type: 'error',
    },
    BATCH_CANCELLED: {
        text: 'La orden fue cancelada antes de aplicarse',
        type: 'error',
    },

    // ── Resultados del lote (avisos al usuario) ─────────────────────────────
    BATCH_UNCONFIRMED: {
        text: 'La caja aún no confirma el lote; puede seguir aplicándolo. No lo reenvíes: pulsa "Revisar estado del lote" para consultar sin crear otro comando.',
        type: 'warning',
    },
    BATCH_UNCONFIRMED_TOAST: {
        text: 'Lote sin confirmar todavía',
        type: 'warning',
    },
    BATCH_CONFIRM_ERROR: {
        text: ({ error }) => `No se pudo confirmar el lote: ${error || 'error desconocido'}. No lo reenvíes: pulsa "Revisar estado del lote" para consultar sin crear otro comando.`,
        type: 'error',
    },
    PENDING_LINES: {
        text: ({ count }) => pendingLinesText(count),
        type: 'warning',
    },
    CONNECTION_LOST: {
        text: ({ count }) => `La conexión con la caja se perdió. ${pendingLinesText(count)}`,
        type: 'warning',
    },
    NONE_CONFIRMED: {
        text: ({ count }) => `La caja no confirmó ningún movimiento. ${pendingLinesText(count)}`,
        type: 'warning',
    },
    BATCH_PARTIAL: {
        text: ({ applied, pending }) => `${applied} aplicados; quedan ${pending} pendientes de revisión`,
        type: 'warning',
    },
    BATCH_CONFIRMED: {
        text: ({ count }) => `${count} movimiento${count === 1 ? '' : 's'} confirmado${count === 1 ? '' : 's'} en caja`,
        type: 'success',
    },
    BATCH_APPLIED_WITH_WARNINGS: {
        text: ({ count }) => `${count} movimiento${count === 1 ? '' : 's'} aplicado${count === 1 ? '' : 's'} con advertencias en caja`,
        type: 'warning',
    },
    RECONCILED_APPLIED: {
        text: ({ count }) => `Lote reconciliado en segundo plano: ${count} movimiento${count === 1 ? '' : 's'} confirmado${count === 1 ? '' : 's'} en caja`,
        type: 'success',
    },
    RECONCILED_FAILED: {
        text: ({ reason, count }) => `Lote reconciliado en segundo plano: ${reason}. ${pendingLinesText(count)}`,
        type: 'warning',
    },
    INGRESS_CONFIRMED: {
        text: 'Ingreso confirmado en la caja',
        type: 'success',
    },
    EGRESS_CONFIRMED: {
        text: 'Egreso confirmado en la caja',
        type: 'success',
    },

    // ── Empaque del producto (configurado desde el lote) ────────────────────
    PACKAGE_SAVED: {
        text: 'Empaque guardado en el producto',
        type: 'success',
    },
    PACKAGE_SAVE_FAILED: {
        text: 'No se pudo guardar el empaque en el producto',
        type: 'error',
    },
    PACKAGE_SAVE_UNCONFIRMED: {
        text: 'La caja no confirmó el cambio de empaque',
        type: 'error',
    },
};

Object.freeze(STOCK_MESSAGES);

export { STOCK_MESSAGES };

/**
 * Texto del mensaje para la clave dada. Las entradas con `text` función
 * reciben un objeto de parámetros. Una clave desconocida devuelve la propia
 * clave (visible en pantalla en vez de un texto vacío).
 */
export function stockMessage(key, params) {
    const entry = STOCK_MESSAGES[key];
    if (!entry) return String(key);
    return typeof entry.text === 'function' ? entry.text(params) : entry.text;
}

/** Tipo de toast canónico de la clave ('error' | 'warning' | 'success' | 'info'). */
export function stockToastType(key) {
    return STOCK_MESSAGES[key]?.type || 'info';
}

/** Anuncia el mensaje como toast con su tipo canónico. */
export function notifyStockToast(showToast, key, params) {
    showToast?.(stockMessage(key, params), stockToastType(key));
}

export default {
    STOCK_MESSAGES,
    formatStockQuantity,
    stockMessage,
    stockToastType,
    notifyStockToast,
};
