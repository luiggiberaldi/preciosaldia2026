# CASO-004 — Cobro «Procesar Pago» de PC estilo Farmacia, y vueltos sin dinero mal anotado

**Fecha:** 2026-11-14
**Estado:** Aplicado (sin commit)
**Auditoría y plan:** [AUDITORIA-COBRO-VUELTOS-BODEGA-VS-FARMACIA-2026-11-14.md](../auditorias/AUDITORIA-COBRO-VUELTOS-BODEGA-VS-FARMACIA-2026-11-14.md) y [2026-11-14-plan-cobro-bodega-alinear-con-farmacia.md](../plans/2026-11-14-plan-cobro-bodega-alinear-con-farmacia.md).

## Qué pidió el dueño
Contrastar el cobro de PC de Bodega con el de Farmacia (con capturas) y la lógica de vueltos; hacer un plan completo y ejecutarlo fase a fase. Decisiones del dueño:
- Vuelto con centavos: opción **«Sugerido»** ($ en billetes enteros + resto en Bs).
- **Sí:** referencia de pago, Biopago, teclado numérico táctil. **No:** Zelle ni Binance de fábrica.
- La tarjeta «Cómo entrega la caja el cambio» de Ajustes se **conecta** al cobro de PC.
- Con vuelto, **siempre** sale la distribución para confirmar después de COBRAR (cambió de opinión sobre el «cobro directo» al verlo).
- De fábrica **ningún** método pide referencia.
- Durante el trabajo: «que no se vea apretada» la zona del vuelto y que los billetes no salgan como círculos.

## Qué se hizo

| Fase | Qué cambia para el cajero | Archivos |
|---|---|---|
| 1 | Un faltante de hasta $0,01 ya no se pierde: queda en `redondeoUsd` de la venta (ERR-009). El modal del vuelto muestra Bs con 2 decimales (ERR-010). `Esc` dentro de un campo con monto solo lo borra; con el modal del vuelto abierto, `Esc` cierra solo el modal (ERR-011) | `utils/checkoutProcessor.js`, `CheckoutModalPOS/components/ChangeConfirmationModal.jsx`, `components/PaymentInputs.jsx` |
| 2 | Nada visible: `index.jsx` (811 líneas) se partió en piezas como Farmacia | `CheckoutModalPOS/index.jsx` + `parts/useCheckoutPosMethods.js`, `useCheckoutPosAmounts.js`, `useCheckoutPosChange.js`, `useCheckoutPosPay.js` |
| 3 | Panel único **TOTAL / PAGADO / FALTA o VUELTO**; botón **«COBRAR $X» / «FALTAN $X»** bajo el resumen; ventana de alto fijo; **«⚡ Completar»** al lado de cada método; atajos **$1 $5 $10 $20 $50 $100** de 44 px (se dejó el $1) | `components/TransactionSummary.jsx`, `PaymentFooter.jsx`, `PaymentInputs.jsx`, `PaymentLeftColumn.jsx`, `index.jsx` |
| 4 | **«¿Cómo entregas el vuelto?»**: Todo en $, Todo en Bs, En $ y Bs, Lo deja (propina), A su billetera. En «En $ y Bs» el otro campo se llena solo («auto») | `components/ChangeCard.jsx` (nuevo), `parts/changeReparto.js` (nuevo), `parts/useCheckoutPosChange.js` |
| 5 | **«Sugerido: $3 + Bs …»** cuando el vuelto tiene centavos (los dólares no tienen monedas). Respeta Ajustes → Caja & Vuelto (billete más pequeño, redondeo «a favor de la tienda») y el efectivo en $ de la gaveta. «Todo en $» con centavos avisa (no bloquea) | `parts/changeReparto.js` (`calcularSugerido`, `leerPrefsVuelto`), `ChangeCard.jsx` |
| 6 | **F9** dentro del cobro cobra (si falta repartir el vuelto, avisa). **Enter** en el último campo cobra. La confirmación del vuelto queda enfocada: **Enter** confirma | `parts/useCheckoutPosPay.js`, `index.jsx`, `KeyboardHelpModal.jsx` |
| 7 | **Biopago** de fábrica (Bs). **Referencia de pago (últimos 4)** por método en Ajustes → Métodos de pago (No / Opcional / Obligatoria; de fábrica todos en No); avisa referencias repetidas del día; sale en recibo, WhatsApp, ticket PDF/HTML e impresora. **Teclado numérico táctil** con interruptor en Ajustes → Ventas → Terminal & Cobro (Automático / Siempre / Nunca) | `config/paymentMethods.js`, `Settings/PaymentMethodsManager.jsx`, `utils/paymentReference.js` (nuevo), `ReceiptModal.jsx`, `ReceiptShareHelper.js`, `utils/ticketGenerator.js`, `utils/ticketHtmlTemplate.js`, `services/PrinterSerial.js`, `core/FinancialEngine.js`, `views/CustomersView.jsx`, `views/OwnerMonitorView.jsx`, `hooks/useCoarsePointer.js` (nuevo), `components/NumericKeypad.jsx` (nuevo), `parts/keypadInput.js` (nuevo), `Settings/TouchKeypadSetting.jsx` (nuevo), `Settings/tabs/SettingsTabVentas.jsx` |

**Retoque visual pedido por el dueño:** en Bodega `rounded-xl` vale 28 px (tokens), así que los billetes salían como círculos y los botones del vuelto como píldoras. Los billetes ahora son rectángulos de esquinas de 10 px; el vuelto va en 3 filas (Sugerido sola; Todo en $ · Todo en Bs · En $ y Bs; Lo deja · Billetera), con esquinas de 12 px y letra de 13 px.

## Qué no cambió
- Las cuentas del procesador (topes del vuelto, propina, billetera, fiado, Cashea, IVA). Solo se añadió el campo `redondeoUsd`.
- El cobro de celular/tablet (`CheckoutModal.jsx`).
- El aviso grande de efectivo en la gaveta de Bodega (CAJA-FONDO-002) se conservó: va en la tarjeta del vuelto y en la confirmación.
- No se trajo nada propio de farmacia (récipe, lotes, descuento por artículo).

## Diferencias con Farmacia (decididas aquí)
- Con vuelto, siempre sale la confirmación (Farmacia cobra directo en PC).
- Atajo de $1 (Farmacia no lo tiene).
- Opción «Sugerido» y aviso en «Todo en $» con centavos (Farmacia no los tiene).
- Aviso de efectivo de Bodega en lugar de la línea simple de Farmacia.
- Sin Zelle ni Binance de fábrica; de fábrica ningún método pide referencia.
- «Bio Pago» y «Biopago» se tratan como el mismo nombre al quitar duplicados (comparación sin espacios).

## Pruebas
- Nuevas (vitest): `tests/redondeoUsd.test.js` (3), `tests/cobroSugerido.test.js` (11), `tests/vueltoRepartoAuto.test.js` (11, de Farmacia), `tests/tecladoCobroTactil.test.js` (13, de Farmacia), `tests/referenciaPago.test.js` (11, de Farmacia, ajustada a Bodega).
- Nueva (navegador, 1366×768): `tests/e2e/cobro-pos.e2e.spec.js`, con el arnés de la auditoría: pago exacto, Esc, Todo en Bs, propina, En $ y Bs, Sugerido, confirmación siempre, aviso de efectivo, F9, Enter, referencia, teclado táctil.
- Resultados (2026-11-14): pruebas del cobro 157 de 157 (15 archivos). Batería completa: 2296 pasan y 3 fallan, las 3 de licencias (`licenseMonitoringMissing`, `licensePolicy`), que ya fallaban antes de este caso. Navegador: `cobro-pos.e2e.spec.js` 17 de 17 (1366×768 y 1024×768).
- Cómo correr la prueba de navegador: `bunx playwright test tests/e2e/cobro-pos.e2e.spec.js`. Si el puerto 4173 lo ocupa otra app (pasó con Farmacia abierta), usar otro servidor y `SUPERVISOR_E2E_BASE_URL=http://localhost:<puerto>` con una configuración sin `webServer`.
- **No verificado:** laptop táctil real; impresora térmica y ticket PDF con referencia (solo por código); el cobro con datos reales de varios días (cuadre del cierre).

## Errores
- [ERR-009](../ERRORES.md): faltante de hasta $0,01 sin rastro. Resuelto.
- [ERR-010](../ERRORES.md): Bs con 3 decimales en la confirmación del vuelto. Resuelto.
- [ERR-011](../ERRORES.md): `Esc` cerraba todo el cobro. Resuelto.
- [ERR-012](../ERRORES.md): «Todo en $» anotaba dólares con centavos que no existen. Mitigado con «Sugerido» y aviso.
