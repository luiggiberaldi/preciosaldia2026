# Relevo: plan de clientes y billetera (Bodega) — dónde quedamos

**Fecha:** 2026-11-14 · **Rama:** `feat/inicio-estilo-farmacia` · **Sin push** (el dueño no lo pidió).
**Plan completo:** [PLAN-FIXEO-CLIENTES-BILLETERA.md](PLAN-FIXEO-CLIENTES-BILLETERA.md) (fases F1 a F10).
**Informe de la verificación inicial:** [docs/reports/2026-11-14-verificacion-clientes-e2e.md](../reports/2026-11-14-verificacion-clientes-e2e.md).
**Usuario:** principiante; responder en **español sencillo**, una fase a la vez, y pedir permiso antes de la siguiente («vamos fase a fase»).

---

## 1. Lo que ya está hecho (con commit)

| Paso | Commit | Qué |
|---|---|---|
| Verificación e2e | `3b4a2d1` | ERR-013 (recibo dice «Vuelto a su billetera»), ERR-014 (Vender mostraba el saldo viejo tras cobrar), ERR-015 (cierre: «saldo a favor generado» incluye vuelto). Pruebas `tests/clientesBilleteraFlujo.test.js` y `tests/e2e/clientes-billetera.e2e.spec.js`. |
| F1 | `2614d5c` | ERR-016: «Reparar cartera» (Reportes) lee clientes y ledger frescos dentro de `pos_write_lock` y solo toca descuadrados (`rebuildAllCustomersFromLedger` en `customerWalletService.js`). Anular desde Reportes aplica `updatedCustomers`. |
| F2 | `f93fb10` | Pruebas e2e antiguas de clientes en verde: `navTab()` en `tests/e2e/helpers/auditHarness.js`, `reportes-fiado` (espera 45 s, `.first()`), F12b («COBRAR $5.00»). |
| F3 | `0330e73` | Confirmación de anular muestra «Cuenta de X: antes → después» y «⚠ quedará debiendo $X». `src/utils/voidImpact.js`, `src/hooks/useVoidImpact.js`, `ConfirmModal` prop `details`, `buildVoidReversalMovements` exportada en `voidSaleProcessor.js`. |
| F4 | `54ac217` | Cierre: filas «De eso, pagado con saldo a favor» y «Entró hoy a caja y bancos» bajo «Cobrado» (`closeDaySummary.js`) + nota del PDF (`dailyCloseGenerator.js`). |
| F5 | `70ff866` | Abono mixto ($ + Bs) en una ventana: `customerTransactionProcessor.js` acepta `payments`; pestaña «$ y Bs» en `TransactionModal.jsx`; `methodIds` en reportes. |
| F6 | `f2e3a36` | Fiado cubierto con saldo a favor: `fiadoCoveredByCredit` en `receivablesReport.js`, sub-fila en Reportes/Inicio (`isSub`) y en el cierre. |

Cada fase tiene su entrada en `bitacora.md` y está marcada ✅ en el plan.

## 2. Lo que quedó A MEDIAS: F7 (mejoras de pantalla del cliente) — SIN commit

### Archivos de F7 (solo estos son míos; NO incluir otros en el commit)

- `src/utils/customerBalanceText.js` (**nuevo**): `customerBalanceChip(customer, rate)` → «Debe $5.00 · Bs 200,00» / «Favor $3.00 · Bs 120,00»; `saleWalletNotes(sale)` → notas «Pagó con su saldo a favor: −$X», «Pagó $3.00 · fió $7.00», «El fiado lo cubrió su saldo a favor…».
- `tests/customerBalanceText.test.js` (**nuevo**, 7 pruebas, pasan).
- `src/utils/receivablesReport.js`: solo `export` en `fiadoCoveredByCredit`.
- `src/components/Sales/CheckoutCustomerPicker.jsx`: componente `BalanceChip` (usa el helper), `data-testid="customer-picker-toggle"` + `aria-expanded` en el botón, `data-testid="customer-balance-chip"`.
- `src/components/Sales/CheckoutModalPOS/parts/useCheckoutPosChange.js`: `abrirSelectorCliente()` — «Billetera: elige cliente» sin cliente abre el selector (además del aviso).
- `src/components/Customers/TransactionModal.jsx`: ventana desplazable (título y botón fijos; `data-testid="ajustar-cuenta"`) y nota «La deuda es de $X. En bolívares cambia con la tasa del día.» (`data-testid="deuda-en-dolares"`, solo en abono en Bs).
- `src/views/CustomersView.jsx`: notas `saleWalletNotes` en el historial del cliente (`data-testid="historial-<key>"`).
- `tests/e2e/clientes-billetera.e2e.spec.js`: comprobaciones nuevas (selector abierto, chip con Bs, `historial-fiado_parcial`, `deuda-en-dolares`).

ESLint: sin errores en esos archivos. Unitarias nuevas: pasan. **E2E de F7: todavía NO se corrieron.**

### Falta para cerrar F7

1. En la prueba «Abono mixto…» (`clientes-billetera.e2e.spec.js`, cerca de la línea 223) agregar que título y botón se ven sin desplazar a 1366×768:
   `await expect(page.getByTestId('ajustar-cuenta').getByText('Ajustar Cuenta')).toBeInViewport();` y `await expect(abonar).toBeInViewport();`
2. Correr: `npx vitest run tests/customerBalanceText.test.js tests/clientesBilleteraFlujo.test.js tests/receivables*.test.js` y `npx playwright test tests/e2e/clientes-billetera.e2e.spec.js --retries=1`.
   Ojo: el texto del chip cambió a «Favor $18.50 · Bs 740,00»; la prueba de ERR-014 busca `'$23.50'` (subcadena, sigue sirviendo).
3. Capturas para revisar (guardarlas FUERA de `test-results`, p. ej. `CLIENTES_SHOTS="$TEMP/clientes-shots"`): selector con el chip, historial con notas, ventana «$ y Bs» a 1366×768.
4. Marcar F7 ✅ en el plan, entrada en `bitacora.md`, y commit solo con los archivos de arriba.

## 3. Lo que falta después

- **F8** — e2e que faltan (ver plan): anular venta con vuelto a billetera ya gastado (aviso ⚠ de F3), cobro de **celular** (`checkout_mode: 'basic'`, 375 px: vuelto a billetera con `MobileChangeAllocation.jsx` y pago con saldo), cierre de caja completo tras la jornada (efectivo esperado + fila de F4).
  Ya hecho dentro de F3: anular desde Inicio una venta pagada con saldo.
- **F9** — portar a Farmacia: guía en la carpeta de notas compartidas `side-session-notes/…/PORTAR-A-FARMACIA-clientes-billetera.md` (falta agregar F1, F3–F7). Revisar antes si Farmacia ya tiene su versión.
- **F10** — batería completa `npx vitest run` (antes solo fallaban 3 de licencias, ajenas), e2e de clientes y reportes, `npm run docs:check`, y documentos pendientes que pide el control de documentación: `docs/sistema/modulos/VENTA.md` (aviso de anulación F3, abono mixto F5) y `docs/sistema/INICIO.md`; abrir `docs/casos/CASO-005-clientes-billetera.md` + `INDICE.md`.

## 4. Cuidados importantes

- **Hay otras sesiones con cambios sin guardar en la misma carpeta** (Ajustes, licencias, respaldos, logos, tickets, `dailyCloseGenerator.js`, `DashboardView.jsx`, `storageService.js`, `auditoria-flujos.e2e.spec.js`, etc.). **Nunca** `git add -A`; agregar archivo por archivo. Si un archivo mío tiene también cambios de otro, subir solo mis líneas (se hizo en F2 con `git hash-object` + `git update-index --cacheinfo`).
- La consola Bash de Claude bloquea comandos con `$` dentro de heredocs/sed (falso «rm» peligroso). Para editar archivos con `$`, usar la herramienta de edición, no `sed`/heredoc.
- Las e2e comparten el servidor del puerto 4173 con otras sesiones: si la página «recarga sola» o falla la primera carga de Reportes, reintentar (`--retries=1`).
- El navegador integrado (puerto 5181, `.claude/launch.json` → `bodega-dev`) quedó sin datos ni licencia; para probar a mano hay que sembrar datos y activar la licencia de prueba (lo hace el dueño).
- Commits terminan con: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
