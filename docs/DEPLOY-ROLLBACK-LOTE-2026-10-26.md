# Checklist de Deploy y Rollback — Lote 2026-10-26 (parque de cajas)

> **Alcance:** los 7 commits verificados del 2026-10-26 (base `8674524` → `533291e`).
> **Estado:** commits locales en `main`, **aún sin push**. Suite verificada: 1867 tests verdes (171 archivos) + ESLint + tsc.
> **Compañero de este documento:** [ROLLBACK-STABLE-BASELINE.md](ROLLBACK-STABLE-BASELINE.md) (línea base anterior) y [BACKUP-RESTORE.md](BACKUP-RESTORE.md) (respaldos).

---

## 1. Qué contiene el lote

| # | Commit | Cambio | Lo que nota la caja |
|---|--------|--------|---------------------|
| 1 | `8fb3699` | `test(sync)` adaptaciones | nada |
| 2 | `3909c82` | `test(sync)` guardrail | nada |
| 3 | `1da548e` | `fix(sync)` regresión Fase 5 | la baja de producto **sí llega al monitor**; retiro del doc legacy de ventas |
| 4 | `506c6a5` | `fix(checkout)` exactBs | 1000 Bs al 10% **cobra 1100** (antes descontaba ~2.6 Bs) |
| 5 | `2e95c27` | `perf(caja)` journal parcial | lotes de inventario sin jank (10.1 M → 2.7 M chars) |
| 6 | `e4d0feb` | `fix(supervisor)` badge | el rechazo de la caja resuelve el badge en **segundos**, no en el TTL |
| 7 | `533291e` | `test(e2e)` | nada (spec + mock) |

**Ningún commit escribe ni reescribe datos de clientes** (ventas, productos, clientes). Ver §5 para la garantía de rollback.

---

## 2. Prerrequisitos ANTES de tocar una caja

### 2.1 Migraciones de base (Sync Cloud `sodgzkablshladvbtnes`)

- [ ] Ejecutar [scripts/verificar-migraciones-produccion.sql](../scripts/verificar-migraciones-produccion.sql) en el SQL Editor y **confirmar 0 filas `FALTA`**. Sin esto no deployar.
- [ ] **Crítico del lote:** la policy `device_delete_own_sync_doc` (migración `20261024_sync_documents_device_delete_policy.sql`) debe dar `OK`. Sin ella, el retiro del doc legacy de ventas queda filtrado por RLS y se reintenta cada 24 h sin completarse (no rompe nada, pero el objetivo del commit 3 no se cumple).
- [ ] `20261022` (trigger user/shift) y `20261023` (expected stock negativo) deben dar `OK` — sin anotación de estado en el repo, verificar con la Sección 7 del script (marcadores de versión viva).
- [ ] **No revertir migraciones en un rollback**: son aditivas e idempotentes y el código anterior funciona con ellas. La única pendiente por diseño son los 2 drafts (`20261013_prod_pairing_token_owner_proof`, `20261017_rebind_license_to_unique_device_id`), que no son prerequisito de este lote.

### 2.2 Código y build

- [ ] `git push` de los 7 commits (verificar antes que `git log --oneline -7` muestra `8fb3699..533291e`).
- [ ] Confirmar **qué rama trackea Vercel** hoy (proyecto `preciosaldia2026`; históricamente `m5-supervisor-canary` según AGENT.md §9). Los commits están en `main`: alinear la rama de deploy sin mezclar trabajo ajeno.
- [ ] `npx vitest run` → 0 fallos (1867 tests).
- [ ] `bun run build` → `dist/` limpio (Vite + PWA service worker).

### 2.3 Respaldo por caja

- [ ] Confirmar que la **última copia automática a `cloud_backups`** de cada caja piloto/afectada es reciente (el backup automático ya está en el producto; ver [BACKUP-RESTORE.md](BACKUP-RESTORE.md)).
- [ ] Opcional pero recomendado: exportar respaldo manual desde la caja piloto antes de actualizar.

---

## 3. Deploy por oleadas (no todo el parque a la vez)

### Oleada 0 — Piloto (1 caja + su monitor, 24–48 h)

- [ ] Desplegar el build nuevo (Vercel) y **forzar la actualización del service worker** en la caja piloto: recargar hasta que el SW nuevo tome control (o reinstalar el APK si es Android/Capacitor). Confirmar que la versión cargada es la nueva antes de validar.
- [ ] **Prueba funcional por commit:**
  - [ ] Commit 4: avanzar 1000 Bs con recargo 10% → cobra **1100.00** exactos.
  - [ ] Commit 3: crear producto en el monitor, vender/borrar, y **dar de baja** un producto → el monitor lo pierde en segundos (sin producto fantasma).
  - [ ] Commit 6: enviar una orden que la caja rechace (ej. stock insuficiente) → el badge del monitor pasa de «ESPERANDO» a resuelto **en segundos**.
  - [ ] Commit 5: aplicar un lote de inventario grande (varias decenas de líneas) → sin congelamiento de la UI de caja.
  - [ ] Retiro del doc legacy: en `sync_documents`, la fila `doc_id = 'bodega_sales_v1'` de la caja piloto desaparece tras el primer push de ventas (y no se crean filas `[]` nuevas).
- [ ] **Monitoreo 24–48 h del piloto** (§4).

### Oleada 1 — resto del parque (por tandas, ej. 25 % → 50 % → 100 %)

- [ ] Repetir la prueba funcional breve (los 4 checks de arriba) en **una caja por tanda**.
- [ ] Entre tandas: revisar §4 sin novedad.

### Flota mixta durante el rollout

- [ ] Esperado y sin acción: cajas nuevas + monitores viejos conviven bien (los payloads de sync no cambian de forma). Un monitor viejo solo no verá las bajas (el fix del commit 3); verá todo lo demás normal.

---

## 4. Monitoreo — qué mirar y dónde

| Qué | Dónde | Señal de alarma |
|-----|-------|-----------------|
| Errores 5xx / 413 de Realtime | Logs del proyecto Supabase | reaparecen eventos 413 (docs > ~1 MB) |
| Tamaño de docs de sync | `sync_documents` (familia `bodega_sales_v1:*`, shards de productos) | un doc vuelve a crecer por encima del presupuesto (~500 KB) |
| Órdenes sin resolver | `supervisor_commands` con `status='pending'` antiguas | acumulación de pendientes > TTL |
| Cobros exactBs | tickets del día | totales Bs que no coinciden con precio fijado × (1+recargo) |
| Jank de caja | reporte de cajeros | congelamientos al aplicar lotes |
| Ecos de sync | monitor | productos que reaparecen tras darse de baja |

---

## 5. Rollback

### 5.1 Cuándo

Cualquiera de estas, sin esperar: totales Bs incorrectos (commit 4), productos fantasma que reaparecen (commit 3), pérdida de datos visible en un ticket/venta, o jank igual o peor que antes (commit 5). El resto (badges lentos, retiro de doc legacy a medias) **no justifica rollback**.

### 5.2 Cómo (código)

- [ ] Opción preferida — revert por commits sin reescribir historial:
  ```bash
  git revert --no-commit 8674524..HEAD
  git commit -m "revert: rollback del lote 2026-10-26 a la base estable 8674524"
  git push origin <rama-deploy>
  ```
  (Si hace falta revert selectivo: `git revert e4d0feb` etc., en orden inverso.)
- [ ] Redesplegar en Vercel y **forzar actualización del SW** en las cajas ya migradas (mismo paso del piloto).
- [ ] Correr `npx vitest run` y `bun run build` antes de publicar el revert.

### 5.3 Qué NO se revierte y por qué es seguro

- **Migraciones de base:** se quedan aplicadas. Son aditivas (columnas, policies, índices) y `CREATE OR REPLACE` de funciones con **la misma firma**; el código anterior funciona contra ellas sin tocar datos.
- **Datos locales de la caja (IndexedDB `BodegaApp` / localStorage):** intactos. El journal de inventario es solo estado operativo local; su merge de recuperación trabaja **por id**, verificado compatible en ambas direcciones: un journal parcial escrito por el código nuevo se recupera bien incluso con el código viejo, y los journals viejos (snapshots completos) los lee el código nuevo. El cache de tamaños del hashing es solo memoria.
- **Nube (`sync_documents`):** lo único nuevo que viaja es la tumba `[]` de buckets vaciados por bajas ya hechas y el borrado del doc legacy. Un código anterior los interpreta correctamente (producto ausente / ventas intactas: el legacy se **borra la fila**, jamás se escribe `[]` sobre ventas).
- **`supervisor_commands`:** estado operativo (cancelaciones/ACKs); no hay datos de negocio que restaurar.
- **Ventas históricas:** el fix de exactBs no recalcula nada; solo cambia cobros futuros.

### 5.4 Verificación post-rollback

- [ ] Los 4 checks funcionales del piloto, con los resultados **del comportamiento anterior** (el avance vuelve a cobrar 1097.40 — eso confirma que el rollback tomó).
- [ ] DevTools → Application → IndexedDB `BodegaApp`: ventas y productos conservan sus registros.
- [ ] El monitor y la caja siguen emparejados (sin re-login ni re-pairing: `pda_device_id` y credenciales no se tocan).

---

## 6. Lote siguiente — Proveedores y facturas en el supervisor (Fases 1 y 2)

Va **después** del lote anterior y en un deploy aparte. Contiene la pestaña **Proveedores** del monitor (estado de cuenta publicado por la caja) y las órdenes remotas `supervisor.supplier.create/update/delete` y `supervisor.invoice.create/update/delete`. Los pagos a proveedores **no** viajan por este canal (Fase 3, sin empezar).

### 6.1 Orden obligatorio

1. [ ] **Migración primero:** aplicar `supabase/migrations/20261026_supervisor_supplier_invoice_commands.sql` en Sync Cloud. Es idempotente y conserva lo de 20261020/20261022 (`v_duration`, `rateMode`).
2. [ ] Re-ejecutar [scripts/verificar-migraciones-produccion.sql](../scripts/verificar-migraciones-produccion.sql): Sección 7 debe decir `OK (20261026 proveedores)` en `create_supervisor_command` y `enforce_supervisor_income_command`, y Sección 8 `OK`.
3. [ ] Variable `VITE_SUPERVISOR_REMOTE_SUPPLIERS_ENABLED=true` en Vercel (sin ella el monitor muestra el estado de cuenta en solo lectura; con `false` es la contención sin tocar código). Las demás capacidades no dependen de ella, salvo `VITE_SUPERVISOR_REMOTE_MUTATIONS_ENABLED=true`, que también la habilita.
4. [ ] Desplegar **cajas y monitores juntos**: una caja vieja responde estas órdenes `failed` con «Tipo de comando no soportado» (sin aplicar nada, no es silencioso), y no publica `bodega_suppliers_v1` ni la familia `bodega_supplier_invoices_v1:<año>`, así que su monitor ve la pestaña vacía.

### 6.2 Prueba funcional (piloto)

- [ ] Abrir **Proveedores** en el monitor → deuda y facturas coinciden con la caja.
- [ ] Alta de proveedor, registro de factura, edición de monto y baja de factura desde el monitor → cada una con «✅ La caja aplicó tu cambio» y reflejada en la caja.
- [ ] Intentar eliminar una factura con pagos → rechazo en segundos con el motivo real; nada cambia en la caja.
- [ ] En `sync_documents`: aparecen `bodega_suppliers_v1` y `bodega_supplier_invoices_v1:<año>`; ninguna fila base `bodega_supplier_invoices_v1`.

### 6.3 Rollback

- Contención: `VITE_SUPERVISOR_REMOTE_SUPPLIERS_ENABLED=false` + redeploy (la pestaña queda en solo lectura).
- Revert de código: igual que §5.2. La migración se queda (aditiva; el código anterior no emite estos tipos). Los docs de proveedores en `sync_documents` quedan como datos inertes para el código anterior.

---

## 7. Pendientes fuera de este lote

- Push de los 7 commits (decisión del dueño).
- Los 2 drafts de `supabase/production-drafts/` siguen sin aplicar por diseño.
- Borrar `tmp-diagnostico-backup.mjs` (script de diagnóstico con ruta local codificada, quedó fuera de los commits).
