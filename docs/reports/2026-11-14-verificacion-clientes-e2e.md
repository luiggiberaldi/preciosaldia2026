# Verificación de punta a punta: clientes, billetera, abonos y deudas

**Sistema:** Precios al Día Bodega (`preciosaldia-supervisor-production-alignment`, rama `feat/inicio-estilo-farmacia`)
**Fecha:** 14-nov-2026
**Datos usados:** solo datos de prueba locales (clienta «María Prueba», «Juan E2E», productos «Caraota/Café/Harina Prueba», tasa fija 40 Bs/$, caja abierta con $100 y Bs 4.000). Nada se envió a la nube.

---

## Resumen en pocas palabras

- **El dinero del cliente está bien llevado.** En todas las pruebas, la deuda, el saldo a favor, el historial (ledger), la caja y el cierre dieron los montos que calculé a mano. No encontré ningún caso en que se pierda o se cuente dos veces dinero.
- **Encontré 3 errores de pantalla y reporte, y los arreglé** (ninguno movía dinero):
  1. El recibo no decía que el vuelto fue a la billetera del cliente.
  2. Vender seguía mostrando el saldo viejo del cliente después de cobrar.
  3. El resumen del cierre contaba como «saldo a favor generado» solo el sobrante de abonos, no el vuelto a billetera (el Inicio decía $8 y el cierre $3).
- Quedan **5 propuestas** pequeñas para decidir (al final).

## Cómo se probó

1. **Lectura del código** del ledger de clientes (`customerLedger.js`, `customerWalletService.js`), venta (`checkoutProcessor.js`), abono (`customerTransactionProcessor.js`), anulación (`voidSaleProcessor.js`), motor de caja (`FinancialEngine.js`), cierre (`closeDaySummary.js`), reportes y «Recalcular deudas».
2. **Prueba automática nueva de lógica** con los procesadores reales: `tests/clientesBilleteraFlujo.test.js` (6 pruebas, recorre los 8 escenarios en una jornada con montos exactos).
3. **Prueba automática nueva de pantalla (Playwright):** `tests/e2e/clientes-billetera.e2e.spec.js` (3 pruebas en el cobro «Procesar Pago» de PC, 1366×768).
4. **Recorrido a mano** en el navegador integrado (puerto 5181) con la licencia de prueba activada.

Regla clave del sistema (para entender la tabla): **cada cliente tiene un solo saldo**, en dólares. Si es negativo es deuda; si es positivo es saldo a favor. Nunca hay deuda y saldo a favor a la vez: lo uno se descuenta de lo otro.

---

## Tabla de escenarios

| # | Escenario (montos) | Resultado | Evidencia |
|---|---|---|---|
| 1a | Venta a crédito total de $10 | ✅ Pasa | Deuda $10; venta «VENTA_FIADA», fiado $10; caja sin cambios. Prueba de lógica. |
| 1b | Venta a crédito parcial: $10, paga $3, fía $7 | ✅ Pasa | Pantalla: «Queda debiendo $7,00 / Bs 280»; recibo «Pendiente (Fiado) Bs 280»; ledger −$7; caja USD +3. Navegador + Playwright. |
| 1c | En modo crédito pagar más que el total | ✅ Pasa (bloquea) | El sistema no deja guardar; dice que cambie a Contado. Prueba de lógica. |
| 2a | Abono parcial Bs 200 (= $5) a deuda de $7 | ✅ Pasa | Deuda $2; la ventana mostraba «Equivale a $5,00» y «después: −$2,00». Caja Bs +200. Navegador. |
| 2b | Abono en $ ($5) | ✅ Pasa | Prueba de lógica y navegador. |
| 2c | Abono mixto $2 + Bs 80 | ✅ Pasa (en 2 pasos) | La ventana de abono es de una moneda; se registran 2 abonos y la deuda baja $4. Ver propuesta P3. |
| 2d | Abono mayor que la deuda: $5 con deuda $2 | ✅ Pasa | Deuda 0 y **$3 a favor**. La ventana avisa: «se aplican $2,00 a la deuda y el sobrante de $3,00 quedará como saldo a favor». Reportes: «+USD 3.00 a favor». Navegador + Playwright. |
| 3a | Vuelto a la billetera: compra $5, paga $10, «A su billetera» | ✅ Pasa | Confirmación clara: «Cambio físico $0 / Saldo a favor acreditado $5 / Queda en caja $0». Saldo $3 → $8. Caja USD +10, sin vuelto. Navegador + Playwright. |
| 3b | Vuelto repartido: $1 en mano + Bs 40 + $2 a billetera | ✅ Pasa | Prueba de lógica. |
| 3c | «Billetera: elige cliente» sin cliente | ✅ Pasa | El botón sale atenuado; al tocarlo avisa «Elige un cliente para pasar el vuelto a su billetera» y no cobra. Playwright. |
| 3d | El recibo dice a dónde fue el vuelto | ❌→✅ **Arreglado (ERR-013)** | Antes solo decía «Efectivo $10». Ahora: «Vuelto a su billetera: $5,00». |
| 4a | Compra pagada toda con saldo a favor ($1 con $2 a favor) | ✅ Pasa | Saldo $2 → $1; la venta solo trae «Saldo a favor», ningún efectivo. Playwright. |
| 4b | Saldo parcial + efectivo: compra $10 = $8 saldo + $2 efectivo | ✅ Pasa | Recibo «Efectivo $2 / Saldo a Favor $8»; saldo queda en 0. Navegador. |
| 4c | Saldo que no alcanza | ✅ Pasa (bloquea) | La pantalla solo deja usar lo disponible («Todo» = máximo). Si se intenta más, el sistema no guarda y dice «saldo a favor insuficiente». Prueba de lógica. |
| 4d | El siguiente cobro muestra el saldo nuevo | ❌→✅ **Arreglado (ERR-014)** | Antes seguía mostrando $3 cuando lo guardado era $8. Comprobado: sin el arreglo la prueba falla 2 de 2; con el arreglo pasa. |
| 5a | Anular la venta pagada con $8 de saldo + $2 | ✅ Pasa | Saldo vuelve a $8 (movimiento «ANULACION» +$8); caja USD 120 → 118. Navegador. |
| 5b | Anular venta fiada parcial, venta con vuelto a billetera, y abono con sobrante | ✅ Pasa | Cada anulación revierte exactamente su movimiento. Prueba de lógica. |
| 5c | Anular una venta cuyo vuelto a billetera ya se gastó | ✅ Pasa (con nota) | El cliente queda debiendo lo que gastó de ese saldo ($5). Es correcto, pero no se avisa al cajero. Ver P4. |
| 6a | Cliente con deuda y saldo a favor a la vez | ✅ Pasa (por diseño) | No puede pasar: un fiado de $5 a un cliente con $2 a favor deja deuda $3. El recibo lo explica («Saldo a favor aplicado»). |
| 6b | Cambio de tasa: deuda de $10 a tasa 40, abono en Bs a tasa 50 | ✅ Pasa (por diseño) | La deuda queda en dólares. Bs 400 ya no alcanzan: abonan $8 y quedan $2. Ver nota para el dueño. |
| 6c | Centavos: pagar en Bs el monto mostrado (tasas 36,55 / 36,123 / 243,17 / 481,06) | ✅ Pasa | La deuda queda exactamente en 0, sin centavos colgando. |
| 6d | Faltante de $0,01 en venta de contado | ✅ Pasa | No se fía; queda anotado como redondeo. |
| 7 | «Recalcular deudas desde el historial» | ✅ Pasa | Después de todos los pasos, la cartera guardada coincide con el historial (sin diferencias) y recalcular deja los mismos saldos. En Reportes no salió alerta de descuadre. |
| 8a | Caja: abonos y billetera no se cuentan dos veces | ✅ Pasa | Inicio: ingresos $15 (solo mercancía), abonos aparte. Efectivo esperado USD 118 / Bs 4.200, igual a mi cuenta a mano. El «saldo a favor usado» no suma al efectivo. |
| 8b | Reportes: fiado, cobranzas y cartera | ✅ Pasa | Fiado otorgado $7, cobranzas $10, neto −$3, cartera $0, saldo a favor generado $8. |
| 8c | Resumen del cierre: «Saldo a favor generado» | ❌→✅ **Arreglado (ERR-015)** | Antes decía $3 (solo el sobrante del abono); ahora $8, igual que el Inicio y Reportes. |

**Cuenta de la jornada a mano (navegador):** apertura $100 + $3 (fiado parcial) + $5 (abono) + $10 (venta con vuelto a billetera) + $2 (venta con saldo, luego anulada) = USD 120 → tras anular, **USD 118** ✔. Bs 4.000 + 200 (abono) = **Bs 4.200** ✔.

---

## Errores encontrados

| ID | Gravedad | Qué pasaba | Cómo reproducirlo (antes del arreglo) | Estado |
|---|---|---|---|---|
| ERR-013 | Baja | El recibo en pantalla no mostraba el vuelto enviado a la billetera. El cliente no sabía a dónde fueron sus $5. (El ticket impreso sí lo decía.) | Vender $5 a un cliente, pagar $10, «A su billetera», cobrar: el recibo solo dice «Efectivo en Dólares $10». | **Arreglado** (`ReceiptModal.jsx`) |
| ERR-014 | Media | Vender mostraba el saldo del cliente de antes de la última venta. No se perdía dinero (el sistema revisa el saldo real antes de guardar), pero el cajero veía un saldo falso y podía rechazarle saldo al cliente o llevarse un «insuficiente». | María con $3 a favor; venta con $5 de vuelto a billetera; abrir otro cobro y elegir a María: muestra «$3,00» (lo guardado es $8). Se corregía al cambiar de pestaña. | **Arreglado** (`useSalesData.js`) |
| ERR-015 | Baja | El resumen del cierre (PDF) decía «Saldo a favor generado $3» cuando el Inicio y Reportes decían $8. | Día con vuelto a billetera de $5 y abono con sobrante de $3; generar el cierre. | **Arreglado** (`closeDaySummary.js`) |

**Por qué pasaba ERR-014:** al cobrar, el sistema guarda primero la venta y después el saldo del cliente. Vender se recargaba al ver la venta guardada, leía el saldo todavía viejo y tapaba el bueno. Ahora también se recarga cuando se guarda el saldo, y una recarga vieja ya no puede tapar a una nueva.

## Qué corregí

- `src/components/Sales/ReceiptModal.jsx`: línea «Vuelto a su billetera: $X».
- `src/hooks/useSalesData.js`: recarga al guardar clientes y descarta recargas viejas.
- `src/utils/closeDaySummary.js`: «Saldo a favor generado» usa la misma regla que el Inicio.
- Pruebas nuevas: `tests/clientesBilleteraFlujo.test.js` (6) y `tests/e2e/clientes-billetera.e2e.spec.js` (3).
- Documentos del proyecto: `docs/ERRORES.md` (ERR-013 a ERR-015), `bitacora.md`, `docs/sistema/modulos/CIERRE-DE-CAJA.md`.

**Pruebas corridas:** cartera, caja, cierre y cobro: 320 de 320 pasan. E2E nuevo: 3 de 3. ESLint: sin errores en los archivos tocados.

---

## Lo que queda (propuestas, sin hacer)

| ID | Propuesta | Por qué | Tamaño |
|---|---|---|---|
| P1 | En el resumen del cierre, agregar la fila «Pagado con saldo a favor». | «Cobrado de esas ventas» incluye lo pagado con saldo a favor, que no entró hoy a la gaveta (entró el día que se generó). El texto dice «es lo que puede estar en la caja», lo que confunde si hubo compras con saldo. Las cifras de caja (efectivo esperado) sí están bien. | Pequeño |
| P2 | Fiado a un cliente que tenía saldo a favor: en Reportes/cierre, el «fiado otorgado» cuenta el fiado entero aunque parte se cubrió con el saldo. | Ejemplo: fiado $5 con $2 a favor → reporte dice fiado $5, pero la deuda solo subió $3. La cartera sí está bien. Ya estaba anotado en la auditoría (F3b). Decidir si se muestra aparte. | Mediano |
| P3 | Permitir abono mixto ($ + Bs) en una sola ventana. | Hoy hay que hacer dos abonos. Funciona, pero son dos registros. | Mediano |
| P4 | Al anular una venta cuyo vuelto a billetera ya se gastó, avisar «el cliente quedará debiendo $X». | Es correcto que quede deuda, pero el cajero no lo sabe antes de confirmar. | Pequeño |
| P5 | Prueba automática de anulación desde la pantalla (Inicio → Historial → Anular). | Hoy solo se probó a mano y con pruebas de lógica. | Pequeño |

**Nota para el dueño (no es error):** las deudas se guardan en **dólares**. Si la tasa sube entre la venta y el abono, el cliente necesita más bolívares para pagar lo mismo (deuda $10: a tasa 40 son Bs 400; a tasa 50 son Bs 500). Si se quisiera deuda fija en bolívares, sería un cambio grande.

## No verificado

- Cobro de celular en esta pasada. Las pruebas e2e antiguas de clientes del celular (`auditoria-flujos` F3, F3b, F12, F12b, F13 y `reportes-fiado`) **hoy fallan por la propia prueba**: el menú aparece dos veces (barra lateral y barra inferior) y el selector `[data-tour="tab-inicio"]` encuentra 2 elementos; en `reportes-fiado`, «$80.00» sale 2 veces. Como F3 falla primero, F3b–F13 no llegaron a correr. No es por los cambios de hoy; ese archivo tiene cambios sin guardar de otra sesión, así que no lo toqué. Arreglo sugerido: usar `[data-testid="sidenav-…"]` como en la prueba nueva.
- Impresora térmica y PDF del cierre impreso (se verificó la cuenta del resumen, no el papel).
- Ventas remotas del Supervisor con clientes, y Cashea.
- Datos reales de un negocio.

## Datos de prueba que quedaron

En el navegador integrado (puerto 5181) quedaron la clienta «María Prueba», 3 productos «… Prueba» y las ventas de este recorrido. Son solo locales; se pueden borrar desde Ajustes o borrando los datos del sitio.
