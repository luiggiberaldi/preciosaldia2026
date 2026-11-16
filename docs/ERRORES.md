# Registro de errores y soluciones

Cada error encontrado va aquí, con su solución. Reglas en [LEY-DOCUMENTACION.md](LEY-DOCUMENTACION.md). La foto de la auditoría de marzo está en `ISSUES.md` (raíz) y no se mezcla con este registro.

## Resumen

| ID | Título | Fecha | Estado | Caso |
|---|---|---|---|---|
| ERR-001 | Se podían abrir dos cajas a la vez | 2026-11-13 | Resuelto | CASO-002 |
| ERR-002 | El cobro calculaba mal el fondo de la gaveta | 2026-11-13 | Resuelto | CASO-002 |
| ERR-003 | Vuelto en Bs sin tener Bs: aviso casi invisible | 2026-11-13 | Resuelto | CASO-002 |
| ERR-004 | Stock de bultos descontaba bultos en vez de unidades | 2026-10-21 | Resuelto | — |
| ERR-005 | Señales del Supervisor rechazadas por reloj del cliente | 2026-10-20 | Resuelto | — |
| ERR-006 | Explosión de egress en sync_documents | 2026-10-23 | Resuelto | — |
| ERR-007 | Un producto sin precio se agregaba a la cesta a $0.00 | 2026-11-14 | Resuelto | CASO-003 |
| ERR-008 | Tema oscuro: precios de las fichas y total de la cesta casi invisibles | 2026-11-14 | Descartado | CASO-003 |
| ERR-009 | Un faltante de hasta $0,01 se cobraba sin dejar rastro | 2026-11-14 | Resuelto | CASO-004 |
| ERR-010 | La confirmación del vuelto mostraba Bs con 3 decimales | 2026-11-14 | Resuelto | CASO-004 |
| ERR-011 | `Esc` en un campo del cobro cerraba todo el cobro | 2026-11-14 | Resuelto | CASO-004 |
| ERR-012 | «Todo en $» anotaba dólares con centavos que no existen | 2026-11-14 | Resuelto (mitigado) | CASO-004 |
| ERR-013 | El recibo en pantalla no decía que el vuelto fue a la billetera | 2026-11-14 | Resuelto | — |
| ERR-014 | Vender mostraba el saldo del cliente de antes de la última venta | 2026-11-14 | Resuelto | — |
| ERR-015 | El cierre contaba como «saldo a favor generado» solo el sobrante de abonos | 2026-11-14 | Resuelto | — |
| ERR-016 | «Reparar cartera» guardaba la lista de clientes que tenía la pantalla | 2026-11-14 | Resuelto | — |

ERR-004 a ERR-006 se reconstruyeron desde informes ya existentes; el detalle completo está en esos informes. ERR-001 a ERR-003 se arreglaron y guardaron el 2026-11-13 (commit «fix(caja): …», ver CASO-002).

---

## ERR-001 — Se podían abrir dos cajas a la vez

- **Fecha:** 2026-11-13
- **Estado:** Resuelto
- **Dónde:** `src/hooks/useCheckoutFlow.js` (`handleSaveApertura`)
- **Síntoma:** con dos pestañas, o una pantalla vieja, se registraban dos aperturas; el sistema solo mira la más nueva y el fondo de la primera se perdía de las cuentas.
- **Causa:** al guardar no se revisaba si ya había una caja abierta.
- **Solución:** dentro del candado de escritura, antes de guardar se busca una caja abierta; si existe se usa esa y se avisa «La caja ya estaba abierta». Marca en el código: `CAJA-APERTURA-001`.
- **Cómo comprobarlo:** abrir caja en dos pestañas; la segunda reutiliza la apertura.
- **Relacionados:** [CASO-002](casos/CASO-002-caja-apertura-y-fondo.md).

## ERR-002 — El cobro calculaba mal el fondo de la gaveta

- **Fecha:** 2026-11-13
- **Estado:** Resuelto
- **Dónde:** cálculo de `currentFloat` en el cobro; `src/utils/fondoGaveta.js` (nuevo)
- **Síntoma:** el aviso «excede el fondo» fallaba; después de medianoche el sistema «olvidaba» el fondo.
- **Causa:** el cálculo filtraba por fecha del calendario en vez de por turno y no restaba los vueltos ya entregados.
- **Solución:** una sola regla del turno abierto (`calcularFondoEnGaveta`). Marca: `CAJA-FONDO-001`.
- **Cómo comprobarlo:** cobrar pasada la medianoche con la caja abierta; el fondo sigue contando.
- **Relacionados:** [CASO-002](casos/CASO-002-caja-apertura-y-fondo.md).

## ERR-003 — Vuelto en Bs sin tener Bs: aviso casi invisible

- **Fecha:** 2026-11-13
- **Estado:** Resuelto
- **Dónde:** pantalla de cobro (`src/components/Sales/AvisoFondoGaveta.jsx` y componentes del cobro)
- **Síntoma:** se podía dar vuelto en Bs sin tenerlos; así nació el «Efectivo esperado −2.159,35 Bs».
- **Causa:** el aviso era una letra naranja diminuta que nadie leía.
- **Solución:** aviso legible de efectivo insuficiente. Marca: `CAJA-FONDO-002`.
- **Cómo comprobarlo:** dar vuelto en Bs sin Bs en la gaveta; sale el aviso grande.
- **Relacionados:** [CASO-002](casos/CASO-002-caja-apertura-y-fondo.md).

## ERR-004 — Stock de bultos descontaba bultos en vez de unidades

- **Fecha:** 2026-10-21
- **Estado:** Resuelto
- **Dónde:** `src/utils/checkoutProcessor.js`, `src/utils/voidSaleProcessor.js`
- **Síntoma:** vender 1 caja de 12 descontaba 1 unidad del stock en vez de 12 (y una unidad suelta podía descontar 0).
- **Causa:** la conversión bulto ↔ unidades estaba invertida; el stock siempre se guarda en unidades.
- **Solución:** ver el plan [2026-10-21-fix-deduccion-stock-bultos-unidades](plans/2026-10-21-fix-deduccion-stock-bultos-unidades.md) y el informe [REPORTE-FIX-STOCK-BULTOS-2026-10-21](reports/REPORTE-FIX-STOCK-BULTOS-2026-10-21.md).
- **Cómo comprobarlo:** vender un bulto y revisar que el stock baja en unidades.

## ERR-005 — Señales del Supervisor rechazadas por reloj del cliente

- **Fecha:** 2026-10-20
- **Estado:** Resuelto (la mitigación del reloj; el resto sigue en el plan del incidente)
- **Dónde:** función `create_supervisor_command` (Supabase)
- **Síntoma:** «envío señales y no llegan»: el servidor respondía `400 "Ventana temporal inválida"`.
- **Causa:** validaba la hora absoluta del reloj del equipo; además la base estaba saturada por documentos de sincronización gigantes y los errores eran invisibles en la pantalla.
- **Solución:** la ventana se construye con `now()` del servidor. Postmortem: [2026-10-20-postmortem-senales-perdidas-y-codigo-vinculacion](reports/2026-10-20-postmortem-senales-perdidas-y-codigo-vinculacion.md).
- **Cómo comprobarlo:** enviar una orden desde el Supervisor; llega a la caja.

## ERR-006 — Explosión de egress en sync_documents

- **Fecha:** 2026-10-23
- **Estado:** Resuelto (fases 1 y 4; fases 2 y 3 pendientes según el informe)
- **Dónde:** consultas a `public.sync_documents` (Supabase PostgREST)
- **Síntoma:** ~318 MB de salida de datos en un día, cuando lo normal era 50–70 MB.
- **Causa:** el 92,7 % venía de las respuestas JSON de esa tabla.
- **Solución:** ver [REPORTE-CAUSA-RAIZ-EGRESS-Y-SOLUCION](reports/REPORTE-CAUSA-RAIZ-EGRESS-Y-SOLUCION.md).
- **Cómo comprobarlo:** revisar el egress diario en la consola de Supabase.

## ERR-007 — Un producto sin precio se agregaba a la cesta a $0.00

- **Fecha:** 2026-11-14
- **Estado:** Resuelto
- **Dónde:** Vender, fichas de la rejilla (`src/components/Sales/CategoryBar.jsx`)
- **Síntoma:** al tocar la ficha de un producto sin precio, entraba a la cesta a $0.00 sin ningún aviso. Se podía cobrar regalado sin darse cuenta.
- **Causa:** la ficha llamaba directo a «agregar a la cesta» sin revisar el precio. Farmacia ya lo había resuelto.
- **Solución:** `handleAdd` revisa el precio (de caja o de unidad). Si no hay, sale el aviso «no tiene precio. Asígnalo en Inventario antes de venderlo» y no se agrega. La ficha lleva borde rojo.
- **Cómo comprobarlo:** crear un producto con precio 0 y tocar su ficha en Vender: aparece el aviso y la cesta no cambia.
- **Relacionados:** CASO-003.

## ERR-008 — Tema oscuro: precios de las fichas y total de la cesta casi invisibles

- **Fecha:** 2026-11-14
- **Estado:** Descartado (2026-11-14: el dueño decidió que el sistema no usará tema oscuro)
- **Dónde:** Vender en tema oscuro (`CategoryBar.jsx`, `CartPanel.jsx`; colores en `src/styles/tokens.css`)
- **Síntoma:** con el tema oscuro, la ficha sigue clara (casi blanca) y el precio en $ y el total de la cesta salen en blanco: no se leen.
- **Causa (probable):** en tema oscuro la paleta `slate` se invierte (tokens), así que `dark:bg-slate-900` termina claro, mientras `dark:text-white` sigue blanco. Ya pasaba antes de CASO-003 (mismas clases en el último commit).
- **Qué se intentó:** nada todavía; Bodega abre en tema claro de fábrica, por eso no se notaba.
- **Decisión:** el dueño dijo «el sistema no utilizará tema oscuro». No se arregla; Bodega trabaja solo en tema claro (el de fábrica). Si algún día se activa el tema oscuro, este error hay que resolverlo antes.
- **Cómo comprobarlo:** Ajustes → tema oscuro, ir a Vender y mirar el precio de cualquier ficha sin bulto/unidad y el «TOTAL $» de la cesta.
- **Relacionados:** CASO-003, P-007.

## ERR-009 — Un faltante de hasta $0,01 se cobraba sin dejar rastro

- **Fecha:** 2026-11-14
- **Estado:** Resuelto
- **Dónde:** `src/utils/checkoutProcessor.js`.
- **Síntoma:** por redondeo de los Bs podía faltar $0,01; la venta pasaba como pagada y no quedaba anotado en ningún lado. Al cuadrar, un centavo que nadie podía explicar.
- **Causa:** la regla «hasta $0,01 no se fía» existía, pero no guardaba la diferencia (Farmacia sí, CASO-004 de Farmacia).
- **Solución:** la venta guarda `redondeoUsd` (0 si el pago fue exacto). No cambia ningún total.
- **Cómo comprobarlo:** `tests/redondeoUsd.test.js` (3 pruebas).
- **Relacionados:** CASO-004.

## ERR-010 — La confirmación del vuelto mostraba Bs con 3 decimales

- **Fecha:** 2026-11-14
- **Estado:** Resuelto
- **Dónde:** `src/components/Sales/CheckoutModalPOS/components/ChangeConfirmationModal.jsx` (`formatBs`).
- **Síntoma:** podía salir «Bs 7.375,006» (mismo error que ERR-116 de Farmacia).
- **Causa:** el formato fijaba el mínimo de decimales pero no el máximo, y recibía `vuelto × tasa` sin redondear.
- **Solución:** `round2` y `maximumFractionDigits: 2`.
- **Cómo comprobarlo:** cobrar con vuelto; «Vuelto total» en Bs muestra 2 decimales.
- **Relacionados:** CASO-004.

## ERR-011 — `Esc` en un campo del cobro cerraba todo el cobro

- **Fecha:** 2026-11-14
- **Estado:** Resuelto
- **Dónde:** `PaymentInputs.jsx` (Esc vacía el campo) y `SalesView.jsx` (Esc en la ventana cierra el cobro).
- **Síntoma:** el cajero pulsaba `Esc` para borrar un monto y se cerraba el cobro entero, perdiendo lo escrito y el cliente elegido. Con la confirmación del vuelto abierta, `Esc` también cerraba todo.
- **Causa:** el campo vaciaba el monto pero dejaba subir la tecla hasta la ventana, donde Vender cierra el cobro.
- **Solución:** con un monto escrito, el campo detiene la tecla (solo borra). Con el campo vacío, `Esc` sigue cerrando el cobro. La confirmación del vuelto atiende `Esc` antes que Vender y cierra solo ella.
- **Cómo comprobarlo:** `tests/e2e/cobro-pos.e2e.spec.js` («Esc con un monto escrito…» y «La confirmación muestra el aviso…»).
- **Relacionados:** CASO-004.

## ERR-012 — «Todo en $» anotaba dólares con centavos que no existen

- **Fecha:** 2026-11-14
- **Estado:** Resuelto (mitigado)
- **Dónde:** cobro de PC (`CheckoutModalPOS`).
- **Síntoma:** con un vuelto de $3,27, «Todo en $» anotaba «entregué $3,27 en dólares». En la vida real se dan $3 y el resto en Bs, así que el «Efectivo esperado» del cierre se desviaba (menos dólares, más Bs).
- **Causa:** el desglose realista (`computeRealisticSplit`) solo lo usaba el cobro de celular.
- **Solución:** opción «Sugerido: $3 + Bs …» en el cobro de PC, con los ajustes de Caja & Vuelto; «Todo en $» con centavos avisa. No se bloquea (decisión del dueño).
- **Cómo comprobarlo:** `tests/cobroSugerido.test.js` y la prueba «Sugerido» de `tests/e2e/cobro-pos.e2e.spec.js`.
- **Relacionados:** CASO-004.

## ERR-013 — El recibo en pantalla no decía que el vuelto fue a la billetera

- **Fecha:** 2026-11-14
- **Estado:** Resuelto
- **Dónde:** `src/components/Sales/ReceiptModal.jsx`.
- **Síntoma:** venta de $5 pagada con $10 y vuelto «A su billetera»: el recibo mostraba «Efectivo en Dólares $10» y nada más. El cliente no veía a dónde fueron sus $5. El ticket impreso sí lo decía («Saldo a favor acreditado»).
- **Causa:** el recibo de pantalla no leía `vueltoParaMonedero`.
- **Solución:** línea «Vuelto a su billetera: $X» (`data-testid="recibo-vuelto-billetera"`).
- **Cómo comprobarlo:** `tests/e2e/clientes-billetera.e2e.spec.js` («Vuelto A su billetera…»).
- **Relacionados:** verificación de clientes del 2026-11-14.

## ERR-014 — Vender mostraba el saldo del cliente de antes de la última venta

- **Fecha:** 2026-11-14
- **Estado:** Resuelto
- **Dónde:** `src/hooks/useSalesData.js` (`handleReloadContent`).
- **Síntoma:** María tenía $3 a favor, compró con vuelto de $5 a su billetera. En el siguiente cobro el sistema seguía mostrando «$3,00» (lo guardado era $8). Pasaba igual al gastar el saldo: seguía mostrando el saldo viejo. Se corregía al cambiar de pestaña o recargar. No se perdía dinero: el cobro revisa el saldo real antes de guardar.
- **Causa:** al cobrar, la venta se guarda antes que el saldo del cliente. La recarga que dispara la venta (50 ms después) leía el saldo todavía viejo y pisaba el nuevo.
- **Solución:** escribir la lista de clientes también recarga, y solo se aplica la recarga más reciente.
- **Cómo comprobarlo:** `tests/e2e/clientes-billetera.e2e.spec.js` («Vuelto A su billetera…», al final). Sin el arreglo falla 2 de 2 veces.
- **Relacionados:** verificación de clientes del 2026-11-14.

## ERR-015 — El cierre contaba como «saldo a favor generado» solo el sobrante de abonos

- **Fecha:** 2026-11-14
- **Estado:** Resuelto
- **Dónde:** `src/utils/closeDaySummary.js` (resumen del PDF del cierre).
- **Síntoma:** en un día con $5 de vuelto a billetera y $3 de sobrante de un abono, el Inicio y Reportes decían «Saldo a favor generado USD 8» y el resumen del cierre decía $3.
- **Causa:** el resumen tomaba el dato de cuentas por cobrar (solo abonos) en lugar de la regla del motor (`getGeneratedWalletCredit`).
- **Solución:** el resumen usa `getGeneratedWalletCredit` en todas las ventas no anuladas.
- **Cómo comprobarlo:** `tests/clientesBilleteraFlujo.test.js` («ERR-015…»).
- **Relacionados:** verificación de clientes del 2026-11-14.

## ERR-016 — «Reparar cartera» guardaba la lista de clientes que tenía la pantalla

- **Fecha:** 2026-11-14
- **Estado:** Resuelto
- **Dónde:** `src/views/ReportsView.jsx` (`handleRepairLedger`) → ahora `rebuildAllCustomersFromLedger` en `src/services/customerWalletService.js`.
- **Síntoma (posible, solo con el interruptor técnico «Recalcular deudas» encendido):** con Reportes abierto en una pestaña y la caja cobrando en otra, pulsar «Reconstruir saldos» guardaba la lista de clientes de cuando se abrió Reportes. Se perdían abonos y saldos nuevos, y hasta clientes creados después. En la misma pestaña el riesgo era mínimo porque Reportes se recarga al guardar.
- **Causa:** la reparación usaba los datos en memoria y guardaba sin el candado de escritura `pos_write_lock`. El aviso de «se guardó algo» no cruza pestañas.
- **Solución:** la reparación lee clientes y ledger de nuevo dentro del candado y solo reescribe a los clientes descuadrados. También: anular desde Reportes ahora actualiza los clientes en pantalla.
- **Cómo comprobarlo:** `tests/ledgerRepairFresh.test.js` (5, incluida la que muestra el comportamiento viejo) y la prueba «Reconstruir…» de `tests/e2e/reportes-fiado.e2e.spec.js`.
- **Relacionados:** PLAN-FIXEO-CLIENTES-BILLETERA, fase F1.
