# Plan de Ejecución Autopilot — Fix Desincronización / Estado Fantasma Caja↔Supervisor

**Fecha:** 2026-10-16 · **Para:** LLM ejecutor (p. ej. Gemini Flash) · **Nivel de detalle:** pegar-ejecutar-verificar
**Derivado de:** [2026-10-16-plan-fix-desincronizacion-estado-fantasma.md](./2026-10-16-plan-fix-desincronizacion-estado-fantasma.md) (fases D1, F1, F2, F3, F4)

---

## 0. PROMPT PARA EL LLM EJECUTOR (pegar esto junto al documento)

> Eres un ejecutor mecánico. Sigue este documento paso por paso EN ORDEN. En cada paso encontrarás bloques `BÚSQUEDA` (texto exacto a localizar en el archivo indicado) y `REEMPLAZO` (texto exacto que debe quedar). NO improvises, NO "mejores" el código, NO agregues imports ni funciones que no estén en este documento. Si un bloque `BÚSQUEDA` no se encuentra exactamente (incluidos espacios y sangría), DETENTE y reporta literalmente: `ANCLA NO ENCONTRADA: <archivo> — <primeras 40 caracteres del bloque>`. No continúes con los pasos siguientes. Después de cada paso ejecuta el comando de `VERIFICACIÓN` y confirma que la salida es la esperada antes de seguir.

## 0.1 Reglas duras (prohibido)

- NO tocar: `src/hooks/useRemoteCommands.js`, `src/hooks/useMonitorSync.js`, `src/services/supervisorInventoryBatchSender.js`, `src/services/supervisorCommandService.js`, `supabase/migrations/**`, `package.json`.
- NO crear migraciones SQL ni modificar políticas RLS.
- NO cambiar firmas de funciones existentes salvo que este documento lo indique explícitamente (solo se AGREGAN exportaciones nuevas).
- NO ejecutar `git commit`, `git push` ni reinstalar dependencias.
- Si un test falla tras tu edición, revierte SOLO el paso actual y reporta el error completo.

## 0.2 Comandos de verificación (referencia rápida)

- Test de un archivo: `npx vitest run <archivo>`
- Suite supervisor completa: `npx vitest run supervisor`
- Tipos: `npx tsc --noEmit -p tsconfig.json` (esperado: sin salida, código 0)
- Lint de lo tocado: `npx eslint <archivos>` (esperado: `0 errors`; warnings pre-existentes OK)

---

## 1. PASO 0 — Lectura previa obligatoria (sin editar nada)

Ejecuta estos 3 comandos y anota los resultados:

```bash
grep -n "ensureDeviceSessionRegistered(deviceId)" src/hooks/useCloudSync.js
grep -n "commitMonitorPairing" src/services/monitorUnpair.js src/components/PairingScanScreen.jsx
grep -n "resetPOSDataToEmpty" src/hooks/useCloudSync.js
```

Resultados esperados en el estado base:
- 1ª línea: **SÍ debe existir** (~línea 357 de `useCloudSync.js`). F1-parcial ya está implementado. **NO lo dupliques.** Si NO existe, detente y reporta.
- 2ª y 3ª: **NO deben existir** (0 coincidencias). Si ya existen, detente y reporta (el fix ya fue aplicado).

---

## 2. PASO 1 — Fase D1: constante de claves críticas (`src/hooks/useCloudSync.js`)

**BÚSQUEDA** (línea exacta):
```js
const LAST_PUSH_HASH_PREFIX = 'bodega_last_periodic_push_hash_';
```

**REEMPLAZO** (la misma línea + bloque nuevo debajo):
```js
const LAST_PUSH_HASH_PREFIX = 'bodega_last_periodic_push_hash_';

// Fase F3: claves del snapshot crítico. `[]` es un estado PUBLICABLE (vacío
// confirmado); `null` (clave ausente) NO se publica. Esa distinción es la que
// permite purgar el estado fantasma desde un POS vacío.
export const EMPTY_SNAPSHOT_KEYS = ['bodega_sales_v1', 'bodega_products_v1', 'bodega_customers_v1', 'bodega_customer_ledger_v1', 'bodega_accounts_v2'];
```

**VERIFICACIÓN:**
```bash
grep -n "EMPTY_SNAPSHOT_KEYS" src/hooks/useCloudSync.js
```
Esperado: 2 líneas (la `const` y su `export` en la misma línea — aparecerá 1 match de definición).

---

## 3. PASO 2 — Fase D1: log de watermark dentro de `_applyFromCloud` (`src/hooks/useCloudSync.js`)

**BÚSQUEDA** (bloque exacto, sangría de 8 espacios):
```js
        if (!isNewerSyncDocument(envelope.updatedAt, previousUpdatedAt)) {
            return false;
        }
```

**REEMPLAZO:**
```js
        if (!isNewerSyncDocument(envelope.updatedAt, previousUpdatedAt)) {
            // Fase D1 (H3): dejar evidencia cuando un doc se descarta por watermark.
            console.info('[CloudSync] Doc omitido por watermark', {
                docId,
                remoto: envelope.updatedAt,
                local: previousUpdatedAt,
            });
            return false;
        }
```

**VERIFICACIÓN:**
```bash
grep -n "Doc omitido por watermark" src/hooks/useCloudSync.js
```
Esperado: 1 línea.

---

## 4. PASO 3 — Fase D1: log de error del pull inicial (`src/hooks/useCloudSync.js`)

**BÚSQUEDA** (línea exacta, sangría de 20 espacios):
```js
                    if (docsError) throw docsError;
```

**REEMPLAZO:**
```js
                    if (docsError) {
                        // Fase D1 (H2): el fallo del pull inicial debe dejar código y motivo.
                        console.error('[CloudSync] Pull inicial falló', {
                            code: docsError.code,
                            message: docsError.message,
                        });
                        throw docsError;
                    }
```

**VERIFICACIÓN:**
```bash
grep -n "Pull inicial falló" src/hooks/useCloudSync.js
```
Esperado: 1 línea.

---

## 5. PASO 4 — Fases D1+F4: diagnóstico del pull + aviso de restauración (`src/hooks/useCloudSync.js`)

**BÚSQUEDA** (bloque exacto — 20 espacios de sangría inicial):
```js
                    if (docs.length > 0) {
                        for (const doc of docs) {
                            // SEC-002: nunca aplicar `abasto-auth-storage` desde la nube.
                            if (doc.doc_id === 'abasto-auth-storage') continue;
                            try {
                                await _applyFromCloud(doc.doc_id, doc.collection, doc.data);
                            } catch (e) {
                                // HOOK-023: try/catch por documento para no abortar el pull completo.
                                console.warn(`[CloudSync] Error aplicando doc ${doc.doc_id}:`, e);
                            }
                        }
                        console.log(`[CloudSync] Pull inicial: ${docs.length} documentos aplicados.`);
                    }
```

**REEMPLAZO:**
```js
                    // Fase D1/F4: ¿el almacén local está vacío? (escenario de estado fantasma)
                    const lfCheck = localforage.createInstance({ name: 'BodegaApp', storeName: 'bodega_app_data' });
                    let localWasEmpty = true;
                    for (const key of EMPTY_SNAPSHOT_KEYS) {
                        const localValue = await lfCheck.getItem(key);
                        if (Array.isArray(localValue) && localValue.length > 0) { localWasEmpty = false; break; }
                    }

                    if (docs.length > 0) {
                        let aplicados = 0;
                        let omitidos = 0;
                        for (const doc of docs) {
                            // SEC-002: nunca aplicar `abasto-auth-storage` desde la nube.
                            if (doc.doc_id === 'abasto-auth-storage') continue;
                            try {
                                const applied = await _applyFromCloud(doc.doc_id, doc.collection, doc.data);
                                if (applied) { aplicados += 1; } else { omitidos += 1; }
                            } catch (e) {
                                // HOOK-023: try/catch por documento para no abortar el pull completo.
                                omitidos += 1;
                                console.warn(`[CloudSync] Error aplicando doc ${doc.doc_id}:`, e);
                            }
                        }
                        // Fase D1: diagnóstico estructurado para distinguir H1/H2/H3 en producción.
                        console.info('[CloudSync] Pull inicial diagnóstico', {
                            deviceId: shortCloudSyncId(deviceId),
                            leidos: docs.length,
                            aplicados,
                            omitidos,
                            localWasEmpty,
                            sesionRegistrada: registration.ok,
                        });
                        if (localWasEmpty && aplicados > 0) {
                            showToast('Se restauró un respaldo previo de este equipo en la nube', 'info');
                            window.dispatchEvent(new CustomEvent('cloud_restore_applied', { detail: { aplicados, omitidos } }));
                        }
                    } else {
                        console.info('[CloudSync] Pull inicial diagnóstico', {
                            deviceId: shortCloudSyncId(deviceId),
                            leidos: 0,
                            aplicados: 0,
                            omitidos: 0,
                            localWasEmpty,
                            sesionRegistrada: registration.ok,
                        });
                    }
```

**VERIFICACIÓN:**
```bash
grep -n "Pull inicial diagnóstico\|localWasEmpty\|cloud_restore_applied" src/hooks/useCloudSync.js
```
Esperado: al menos 5 coincidencias.

---

## 6. PASO 5 — Fase F1: fallo visible SOLO cuando el almacén local está vacío (`src/hooks/useCloudSync.js`)

Primero agrega el import de toasts.

**BÚSQUEDA** (línea exacta):
```js
import { ensureDeviceSessionRegistered } from '../utils/deviceIdentity';
```

**REEMPLAZO:**
```js
import { ensureDeviceSessionRegistered } from '../utils/deviceIdentity';
import { showToast } from '../components/Toast';
```

Luego el manejo visible del fallo.

**BÚSQUEDA** (bloque exacto):
```js
            } catch (err) {
                console.error('[CloudSync] Fallo en inicialización:', err);
                isInitialized.current = false;
            }
```

**REEMPLAZO:**
```js
            } catch (err) {
                console.error('[CloudSync] Fallo en inicialización:', err);
                isInitialized.current = false;
                // Fase F1: el fallo solo es visible para el usuario cuando importa
                // (local vacío = posible estado fantasma). Sin datos locales y sin
                // red no se avisa, para no enojar al POS offline-first en cada arranque.
                try {
                    const lfCheck = localforage.createInstance({ name: 'BodegaApp', storeName: 'bodega_app_data' });
                    let localEmpty = true;
                    for (const key of EMPTY_SNAPSHOT_KEYS) {
                        const localValue = await lfCheck.getItem(key);
                        if (Array.isArray(localValue) && localValue.length > 0) { localEmpty = false; break; }
                    }
                    if (localEmpty) {
                        showToast('No se pudo restaurar el respaldo de este equipo en la nube. Revisa la conexión o vuelve a iniciar sesión.', 'error');
                    }
                } catch { /* sin storage no hay nada que restaurar ni que avisar */ }
            }
```

**VERIFICACIÓN:**
```bash
grep -n "No se pudo restaurar el respaldo" src/hooks/useCloudSync.js
```
Esperado: 1 línea.

---

## 7. PASO 6 — Fase F3: `resetPOSDataToEmpty` (`src/hooks/useCloudSync.js`)

**BÚSQUEDA** (bloque exacto — cierre de `forceSyncAllPOSData`):
```js
        return { ok: true, error: null, pushed };
    } catch (e) {
        console.warn('[CloudSync] Error en sincronización forzada POS:', e);
        return { ok: false, error: e?.message || 'Error de sincronización', pushed: 0 };
    }
};
```

**REEMPLAZO** (el mismo bloque + la función nueva después):
```js
        return { ok: true, error: null, pushed };
    } catch (e) {
        console.warn('[CloudSync] Error en sincronización forzada POS:', e);
        return { ok: false, error: e?.message || 'Error de sincronización', pushed: 0 };
    }
};

/**
 * Fase F3: "Empezar desde cero". Escribe `[]` (vacío CONFIRMADO, publicable) en las
 * claves del snapshot crítico y publica el estado vacío a la nube, para que el
 * monitor deje de ver productos/ventas fantasma. `null` (clave ausente) NO se
 * publica; `[]` sí — esa es la semántica de tombstone. Nota: el ledger es
 * append-only en el receptor, así que en el monitor se fusiona en vez de vaciarse.
 */
export async function resetPOSDataToEmpty({ idbStore, publish } = {}) {
    const lf = idbStore || localforage.createInstance({ name: 'BodegaApp', storeName: 'bodega_app_data' });
    for (const key of EMPTY_SNAPSHOT_KEYS) {
        await lf.setItem(key, []);
    }
    const result = await (publish ? publish() : forceSyncAllPOSData());
    return { ok: result?.ok !== false, keys: EMPTY_SNAPSHOT_KEYS, result: result || null };
}
```

**VERIFICACIÓN:**
```bash
grep -n "resetPOSDataToEmpty" src/hooks/useCloudSync.js
```
Esperado: 2 líneas (comentario/doc + `export async function`).

---

## 8. PASO 7 — Fase F2: `commitMonitorPairing` (`src/services/monitorUnpair.js`)

**BÚSQUEDA** (bloque exacto — cierre de `clearMonitorCache`; OJO: este archivo usa CRLF):
```js
    localStorage.removeItem('pda_paired_device_id');
    localStorage.removeItem('pda_pairing_mode');
    // Este marcador se quita último para poder reanudar si cualquier paso falla.
    localStorage.removeItem(MONITOR_CLEANUP_PENDING_KEY);
}
```

**REEMPLAZO** (el mismo bloque + la función nueva después):
```js
    localStorage.removeItem('pda_paired_device_id');
    localStorage.removeItem('pda_pairing_mode');
    // Este marcador se quita último para poder reanudar si cualquier paso falla.
    localStorage.removeItem(MONITOR_CLEANUP_PENDING_KEY);
}

/**
 * Fase F2: fija un NUEVO vínculo de monitor garantizando que no sobreviva nada de
 * vidas anteriores (rol POS previo u otro vínculo). El orden importa: purgar
 * primero (clearMonitorCache también borra las claves de vínculo) y fijar después,
 * de modo que una purga fallida NUNCA deje un vínculo nuevo sobre datos viejos.
 */
export async function commitMonitorPairing({ idbStore, localStorage, primaryDeviceId }) {
    if (!primaryDeviceId) throw new Error('Falta el dispositivo principal para vincular');
    await clearMonitorCache({ idbStore, localStorage });
    localStorage.setItem('pda_paired_device_id', primaryDeviceId);
    localStorage.setItem('pda_pairing_mode', 'monitor');
}
```

**VERIFICACIÓN:**
```bash
grep -n "commitMonitorPairing" src/services/monitorUnpair.js
```
Esperado: 2 líneas.

---

## 9. PASO 8 — Fase F2: usar `commitMonitorPairing` en el escaneo (`src/components/PairingScanScreen.jsx`)

**BÚSQUEDA** (línea exacta):
```js
import { supabaseCloud } from '../config/supabaseCloud';
```

**REEMPLAZO:**
```js
import { supabaseCloud } from '../config/supabaseCloud';
import localforage from 'localforage';
```

**BÚSQUEDA** (línea exacta):
```js
import { ensureSupervisorSession } from '../services/supervisorAuth';
```

**REEMPLAZO:**
```js
import { ensureSupervisorSession } from '../services/supervisorAuth';
import { commitMonitorPairing } from '../services/monitorUnpair';
```

**BÚSQUEDA** (bloque exacto):
```js
                localStorage.setItem('pda_paired_device_id', data.primary_device_id);
                localStorage.setItem('pda_pairing_mode', 'monitor');
```

**REEMPLAZO:**
```js
                // Fase F2: purgar cualquier estado heredado ANTES de fijar el nuevo
                // vínculo. Si la purga falla, no se fija nada y el usuario puede reintentar.
                await commitMonitorPairing({
                    idbStore: localforage.createInstance({ name: 'BodegaApp', storeName: 'bodega_app_data' }),
                    localStorage,
                    primaryDeviceId: data.primary_device_id,
                });
```

**VERIFICACIÓN:**
```bash
grep -n "commitMonitorPairing\|pda_paired_device_id" src/components/PairingScanScreen.jsx
```
Esperado: la llamada a `commitMonitorPairing` presente y **ningún** `localStorage.setItem('pda_paired_device_id'` directo.

---

## 10. PASO 9 — Tests NUEVOS (crear los 3 archivos tal cual)

### 10.1 `tests/cloudSyncRehydrate.test.js` (crear)

```js
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../src/hooks/useCloudSync.js', import.meta.url), 'utf8');

describe('CloudSync — hidratación confiable (D1/F1/F4)', () => {
    it('registra la sesión del dispositivo ANTES de consultar sync_documents', () => {
        const registro = source.indexOf('ensureDeviceSessionRegistered(deviceId)');
        const pull = source.indexOf("from('sync_documents')");
        expect(registro).toBeGreaterThan(-1);
        expect(pull).toBeGreaterThan(-1);
        expect(registro).toBeLessThan(pull);
    });

    it('deja diagnóstico estructurado del pull inicial (D1)', () => {
        expect(source).toContain(`'[CloudSync] Pull inicial diagnóstico'`);
        expect(source).toContain(`'[CloudSync] Doc omitido por watermark'`);
        expect(source).toContain(`'[CloudSync] Pull inicial falló'`);
    });

    it('avisa restauración/fallo cuando el almacén local está vacío (F1/F4)', () => {
        expect(source).toContain('localWasEmpty');
        expect(source).toContain('Se restauró un respaldo previo de este equipo en la nube');
        expect(source).toContain('No se pudo restaurar el respaldo de este equipo en la nube');
    });

    it('expone la semántica de vacío publicable (F3)', () => {
        expect(source).toContain('export const EMPTY_SNAPSHOT_KEYS');
        expect(source).toContain('export async function resetPOSDataToEmpty');
    });
});
```

### 10.2 `tests/cloudSyncEmptySnapshot.test.js` (crear)

```js
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { EMPTY_SNAPSHOT_KEYS, resetPOSDataToEmpty } from '../src/hooks/useCloudSync';

function createFakeIdb(initial = {}) {
    const entries = new Map(Object.entries(initial));
    return {
        entries,
        getItem: vi.fn(async (key) => (entries.has(key) ? entries.get(key) : null)),
        setItem: vi.fn(async (key, value) => { entries.set(key, value); }),
    };
}

describe('resetPOSDataToEmpty (F3: snapshot vacío publicable)', () => {
    it('escribe [] en las claves críticas y publica el estado vacío', async () => {
        const idbStore = createFakeIdb({ bodega_products_v1: [{ id: 'fantasma' }] });
        const publish = vi.fn(async () => ({ ok: true }));

        const result = await resetPOSDataToEmpty({ idbStore, publish });

        expect(result.ok).toBe(true);
        for (const key of EMPTY_SNAPSHOT_KEYS) {
            expect(idbStore.entries.get(key)).toEqual([]);
        }
        expect(publish).toHaveBeenCalledTimes(1);
    });

    it('reporta fallo de publicación sin lanzar excepción', async () => {
        const idbStore = createFakeIdb();
        const publish = vi.fn(async () => ({ ok: false, error: 'La sincronización no está activa' }));

        const result = await resetPOSDataToEmpty({ idbStore, publish });

        expect(result.ok).toBe(false);
        expect(result.result?.error).toMatch(/sincronización/i);
    });

    it('no publica claves ausentes como vacío: solo las claves del snapshot crítico', async () => {
        const idbStore = createFakeIdb();
        const publish = vi.fn(async () => ({ ok: true }));

        await resetPOSDataToEmpty({ idbStore, publish });

        expect(EMPTY_SNAPSHOT_KEYS).toEqual([
            'bodega_sales_v1',
            'bodega_products_v1',
            'bodega_customers_v1',
            'bodega_customer_ledger_v1',
            'bodega_accounts_v2',
        ]);
        expect(idbStore.entries.size).toBe(EMPTY_SNAPSHOT_KEYS.length);
    });
});
```

### 10.3 `tests/monitorUnpair.test.js` (EDITAR — dos cambios)

**Cambio A — imports. BÚSQUEDA:**
```js
import {
    clearMonitorCache,
    MONITOR_CLEANUP_PENDING_KEY,
    isPairingRevocationConfirmed,
    revokeAndClearMonitor,
} from '../src/services/monitorUnpair.js';
```

**REEMPLAZO:**
```js
import {
    clearMonitorCache,
    commitMonitorPairing,
    MONITOR_CLEANUP_PENDING_KEY,
    isPairingRevocationConfirmed,
    revokeAndClearMonitor,
} from '../src/services/monitorUnpair.js';
```

**Cambio B — al FINAL del archivo, AGREGAR** (no reemplazar nada):

```js

describe('commitMonitorPairing (F2: purga al re-vincular)', () => {
    it('purga la caché heredada ANTES de fijar el nuevo vínculo', async () => {
        const syncKey = SUPERVISOR_SYNC_KEYS[0];
        const idbStore = createStore([[syncKey, [{ id: 'heredado' }]]]);
        const localStorage = createLocalStorage([
            ['pda_paired_device_id', 'primary-viejo'],
            ['pda_pairing_mode', 'monitor'],
            [getSyncMetadataKey(syncKey), '2026-08-01T00:00:00Z'],
        ]);

        await commitMonitorPairing({ idbStore, localStorage, primaryDeviceId: 'primary-nuevo' });

        expect(idbStore.entries.has(syncKey)).toBe(false);
        expect(localStorage.getItem('pda_paired_device_id')).toBe('primary-nuevo');
        expect(localStorage.getItem('pda_pairing_mode')).toBe('monitor');
        expect(localStorage.getItem(getSyncMetadataKey(syncKey))).toBeNull();
    });

    it('si la purga falla, NO se fija el vínculo nuevo (rollback de identidad)', async () => {
        const idbStore = createStore([['bodega_products_v1', [{ id: 'x' }]]], { failRemove: 'bodega_products_v1' });
        const localStorage = createLocalStorage();

        await expect(commitMonitorPairing({ idbStore, localStorage, primaryDeviceId: 'primary-nuevo' }))
            .rejects.toThrow();

        expect(localStorage.getItem('pda_paired_device_id')).toBeNull();
        expect(localStorage.getItem('pda_pairing_mode')).toBeNull();
    });

    it('rechaza fijar un vínculo sin dispositivo principal', async () => {
        const localStorage = createLocalStorage();
        await expect(commitMonitorPairing({ idbStore: createStore(), localStorage, primaryDeviceId: '' }))
            .rejects.toThrow(/dispositivo principal/i);
        expect(localStorage.getItem('pda_paired_device_id')).toBeNull();
    });
});
```

> Nota: `createStore`, `createLocalStorage`, `SUPERVISOR_SYNC_KEYS` y `getSyncMetadataKey` ya existen en ese archivo. NO los redefinas.

---

## 11. PASO 10 — Fase F4: botón "Empezar desde cero" (`src/components/Settings/tabs/SettingsTabSistema.jsx`)

Este paso es de UI; si el paso falla o el archivo cambió mucho, OMÍTELO y repórtalo — los pasos 1-9 ya son el fix completo.

**BÚSQUEDA** (línea exacta — antes del bloque de error):
```jsx
                {lastError && (
```

**REEMPLAZO** (bloque nuevo + la línea original):
```jsx
                    <button
                        onClick={async () => {
                            const ok = window.confirm('Se descartarán productos, ventas y clientes de ESTE equipo y se publicará un respaldo vacío en la nube. ¿Continuar?');
                            if (!ok) return;
                            try {
                                const result = await resetPOSDataToEmpty();
                                showToast(
                                    result.ok
                                        ? 'Equipo reiniciado: la nube quedó con estado vacío'
                                        : `No se pudo publicar el estado vacío: ${result.result?.error || 'error desconocido'}`,
                                    result.ok ? 'success' : 'error',
                                );
                            } catch (error) {
                                showToast(error?.message || 'No se pudieron reiniciar los datos', 'error');
                            }
                        }}
                        className="w-full flex items-center gap-3 p-3 bg-rose-50 dark:bg-rose-900/20 border border-rose-100 dark:border-rose-800/40 rounded-xl hover:bg-rose-100 dark:hover:bg-rose-900/30 transition-colors group active:scale-[0.98]"
                    >
                        <div className="p-2 bg-rose-100 dark:bg-rose-900/40 rounded-lg"><AlertTriangle size={18} className="text-rose-500" /></div>
                        <div className="text-left flex-1">
                            <p className="text-sm font-bold text-rose-700 dark:text-rose-300">Empezar desde cero</p>
                            <p className="text-xs text-rose-500 dark:text-rose-400">Vacía este equipo y publica el vacío en la nube</p>
                        </div>
                        <ChevronRight size={16} className="text-slate-300" />
                    </button>

                {lastError && (
```

Además agrega el import (busca cualquier bloque de imports al inicio y añade esta línea):
```js
import { resetPOSDataToEmpty } from '../../../hooks/useCloudSync';
```

(`showToast`, `AlertTriangle` y `ChevronRight` ya se usan en ese archivo; NO los reimportes.)

**VERIFICACIÓN:**
```bash
grep -n "resetPOSDataToEmpty\|Empezar desde cero" src/components/Settings/tabs/SettingsTabSistema.jsx
```
Esperado: 2+ líneas.

---

## 12. VERIFICACIÓN GLOBAL FINAL (obligatoria)

```bash
npx vitest run tests/cloudSyncRehydrate.test.js tests/cloudSyncEmptySnapshot.test.js tests/monitorUnpair.test.js
```
Esperado: `3 passed` / todos los tests en verde.

```bash
npx vitest run supervisor
```
Esperado: todos los archivos en verde (no debe haber regresiones).

```bash
npx tsc --noEmit -p tsconfig.json
```
Esperado: sin errores (salida vacía, código 0).

```bash
npx eslint src/hooks/useCloudSync.js src/services/monitorUnpair.js src/components/PairingScanScreen.jsx src/components/Settings/tabs/SettingsTabSistema.jsx tests/cloudSyncRehydrate.test.js tests/cloudSyncEmptySnapshot.test.js tests/monitorUnpair.test.js
```
Esperado: `0 errors` (warnings pre-existentes tipo `no-unused-vars` sobre JSX son normales en este repo; NO intentes "arreglarlos").

---

## 13. CRITERIOS DE ACEPTACIÓN (checklist final)

- [ ] `grep ensureDeviceSessionRegistered(deviceId) src/hooks/useCloudSync.js` → sigue existiendo UNA sola vez (no se duplicó).
- [ ] `src/components/PairingScanScreen.jsx` ya no hace `setItem('pda_paired_device_id'` directo; pasa por `commitMonitorPairing`.
- [ ] `resetPOSDataToEmpty` existe y sus tests cubren: escribe `[]`, publica, y reporta fallo sin lanzar.
- [ ] El pull inicial deja log `Pull inicial diagnóstico` con `leidos/aplicados/omitidos/localWasEmpty/sesionRegistrada`.
- [ ] Con almacén vacío + fallo de red → se muestra el toast `No se pudo restaurar el respaldo…`; con almacén con datos + fallo de red → NO hay toast (solo consola).
- [ ] Suite `supervisor` completa en verde + `tsc` sin errores.

## 14. TROUBLESHOOTING (síntoma → acción)

| Síntoma | Acción |
|---|---|
| `ANCLA NO ENCONTRADA` en cualquier paso | DETENTE. Reporta archivo + bloque. No edites a mano. |
| `localStorage is not defined` en tests | Falta `// @vitest-environment jsdom` en la 1ª línea del test. |
| `showToast is not defined` en useCloudSync | Falta el import del Paso 5. |
| Test de `commitMonitorPairing` falla en "rollback" | Verifica que `commitMonitorPairing` hace `await clearMonitorCache(...)` ANTES de los `setItem`. |
| `tsc` marca error en `registration.ok` | `registration` viene de `ensureDeviceSessionRegistered`; no cambies su forma; el Paso 4 la usa tal cual. |
| La suite `supervisor` muestra fallos ajenos a estos archivos | Reporta los fallos completos; NO modiques archivos fuera del alcance. |

## 15. FUERA DE ALCANCE (recordatorio)

- La Fase F5 (runbook operativo para la instalación afectada) es procedimiento humano, no código: restaurar desde la caja o "Empezar desde cero" + desvincular en el celular.
- El cambio semántico profundo del receptor (merge append-only del ledger en el monitor) NO se toca; por eso el vaciado del ledger en el receptor es por fusión, no por reemplazo.
