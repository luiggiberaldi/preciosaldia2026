# PENDIENTES — cambios por hacer en Bodega

> **Para el agente:** si te piden "busca los cambios pendientes", empieza aquí. Cada entrada tiene un ID `P-NNN`, un estado y los pasos. Al terminar una: estado `Hecho (fecha)`, enlaza la bitácora y el caso, y muévela a **Hechos**. Nunca borres una entrada.
>
> Existe por la regla 7 de [docs/LEY-DOCUMENTACION.md](docs/LEY-DOCUMENTACION.md): lo que no se decide en el momento se anota aquí con fecha.

## Resumen

| ID | Qué | Origen | Estado |
|---|---|---|---|
| P-001 | Guardar (commit) los cambios de caja, inicio y documentación que están sin commit | Auditoría de apertura y de documentación, 2026-11-13 | Pendiente |
| P-002 | Decidir si el guardia de documentación pasa de "avisa" a "frena" | Documentación, fase 2 | Pendiente (esperar ~2 semanas de uso) |
| P-003 | Decidir si se agrega el límite de 600 líneas por archivo y la revisión de imports | Auditoría de documentación de Farmacia | Pendiente (no es documentación) |
| P-004 | Decidir si se versionan las entregas en la bitácora (hoy `2.0.5`) | Auditoría de documentación de Farmacia | Pendiente |
| P-005 | Recordatorio: la corrección de caja de Bodega debe replicarse en Farmacia | CASO-002 | Pendiente (ya anotada en Farmacia como su P-001) |
| P-006 | Ordenar los `PLAN-*`, `REPORTE-*`, `M5-*`, `REBRAND-PLAN` y `CASO-DESCUADRE-*` que siguen en la raíz (moverlos a `docs/plans/` o `docs/reports/`) | Documentación, fase 4 | Hecho (2026-11-15) · ver Hechos |
| P-007 | Arreglar el tema oscuro en Vender (precios y total casi invisibles, ERR-008) | CASO-003 | Descartado (2026-11-14): no se usará tema oscuro |
| P-008 | Probar Vender con varias categorías y con las fotos reales de los productos | CASO-003 | Pendiente |
| P-009 | Probar el cobro en una laptop táctil real (teclado numérico), la impresora térmica y el ticket PDF con referencia de pago, y el cuadre del cierre con ventas reales de varios días | CASO-004 | Pendiente |
| P-010 | Probar la nómina en el equipo real: recibo en la impresora térmica, PDF enviado por WhatsApp, y el cierre de un día con un adelanto en efectivo y un pago por pago móvil | CASO-005 | Pendiente |
| P-011 | Revisar 3 pruebas de licencias que fallan sin relación con la nómina: `licenseMonitoringMissing` (2; archivo nuevo de otra sesión, aún sin confirmar) y `licensePolicy` (compara contra la copia de otra carpeta del Escritorio) | CASO-005 | Hecho (2026-11-15) · ver Hechos |
| P-012 | Fases opcionales de la nómina: ~~F6 (mercancía del empleado)~~ hecha el 2026-11-15; queda F7 (resumen de solo lectura en el Supervisor) | CASO-005 | F6 hecha · F7 pendiente (el dueño la deja para después de publicar `fix/egress-realtime`) |
| P-013 | Multicaja por red local (LAN): una PC servidor con el stock, los fiados y los turnos de todas las cajas; Supervisor a través del servidor | Plan del 2026-11-14 | Pendiente (falta que el dueño decida P-L1 a P-L7) |
| P-018 | Seguridad: aplicar `20261115_licenses_cerrar_lectura_publica.sql` y `20261115_backup_requests_solo_propias.sql`. Hoy cualquiera con la clave pública lee todas las licencias y lee o borra las solicitudes de respaldo (la segunda resuelve P-016 de la rama `fix/egress-realtime`) | Revisión de licencias, 2026-11-15 | Aplicado (2026-11-15); falta probar en una caja real |
| P-019 | Aplicar `20261106_backup_identity_seed_and_monthly.sql` (verificado en vivo el 2026-11-15 que **no** está aplicada: `has_permanent_backup_license` aún no acepta la mensualidad) **y** recuperar su parte de la caja, que solo existe en `git stash` («pendiente 6-nov: respaldo e identidad de caja», del 13-11): `deviceIdentity.js` siembra la prueba de posesión con `claim_device_session`, más cambios en `useAutoBackup.js` y `cloudBackupUpload.js`. Su cambio en `useLicenseMonitoring.js` ya no hace falta (P-011) | Revisión de licencias, 2026-11-15 | En curso: código de la caja recuperado del stash y migración **aplicada** el 2026-11-15 (bitácora); falta publicar la app y liberar a mano las cajas que ya perdieron la sesión |
| P-020 | Separar «cosméticos» del ID compartido `PDA-V2-333D310E…CB675980` con «bueno y sano». Aviso de cambio de ID puesto el 2026-11-15 para la sesión `8bc85903` (Net Uno) hacia `PDA-V2-87149FBF…CFC294`, con licencia permanente `ACTIV-49CF-C294` ya creada; vence el 2026-11-22. Falta: confirmar `status = 'done'` en `identity_migration_orders`, que el ID nuevo reporte desde Net Uno y que «bueno y sano» siga con `ACTIV-CB67-5980`. Los datos viejos en la nube bajo el ID compartido quedan sin limpiar | Licencias, 2026-11-15 | En curso |
| P-014 | Egress: aplicar en producción las migraciones `20261114_realtime_backup_requests.sql` y `20261114_sync_document_events.sql` **antes** de publicar la rama `fix/egress-realtime`, y verificar caja + supervisor reales (audit log por franjas, ventas de hoy, avisos, pestaña oculta) | CASO-006 | En curso: migraciones aplicadas el 15-nov-2026; falta publicar la rama y verificar en navegador |
| P-015 | Egress: guardar el secreto `SUPABASE_ACCESS_TOKEN` en GitHub (Settings → Secrets and variables → Actions) y llevar `egress-alarm.yml` a `main` para que la alarma corra sola | CASO-006 | Pendiente (solo el dueño) |
| P-016 | Seguridad: `backup_requests` tiene políticas de lectura y borrado `USING (true)` para `anon` (cualquiera con la clave pública ve y borra solicitudes de cualquier equipo). Restringir a filas propias | CASO-006 | Propuesto |
| P-017 | Egress: cuando ya no quede ningún supervisor sin actualizar, quitar `sync_documents` de la publicación de Realtime; y avisar «supervisor abierto en otro equipo» (parte de F3 no hecha) | CASO-006 | Pendiente |

---

## P-001 · Guardar lo pendiente

El árbol de trabajo tiene muchos archivos modificados sin commit (caja, ajustes, usuarios, inicio y la documentación nueva). Hay que guardarlos en commits aparte, por tema. Nadie lo ha hecho aún a propósito: cada commit lo decide el dueño.

- 2026-11-13: **la parte de caja ya se guardó** (commit «fix(caja): …», CASO-002), con el visto bueno del dueño. Siguen sin guardar ajustes, usuarios e inicio.

## P-002 · Guardia en modo "frena"

Hoy `bun run docs:check` solo avisa. Pasarlo a frenar commits solo para lo grave (enlaces rotos, error resuelto sin solución) después de unas 2 semanas de uso limpio. Cambia `githooks/pre-commit` y `ci.yml`.

## P-003 · Controles de código

Farmacia tiene `check-max-lines` (600 líneas) y `check-imports`. Es otra decisión, no de documentación.

## P-004 · Versiones

Farmacia exige que la versión de `package.json` coincida con la bitácora. En Bodega sería un cambio de hábito; decidir con el dueño.

## P-005 · Corrección de caja en Farmacia

La corrección de caja ya existe aquí en Bodega (CASO-002). Farmacia la tiene anotada en su propio `PENDIENTES.md` (P-001); este punto solo recuerda el vínculo.

## P-006 · Archivos sueltos en la raíz

Las auditorías (`AUDITORIA-*`) ya están en `docs/auditorias/`. Quedan en la raíz ~20 planes y reportes. Antes de moverlos hay que actualizar los comentarios de `src/` y `tests/` que los citan por nombre y los enlaces entre planes.

## P-007 · Tema oscuro en Vender

**Descartado (2026-11-14):** el dueño decidió que el sistema no usará tema oscuro. Se deja la nota por si algún día se activa.

ERR-008: en tema oscuro las fichas siguen claras y el precio en $ y el total de la cesta salen en blanco. Ya pasaba antes de CASO-003; Bodega abre en tema claro de fábrica. Propuesta: revisar las clases `dark:` de `CategoryBar.jsx` y `CartPanel.jsx` contra los tokens invertidos de `src/styles/tokens.css` (medio día). Si no se hace: quien active el tema oscuro no podrá leer precios al vender.

## P-008 · Vender con varias categorías y fotos reales

En CASO-003 no se pudo ver en pantalla el caso con varias categorías (los datos de prueba solo tenían «General») ni las fichas con fotos reales (las de prueba fallan y salen iniciales). Probarlo con el inventario real del dueño antes de publicar.

## P-013 · Multicaja por red local (LAN)

Plan completo: [docs/plans/2026-11-14-plan-multicaja-lan.md](docs/plans/2026-11-14-plan-multicaja-lan.md). Es la alternativa por red local al plan de la nube ([2026-11-13-plan-preciosaldia-multicaja.md](docs/plans/2026-11-13-plan-preciosaldia-multicaja.md)).

- **Qué es:** la app de escritorio de una PC hace de servidor (con su propia base) y las demás cajas le piden todo por la red del local. Se puede vender sin internet; la nube queda para respaldos y el Modo Supervisor, que se vincula con el servidor.
- **Por qué no como PWA pura:** el navegador no deja que una página HTTPS hable con `http://192.168.x.x`, y el modo sin internet exige HTTPS. Las cajas serían la app de escritorio o la app Android; la PWA sigue igual para el negocio de una caja.
- **Usuarios actuales:** no cambia nada; todo va detrás del interruptor `modo = 'lan'`.
- **Antes de empezar:** el dueño decide P-L1 a P-L7 (sección 12 del plan), entre ellas solo LAN o LAN + nube, el precio por caja y el certificado de firma del instalador.
- **Tamaño:** unas 11,5 semanas (≈2,5–3 meses) en 8 fases.

## P-018 · Cerrar la lectura pública de licencias y respaldos

Revisión en vivo (solo lectura) del 2026-11-15: no hay licencias borradas ni revocadas sospechosas, pero:

- `licenses` tiene `licenses_device_read` (SELECT, anon, `USING (true)`): se leen las 555 licencias con su `device_id` y su código. Con el `device_id` de un cliente con permanente se puede usar su licencia en otro navegador.
- `backup_requests` tiene lectura, alta y **borrado** abiertos a anon (`USING (true)`).

Las dos migraciones dejan a cada caja solo sus filas (`is_own_device_row`), la misma regla de `sync_documents` y `cloud_backups`. La Estación usa la clave de servicio y no le afecta. Las cajas usan los RPC `get_license_status` y `verify_activation_code`, que no cambian. **Aplicadas el 2026-11-15** con el visto bueno del dueño (bitácora). Antes de aplicar, leer el encabezado de cada migración (efectos conocidos, verificación y reversión). Después, probar en una caja real que abre premium y que un «Solicitar respaldo» de la Estación se completa.

---

## Hechos

### P-006 · Archivos sueltos en la raíz — Hecho (2026-11-15)

Se movieron 26 archivos con `git mv` (el historial se conserva) y **sin cambiarles el nombre**, porque el código y las pruebas los citan por nombre en comentarios: 20 `PLAN-*`, `REBRAND-PLAN` y `HANDOFF-PLAN-CLIENTES-BILLETERA` a `docs/plans/`; los 2 `REPORTE-*`, los 2 `M5-*` y `CASO-DESCUADRE-*` a `docs/reports/`. Se corrigieron 60 enlaces (los que apuntaban a estos archivos y los de dentro de ellos que partían de la raíz), más 2 menciones en `docs/ERRORES.md` y 1 en `AGENT.md`. No quedó ningún enlace roto nuevo. Al unir `fix/egress-realtime` hay que revisar sus enlaces a `REPORTE-CAUSA-RAIZ-EGRESS-Y-SOLUCION.md`.

### P-011 · Pruebas de licencias en rojo — Hecho (2026-11-15)

No eran pruebas rotas: señalaban dos problemas reales. Bitácora del 2026-11-15.

- `licenseMonitoringMissing` (2): la prueba, escrita el 06-11, pedía un arreglo que nunca se hizo. La caja no quitaba el acceso si se **borraba** la fila de licencia en la Estación, ni si una **permanente** traía un vencimiento ya pasado. Arreglado en `src/hooks/useLicenseMonitoring.js`. Para decir «borrada» hacen falta 3 consultas seguidas (`MISSING_LICENSE_LIMIT`, ~6 min) en las que el RPC y el SELECT respondan sin error y vacíos; un fallo de red nunca cuenta.
- `licensePolicy` (1): la copia atrasada era la de **Bodega**. La Estación Maestra (`139e33c`, 31-10) y Farmacia ya tenían la versión con el precio de Farmacia y la gracia configurable. Se copió aquí y se actualizó el SHA anclado. Para Bodega no cambia nada: no pasa `graceDays` y sus precios son los mismos.
- Queda en rojo mientras exista el worktree `pad-egress-realtime` con la copia vieja; se arregla sola al unir `fix/egress-realtime` (esa rama no toca el archivo). El worktree `bodega-licensepolicy-farmacia` (`chore/licensepolicy-farmacia`) ya no hace falta: era este mismo cambio sin guardar.
