// tests/backupCompleteRetired.test.js
//
// Guardia de no-dependencia: el POS NO debe llamar ni referenciar
// `/api/backup/complete` de la Estación Maestra.
//
// Motivo: ese endpoint hacía upsert de `cloud_backups.backup_data` con solo
// metadatos (size_bytes, product_count, sales_count, customer_count) y esa
// columna es donde el POS guarda el payload COMPLETO del respaldo (contrato
// BACKUP-001). Cada llamada sobrescribía y destruía el respaldo real del
// dispositivo. La Estación lo retiró con 410 Gone.
//
// Si algún día vuelven a hacer falta metadatos de respaldo, van en columnas
// propias de `cloud_backups`, nunca dentro de `backup_data`.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { CLOUD_BACKUPS_WRITABLE, buildCloudBackupsRow } from '../src/config/cloudSchema';

const SOURCE_DIR = 'src';
const SOURCE_EXT = /\.(js|jsx|ts|tsx|mjs)$/;

function collectSourceFiles(dir) {
    const out = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) out.push(...collectSourceFiles(full));
        else if (SOURCE_EXT.test(entry)) out.push(full);
    }
    return out;
}

function findRetiredEndpointRefs() {
    return collectSourceFiles(SOURCE_DIR)
        .filter(file => readFileSync(file, 'utf8').includes('backup/complete'));
}

describe('Retiro de /api/backup/complete (Estación Maestra)', () => {
    it('ninguna fuente del POS llama ni referencia /api/backup/complete', () => {
        expect(findRetiredEndpointRefs()).toEqual([]);
    });

    it('backup_data siempre guarda el payload completo, nunca solo metadatos', () => {
        expect([...CLOUD_BACKUPS_WRITABLE]).toEqual(['device_id', 'backup_data', 'updated_at']);

        const payload = { compressed: true, compression: 'gzip', data: 'H4sIAAAAAAAA' };
        const row = buildCloudBackupsRow({ deviceId: 'PDA-DEVICE-01', backupData: payload });

        // El writer no transforma ni resume el payload: lo pasa íntegro.
        expect(row.backup_data).toBe(payload);
    });
});
