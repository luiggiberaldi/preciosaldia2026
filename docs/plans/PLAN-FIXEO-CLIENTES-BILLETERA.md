# PLAN DE FIXEO Y MEJORA — CLIENTES, BILLETERA, ABONOS Y DEUDAS

> **Relevo (2026-11-14):** F1–F7 hechas. Dónde quedamos y qué sigue: [HANDOFF-PLAN-CLIENTES-BILLETERA.md](HANDOFF-PLAN-CLIENTES-BILLETERA.md).

**Documento ejecutable.** Cada fase se puede hacer sola, en orden, con su prueba y su commit.
**Origen:** verificación de punta a punta del 2026-11-14 ([docs/reports/2026-11-14-verificacion-clientes-e2e.md](../reports/2026-11-14-verificacion-clientes-e2e.md), commit `3b4a2d1`).
**Caso a abrir:** CASO-005 (`docs/casos/CASO-005-clientes-billetera.md`).
**Fases:** 10 · **Prioridad:** F1 primero (puede tocar dinero), luego en el orden escrito.

---

## §0. Punto de partida

Ya está bien y **no se toca**:
- Ledger de clientes con saldo único (favor − deuda) en USD, idempotente, con candado `pos_write_lock`.
- Venta fiada total/parcial, abono con sobrante a favor, vuelto a billetera, pago con saldo a favor, anulaciones y su reversa.
- Caja: el saldo a favor usado no suma al efectivo; los abonos no suman a ventas.
- Ya arreglado en `3b4a2d1`: ERR-013 (recibo), ERR-014 (saldo viejo en Vender), ERR-015 (saldo generado en el cierre).

Regla para todas las fases: **pantalla nunca decide el dinero**. Toda validación de saldo vive en el procesador (dentro del candado); la pantalla solo avisa.

## §1. Decisiones del dueño (el plan toma la opción conservadora; se puede invertir)

| ID | Pregunta | Decisión tomada | Si se elige lo contrario |
|---|---|---|---|
| D1 | Fiado a un cliente con saldo a favor: ¿cómo se reporta? | Se sigue contando como fiado otorgado, **pero** se muestra aparte «de eso, $X cubierto con saldo a favor». | Restarlo del fiado otorgado: cambia totales históricos de reportes. |
| D2 | ¿Abono mixto ($ + Bs) en una sola ventana? | **Sí**, un solo registro `COBRO_DEUDA` con 2 pagos. | Dejar dos abonos separados (hoy funciona). Saltar F5. |
| D3 | ¿Deuda en dólares o en bolívares? | **Se queda en dólares** (como hoy). Solo se mejora el aviso de cuántos Bs son hoy. | Deuda en Bs = rediseño del ledger. Fuera de este plan. |
| D4 | Anular venta con vuelto a billetera ya gastado | **Se permite**, con aviso claro de la deuda que quedará. | Bloquear la anulación: el cliente no podría devolver mercancía. |

---

## F1 — Reparar cartera desde Reportes con datos frescos ✅ HECHO (ERR-016)

**Problema posible:** `handleRepairLedger` en `src/views/ReportsView.jsx` (~línea 175) hace `rebuildCustomersFromLedger(customers, ledger)` con el estado **en memoria** y guarda con `storageService.setItem` **sin** `withLock`. Si una venta o abono entra mientras Reportes está abierto, puede reescribir saldos viejos.

1. Reproducir en prueba: con Reportes montado, guardar un abono en storage sin avisar a la vista y pulsar reparar → ¿el saldo vuelve al anterior?
2. Arreglo: mover la reparación a `src/services/customerWalletService.js` → `rebuildAllCustomersFromLedger()` que, dentro de `withLock('pos_write_lock')`, lee clientes y ledger frescos de storage, reconstruye y guarda. `ReportsView` solo la llama y luego `setCustomers(resultado)`.
3. Prueba: `tests/ledgerRepairFresh.test.js` — el abono hecho «por detrás» sobrevive a la reparación.
4. Revisar igual `confirmVoidSale` de `ReportsView` (no aplica `updatedCustomers`; hoy depende del evento de storage): aplicar `setCustomers(updatedCustomers)` como hace `DashboardView`.

**Hecho cuando:** la prueba pasa y la reparación no puede bajar ni subir un saldo que el ledger guardado no respalde.

## F2 — Reparar las pruebas e2e antiguas de clientes ✅ HECHO

**Problema:** `auditoria-flujos` F3–F13 y `reportes-fiado` fallan por selectores duplicados: `[data-tour="tab-inicio"]` existe en `SideNav.jsx` y en la barra inferior de `App.jsx`; en `reportes-fiado`, `$80.00` sale 2 veces.

1. `tests/e2e/helpers/auditHarness.js`: `startApp` y `goTo` usan `.locator('[data-tour="tab-x"]:visible').first()` (sirve en celular y en PC). **No tocar** `auditoria-flujos.e2e.spec.js` mientras tenga cambios sin guardar de otra sesión; si su propio `goToSales` falla, coordinar.
2. `tests/e2e/reportes-fiado.e2e.spec.js`: subir a 30 s la espera de `[data-view="reportes"]` en `goToReports` (en frío tarda más de 15 s; visto en F1). Línea 38: `getByText('$80.00').first()` o un `data-testid` en la tarjeta.
3. Correr: `bunx playwright test tests/e2e/auditoria-flujos.e2e.spec.js tests/e2e/reportes-fiado.e2e.spec.js -g "F3|F12|F13|cobranzas|cartera"`.

**Hecho cuando:** las 7 pruebas pasan (o las que fallen muestran un error real de la app, que se anota como ERR nuevo).

## F3 — Aviso al anular una venta que deja deuda (P4, decisión D4) ✅ HECHO

1. Nuevo `src/utils/voidImpact.js` → `previewVoidCustomerImpact(sale, customer, ledger)`: devuelve el saldo antes y después de anular usando los mismos movimientos que `processVoidSale` (reutilizar la lógica: extraer de `voidSaleProcessor.js` la función que arma `reversalMovements` y exportarla).
2. `DashboardView.jsx` (modal «Anular venta», ~línea 896) y `ReportsView.jsx` (~línea 504): si `despues < 0` y `antes >= 0`, añadir al mensaje: «El cliente quedará debiendo $X (Bs Y): ya usó el saldo que generó esta venta».
3. Mostrar también, siempre que haya cliente: «Saldo de {cliente}: antes $A → después $B».
4. Pruebas: `tests/voidImpact.test.js` (vuelto gastado → deuda; fiado → baja deuda; pago con saldo → sube favor; abono con sobrante → baja favor).

## F4 — Cierre: fila «Pagado con saldo a favor» (P1) ✅ HECHO

1. `src/utils/closeDaySummary.js`: calcular `saldoFavorUsadoUsd` = suma de pagos `saldo_favor`/`isInternalCredit` de ventas no anuladas.
2. Nueva fila nivel 1 bajo «Cobrado de esas ventas»: «De eso, pagado con saldo a favor» (`tone: 'muted'`), y fila «Cobrado en caja y bancos» = cobrado − saldo usado. Mantener la invariante `cobrado + créditos = ventas netas`.
3. Cambiar el texto de ayuda de «Cobrado»: quitar «es lo que puede estar en la caja» cuando hubo saldo usado.
4. `src/utils/dailyCloseGenerator.js`: verificar que la fila nueva sale en el PDF (2 columnas).
5. Pruebas: ampliar `tests/closeDaySummary.test.js` y `tests/clientesBilleteraFlujo.test.js` (jornada con $4 de saldo usado → fila $4, cobrado en caja = cobrado − 4).

## F5 — Abono mixto en una sola ventana (P3, decisión D2) ✅ HECHO

1. `src/components/Customers/TransactionModal.jsx`: en «Recibir Abono», modo «$ y Bs» con dos campos y método por campo; vista previa con el total en $ y el saldo resultante.
2. `src/utils/customerTransactionProcessor.js`: aceptar `payments: [{ currency, amount, methodId }]` (mantener la firma vieja de un solo monto). Un solo registro `COBRO_DEUDA` con varios `payments`, un solo movimiento `ABONO_DEUDA` por el total en USD (`sumR` de cada parte convertida con `divR`), `saldoFavorGeneradoUsd` sobre el total.
3. Verificar que `FinancialEngine` reparte cada pago a su método (ya recorre `payments`) y que Reportes «Detalle de cobranzas» muestra los dos métodos (hoy toma `payments[0]`: corregir en `receivablesReport.js`).
4. Pruebas: unitaria (deuda $7, abono $2 + Bs 200 a tasa 40 → deuda 0, favor 0; caja USD +2, Bs +200) y e2e en `clientes-billetera.e2e.spec.js`.

## F6 — Reportes: fiado cubierto con saldo a favor (P2, decisión D1) ✅ HECHO

1. `src/utils/receivablesReport.js`: en cada fiado, `cubiertoConFavorUsd = min(walletSnapshot.favorAntes, fiadoUsd)` (ventas sin `walletSnapshot` = 0). Total del período `fiadoCubiertoConFavorUsd`.
2. Reportes y Dashboard: bajo «Fiado otorgado», línea «de eso, cubierto con saldo a favor: $X» solo si X > 0.
3. `closeDaySummary.js`: misma línea en «Fiado a clientes».
4. Pruebas: fiado $5 con $2 a favor → fiado otorgado 5, cubierto 2.

## F7 — Mejoras de pantalla del cliente ✅ HECHO

1. Selector de cliente en el cobro (`CheckoutCustomerPicker.jsx`): mostrar deuda en rojo además de «Favor $X», y en Bs a la tasa del día (D3).
2. Ventana de abono: botón «Pagar total» también en $ cuando el modo es Bs (hoy solo en la moneda activa) y aviso cuando la tasa cambió desde la venta fiada: «La deuda es $10; hoy son Bs 500 (cuando se fió eran Bs 400)».
3. Detalle del cliente (`CustomersView.jsx`): revisar que el historial nombre en español sencillo cada movimiento del ledger (`VUELTO_ACREDITADO` → «Vuelto guardado», `SALDO_FAVOR_USADO` → «Pagó con su saldo», `ANULACION` → «Anulación de …»).
4. Ventana «Ajustar Cuenta» (`TransactionModal.jsx`): a 1366×768 en modo «$ y Bs» es más alta que la pantalla y el título queda cortado arriba (visto en F5). Hacerla desplazable con el botón fijo abajo.
5. «Billetera: elige cliente» (`ChangeCard.jsx`): al tocarlo sin cliente, abrir directamente el selector de cliente además del aviso.

Cada punto con su prueba de componente o e2e; capturas a 1366×768 y 375 px.

## F8 — Pruebas e2e que faltan (P5)

En `tests/e2e/clientes-billetera.e2e.spec.js`:
1. Anular desde Inicio → Historial → Anular: venta pagada con saldo → el saldo vuelve; caja baja el efectivo de esa venta.
2. Anular la venta con vuelto a billetera ya gastado → aparece el aviso de F3 y queda la deuda.
3. Cobro de **celular** (`checkout_mode: 'basic'`, 375 px): vuelto a billetera con `MobileChangeAllocation.jsx` y pago con saldo a favor (no verificado el 14-nov).
4. Cierre de caja completo tras la jornada: «Efectivo esperado» y la fila de F4.

## F9 — Portar a Farmacia

Guía: `side-session-notes/…/PORTAR-A-FARMACIA-clientes-billetera.md`. Llevar ERR-013/014/015 y las fases F1, F3, F4 que apliquen. Revisar antes si Farmacia ya tiene sus propias versiones (no duplicar).

## F10 — Cierre del plan

1. Batería completa: `bunx vitest run` (solo deben fallar las 3 de licencias que ya fallaban) y las e2e de F2 y F8.
2. `npm run docs:check` sin avisos nuevos; actualizar `docs/ERRORES.md` (ERR nuevos que salgan), `bitacora.md`, `docs/sistema/modulos/CIERRE-DE-CAJA.md`, `docs/sistema/modulos/VENTA.md`, CASO-005 e `INDICE.md`.
3. Un commit por fase, sin push; nunca incluir archivos de otras sesiones.

---

## Resumen

| Fase | Qué | Gravedad / valor | Tamaño | Depende de |
|---|---|---|---|---|
| F1 ✅ | Reparar cartera con datos frescos y candado | Alta (posible dinero) | Pequeño | — |
| F2 ✅ | Arreglar e2e antiguas | Media | Pequeño | — |
| F3 ✅ | Aviso al anular con deuda | Media | Pequeño | — |
| F4 ✅ | Cierre: pagado con saldo a favor | Baja | Pequeño | — |
| F5 ✅ | Abono mixto | Mejora | Mediano | — |
| F6 ✅ | Fiado cubierto con saldo en reportes | Baja | Mediano | — |
| F7 ✅ | Mejoras de pantalla del cliente | Mejora | Mediano | F3 |
| F8 | E2E faltantes | Seguridad | Mediano | F2, F3, F4 |
| F9 | Portar a Farmacia | — | Mediano | F1–F4 |
| F10 | Batería, docs y commits | — | Pequeño | todas |
