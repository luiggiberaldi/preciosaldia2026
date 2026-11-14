# Módulo: Inventario (pantalla Inventario)

> Revisado 2026-11-13 leyendo `src/utils/granel.js`, `src/utils/productProcessor.js`, `src/components/Products/` y `AGENT.md`. No verificado con clics en pantalla.

## Qué hace

Guarda los productos (nombre, costo, precio, stock, categoría, imagen) y su stock. Alimenta la venta y el Supervisor.

## Reglas del stock

- **El stock se guarda siempre en unidades individuales**, nunca en bultos. Vender 1 caja de 12 descuenta 12 ([ERR-004](../../ERRORES.md)).
- **Granel:** peso o volumen se guarda en kg / litros (hasta 3 decimales). En pantalla se puede ver en gramos/ml (`granel_unit_mode`). Si en modo gramos se escribe un número menor que 1 (por ejemplo 0,5), se interpreta como 500 g. Los productos que no son granel solo aceptan enteros.
- Los bultos se identifican con `packagingType: 'lote'` (o el campo antiguo `unit: 'paquete'`); `'package'` es solo el modo del carrito.

## Precios

- El **costo** es el dato fijo (lo que se pagó); precio y margen son decisiones. El factor de costo = costo ÷ precio = 1 − margen (`productProcessor.js`).
- Bs y COP se calculan con la tasa del momento. Ver [Reglas del dinero](REGLAS-DEL-DINERO.md).
- Hay ajuste de precios en bloque (`BulkPriceAdjustModal`) y modos de precio.

## Piezas de la pantalla

Formulario rápido y asistente de producto, tarjetas, barra de herramientas, categorías, carga de stock por lote (`StockBatchModal`) en `src/components/Products/`.

## Con el Supervisor

El dueño puede crear, editar y borrar productos y ajustar stock por lote desde su celular ([Supervisor](SUPERVISOR.md)). Esos cambios entran como órdenes que la caja valida.

## Archivos principales

`src/utils/granel.js`, `src/utils/productProcessor.js`, `src/views/ProductsView.jsx`, `src/hooks/useProductForm.js`, `src/components/Products/`.
