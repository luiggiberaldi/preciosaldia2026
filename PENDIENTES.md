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
| P-010 | Probar la nómina en el equipo real: recibo en la impresora térmica, PDF enviado por WhatsApp, y el cierre de un día con un adelanto en efectivo y un pago por pago móvil | CASO-005 | Pendiente |
| P-011 | Revisar 3 pruebas de licencias que fallan sin relación con la nómina: `licenseMonitoringMissing` (2; archivo nuevo de otra sesión, aún sin confirmar) y `licensePolicy` (compara contra la copia de otra carpeta del Escritorio) | CASO-005 | Pendiente |
| P-012 | Fases opcionales de la nómina: F6 (mercancía que se lleva el empleado, descontada del sueldo) y F7 (resumen de solo lectura en el Supervisor) | CASO-005 | Pendiente (el dueño las dejó para después) |
| P-013 | Multicaja por red local (LAN): una PC servidor con el stock, los fiados y los turnos de todas las cajas; Supervisor a través del servidor | Plan del 2026-11-14 | Pendiente (falta que el dueño decida P-L1 a P-L7) |

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

---

## Hechos

_(vacío)_
