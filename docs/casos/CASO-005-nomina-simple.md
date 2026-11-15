# CASO-005 — «Nómina simple» en Gestión (adelantos, pagos, bonos y descuentos)

**Fecha:** 2026-11-14
**Estado:** Aplicado. Falta la prueba en el equipo real (P-010).
**Estudio y plan:** [AUDITORIA-NOMINA-DONDE-JUANCHO-PARA-BODEGA-2026-11-14.md](../auditorias/AUDITORIA-NOMINA-DONDE-JUANCHO-PARA-BODEGA-2026-11-14.md) y [2026-11-14-plan-nomina-simple-bodega.md](../plans/2026-11-14-plan-nomina-simple-bodega.md).

## Qué pidió el dueño
Añadir a Bodega la nómina que se estudió en Donde Juancho, **corregida** (sin sus errores E1–E3) y **adaptada**. Decisiones D1–D9 (detalle en el plan):
- La frecuencia la elige cada empleado: semanal, quincenal o mensual.
- El sueldo va en $. Se paga en $ o en Bs, con la **tasa de la tienda** del momento. La tasa no se edita.
- Los adelantos los da solo el Administrador. No se paga más que el saldo sin confirmar; la diferencia queda como deuda para el periodo siguiente.
- Solo se anula lo del turno de caja abierto.
- No hay consumo de mercancía ni nada en el Supervisor (quedan para después).
- **La nómina va en la pestaña «Clientes», que pasa a llamarse «Gestión»** (Clientes · Proveedores · Nómina).
- El recibo sale en ticket térmico y en PDF. Los sueldos que ya se pagaron como «Gasto › Personal» se dejan como están.

## Qué se hizo

| Fase | Qué cambia para el dueño | Archivos |
|---|---|---|
| F0 | «Gastos internos» guarda con candado y lectura fresca, así un gasto no pisa una venta hecha al mismo tiempo. Redondea, anota quién lo hizo, pide la caja abierta para gastos en **efectivo** y confirma que quedó guardado. Un gasto de nómina no se anula desde la lista de gastos | `utils/gastoInterno.js` (nuevo), `services/gastosInternosService.js` (nuevo), `hooks/useGastosInternos.js`, `GastosInternos/GastosInternosModal.jsx` |
| F1 | Nada visible: el modelo puro (periodos en hora de Caracas, sueldo congelado, saldo calculado, arrastre de deuda, contrato único de datos) | `utils/payrollModel.js` (nuevo) |
| F2 | Nada visible: el servicio que guarda (empleados, movimientos, anular, recuperación tras un corte, PIN siempre, doble clic = un solo pago). Las dos claves nuevas van en el respaldo, no en la nube | `services/payrollService.js` (nuevo), `config/backupKeys.js` |
| F3 | Pestaña **«Gestión»** con sub-pestaña **Nómina** (solo Administrador): lista con «por pagar», detalle por periodo, Dar adelanto / Pagar periodo / Bono / Descuento, anular, recibo en ticket y PDF. «Nómina» aparece separada en Reportes › Gastos y en el cierre | `components/Gestion/GestionTabs.jsx`, `components/Payroll/*` (nuevos), `utils/payrollReceipt.js` (nuevo), `views/CustomersView.jsx`, `App.jsx`, `Sales/MiniNav.jsx`, `CommandPalette.jsx`, `OnboardingOverlay.jsx`, `Reports/ReportsExpensesTab.jsx`, `utils/dailyCloseGenerator.js` |
| F4 | Prueba e2e de punta a punta | `tests/e2e/nomina.e2e.spec.js` (nuevo) |

## Ajuste al plan durante el trabajo
El plan decía guardar el pago por pago móvil con `afectaCaja: false`. Al leer el motor del cierre se vio que eso lo **escondía** del cierre, que es justo el error E8 de Donde Juancho. Ahora se guarda como cualquier gasto de Bodega (`afectaCaja: true`): el método decide si baja la gaveta (efectivo) o no (pago móvil). El plan quedó corregido.

## Cómo se evitan los errores de Donde Juancho
- **E1** (borraba los consumos de los demás): siempre se guarda la lista completa leída dentro del candado. Prueba con dos empleados y dos periodos.
- **E2** (anular restaba otra vez): anular marca `ANULADO`/`ANULADA` y no crea un movimiento al revés. La prueba demuestra que la gaveta vuelve exacta.
- **E3** (el botón «Liquidar» no funcionaba): un solo contrato de datos y la tasa la pone el servicio. La e2e pulsa los botones reales en $ y en Bs.
- **E4**: el PIN del Administrador se pide siempre, aunque `requireLogin` esté apagado.
- **E6–E8**: el arrastre es explícito, el pago en Bs se compara en Bs y el pago digital sale en el cierre.

## Verificación
- Vitest: `gastosInternosService` 9, `payrollModel` 19, `payrollService` 14, `payrollUi` 3. Todas pasan.
- Playwright: `nomina.e2e.spec.js` 2 de 2. Crea el empleado, da un adelanto de $10 en efectivo, rechaza un PIN equivocado, paga los $90 restantes en Bs por pago móvil (Bs 3.600 a tasa 40), deja el periodo «Pagado», anula el adelanto (la caja vuelve y el saldo reaparece) y lo comprueba de nuevo tras recargar. También revisa que el gasto de nómina no se pueda anular desde Gastos internos. Capturas en `test-results/nomina-*.png`.
- Suite completa de Vitest: pasan 2393 pruebas. Fallan 3 de licencias que no dependen de este trabajo: `licenseMonitoringMissing` (2) y `licensePolicy`, que compara contra una copia en otra carpeta del Escritorio. En una corrida anterior también falló una vez «planRemoteSale G1»; en la siguiente pasó.
- **No verificado:** impresora térmica real, PDF abierto en el celular y uso con una caja real (P-010).

## F6 · Mercancía que se lleva el empleado (2026-11-15, P-012)

**Qué pidió el dueño:** hacer P-012. Decidió que el precio de la mercancía sea **una opción en Ajustes** (costo o venta), que **pida el PIN** del Administrador como los adelantos y pagos, y que **F7** (resumen en el Supervisor) **espere** a que se publique el arreglo de egress.

**Qué se hizo:**
- Nuevo movimiento `MERCANCIA` en `utils/payrollModel.js`: resta del saldo como un descuento (`mercanciaUsd` en el saldo del periodo) y, si se pasa, pide confirmar y deja la deuda en el periodo siguiente (D6). `evaluateGoods` valida con los productos frescos: que existan, que no estén repetidos, la cantidad, el stock (salvo «permitir stock negativo») y que tengan precio a esa valoración.
- `registerGoods` en `services/payrollService.js`, bajo el mismo candado: 1.º baja el stock y guarda un retiro de inventario en las ventas (`isAutoconsumo: true`, `afectaCaja: false`, categoría «Nómina»); 2.º el renglón. Si el renglón falla, devuelve el stock y anula el retiro. Idempotente.
- Anular (`voidEntry`) devuelve el stock; solo si la caja de ese retiro sigue abierta, igual que un adelanto. `recoverPayroll` también devuelve el stock de un retiro que quedó sin renglón tras un corte.
- Ajustes › Negocio › tarjeta «Nómina» (`components/Payroll/PayrollSettingsCard.jsx`), clave `payroll_goods_valuation`, de fábrica «costo». Entra en el respaldo (`LS_KEYS`); no va a la nube.
- Pantalla: botón «Se lleva mercancía» en el detalle del empleado (`components/Payroll/PayrollGoodsModal.jsx`), línea «Mercancía» en el saldo, el detalle de productos en cada renglón y en el recibo (que pide firma).

**Dónde se ve:** la gaveta no cambia. El cierre lo muestra con los retiros de inventario. Reportes › Gastos lo suma a «Nómina».

**Verificación:** Vitest `payrollGoods` 17 pruebas nuevas, y nómina completa 101/101. Playwright `nomina.e2e.spec.js` 3/3: elige «Precio de venta» en Ajustes, 2 Caraotas a $5 → saldo de $50 a $40 y stock de 10 a 8; al anular, saldo $50 y stock 10. Capturas `test-results/nomina-mercancia-*.png` y `nomina-ajustes-mercancia.png`. **No verificado:** recibo en impresora térmica real (P-010).
