# Registro de casos de cambio

Un caso es un trabajo grande (varios archivos, visible para el usuario, o que toca dinero, inventario o licencias). Reglas: [LEY-DOCUMENTACION.md](../LEY-DOCUMENTACION.md). Errores: [ERRORES.md](../ERRORES.md). Historia: [bitácora](../../bitacora.md).

## Convención

- **ID:** `CASO-NNN` correlativo de 3 dígitos. Nunca se reutiliza.
- **Archivo:** `CASO-NNN-slug-corto.md`.
- **Estados:** `Propuesto` · `En curso` · `Aplicado` · `Verificado` · `Revertido` · `Descartado`.
- **Fecha:** de registro (AAAA-MM-DD). Si es anterior, "(reconstruido)".
- Un caso = un objetivo. Si un cambio posterior modifica uno anterior, se crea un caso nuevo y se enlaza.
- La fila nueva va al final de la tabla.

## Casos

| ID | Título | Fecha | Estado | Resumen |
|---|---|---|---|---|
| [CASO-001](CASO-001-documentacion-estilo-farmacia.md) | Documentación estilo Farmacia | 2026-11-13 | Aplicado | Ley, errores, casos, pendientes, guardia suave y manual corto. |
| [CASO-002](CASO-002-caja-apertura-y-fondo.md) | Caja: apertura duplicada y fondo real de la gaveta | 2026-11-13 | Aplicado | No abrir dos cajas, fondo real en el cobro y aviso legible de vuelto en Bs. |
| [CASO-003](CASO-003-vender-estilo-farmacia.md) | Vender estilo Farmacia | 2026-11-14 | Aplicado | Fichas uniformes, buscador de 2 modos, cesta compacta, «Vaciar» en la cesta, más vendidos y hora de la tasa. |

## Antes de la ley

Los trabajos anteriores al 2026-11-13 están en `docs/plans/` (planes), `docs/reports/` (informes), las auditorías en `docs/auditorias/` y varios `PLAN-*`/`REPORTE-*` de la raíz. No se reconstruyeron como casos.
