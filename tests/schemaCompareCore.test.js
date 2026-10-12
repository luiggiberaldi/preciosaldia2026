import { describe, expect, it } from 'vitest';
import {
    compareSnapshots,
    redactSqlLiterals,
    renderMarkdownReport,
    sanitizeForReport,
    stableSnapshotDigest,
} from '../scripts/schemaCompareCore.mjs';

const makeSnapshot = (overrides = {}) => ({
    server_version: '17.6',
    relations: [{
        name: 'device_pairings',
        kind: 'table',
        columns: [{ name: 'id', type: 'uuid', nullable: false, default: 'gen_random_uuid()' }],
        constraints: [],
        indexes: [],
    }],
    routines: [],
    policies: [],
    triggers: [],
    extensions: [],
    publication: [],
    grants: [],
    enum_types: [],
    ...overrides,
});

describe('schema comparison core', () => {
    it('normalizes order so unordered catalog results compare reproducibly', () => {
        const production = makeSnapshot({
            relations: [
                { name: 'z_table', columns: [], constraints: [], indexes: [] },
                { name: 'a_table', columns: [], constraints: [], indexes: [] },
            ],
        });
        const staging = makeSnapshot({ relations: [...production.relations].reverse() });

        expect(compareSnapshots(production, staging)).toEqual([]);
        expect(stableSnapshotDigest(production)).toBe(stableSnapshotDigest(staging));
    });

    it('compares nested schema arrays such as enum labels, extensions, and relations by stable identity', () => {
        const production = makeSnapshot({
            relations: [
                { name: 'z_table', columns: [], constraints: [], indexes: [] },
                { name: 'a_table', columns: [], constraints: [], indexes: [] },
            ],
            extensions: [{ name: 'uuid-ossp', version: '1.1' }, { name: 'pgcrypto', version: '1.3' }],
            enum_types: [{ name: 'status', labels: ['pending', 'ready', 'done'] }],
        });
        const staging = makeSnapshot({
            relations: [...production.relations].reverse(),
            extensions: [...production.extensions].reverse(),
            enum_types: [{ name: 'status', labels: ['pending', 'ready', 'archived'] }],
        });

        expect(compareSnapshots(production, staging)).toEqual([
            expect.objectContaining({
                path: 'enum_types[status].labels',
                production: ['pending', 'ready', 'done'],
                staging: ['pending', 'ready', 'archived'],
            }),
        ]);
    });

    it('reports relations and columns that are missing or structurally different', () => {
        const production = makeSnapshot({
            relations: [{
                name: 'sync_documents',
                columns: [{ name: 'id', type: 'bigint', nullable: false }],
                constraints: [],
                indexes: [],
            }],
        });
        const staging = makeSnapshot({
            relations: [{
                name: 'sync_documents',
                columns: [{ name: 'id', type: 'uuid', nullable: false }],
                constraints: [],
                indexes: [],
            }, {
                name: 'staging_only', columns: [], constraints: [], indexes: [],
            }],
        });

        expect(compareSnapshots(production, staging)).toEqual(expect.arrayContaining([
            expect.objectContaining({
                path: 'relations[sync_documents].columns[id].type',
                production: 'bigint',
                staging: 'uuid',
            }),
            expect.objectContaining({
                path: 'relations[staging_only]',
                production: undefined,
                staging: expect.objectContaining({ name: 'staging_only' }),
            }),
        ]));
    });

    it('redacts SQL string literals and token-like secrets before output', () => {
        const token = 'eyJabcdefghijklmnop.abcdefghijklmnop.abcdefghijklmno';
        const rawDefault = "'a-private-default-value'::text";
        const raw = `DEFAULT ${rawDefault}; bearer=some-private-token; ${token}`;

        expect(redactSqlLiterals(rawDefault)).not.toContain('a-private-default-value');
        const safe = sanitizeForReport({ default: raw, description: token });
        expect(JSON.stringify(safe)).not.toContain('a-private-default-value');
        expect(JSON.stringify(safe)).not.toContain(token);
        expect(JSON.stringify(safe)).not.toContain('some-private-token');
        expect(sanitizeForReport({ description: 'bearer private' }).description).toBe('[REDACTED]');
        expect(sanitizeForReport({ description: 'token = private' }).description).toBe('[REDACTED]');
    });

    it('reports structural differences in SQL while withholding literal values', () => {
        const production = makeSnapshot({
            relations: [{
                name: 'licenses',
                columns: [{ name: 'secret', type: 'text', default: "'prod-password-is-secret'::text" }],
                constraints: [],
                indexes: [],
            }],
        });
        const staging = makeSnapshot({
            relations: [{
                name: 'licenses',
                columns: [{ name: 'secret', type: 'text', default: "'stage-password-is-secret'::text" }],
                constraints: [],
                indexes: [],
            }],
        });
        const diffs = compareSnapshots(production, staging);

        expect(diffs).toHaveLength(1);
        expect(diffs[0].production).not.toContain('prod-password-is-secret');
        expect(diffs[0].staging).not.toContain('stage-password-is-secret');
        expect(diffs[0].production).toContain('[different]');
        expect(diffs[0].staging).toContain('[different]');
    });

    it('escapes markdown and states schema-only scope in the report', () => {
        const snapshot = makeSnapshot();
        const report = renderMarkdownReport({
            generatedAt: '2026-10-11T00:00:00.000Z',
            production: { name: 'production|name', ref: 'prod-ref', snapshot },
            staging: { name: 'staging', ref: 'stage-ref', snapshot },
            diffs: [],
        });

        expect(report).toContain('production\\|name');
        expect(report).toContain('Comparación de metadatos de esquema únicamente');
        expect(report).toContain('No se detectaron diferencias');
        expect(report).not.toContain('password=');
    });
});
