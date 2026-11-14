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

De fábrica: Efectivo Bs, Pago Móvil, Punto de Venta, Efectivo USD, Efectivo COP, Transferencia COP. El **Saldo a favor** es un método virtual: es crédito interno del cliente, no dinero recibido. El dueño puede agregar métodos propios (`bodega_payment_methods_v1`).

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
