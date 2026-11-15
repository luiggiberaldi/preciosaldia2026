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
| P-006 | Ordenar los `PLAN-*`, `REPORTE-*`, `M5-*`, `REBRAND-PLAN` y `CASO-DESCUADRE-*` que siguen en la raíz (moverlos a `docs/plans/` o `docs/reports/`) | Documentación, fase 4 | Pendiente (no se movieron: se citan por nombre en comentarios de `src/` y `tests/`, y se enlazan entre sí) |
| P-007 | Arreglar el tema oscuro en Vender (precios y total casi invisibles, ERR-008) | CASO-003 | Descartado (2026-11-14): no se usará tema oscuro |
| P-008 | Probar Vender con varias categorías y con las fotos reales de los productos | CASO-003 | Pendiente |
| P-009 | Probar el cobro en una laptop táctil real (teclado numérico), la impresora térmica y el ticket PDF con referencia de pago, y el cuadre del cierre con ventas reales de varios días | CASO-004 | Pendiente |
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

---

## Hechos

_(vacío)_
