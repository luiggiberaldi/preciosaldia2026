/**
 * licensePolicy.js — Política de licencias: ÚNICA fuente de verdad.
 *
 * COPIA MAESTRA. Este archivo debe permanecer BYTE A BYTE idéntico en los dos
 * proyectos que lo consumen:
 *
 *   · POS (preciosaldia-bodega) ...... src/config/licensePolicy.js
 *   · Estación Maestra .............. src/lib/licensePolicy.js
 *
 * La identidad se garantiza con tests: cada proyecto ancla el SHA-256 de este
 * archivo en tests/licensePolicy.test.js y falla si sus copias divergen. Si
 * cambias la política, cámbiala AQUÍ y propaga la copia; los tests te lo
 * recordarán.
 *
 * Por qué existe: la política (tipos, duraciones, días de gracia, elegibilidad
 * de respaldo y precios) estaba escrita DOS VECES, una por proyecto, y las dos
 * divergían — AUDITORIA-LICENCIAS.md LIC-03 (respaldo mensual), LIC-04 (gracia
 * de demos), LIC-06 (precio) y LIC-10 (mensual sin fecha). Una sola regla, un
 * solo lugar, probada por ambos lados.
 *
 * Sin dependencias, sin I/O y sin variables de entorno: debe comportarse igual
 * en el navegador, en Vitest y en Next.js.
 */

// ── Tipos de licencia ────────────────────────────────────────────────────────

/** Todos los valores posibles de `licenses.type`. */
export const LICENSE_TYPES = Object.freeze([
    'permanent',
    'monthly',
    'demo3',
    'demo7',
    'revoked',
    'registered',
]);

/** Tipos de prueba. */
export const DEMO_TYPES = Object.freeze(['demo3', 'demo7']);

/** Tipos de pago: dan acceso completo y respaldo remoto. */
export const PAID_TYPES = Object.freeze(['permanent', 'monthly']);

/** Tipos que nunca dan acceso. */
export const NO_ACCESS_TYPES = Object.freeze(['revoked', 'registered']);

// ── Duraciones ───────────────────────────────────────────────────────────────

/** Días reales que dura cada tipo de demo. */
export const DEMO_DURATION_DAYS = Object.freeze({ demo3: 3, demo7: 7 });

/** Días que cubre un pago mensual (antes de la gracia). */
export const MONTHLY_PERIOD_DAYS = 30;

export const DAY_MS = 24 * 60 * 60 * 1000;

// ── Período de gracia ────────────────────────────────────────────────────────

/**
 * Días de gracia DESPUÉS del vencimiento en los que la licencia sigue viva.
 *
 * Solo la mensual tiene gracia: es el margen que se da al cliente mientras
 * cobra/regula el pago. Las demos se cortan en seco en su vencimiento (LIC-04:
 * la Estación les aplicaba 5 días de gracia y mostraba como activo a un cliente
 * que ya estaba bloqueado en la caja) y la permanente no vence.
 */
export const MONTHLY_GRACE_DAYS = 5;

const GRACE_DAYS_BY_TYPE = Object.freeze({
    permanent: 0,
    monthly: MONTHLY_GRACE_DAYS,
    demo3: 0,
    demo7: 0,
    revoked: 0,
    registered: 0,
});

// ── Respaldo remoto ──────────────────────────────────────────────────────────

/**
 * Tipos con derecho a respaldo remoto automático.
 *
 * Decisión de negocio (2026-10-19): los planes de pago, permanente y mensual,
 * incluyen respaldo remoto. Antes el servidor lo permitía y la caja lo
 * bloqueaba, así que la Estación mandaba solicitudes que nunca se subían.
 */
export const BACKUP_ELIGIBLE_TYPES = Object.freeze(['permanent', 'monthly']);

// ── Precios de venta (USD) ───────────────────────────────────────────────────

/**
 * Precio de venta oficial por producto y plan. Es el único lugar donde vive el
 * precio: los textos de venta y el estimado de ingresos deben derivar de aquí
 * (LIC-06: la UI anunciaba $50 y el dashboard contaba $80).
 */
export const PRODUCT_PRICES = Object.freeze({
    bodega: Object.freeze({ permanent: 100, monthly: 10 }),
    // Pro está pausado; 0 evita inventar ingresos en el dashboard.
    pro: Object.freeze({ permanent: 0, monthly: 0 }),
});

/** Producto comercial por defecto (el POS es siempre 'bodega'). */
export const DEFAULT_PRODUCT_ID = 'bodega';

// ── Predicados de tipo ───────────────────────────────────────────────────────

/**
 * ¿Es un tipo de demostración?
 * @param {string|null|undefined} type
 * @returns {boolean}
 */
export function isDemoType(type) {
    return typeof type === 'string' && type.startsWith('demo');
}

/**
 * ¿Es un tipo de pago (permanente o mensual)?
 * @param {string|null|undefined} type
 * @returns {boolean}
 */
export function isPaidType(type) {
    return PAID_TYPES.includes(type);
}

/**
 * Días nominales de un tipo de demo (3 o 7). 0 si no es demo.
 * @param {string|null|undefined} type
 * @returns {number}
 */
export function demoDurationDays(type) {
    return DEMO_DURATION_DAYS[type] ?? 0;
}

/**
 * Días de gracia que concede un tipo.
 * @param {string|null|undefined} type
 * @returns {number}
 */
export function graceDaysFor(type) {
    return GRACE_DAYS_BY_TYPE[type] ?? 0;
}

/**
 * Milisegundos de gracia que concede un tipo.
 * @param {string|null|undefined} type
 * @returns {number}
 */
export function graceMillisFor(type) {
    return graceDaysFor(type) * DAY_MS;
}

/**
 * Días completos restantes entre `now` y `endMs`. Redondea a la baja: honesto.
 * @param {number} endMs
 * @param {number} [now]
 * @returns {number}
 */
export function remainingDays(endMs, now = Date.now()) {
    if (!Number.isFinite(endMs)) return 0;
    return Math.max(0, Math.floor((endMs - now) / DAY_MS));
}

/**
 * Normaliza un device id igual en ambos proyectos: sin espacios y en
 * mayúsculas. Devuelve null si no tiene entre 8 y 64 caracteres.
 * @param {string|null|undefined} raw
 * @returns {string|null}
 */
export function normalizeDeviceId(raw) {
    const id = typeof raw === 'string' ? raw.replace(/\s+/g, '').toUpperCase() : '';
    return id.length >= 8 && id.length <= 64 ? id : null;
}

// ── Regla única de estado ────────────────────────────────────────────────────

/**
 * @typedef {Object} LicenseState
 * @property {'active'|'expired'|'revoked'|'registered'} status
 * @property {boolean} isPremium   Hay acceso completo a la app.
 * @property {boolean} isDemo      Está en período de prueba.
 * @property {boolean} isGrace     Está vencido pero aún dentro de la gracia.
 * @property {number}  graceDays   Días de gracia que quedan (0 si no aplica).
 * @property {number|null} expiresAtMs  Vencimiento en epoch ms, o null.
 * @property {'ok'|'inactive'|'revoked_type'|'registered_type'|'unknown_type'|
 *            'missing_expiry'|'invalid_expiry'|'expired'} reason
 */

/** Convierte ISO/epoch a epoch ms, o null si no es interpretable. */
function toEpoch(value) {
    if (value == null || value === '') return null;
    const ms = typeof value === 'number' ? value : Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
}

const CLOSED = Object.freeze({
    isPremium: false,
    isDemo: false,
    isGrace: false,
    graceDays: 0,
});

function closed(status, reason, expiresAtMs) {
    return { status, ...CLOSED, expiresAtMs: expiresAtMs ?? null, reason };
}

/**
 * Regla ÚNICA de vida de una licencia: la misma en la caja y en la Estación.
 *
 * Orden de decisión:
 *   1. tipo 'registered' → sin licencia.
 *   2. `is_active` false o tipo 'revoked' → revocada.
 *   3. tipo desconocido → sin acceso (fail-closed).
 *   4. demo: exige vencimiento y se corta EN SECO al llegar.
 *   5. mensual: exige vencimiento (LIC-10: sin fecha no es premium para
 *      siempre) y vive 5 días de gracia.
 *   6. permanente: vive para siempre salvo que traiga vencimiento, que se
 *      respeta sin gracia.
 *
 * @param {{type?: string|null, isActive?: boolean, expiresAt?: string|number|null,
 *          now?: number}} license
 * @returns {LicenseState}
 */
export function resolveLicenseState(license) {
    const type = license?.type ?? null;
    const now = Number.isFinite(license?.now) ? license.now : Date.now();
    const isActive = license?.isActive ?? license?.is_active;
    const rawExpiry = license?.expiresAt ?? license?.expires_at ?? null;
    const hasExpiry = rawExpiry != null && rawExpiry !== '';
    const expiresAtMs = toEpoch(rawExpiry);

    // 1: el tipo "sin licencia" nunca da acceso.
    if (type === 'registered') return closed('registered', 'registered_type', expiresAtMs);

    // 2: un tipo que no existe en el contrato (incluido "sin tipo") es un error
    // de datos → sin acceso.
    if (!LICENSE_TYPES.includes(type)) return closed('registered', 'unknown_type', expiresAtMs);

    // 3: solo `is_active === true` (booleano literal) da acceso: cualquier otro
    // valor se trata como inactiva (fail-closed). El tipo 'revoked' nunca da
    // acceso aunque la fila diga que está activa.
    if (isActive !== true || type === 'revoked') return closed('revoked', 'inactive', expiresAtMs);

    // Un vencimiento presente pero ilegible no puede interpretarse como
    // "sin vencimiento": eso daría acceso indefinido por un dato corrupto.
    if (hasExpiry && expiresAtMs === null) return closed('expired', 'invalid_expiry', null);

    // 4: demos. Sin vencimiento no hay prueba que ofrecer.
    if (isDemoType(type)) {
        if (!hasExpiry) return closed('expired', 'missing_expiry', null);
        if (now >= expiresAtMs) return closed('expired', 'expired', expiresAtMs);
        return { status: 'active', isPremium: true, isDemo: true, isGrace: false, graceDays: 0, expiresAtMs, reason: 'ok' };
    }

    // 5: mensual. Requiere vencimiento y suma la gracia.
    if (type === 'monthly') {
        if (!hasExpiry) return closed('expired', 'missing_expiry', expiresAtMs);
        const graceEnd = expiresAtMs + graceMillisFor(type);
        if (now >= graceEnd) return closed('expired', 'expired', expiresAtMs);
        if (now >= expiresAtMs) {
            return {
                status: 'active',
                isPremium: true,
                isDemo: false,
                isGrace: true,
                graceDays: remainingDays(graceEnd, now),
                expiresAtMs,
                reason: 'ok',
            };
        }
        return { status: 'active', isPremium: true, isDemo: false, isGrace: false, graceDays: 0, expiresAtMs, reason: 'ok' };
    }

    // 6: permanente. Si trae vencimiento, se respeta tal cual.
    if (hasExpiry && now >= expiresAtMs) return closed('expired', 'expired', expiresAtMs);
    return { status: 'active', isPremium: true, isDemo: false, isGrace: false, graceDays: 0, expiresAtMs, reason: 'ok' };
}

/**
 * ¿Tiene derecho a respaldo remoto? La respuesta es: licencia viva + tipo de
 * pago. Así los planes de pago se tratan igual en ambos proyectos.
 *
 * @param {{type?: string|null, isActive?: boolean, expiresAt?: string|number|null}} license
 * @param {number} [now]
 * @returns {{allowed: boolean, reason: string}}
 */
export function evaluateBackupEligibility(license, now = Date.now()) {
    const state = resolveLicenseState({ ...license, now });
    if (state.status !== 'active') return { allowed: false, reason: state.reason };
    if (!BACKUP_ELIGIBLE_TYPES.includes(license?.type)) return { allowed: false, reason: 'not_eligible' };
    return { allowed: true, reason: 'eligible' };
}

/**
 * Precio de venta en USD de un plan; 0 si el producto/plan no existe.
 * @param {string|null|undefined} productId
 * @param {'permanent'|'monthly'} plan
 * @returns {number}
 */
export function productPrice(productId, plan) {
    const prices = PRODUCT_PRICES[productId];
    return prices?.[plan] ?? 0;
}
