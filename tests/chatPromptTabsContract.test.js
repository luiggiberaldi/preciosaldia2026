// tests/chatPromptTabsContract.test.js — El prompt del asistente no puede quedarse atrás
// de las pestañas reales de la app. Si añades o renombras una pestaña, este test falla
// hasta que actualices src/services/chatSystemPrompt.js.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { CHAT_SYSTEM_PROMPT } from '../src/services/chatSystemPrompt';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');

function settingsTabLabels() {
  return read('src/views/SettingsView.jsx')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .map((line) => line.match(/^\s*\{ id: '[a-z]+', label: '([^']+)', icon:/)?.[1])
    .filter(Boolean);
}

function reportsTabLabels() {
  return [...read('src/views/ReportsView.jsx').matchAll(/aria-hidden="true"\/>\s+([^\n<{]+)/g)].map((m) => m[1].trim());
}

function supervisorTabLabels() {
  const source = read('src/views/OwnerMonitorView.jsx');
  const start = source.indexOf('data-testid="supervisor-tabs"');
  const block = source.slice(start, start + 12000);
  return [...block.matchAll(/size=\{17\}[^\n]*\/>\s*<span>([^<]+)<\/span>/g)].map((m) => m[1].trim());
}

describe('contrato prompt ↔ pestañas reales', () => {
  it('Configuración: todas las pestañas visibles están en el prompt', () => {
    const labels = settingsTabLabels();
    expect(labels.length).toBeGreaterThanOrEqual(5);
    for (const label of labels) expect(CHAT_SYSTEM_PROMPT, `Configuración -> ${label}`).toContain(label);
  });

  it('Reportes: todas las pestañas están en el prompt', () => {
    const labels = reportsTabLabels();
    expect(labels.length).toBeGreaterThanOrEqual(5);
    for (const label of labels) expect(CHAT_SYSTEM_PROMPT, `Reportes -> ${label}`).toContain(label);
  });

  it('Monitor del Supervisor: todas las pestañas están en el prompt', () => {
    const labels = supervisorTabLabels();
    expect(labels.length).toBeGreaterThanOrEqual(6);
    for (const label of labels) expect(CHAT_SYSTEM_PROMPT, `Supervisor -> ${label}`).toContain(label);
  });
});
