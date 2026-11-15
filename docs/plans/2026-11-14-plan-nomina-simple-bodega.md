# Plan: «Nómina simple» para Precios al Día Bodega

Fecha: 14-11-2026 · Rama base: `feat/inicio-estilo-farmacia`
Origen: [docs/auditorias/AUDITORIA-NOMINA-DONDE-JUANCHO-PARA-BODEGA-2026-11-14.md](../auditorias/AUDITORIA-NOMINA-DONDE-JUANCHO-PARA-BODEGA-2026-11-14.md) (estudio de la nómina de Donde Juancho, con sus errores E1–E9).

## Resumen

Bodega no tiene nómina. Hoy el dueño puede pagar un sueldo como «Gasto › Personal», pero no hay ficha de empleado, ni saldo, ni historial.
Este plan crea una **nómina propia y sencilla**: ficha de empleado, sueldo en $, **adelantos (vales)**, bonos y descuentos manuales,
y el **pago del periodo**. Todo sale de la caja como un gasto de categoría «Nómina» y cuadra en el cierre.

Se usan las **ideas** de Donde Juancho, no su código. Cada uno de sus tres errores graves (E1–E3) tiene aquí una regla que lo evita
y una prueba que lo demuestra.

> **Analogía:** cada empleado tiene una **tarjeta** (su ficha) y un **sobre** por periodo. Cada vale, bono o pago es un papelito
> que se mete en el sobre. Si el papelito saca plata de la gaveta, también se pone uno igual en la caja registradora.
> Si te equivocas, **tachas los dos papelitos**; nunca escribes uno nuevo al revés.

---

## Decisiones del dueño (14-11-2026)

| # | Pregunta | Decisión |
|---|---|---|
| D1 | ¿Cada cuánto se paga? | **Lo elige cada empleado:** semanal, quincenal o mensual |
| D2 | ¿Moneda del sueldo y tasa? | **Sueldo en $.** Se paga en $ o en Bs; en Bs con **la tasa de la tienda** (`effectiveRate` de `RateContext`, la misma con la que se vende) |
| D3 | ¿Mercancía descontada del sueldo? | **No por ahora.** Queda como fase opcional F6 |
| D4 | ¿Quién da adelantos? | **Solo el Administrador**, dentro de Gestión › Nómina |
| D5 | ¿Anular algo de un turno de caja ya cerrado? | **No.** Solo se anula lo del turno abierto. Para corregir algo viejo se registra un bono o un descuento en el periodo |
| D6 | ¿Tope de adelantos? | **No pasar del saldo del periodo.** Pasarse exige confirmación del Administrador y la diferencia queda como deuda para el periodo siguiente |
| D7 | ¿Nómina en el Supervisor (teléfono)? | **No por ahora.** Los pagos ya viajan con las ventas como gasto «Nómina». Un resumen de solo lectura queda como fase opcional F7 |
| D8 | ¿Conceptos además del sueldo? | Sin preferencia. **Por defecto: bono manual y descuento manual**, con nota. Pago por día y comisiones quedan fuera |
| D9 | ¿Dónde vive la nómina? (cambio del dueño, mismo día) | **En la pestaña «Clientes», que pasa a llamarse «Gestión»**, con sub-pestañas Clientes · Proveedores · Nómina. La de Nómina solo la ve el Administrador. Reemplaza la idea de ponerla en Ajustes |

---

## Reglas del negocio

1. **Periodos** (hora de Venezuela, `America/Caracas`, intervalo `[inicio, fin)`):
   - Semanal: lunes a domingo.
   - Quincenal: del 1 al 15 y del 16 al último día del mes.
   - Mensual: el mes calendario.
   - El id del periodo se calcula, no se guarda aparte: `S-2026-W46`, `Q-2026-11-1`, `Q-2026-11-2`, `M-2026-11`.
2. **Sueldo congelado:** el primer renglón de un periodo guarda `sueldoPeriodoUsd` (la «foto» del sueldo). Si el sueldo cambia
   a mitad de periodo, el periodo en curso sigue con la foto y el cambio vale desde el siguiente.
   Si el empleado cambia de frecuencia, el cambio también vale desde el siguiente periodo.
3. **Saldo por pagar** = sueldo congelado + bonos − descuentos − adelantos − pagos (+ deuda arrastrada, que entra como un descuento).
   **Se calcula siempre** a partir de los renglones activos; no se guarda.
4. **Adelanto y pago** sacan dinero: cada uno crea **un** `GASTO_INTERNO` en `bodega_sales_v1`.
   **Bono y descuento** no mueven dinero: solo cambian el saldo, no tocan la caja.
5. **Tope (D6):** un adelanto o pago mayor que el saldo pide una segunda confirmación («Va a pagar $X de más; queda debiendo
   $X para el próximo periodo»). Al aceptar, se crea en el periodo siguiente un renglón `DESCUENTO` con `origen: 'ARRASTRE'` por esa diferencia.
   **Nunca** se recorta un saldo negativo a 0 sin avisar (evita E6).
6. **Efectivo exige caja abierta** (`findOpenCashShift`). Sin caja abierta, el efectivo se rechaza («Abre la caja para pagar en efectivo»)
   y el pago móvil o transferencia se acepta con `afectaCaja: false`.
7. **Anular (D5):** se marca el renglón `ANULADO` y su movimiento de caja `status: 'ANULADA'`, en la misma escritura.
   Solo si el movimiento pertenece al **turno abierto** (`isRecordInOpenCashShift`). Bono y descuento se pueden anular mientras su periodo no esté pagado completo.
   Nunca se crea un movimiento «al revés» (evita E2).
8. **Permisos (D4, D9):** la pestaña principal «Gestión» la ve también el Cajero (por sus clientes y proveedores), así que la sub-pestaña **Nómina se oculta al Cajero** con una regla propia (`canSeePayroll`), y además el servicio revisa el rol
   y **pide el PIN del Administrador** en cada adelanto, pago o anulación, **aunque `requireLogin` esté apagado** (evita E4).
9. **Montos:** todo con `src/utils/dinero.js` (`round2`, `mulR`, `subR`, `sumR`). En Bs se guarda la tasa usada con 4 decimales
   y el monto en Bs con 2. Al validar un pago en Bs se compara **en Bs**, no convirtiendo a $ con una tasa redondeada (evita E7).
10. **Dinero digital visible (evita E8):** el movimiento de nómina se guarda como cualquier gasto de Bodega, con `afectaCaja: true`.
    El **método** decide si baja la gaveta: efectivo sí, pago móvil o transferencia no (el cierre resta cada método por separado).
    Así el pago digital **sí aparece** en Reportes › Gastos y en el cierre como «Nómina». El renglón guarda `saleDeGaveta` para la pantalla.
    *(Ajuste del 14-11-2026 al implementar: la idea original de `afectaCaja: false` lo habría escondido del cierre.)*

---

## Modelo de datos (local, sin internet)

| Clave nueva | Qué guarda |
|---|---|
| `bodega_employees_v1` | `{ id, nombre, cedula, cargo, telefono, sueldoUsd, frecuencia: 'semanal'\|'quincenal'\|'mensual', activo, fechaIngreso, nota, creadoPor, creadoAt, actualizadoAt }` |
| `bodega_payroll_entries_v1` | Lista única de renglones: `{ id, employeeId, periodoId, sueldoPeriodoUsd, tipo: 'ADELANTO'\|'PAGO'\|'BONO'\|'DESCUENTO', origen: 'MANUAL'\|'ARRASTRE', montoUsd, moneda: 'USD'\|'BS', montoBs, tasa, metodoId, afectaCaja, movimientoCajaId, nota, status: 'ACTIVO'\|'ANULADO', actor, timestamp, anuladoPor, anuladoAt, idempotencyKey }` |

Movimiento de caja (en `bodega_sales_v1`, con la misma forma que crea hoy `registrarGasto`, montos **negativos**):

```js
{ id, timestamp, tipo: 'GASTO_INTERNO', category: 'nomina', isPayroll: true,
  payrollEntryId, employeeId, afectaCaja, cajaCerrada: false,
  description: 'Adelanto: María Pérez (Q-2026-11-2)', totalUsd: -10, totalBs: -4870,
  paymentMethod, payments: [{ methodId, amountUsd, amountBs, currency, methodLabel: 'Nómina' }],
  items: [{ name: 'Nómina: …', qty: 1, priceUsd: -10, costBs: 0 }], actor }
```

- Empleados **no** son usuarios del sistema. Un empleado no necesita PIN ni entrar a la app.
- Desactivar un empleado lo oculta de la lista, pero no borra su historial. **No hay borrar.**
- Las dos claves nuevas entran en `src/config/backupKeys.js`. **No** van a la nube (D7). El movimiento de caja sí viaja con las ventas, como ya pasa con cualquier gasto.

---

## Cómo se evita cada error de Donde Juancho

| Error | Regla en Bodega | Prueba que lo demuestra |
|---|---|---|
| **E1** Liquidar a uno borra los consumos de los demás | Toda escritura lee la lista **completa y fresca dentro del candado**, cambia solo los renglones afectados y guarda la lista completa. Prohibido guardar una lista filtrada | Pagar a dos empleados en dos periodos y comprobar que los renglones del otro siguen intactos |
| **E2** Anular un pago en efectivo resta otra vez | Anular = marcar `ANULADO` + `ANULADA`, sin movimiento nuevo. El cierre ya ignora `ANULADA` (`isShiftCashMovement`) | Adelanto de $10 → efectivo esperado baja $10 → anular → vuelve al valor anterior |
| **E3** El botón «Liquidar» no funcionaba (nombres distintos, sin tasa) | Un solo contrato de datos en `payrollModel.js`, usado por la pantalla y el servicio. La tasa la pone el servicio desde `effectiveRate`, no la pantalla | Prueba e2e que pulsa el botón real «Pagar» en $ y en Bs |
| E4 Sin `requireLogin` cualquiera es ADMIN | PIN de Administrador siempre | Prueba del servicio con `requireLogin` apagado |
| E5 Supervisor cambia sueldos | Nada de nómina en el Supervisor (D7) | — |
| E6 Neto negativo recortado a 0 | Arrastre explícito (regla 5) | Pagar de más → aparece el arrastre en el periodo siguiente |
| E7 Tolerancia en Bs demasiado grande | Comparar en Bs (regla 9) | Tasa con 4 decimales, sin centavos fantasma |
| E8 Pago digital no aparece en el cierre | Línea propia (regla 10) | Pago móvil aparece en el cierre y no baja el efectivo esperado |

---

## Barandas de escritura (todas las operaciones del servicio)

1. `withLock('pos_write_lock', …)`: el mismo candado que usan ventas y autoconsumo, así un pago no pisa una venta simultánea.
2. Dentro del candado se leen **frescos** `bodega_payroll_entries_v1` y `bodega_sales_v1` (nunca la lista que tiene la pantalla).
3. **Idempotencia:** la pantalla genera un `idempotencyKey` al abrir el formulario. Si ya existe un renglón con esa llave, se devuelve ese renglón y no se crea otro (doble clic = un solo pago).
4. **Orden de escritura y recuperación:** primero el movimiento de caja, después el renglón, ambos con `writeVerifiedValue` (`src/utils/verifiedWrite.js`).
   Al abrir Nómina, una función `recoverPayroll()` busca movimientos `isPayroll` sin renglón (o renglones sin movimiento) y los completa o los marca `ANULADA`,
   con anotación en la auditoría. Es como revisar al abrir la tienda que cada papelito de la caja tenga su pareja en el sobre.
5. `auditLog('NOMINA', 'ADELANTO' | 'PAGO' | 'BONO' | 'DESCUENTO' | 'ANULAR' | 'EMPLEADO_*', …)` con actor, monto y periodo.

---

## Pantallas

**Gestión › Nómina** (D9). La pestaña principal `clientes` conserva su id pero su nombre pasa a «Gestión» (barra en `App.jsx`, `MiniNav.jsx`, recorrido de bienvenida). Dentro de `CustomersView.jsx`, que ya tiene sub-pestañas `clientes | proveedores`, se agrega `nomina`, visible solo para el Administrador. Archivo nuevo `src/components/Payroll/PayrollPanel.jsx`.

- **Lista:** nombre, cargo, frecuencia, periodo actual y **«Por pagar: $X (Bs Y)»**. Filtro activos / inactivos. Botón «Nuevo empleado».
- **Ficha del empleado** (`EmployeeFormModal.jsx`): datos, sueldo en $, frecuencia, fecha de ingreso. Aviso si se cambia el sueldo: «vale desde el próximo periodo».
- **Detalle por periodo** (`EmployeePayrollPanel.jsx`): renglones del periodo con su estado, selector de periodos anteriores, saldo calculado.
  Botones **«Dar adelanto»**, **«Bono»**, **«Descuento»**, **«Pagar periodo»** (sugiere el saldo completo).
- **Formulario de dinero** (`PayrollEntryModal.jsx`): monto, moneda ($ / Bs con la tasa del día a la vista), método de pago (de `bodega_payment_methods_v1`), nota,
  confirmación y PIN de Administrador. Si se pasa del saldo, segunda confirmación (regla 5).
- **Recibo:** ticket térmico y PDF con `ticketGenerator.js` / `printerUtils.js` (nombre, periodo, concepto, monto, saldo que queda, firma).
- **Reportes › Gastos:** categoría `nomina` («Nómina») en `CATEGORY_META` de `ReportsExpensesTab.jsx`.
- **Cierre:** `nomina: 'Nómina'` en `CATEGORY_LABELS` de `dailyCloseGenerator.js`, más la línea de pagos digitales (regla 10).
- **Gastos internos:** el movimiento de nómina aparece en la lista de gastos, pero el botón «Anular» de ahí queda **bloqueado** para `isPayroll`
  con el mensaje «Se anula desde Gestión › Nómina». Si no, se anularía el papelito de la caja y no el del sobre.

---

## Fases

Cada fase es **un commit aparte**, con sus pruebas y su entrada de bitácora. Este trabajo toca dinero, así que lleva **caso `CASO-NNN`**
(se abre al empezar F0; revisar antes el último número en `docs/casos/INDICE.md`).

| Fase | Qué | Archivos | Tamaño | Riesgo | Depende de |
|---|---|---|---|---|---|
| **F0** | Reforzar «Gastos internos»: `registrarGasto` y `anularGasto` con `withLock`, lectura fresca, `round2`, `actor` y caja abierta para efectivo | `useGastosInternos.js` + prueba | ½ día | Bajo (lleva arnés del flujo actual) | — |
| **F1** | Modelo puro: periodos semanal/quincenal/mensual, id de periodo, sueldo congelado, saldo, arrastre, normalizadores, contrato único de datos | `src/utils/payrollModel.js` + `tests/payrollModel.test.js` | 1 día | Bajo | — |
| **F2** | Servicio: empleados (crear, editar, desactivar), adelanto, bono, descuento, pago, anular, candado, idempotencia, recuperación, auditoría, PIN; claves en `backupKeys.js` | `src/services/payrollService.js` + `tests/payrollService.test.js` | 2 días | Medio (dinero) | F0, F1 |
| **F3** | Renombrar «Clientes» a «Gestión» + sub-pestaña Nómina + recibo + «Nómina» en Reportes y cierre + bloqueo de anular desde Gastos internos | `App.jsx`, `MiniNav.jsx`, `CustomersView.jsx`, `components/Payroll/*` nuevos, `ReportsExpensesTab.jsx`, `dailyCloseGenerator.js`, lista de gastos | 2 días | Medio | F2 |
| **F4** | Arnés e2e (Playwright): abrir caja → crear empleado → adelanto en efectivo → pago en Bs → cierre cuadra → anular → cierre vuelve a cuadrar → respaldo y restauración | `tests/e2e/nomina.e2e.spec.js` | 1 día | Bajo | F3 |
| F5 | Revisión con el dueño en el equipo real (impresora térmica, tasa del día) | — | ½ día | — | F4 |
| F6 *(opcional, D3)* — **hecha 2026-11-15** | Mercancía que se lleva el empleado, descontada del sueldo a costo o a venta según Ajustes, con PIN (ver CASO-005 § F6) | — | 2 días | Medio (inventario) | F4 |
| F7 *(opcional, D7)* | Resumen de nómina de solo lectura en el Supervisor | — | Mediano | Medio (nube, lista blanca SQL y JS) | F4 |

**Núcleo (F0–F4): unos 6–7 días de trabajo.** Orden: F0 → F1 → F2 → F3 → F4 → F5.

---

## Pruebas mínimas (arneses)

**Modelo (F1)**
- Periodos: un martes cae en la semana lunes–domingo correcta; el 15 y el 16 caen en quincenas distintas; 28/29/30/31 cierran bien el mes; medianoche en Caracas.
- Saldo con sueldo + bono − descuento − adelanto − pago; renglones `ANULADO` no cuentan.
- Cambio de sueldo a mitad de periodo: el periodo en curso usa la foto.
- Redondeo: $33,33 × 3 = $99,99; Bs con tasa de 4 decimales sin centavos fantasma.

**Servicio (F2)**
- **E1:** pagar a dos empleados en dos periodos; los renglones del otro siguen intactos.
- **E2:** adelanto de $10 en efectivo baja $10 el efectivo esperado; al anular vuelve al valor anterior.
- Doble llamada con la misma `idempotencyKey`: un solo renglón y un solo movimiento.
- Sin caja abierta: efectivo rechazado, pago móvil aceptado con `afectaCaja: false`.
- Anular algo de un turno cerrado: rechazado (D5).
- Pagar de más: pide confirmación y crea el arrastre en el periodo siguiente (D6).
- Cajero, o `requireLogin` apagado sin PIN: rechazado.
- Recuperación: movimiento sin renglón (corte de luz a mitad) se completa o se anula al abrir.
- Respaldo → restaurar conserva empleados y renglones.

**Pantalla y e2e (F3–F4)**
- **E3:** pulsar el botón real «Pagar periodo» en $ y en Bs; el ticket muestra el monto y la tasa correctos.
- El Cajero ve «Gestión» con Clientes y Proveedores, pero **no** la sub-pestaña Nómina.
- Reportes › Gastos y el cierre muestran «Nómina» separada; el pago digital aparece sin bajar la gaveta.
- «Anular» desde Gastos internos está bloqueado para un gasto de nómina.

---

## Puntos abiertos (no frenan F0–F2; se deciden antes de F3)

1. **Tasa al pagar en Bs:** el plan usa la tasa de la tienda del momento (D2). ¿Se permite escribirla a mano en el formulario, o siempre la del día?
2. **Recibo:** ¿basta el ticket térmico, o también hace falta el PDF para enviarlo por WhatsApp?
3. **Gasto «Personal» existente:** los sueldos pagados antes como «Gasto › Personal» se quedan como están (no se migran). Confirmar con el dueño.

## Fuera de alcance

Prestaciones, IVSS, cesta ticket y cualquier cálculo legal; pago por hora o por día; comisiones; horas extra; nómina desde el Supervisor (salvo F7).
