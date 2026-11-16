# Módulo: Apertura y cierre de caja

> Revisado 2026-11-13 leyendo `src/utils/cashShift.js`, `src/utils/cajaEsperada.js`, `src/utils/fondoGaveta.js`, `src/utils/closeDaySummary.js`, `CierreCajaWizard.jsx`, `AperturaCajaModal.jsx`. No verificado con clics en pantalla.

## La idea

La caja es como una **gaveta con un cuaderno**: abrir es escribir arriba «empiezo con $20 y 500 Bs»; debajo se anota cada venta, cobro, gasto y vuelto; cerrar es contar lo que hay y compararlo con lo que el cuaderno dice que debería haber.

## Abrir caja

- Se registra un movimiento `APERTURA_CAJA` con el fondo en USD, Bs y COP. No es ingreso.
- **No se puede abrir una segunda caja** si ya hay una abierta: se reutiliza la existente y se avisa (`CAJA-APERTURA-001`, [ERR-001](../../ERRORES.md)).

## La caja abierta (turno)

- Se identifica con `findOpenCashShift`: la apertura más nueva que no está marcada `cajaCerrada`.
- **No se reinicia a medianoche.** Sigue abierta hasta que exista un cierre manual.
- `isShiftCashMovement` decide qué movimientos cuentan: ignora anuladas, tipos que no son de caja y egresos con `afectaCaja: false`.
- Tipos que cuentan: ventas (contado, fiada, Cashea), cobros de deuda, pagos a proveedores, gastos internos, apertura, avance de efectivo y aporte a caja.
- **Nómina (CASO-005):** los adelantos y pagos al personal son gastos internos con `category: 'nomina'` e `isPayroll: true`, y siempre llevan `afectaCaja: true`. El método decide si baja la gaveta: el efectivo sí, el pago móvil no (el cierre resta cada método por separado). En el PDF del cierre salen en la línea «Nómina» de los gastos. Se anulan solo desde Gestión › Nómina, nunca desde la lista de gastos. Un gasto en efectivo, de nómina o no, exige la caja abierta (`services/gastosInternosService.js`).

## Efectivo esperado

`calcularEfectivoEsperado` (`cajaEsperada.js`) es la **única fórmula**: la usan el cierre y la tarjeta del Inicio, para que muestren el mismo número. El fondo en la gaveta del cobro (`fondoGaveta.js`) usa la misma regla.

## Cerrar caja

`CierreCajaWizard` tiene 3 pasos: **Resumen**, **Conteo** (se cuenta el efectivo a mano) y **Resultado** (semáforo con tolerancias por moneda, `FINANCIAL_EPSILON`). El resumen del día (`closeDaySummary.js`) explica por qué la caja no coincide con el total vendido: las ventas fiadas y de Cashea suman al ingreso pero no entran a la gaveta. Garantiza `cobrado + créditos = ventas netas`. El PDF se genera con `dailyCloseGenerator.js`. La fila «Saldo a favor generado» suma el vuelto enviado a la billetera y el sobrante de abonos, con la misma regla del Inicio (`getGeneratedWalletCredit`, ERR-015). Si hubo ventas pagadas con saldo a favor, bajo «Cobrado» salen «De eso, pagado con saldo a favor» y «Entró hoy a caja y bancos»: ese dinero entró el día que se generó el saldo, no hoy (F4 del plan de clientes).

## Lo que se aprendió

- Un «Efectivo esperado −2.159,35 Bs» nació de dos cajas abiertas y de dar vuelto en Bs sin tener Bs ([CASO-002](../../casos/CASO-002-caja-apertura-y-fondo.md)).

## Archivos principales

`src/utils/cashShift.js`, `src/utils/cajaEsperada.js`, `src/utils/fondoGaveta.js`, `src/utils/closeDaySummary.js`, `src/utils/dailyCloseGenerator.js`, `src/components/Dashboard/`.
