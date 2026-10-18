// ── Evaluador de verificación de comandos ("¿Hizo efecto de verdad?") ───────
// Regla de Donde Juancho: "la igualdad de stock no basta". Aplicado significa
// probado contra el eco real de la caja (los sync_documents que publica). Este
// módulo es puro (sin React, sin red): recibe el comando, su ACK y un snapshot
// del eco, y decide el sello:
//
//   'received'  — Recibido por la caja: sin eco posterior todavía, o el eco no
//                 permite verificar este tipo de cambio (honesto; jamás un
//                 verde falso).
//   'verified'  — Aplicado y verificado: el eco posterior CONFIRMA el efecto
//                 pedido (por tipo de comando).
//   'mismatch'  — No coincide — revisar: el eco posterior CONTRADICE el cambio.
//
// Un sello 'verified' solo se emite con comprobación real; si falta la cifra
// (p. ej. stockAfter del ACK) o el dato del eco, el sello se degrada a
// 'received' explicando qué falta.

export const VERIFICATION_LEVELS = Object.freeze(['received', 'verified', 'mismatch']);

/** Periodo de gracia tras aplicar la orden antes de insistir en el eco. */
export const VERIFICATION_GRACE_MS = 15_000;

/** Tolerancia para comparar stocks con decimales (p. ej. 30 vs 30.0000000001). */
export const STOCK_EPSILON = 1e-9;

const APPLIED_STATUSES = Object.freeze(['applied', 'applied_with_warnings']);

const VERIFICATION_META = Object.freeze({
    received: {
        level: 'received',
        label: 'Recibido por la caja',
        tone: 'info',
        description: 'La caja aplicó la orden; aún sin eco posterior que la confirme.',
    },
    verified: {
        level: 'verified',
        label: 'Aplicado y verificado',
        tone: 'success',
        description: 'El eco de la caja confirma que el cambio quedó aplicado.',
    },
    mismatch: {
        level: 'mismatch',
        label: 'No coincide — revisar',
        tone: 'danger',
        description: 'El eco posterior no refleja el cambio pedido.',
    },
});

export function getVerificationMeta(level) {
    return { ...(VERIFICATION_META[level] || VERIFICATION_META.received) };
}

function result(level, detail, checks = [], now = Date.now()) {
    return {
        level,
        checkedAt: new Date(now).toISOString(),
        detail: detail || null,
        checks,
    };
}

function isApplied(command, ack) {
    const status = ack?.status || command?.status;
    return APPLIED_STATUSES.includes(status);
}

/**
 * Frescura del eco POR DOMINIO: un eco de productos más reciente jamás valida
 * una tasa vieja (eso produciría falsos "No coincide"). Cada tipo usa el
 * timestamp de su dominio y, en su defecto, el del eco general.
 */
export function freshnessTimestampFor(snapshot, type) {
    switch (type) {
        case 'supervisor.inventory.batch.adjust':
        case 'supervisor.product.create':
        case 'supervisor.product.update':
        case 'supervisor.product.delete':
            return snapshot?.productsUpdatedAt ?? snapshot?.updatedAt ?? null;
        case 'supervisor.rate.set':
            return snapshot?.rateModeUpdatedAt ?? snapshot?.updatedAt ?? null;
        case 'supervisor.user.create':
        case 'supervisor.user.update':
        case 'supervisor.user.delete':
        case 'supervisor.user.pin.change':
            return snapshot?.usersUpdatedAt ?? snapshot?.updatedAt ?? null;
        default:
            return snapshot?.updatedAt ?? null;
    }
}

function near(a, b) {
    return Math.abs(Number(a) - Number(b)) < STOCK_EPSILON;
}

function sameValue(expected, actual) {
    if (typeof expected === 'number' && typeof actual === 'number') return near(expected, actual);
    return expected === actual;
}

function findProduct(products, productId) {
    const id = String(productId ?? '');
    return (products || []).find(item => String(item?.id) === id) || null;
}

function findUser(users, { userId, nombre }) {
    return (users || []).find(item => (
        (userId != null && String(item?.id) === String(userId))
        || (nombre && item?.nombre === nombre)
    )) || null;
}

function stockExpectations(command, ack) {
    const payload = command?.payload || {};
    const ackData = ack?.ack ?? ack ?? null;
    const expectations = [];

    if (Array.isArray(payload.lines) && payload.lines.length) {
        const ackLines = Array.isArray(ackData?.lines) ? ackData.lines : [];
        payload.lines.forEach((line, index) => {
            const ackLine = ackLines.find(entry => String(entry?.productId) === String(line?.productId))
                || ackLines[index]
                || null;
            const expected = Number(ackLine?.stockAfter ?? ackLine?.ack?.stockAfter);
            expectations.push({
                productId: String(line?.productId ?? ''),
                expected: Number.isFinite(expected) ? expected : null,
            });
        });
        return expectations;
    }

    const raw = ackData?.stockAfter ?? ackData?.ack?.stockAfter;
    const expected = Number(raw);
    return [{
        productId: String(payload.productId ?? ''),
        expected: Number.isFinite(expected) ? expected : null,
    }];
}

function verifyInventory({ command, ack, snapshot }) {
    // Eco incompleto (sin datos de productos): no se puede verificar → received
    // honesto. Un eco completo sin el producto SÍ es mismatch.
    if (!Array.isArray(snapshot.products)) {
        return result('received', 'El eco no trae el inventario de la caja; no se puede verificar.');
    }

    const expectations = stockExpectations(command, ack);

    // La igualdad de stock no basta: sin la cifra confirmada por la caja no se
    // declara 'verified', aunque el stock del eco "cuadre" por casualidad.
    if (expectations.some(entry => entry.expected == null)) {
        return result(
            'received',
            'La caja no devolvió el stock final de la operación; sin esa cifra no se declara verificado.',
        );
    }

    const checks = expectations.map(entry => {
        const product = findProduct(snapshot.products, entry.productId);
        return {
            label: `Stock de ${entry.productId}`,
            ok: Boolean(product) && near(product.stock, entry.expected),
            expected: entry.expected,
            actual: product ? Number(product.stock) : null,
            productId: entry.productId,
        };
    });

    const missing = checks.filter(check => check.actual == null);
    if (missing.length) {
        return result(
            'mismatch',
            `El producto ${missing.map(check => check.productId).join(', ')} no aparece en el eco posterior de la caja.`,
            checks,
        );
    }

    const off = checks.filter(check => !check.ok);
    if (off.length) {
        return result(
            'mismatch',
            off.map(check => `El stock del eco (${check.actual}) no coincide con el confirmado por la caja (${check.expected}).`).join(' '),
            checks,
        );
    }
    return result('verified', 'El eco de la caja confirma el stock de la operación.', checks);
}

function verifyProductCreate({ command, snapshot }) {
    if (!Array.isArray(snapshot.products)) {
        return result('received', 'El eco no trae el catálogo de productos; no se puede verificar.');
    }
    const wanted = command?.payload?.product || {};
    const product = findProduct(snapshot.products, wanted.id);
    if (!product) {
        return result('mismatch', 'El producto creado no aparece en el eco posterior de la caja.');
    }
    if (wanted.name && product.name && product.name !== wanted.name) {
        return result(
            'mismatch',
            `El producto aparece en el eco pero con otro nombre ("${product.name}" en vez de "${wanted.name}").`,
            [{ label: 'Nombre', ok: false, expected: wanted.name, actual: product.name }],
        );
    }
    return result('verified', 'El eco de la caja confirma el producto creado.', [
        { label: 'Producto presente', ok: true, expected: wanted.id, actual: product.id },
    ]);
}

function verifyProductUpdate({ command, snapshot }) {
    if (!Array.isArray(snapshot.products)) {
        return result('received', 'El eco no trae el catálogo de productos; no se puede verificar.');
    }
    const payload = command?.payload || {};
    const product = findProduct(snapshot.products, payload.productId);
    if (!product) {
        return result('mismatch', 'El producto editado no aparece en el eco posterior de la caja.');
    }

    // El stock es territorio de los movimientos: nunca se compara desde un
    // patch maestro (la caja lo preserva aunque el payload lo incluyera).
    const ignored = new Set(['baseRevision', 'stock', 'stockInLotes', 'updatedAt', 'updated_at', 'id']);
    const fields = Object.entries(payload.patch || {})
        .filter(([key, value]) => !ignored.has(key) && (value === null || ['string', 'number', 'boolean'].includes(typeof value)));

    const checks = fields.map(([key, expected]) => ({
        label: key,
        ok: sameValue(expected, product[key]),
        expected,
        actual: product[key],
    }));
    const off = checks.filter(check => !check.ok);
    if (off.length) {
        return result(
            'mismatch',
            `El eco no coincide en: ${off.map(check => `${check.label} (pedido ${check.expected}, en la caja ${check.actual})`).join('; ')}.`,
            checks,
        );
    }
    return result('verified', 'El eco de la caja confirma la edición del producto.', checks);
}

function verifyProductDelete({ command, snapshot }) {
    if (!Array.isArray(snapshot.products)) {
        return result('received', 'El eco no trae el catálogo de productos; no se puede verificar.');
    }
    const product = findProduct(snapshot.products, command?.payload?.productId);
    if (product) {
        return result('mismatch', 'El producto sigue apareciendo en el catálogo de la caja.');
    }
    return result('verified', 'El eco de la caja confirma la baja del producto.');
}

function verifyRateSet({ command, snapshot }) {
    const wanted = command?.payload?.rateMode;
    if (snapshot.rateMode == null) {
        return result('received', 'El eco no trae el modo de tasa activo; no se puede verificar.');
    }
    const ok = snapshot.rateMode === wanted;
    const checks = [{ label: 'Modo de tasa activo', ok, expected: wanted, actual: snapshot.rateMode }];
    return result(
        ok ? 'verified' : 'mismatch',
        ok
            ? 'El eco de la caja confirma el modo de tasa activo.'
            : `El eco muestra la tasa "${snapshot.rateMode}" pero se pidió "${wanted}".`,
        checks,
    );
}

function verifyUserCreate({ command, snapshot }) {
    if (!Array.isArray(snapshot.users)) {
        return result('received', 'El eco no trae el catálogo de usuarios; no se puede verificar.');
    }
    const payload = command?.payload || {};
    const user = findUser(snapshot.users, { userId: payload.userId, nombre: payload.nombre });
    if (!user) {
        return result('mismatch', 'El usuario creado no aparece en el eco posterior de la caja.');
    }
    if (payload.rol && user.rol && user.rol !== payload.rol) {
        return result(
            'mismatch',
            `El usuario aparece en el eco con otro rol ("${user.rol}" en vez de "${payload.rol}").`,
            [{ label: 'Rol', ok: false, expected: payload.rol, actual: user.rol }],
        );
    }
    return result('verified', 'El eco de la caja confirma el alta del usuario.');
}

function verifyUserUpdate({ command, snapshot }) {
    if (!Array.isArray(snapshot.users)) {
        return result('received', 'El eco no trae el catálogo de usuarios; no se puede verificar.');
    }
    const payload = command?.payload || {};
    const user = findUser(snapshot.users, { userId: payload.userId, nombre: payload.nombre });
    if (!user) {
        return result('mismatch', 'El usuario editado no aparece en el eco posterior de la caja.');
    }
    const patch = payload.patch && typeof payload.patch === 'object' ? payload.patch : payload;
    const fields = Object.entries(patch)
        .filter(([key, value]) => ['nombre', 'rol'].includes(key) && value != null);
    const checks = fields.map(([key, expected]) => ({
        label: key,
        ok: sameValue(expected, user[key]),
        expected,
        actual: user[key],
    }));
    const off = checks.filter(check => !check.ok);
    if (off.length) {
        return result(
            'mismatch',
            `El eco no coincide en: ${off.map(check => `${check.label} (pedido ${check.expected}, en la caja ${check.actual})`).join('; ')}.`,
            checks,
        );
    }
    return result('verified', 'El eco de la caja confirma la edición del usuario.', checks);
}

function verifyUserDelete({ command, snapshot }) {
    if (!Array.isArray(snapshot.users)) {
        return result('received', 'El eco no trae el catálogo de usuarios; no se puede verificar.');
    }
    const payload = command?.payload || {};
    const user = findUser(snapshot.users, { userId: payload.userId, nombre: payload.nombre });
    if (user) {
        return result('mismatch', 'El usuario sigue apareciendo en el eco de la caja.');
    }
    return result('verified', 'El eco de la caja confirma la baja del usuario.');
}

function verifyByType({ command, ack, snapshot }) {
    switch (command?.command_type) {
        case 'supervisor.inventory.batch.adjust':
            return verifyInventory({ command, ack, snapshot });
        case 'supervisor.product.create':
            return verifyProductCreate({ command, snapshot });
        case 'supervisor.product.update':
            return verifyProductUpdate({ command, snapshot });
        case 'supervisor.product.delete':
            return verifyProductDelete({ command, snapshot });
        case 'supervisor.rate.set':
            return verifyRateSet({ command, snapshot });
        case 'supervisor.user.create':
            return verifyUserCreate({ command, snapshot });
        case 'supervisor.user.update':
            return verifyUserUpdate({ command, snapshot });
        case 'supervisor.user.delete':
            return verifyUserDelete({ command, snapshot });
        case 'supervisor.user.pin.change':
            // El eco nunca contiene PINs (SEC-002): jamás un verde falso.
            return result('received', 'El PIN no viaja en el eco; solo la caja puede confirmar este cambio.');
        case 'supervisor.shift.close':
        case 'supervisor.shift.reopen':
            return result('received', 'El eco de la caja no trae el estado de turnos; no se puede verificar automáticamente.');
        default:
            return result('received', 'Este tipo de orden todavía no se puede verificar con el eco de la caja.');
    }
}

/**
 * Evalúa el sello de un comando aplicado contra el eco de la caja.
 *
 * @param {Object} params
 * @param {Object} params.command  Fila de `supervisor_commands` (o equivalente).
 * @param {Object} [params.ack]    ACK del comando (por defecto `command.ack_payload`).
 * @param {Object} [params.snapshot] Eco normalizado: `{ products, users, rateMode, updatedAt }`.
 * @param {number} [params.now]
 * @returns {{ level: 'received'|'verified'|'mismatch', checkedAt: string, detail: string|null, checks: Array }}
 */
export function evaluateCommandVerification({ command, ack = null, snapshot = null, now = Date.now() } = {}) {
    const effectiveAck = ack ?? (command?.ack_payload ? { status: command.status, ack: command.ack_payload } : null);

    if (!isApplied(command, effectiveAck)) {
        return result('received', 'La caja aún no confirma la aplicación de esta orden.', [], now);
    }

    const freshnessAt = freshnessTimestampFor(snapshot, command?.command_type);
    if (!freshnessAt) {
        return result('received', 'Sin eco de la caja disponible para verificar el cambio.', [], now);
    }

    const appliedAt = Date.parse(command?.updated_at || command?.applied_at || '');
    const snapshotAt = Date.parse(freshnessAt);
    const appliedMs = Number.isFinite(appliedAt) ? appliedAt : 0;

    // El eco debe ser POSTERIOR a la aplicación: un eco anterior no prueba nada.
    if (!(snapshotAt > appliedMs)) {
        const withinGrace = now - appliedMs < VERIFICATION_GRACE_MS;
        return result(
            'received',
            withinGrace
                ? 'Dando tiempo al eco de la caja; se verificará en unos segundos.'
                : 'El eco de la caja todavía no refleja el cambio pedido.',
            [],
            now,
        );
    }

    const outcome = verifyByType({ command, ack: effectiveAck, snapshot });
    return { ...outcome, checkedAt: new Date(now).toISOString() };
}

/**
 * Recorre comandos recientes contra el eco y emite el veredicto de cada uno
 * (solo 'verified' y 'mismatch' son registrables; 'received' no es veredicto).
 * Reglas de registro:
 *   - un sello 'verified' confirmado no retrocede ni se re-registra;
 *   - el mismo nivel no se registra dos veces;
 *   - 'mismatch' → 'verified' es una mejora legítima y sí se registra.
 *
 * @returns {Array<{commandId: string, outcome: Object}>} veredictos registrables.
 */
export function verifyCommandsAgainstEcho({
    commands = [],
    snapshot = null,
    recorded = [],
    recentWindowMs = 30 * 60_000,
    now = Date.now(),
    onResult,
} = {}) {
    const outcomes = [];
    const previousLevel = new Map((recorded || []).map(entry => [String(entry?.commandId || ''), entry?.level || null]));
    (commands || []).forEach(command => {
        if (!command?.command_id) return;
        const appliedAt = Date.parse(command.updated_at || command.created_at || command.issued_at || '');
        if (Number.isFinite(appliedAt) && now - appliedAt > recentWindowMs) return;
        const outcome = evaluateCommandVerification({ command, snapshot, now });
        if (outcome.level !== 'verified' && outcome.level !== 'mismatch') return;
        const previous = previousLevel.get(String(command.command_id));
        if (previous === 'verified' || previous === outcome.level) return;
        outcomes.push({ commandId: String(command.command_id), outcome });
        onResult?.(String(command.command_id), outcome);
    });
    return outcomes;
}

export default {
    VERIFICATION_LEVELS,
    VERIFICATION_GRACE_MS,
    STOCK_EPSILON,
    getVerificationMeta,
    evaluateCommandVerification,
    freshnessTimestampFor,
    verifyCommandsAgainstEcho,
};
