# Módulo: Venta (pantalla Vender)

> Revisado 2026-11-13 leyendo `src/utils/checkoutProcessor.js`, `src/utils/voidSaleProcessor.js`, `src/config/paymentMethods.js` y `AGENT.md`. No verificado con clics en pantalla.

## Qué hace

Arma la cesta, cobra con uno o varios métodos de pago, calcula el vuelto, descuenta el stock y guarda la venta.

## Cómo se cobra

1. La cesta se arma en `SalesView` (componentes en `src/components/Sales/`).
2. Al cobrar, `checkoutProcessor` valida antes de guardar:
   - la cesta no está vacía;
   - el total es mayor a 0,01 y no es NaN;
   - la tasa efectiva es mayor a 0;
   - el total en Bs coincide con el total en USD × tasa (con una pequeña tolerancia);
   - el vuelto no supera 5 veces el total (anti anomalía).
3. Todo el guardado va dentro de un **candado de escritura** (`withLock('pos_write_lock')`) y la venta se congela (`deepFreeze`) antes de devolverla.
4. Se descuenta el stock en **unidades** (los productos a granel en kg/L). Ver [Inventario](INVENTARIO.md).

## Métodos de pago

De fábrica: Efectivo Bs, Pago Móvil, Punto de Venta, Biopago, Efectivo USD, Efectivo COP, Transferencia COP. Cada método (menos el efectivo) puede pedir **referencia de pago** (últimos 4): No / Opcional / Obligatoria, en Ajustes → Ventas → Caja & Vuelto; de fábrica todos en «No». La referencia se guarda en el pago (`referencia`), sale en recibo y tickets, y el cobro avisa si se repite el mismo día ([CASO-004](../../casos/CASO-004-cobro-pos-estilo-farmacia.md)). El **Saldo a favor** es un método virtual: es crédito interno del cliente, no dinero recibido. El dueño puede agregar métodos propios (`bodega_payment_methods_v1`).

## Cobro de PC («Procesar Pago», CASO-004)

- Arriba a la izquierda, un solo panel: **Total**, **Pagado** y **Falta** (ámbar) o **Vuelto** (verde). Debajo, el botón **«COBRAR $X»** o **«FALTAN $X»**.
- Cada método tiene **«⚡ Completar»** (o la tecla Espacio) para poner lo que falta. Efectivo $ tiene atajos $1…$100.
- **Vuelto:** «¿Cómo entregas el vuelto?» con **Sugerido** ($ en billetes + resto en Bs, solo si el vuelto tiene centavos), **Todo en $**, **Todo en Bs**, **En $ y Bs** (el otro campo se llena solo), **Lo deja (propina)** y **A su billetera** (con cliente).
- El «Sugerido» usa Ajustes → Caja & Vuelto: billete más pequeño y redondeo «a favor de la tienda» (la diferencia queda en caja). «A favor del cliente» no redondea hacia arriba en PC, porque dar de más no se puede anotar en la venta.
- Con vuelto, después de COBRAR **siempre** sale la confirmación de la distribución (Enter confirma, Esc vuelve).
- **Teclado:** F9 abre el cobro y, ya dentro, cobra; Enter en el último campo cobra; Esc en un campo con monto lo borra (no cierra el cobro).
- **Pantalla táctil:** teclado numérico propio (Ajustes → Ventas → Terminal & Cobro: Automático / Siempre / Nunca, por equipo).
- Código: `src/components/Sales/CheckoutModalPOS/` (`parts/` tiene las cuentas de pantalla; `components/` lo que se ve).

## Tipos de venta

Contado (`VENTA`), fiada (`VENTA_FIADA`, genera deuda) y Cashea (`VENTA_CASHEA`). Ver [Glosario](../GLOSARIO.md).

## Aviso de fondo en la gaveta

Si el vuelto en efectivo supera lo que hay en la gaveta, el cobro muestra un aviso legible (`CAJA-FONDO-002`). La cuenta del fondo sale de `src/utils/fondoGaveta.js`, la misma regla del "Efectivo esperado" ([ERR-002](../../ERRORES.md), [CASO-002](../../casos/CASO-002-caja-apertura-y-fondo.md)).

## Anular

`voidSaleProcessor` marca la venta `ANULADA`, devuelve el stock y revierte los movimientos de cartera del cliente. La venta no se borra.

## Reglas que no se rompen

- Toda cuenta de dinero pasa por [`dinero.js`](REGLAS-DEL-DINERO.md).
- Todo guardado de ventas, productos o clientes va dentro del candado.
- Una venta es todo o nada.

## Archivos principales

`src/utils/checkoutProcessor.js`, `src/utils/voidSaleProcessor.js`, `src/hooks/useCheckoutFlow.js`, `src/views/SalesView.jsx`, `src/components/Sales/`.
