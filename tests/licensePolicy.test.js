// tests/licensePolicy.test.js
//
// Paridad de la política de licencias entre el POS y la Estación Maestra.
//
// Este archivo es una COPIA IDÉNTICA en ambos proyectos. Lo que garantiza que
// los dos lados apliquen exactamente la misma política es doble:
//
//   1. El SHA-256 de `licensePolicy.js` está anclado aquí abajo: si alguien
//      edita una copia sin propagarla, el test de ese proyecto falla.
//   2. Se buscan todas las copias del módulo en los checkouts vecinos y se
//      exige que sean byte a byte iguales.
//
// Además se prueban las reglas de negocio una sola vez, contra la copia local:
// tipos, duraciones, gracia, elegibilidad de respaldo y precios.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

// SHA-256 de src/config/licensePolicy.js. Si cambias la política, actualiza
// este valor en AMBOS proyectos y propaga la copia del archivo.
const EXPECTED_POLICY_SHA256 = 'a41a78cac5f688a8a3ee1b9f82cf2e823c71a473229fe7b293202ab2048fcba2';

// Rutas relativas donde vive el módulo según el proyecto (POS y Estación).
const POLICY_CANDIDATES = [
    'src/config/licensePolicy.js',
    'src/lib/licensePolicy.js',
];

function findLocalPolicyPath() {
    const hit = POLICY_CANDIDATES.map((rel) => resolve(process.cwd(), rel)).find(existsSync);
    if (!hit) {
        throw new Error(`No se encontró licensePolicy.js. Probé: ${POLICY_CANDIDATES.join(', ')}`);
    }
    return hit;
}

// Copias del módulo en el propio checkout y en los hermanos del directorio padre.
function findPolicyCopies() {
    const local = findLocalPolicyPath();
    const found = [local];
    const parent = resolve(process.cwd(), '..');
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        for (const rel of POLICY_CANDIDATES) {
            const candidate = resolve(parent, entry.name, rel);
            if (candidate !== local && existsSync(candidate)) found.push(candidate);
        }
    }
    return found;
}

const POLICY_PATH = findLocalPolicyPath();
const POLICY_SOURCE = readFileSync(POLICY_PATH, 'utf8');
const policy = await import(pathToFileURL(POLICY_PATH).href);

const {
    LICENSE_TYPES,
    DEMO_TYPES,
    PAID_TYPES,
    NO_ACCESS_TYPES,
    DEMO_DURATION_DAYS,
    MONTHLY_PERIOD_DAYS,
    DAY_MS,
    MONTHLY_GRACE_DAYS,
    BACKUP_ELIGIBLE_TYPES,
    PRODUCT_PRICES,
    DEFAULT_PRODUCT_ID,
    isDemoType,
    isPaidType,
    demoDurationDays,
    graceDaysFor,
    graceMillisFor,
    remainingDays,
    normalizeDeviceId,
    resolveLicenseState,
    evaluateBackupEligibility,
    productPrice,
} = policy;

const DAY = DAY_MS;
const NOW = Date.parse('2026-10-19T12:00:00.000Z');
const iso = (ms) => new Date(ms).toISOString();

describe('identidad de la política entre proyectos', () => {
    it('el módulo local coincide con el SHA-256 anclado', async () => {
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(POLICY_SOURCE));
        const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
        expect(hex).toBe(EXPECTED_POLICY_SHA256);
    });

    it('todas las copias del módulo en los checkouts vecinos son byte a byte iguales', () => {
        const copies = findPolicyCopies();
        for (const copy of copies) {
            expect(readFileSync(copy, 'utf8'), `la copia ${copy} divergió`).toBe(POLICY_SOURCE);
        }
    });
});

describe('tipos, duraciones y gracia', () => {
    it('declara exactamente los tipos del contrato', () => {
        expect([...LICENSE_TYPES]).toEqual(['permanent', 'monthly', 'demo3', 'demo7', 'revoked', 'registered']);
        expect([...DEMO_TYPES]).toEqual(['demo3', 'demo7']);
        expect([...PAID_TYPES]).toEqual(['permanent', 'monthly']);
        expect([...NO_ACCESS_TYPES]).toEqual(['revoked', 'registered']);
    });

    it('las demos duran 3 y 7 días reales', () => {
        expect(DEMO_DURATION_DAYS).toEqual({ demo3: 3, demo7: 7 });
        expect(demoDurationDays('demo3')).toBe(3);
        expect(demoDurationDays('demo7')).toBe(7);
        expect(demoDurationDays('permanent')).toBe(0);
    });

    it('el pago mensual cubre 30 días', () => {
        expect(MONTHLY_PERIOD_DAYS).toBe(30);
        expect(DAY).toBe(86_400_000);
    });

    it('solo la mensual tiene gracia (5 días); demos y permanente, ninguna', () => {
        expect(MONTHLY_GRACE_DAYS).toBe(5);
        expect(graceDaysFor('monthly')).toBe(5);
        expect(graceMillisFor('monthly')).toBe(5 * DAY);
        for (const type of ['permanent', 'demo3', 'demo7', 'revoked', 'registered']) {
            expect(graceDaysFor(type), `${type} no debe tener gracia`).toBe(0);
        }
    });

    it('los días restantes redondean a la baja, sin inflar', () => {
        expect(remainingDays(NOW + 3 * DAY + 5 * 60 * 1000, NOW)).toBe(3);
        expect(remainingDays(NOW + 3 * DAY, NOW)).toBe(3);
        expect(remainingDays(NOW + 5 * 60 * 1000, NOW)).toBe(0);
        expect(remainingDays(NOW - DAY, NOW)).toBe(0);
        expect(remainingDays(Number.NaN, NOW)).toBe(0);
    });

    it('isDemoType / isPaidType cubren el contrato entero', () => {
        expect(LICENSE_TYPES.filter(isDemoType)).toEqual(['demo3', 'demo7']);
        expect(LICENSE_TYPES.filter(isPaidType)).toEqual(['permanent', 'monthly']);
        expect(isDemoType(undefined)).toBe(false);
        expect(isPaidType(null)).toBe(false);
    });

    it('normalizeDeviceId aplica la misma regla en ambos lados', () => {
        expect(normalizeDeviceId('  pda device 01  ')).toBe('PDADEVICE01');
        expect(normalizeDeviceId('1234567')).toBeNull();
        expect(normalizeDeviceId('12345678')).toBe('12345678');
        expect(normalizeDeviceId('a'.repeat(64))).toBe('A'.repeat(64));
        expect(normalizeDeviceId('a'.repeat(65))).toBeNull();
    });
});

describe('resolveLicenseState · regla única de vida', () => {
    it('permanente activa sin vencimiento vive para siempre', () => {
        expect(resolveLicenseState({ type: 'permanent', isActive: true, expiresAt: null, now: NOW }))
            .toMatchObject({ status: 'active', isPremium: true, isDemo: false, isGrace: false, reason: 'ok' });
    });

    it('permanente inactiva está revocada', () => {
        expect(resolveLicenseState({ type: 'permanent', isActive: false, expiresAt: null, now: NOW }))
            .toMatchObject({ status: 'revoked', isPremium: false, reason: 'inactive' });
    });

    it('sin is_active explícitamente true no hay acceso (fail-closed)', () => {
        for (const isActive of [undefined, null, false, 'true', 1]) {
            expect(resolveLicenseState({ type: 'permanent', isActive, expiresAt: null, now: NOW }),
                `isActive=${String(isActive)}`)
                .toMatchObject({ status: 'revoked', isPremium: false, reason: 'inactive' });
        }
    });

    it('permanente con vencimiento futuro sigue viva', () => {
        expect(resolveLicenseState({ type: 'permanent', isActive: true, expiresAt: iso(NOW + DAY), now: NOW }))
            .toMatchObject({ status: 'active', isPremium: true });
    });

    it('permanente con vencimiento pasado se corta sin gracia', () => {
        expect(resolveLicenseState({ type: 'permanent', isActive: true, expiresAt: iso(NOW - 1), now: NOW }))
            .toMatchObject({ status: 'expired', isPremium: false, reason: 'expired' });
    });

    it('mensual activa con vencimiento futuro no está en gracia', () => {
        expect(resolveLicenseState({ type: 'monthly', isActive: true, expiresAt: iso(NOW + DAY), now: NOW }))
            .toMatchObject({ status: 'active', isPremium: true, isGrace: false, graceDays: 0 });
    });

    it('mensual vencida hace 2 días sigue viva en gracia, con 3 días por delante', () => {
        expect(resolveLicenseState({ type: 'monthly', isActive: true, expiresAt: iso(NOW - 2 * DAY), now: NOW }))
            .toMatchObject({ status: 'active', isPremium: true, isGrace: true, graceDays: 3 });
    });

    it('mensual vencida hace 4 días y 23 horas sigue en gracia con 0 días por delante', () => {
        const expiresAt = NOW - (4 * DAY + 23 * 60 * 60 * 1000);
        expect(resolveLicenseState({ type: 'monthly', isActive: true, expiresAt: iso(expiresAt), now: NOW }))
            .toMatchObject({ status: 'active', isPremium: true, isGrace: true, graceDays: 0 });
    });

    it('mensual se corta al llegar a los 5 días de gracia exactos', () => {
        expect(resolveLicenseState({ type: 'monthly', isActive: true, expiresAt: iso(NOW - 5 * DAY), now: NOW }))
            .toMatchObject({ status: 'expired', isPremium: false, reason: 'expired' });
    });

    it('mensual vencida hace 6 días está muerta', () => {
        expect(resolveLicenseState({ type: 'monthly', isActive: true, expiresAt: iso(NOW - 6 * DAY), now: NOW }))
            .toMatchObject({ status: 'expired', isPremium: false });
    });

    it('mensual sin vencimiento NO es premium para siempre (LIC-10)', () => {
        expect(resolveLicenseState({ type: 'monthly', isActive: true, expiresAt: null, now: NOW }))
            .toMatchObject({ status: 'expired', isPremium: false, reason: 'missing_expiry' });
    });

    it('demo viva da acceso completo como prueba', () => {
        expect(resolveLicenseState({ type: 'demo3', isActive: true, expiresAt: iso(NOW + 2 * DAY), now: NOW }))
            .toMatchObject({ status: 'active', isPremium: true, isDemo: true, isGrace: false });
    });

    it('demo se corta en seco al vencer, sin gracia (LIC-04)', () => {
        expect(resolveLicenseState({ type: 'demo3', isActive: true, expiresAt: iso(NOW - 60_000), now: NOW }))
            .toMatchObject({ status: 'expired', isPremium: false, isDemo: false, isGrace: false, graceDays: 0 });
    });

    it('demo7 tampoco tiene gracia: vencida ayer está muerta', () => {
        expect(resolveLicenseState({ type: 'demo7', isActive: true, expiresAt: iso(NOW - DAY), now: NOW }))
            .toMatchObject({ status: 'expired', isPremium: false });
    });

    it('demo sin vencimiento no da acceso', () => {
        expect(resolveLicenseState({ type: 'demo3', isActive: true, expiresAt: null, now: NOW }))
            .toMatchObject({ status: 'expired', isPremium: false, reason: 'missing_expiry' });
    });

    it('tipo registered nunca da acceso', () => {
        expect(resolveLicenseState({ type: 'registered', isActive: true, expiresAt: null, now: NOW }))
            .toMatchObject({ status: 'registered', isPremium: false, reason: 'registered_type' });
    });

    it('tipo revoked nunca da acceso aunque diga que está activa', () => {
        expect(resolveLicenseState({ type: 'revoked', isActive: true, expiresAt: null, now: NOW }))
            .toMatchObject({ status: 'revoked', isPremium: false, reason: 'inactive' });
    });

    it('un tipo desconocido falla cerrado', () => {
        expect(resolveLicenseState({ type: 'lifetime', isActive: true, expiresAt: null, now: NOW }))
            .toMatchObject({ status: 'registered', isPremium: false, reason: 'unknown_type' });
        expect(resolveLicenseState({ now: NOW }))
            .toMatchObject({ status: 'registered', isPremium: false, reason: 'unknown_type' });
    });

    it('un vencimiento ilegible falla cerrado: no se convierte en "para siempre"', () => {
        expect(resolveLicenseState({ type: 'monthly', isActive: true, expiresAt: 'no-es-fecha', now: NOW }))
            .toMatchObject({ status: 'expired', isPremium: false, reason: 'invalid_expiry' });
        expect(resolveLicenseState({ type: 'permanent', isActive: true, expiresAt: 'no-es-fecha', now: NOW }))
            .toMatchObject({ status: 'expired', isPremium: false, reason: 'invalid_expiry' });
    });

    it('acepta ISO y epoch ms por igual, y is_active en snake_case', () => {
        const isoState = resolveLicenseState({ type: 'monthly', isActive: true, expiresAt: iso(NOW + DAY), now: NOW });
        const epochState = resolveLicenseState({ type: 'monthly', isActive: true, expiresAt: NOW + DAY, now: NOW });
        expect(epochState).toEqual(isoState);

        expect(resolveLicenseState({ type: 'permanent', is_active: true, expires_at: null, now: NOW }))
            .toMatchObject({ status: 'active', isPremium: true });
    });
});

describe('evaluateBackupEligibility · respaldo remoto', () => {
    it('permanente activa tiene respaldo', () => {
        expect(evaluateBackupEligibility({ type: 'permanent', isActive: true, expiresAt: null }, NOW))
            .toEqual({ allowed: true, reason: 'eligible' });
    });

    it('mensual activa tiene respaldo (LIC-03: los planes de pago se tratan igual)', () => {
        expect(evaluateBackupEligibility({ type: 'monthly', isActive: true, expiresAt: iso(NOW + DAY) }, NOW))
            .toEqual({ allowed: true, reason: 'eligible' });
    });

    it('mensual en gracia conserva el respaldo', () => {
        expect(evaluateBackupEligibility({ type: 'monthly', isActive: true, expiresAt: iso(NOW - 2 * DAY) }, NOW))
            .toEqual({ allowed: true, reason: 'eligible' });
    });

    it('mensual ya muerta no tiene respaldo', () => {
        expect(evaluateBackupEligibility({ type: 'monthly', isActive: true, expiresAt: iso(NOW - 6 * DAY) }, NOW))
            .toEqual({ allowed: false, reason: 'expired' });
    });

    it.each(['demo3', 'demo7'])('la demo %s no tiene respaldo remoto', (type) => {
        expect(evaluateBackupEligibility({ type, isActive: true, expiresAt: iso(NOW + DAY) }, NOW))
            .toEqual({ allowed: false, reason: 'not_eligible' });
    });

    it('una licencia inactiva o revocada no tiene respaldo', () => {
        expect(evaluateBackupEligibility({ type: 'permanent', isActive: false, expiresAt: null }, NOW))
            .toEqual({ allowed: false, reason: 'inactive' });
        expect(evaluateBackupEligibility({ type: 'revoked', isActive: true, expiresAt: null }, NOW))
            .toEqual({ allowed: false, reason: 'inactive' });
    });

    it('sin fila de licencia no hay respaldo (fail-closed)', () => {
        expect(evaluateBackupEligibility(null, NOW).allowed).toBe(false);
        expect(evaluateBackupEligibility({}, NOW).allowed).toBe(false);
    });
});

describe('precios de venta', () => {
    it('Lite cuesta $100 permanente y $10 mensual (LIC-06)', () => {
        expect(PRODUCT_PRICES.bodega).toEqual({ permanent: 100, monthly: 10 });
        expect(productPrice('bodega', 'permanent')).toBe(100);
        expect(productPrice('bodega', 'monthly')).toBe(10);
    });

    it('Pro sigue pausado sin precio inventado', () => {
        expect(productPrice('pro', 'permanent')).toBe(0);
        expect(productPrice('pro', 'monthly')).toBe(0);
        expect(productPrice('no-existe', 'permanent')).toBe(0);
    });

    it('el producto por defecto es bodega (Lite)', () => {
        expect(DEFAULT_PRODUCT_ID).toBe('bodega');
    });

    it('el contrato de elegibilidad de respaldo es exactamente los planes de pago', () => {
        expect([...BACKUP_ELIGIBLE_TYPES]).toEqual([...PAID_TYPES]);
    });
});
