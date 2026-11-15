import { describe, it, expect } from 'vitest';
import { daysSinceBackup, describeBackupAge, isBackupStale, backupFileName } from '../src/utils/backupReminder';

const NOW = new Date('2026-11-09T12:00:00Z');

describe('backupReminder', () => {
    it('sin respaldo previo avisa y se considera vencido', () => {
        expect(daysSinceBackup(null, NOW)).toBeNull();
        expect(describeBackupAge(null, NOW)).toMatch(/Aún no/);
        expect(isBackupStale(null, NOW)).toBe(true);
    });
    it('hoy y ayer', () => {
        expect(describeBackupAge('2026-11-09T08:00:00Z', NOW)).toBe('Último respaldo: hoy');
        expect(describeBackupAge('2026-11-08T08:00:00Z', NOW)).toBe('Último respaldo: ayer');
    });
    it('vence a los 7 días', () => {
        expect(isBackupStale('2026-11-03T12:00:00Z', NOW)).toBe(false); // 6 días
        expect(isBackupStale('2026-11-02T12:00:00Z', NOW)).toBe(true);  // 7 días
        expect(describeBackupAge('2026-11-02T12:00:00Z', NOW)).toBe('Último respaldo: hace 7 días');
    });
});

describe('backupFileName', () => {
    it('usa la marca Precios al Día y la fecha local, no la UTC', () => {
        // 14-nov a las 21:15 hora local: en UTC ya sería 15-nov.
        expect(backupFileName(new Date(2026, 10, 14, 21, 15))).toBe('respaldo_preciosaldia_2026-11-14.json');
        expect(backupFileName(new Date(2026, 0, 5, 8, 0))).toBe('respaldo_preciosaldia_2026-01-05.json');
    });
});
