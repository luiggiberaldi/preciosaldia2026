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
| [CASO-004](CASO-004-cobro-pos-estilo-farmacia.md) | Cobro «Procesar Pago» estilo Farmacia y vueltos | 2026-11-14 | Aplicado | Resumen único, COBRAR junto al total, vuelto en opciones de un toque con «Sugerido», F9/Enter, Biopago, referencia de pago, teclado táctil. ERR-009 a 012. |
| [CASO-005](CASO-005-nomina-simple.md) | «Nómina simple» en Gestión | 2026-11-14 | Aplicado | «Clientes» pasa a «Gestión» con sub-pestaña Nómina (solo Administrador): adelantos, pagos, bonos y descuentos que cuadran en el cierre. Gastos internos con candado. Sin los errores E1–E3 de Donde Juancho. |
| [CASO-006](CASO-006-egress-realtime.md) | Egress de Realtime: el supervisor deja de recibir documentos enteros | 2026-11-14 | En curso | Código hecho, sin publicar. Audit log por franjas de 2 h, ventas de hoy en tramos chicos, avisos livianos en vez de filas completas, pestaña oculta suelta Realtime, alarma diaria e informe semanal. P-014 a P-017. |

## Antes de la ley

Los trabajos anteriores al 2026-11-13 están en `docs/plans/` (planes), `docs/reports/` (informes), las auditorías en `docs/auditorias/` y varios `PLAN-*`/`REPORTE-*` de la raíz. No se reconstruyeron como casos.
