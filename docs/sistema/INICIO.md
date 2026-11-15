# Empieza aquí: cómo funciona Bodega

> Revisado 2026-11-13. Escrito a partir de `AGENT.md` y de las cabeceras del código; **no se verificó con clics en pantalla**. Si algo no coincide con el código, es un error de documentación: regístralo en [ERRORES.md](../ERRORES.md) y corrígelo.

## En una frase

Es la **caja registradora de una bodega venezolana**. Vende, descuenta del inventario, lleva las deudas de los clientes, cierra la caja del día y deja que el dueño la vea desde su celular. Funciona **sin internet**, como una libreta que se guarda en el propio equipo, y se copia a la nube cuando hay conexión.

## Quiénes la usan

| Persona | Qué puede hacer | De dónde sale |
|---|---|---|
| **Administrador** (`ADMIN`) | Todo | `src/hooks/store/useAuthStore.js` |
| **Cajero** (`CAJERO`) | Vender, ver inventario y clientes. No abre Reportes ni Ajustes (ni con Ctrl+K) | `src/app/roleTabs.js` |
| **Supervisor** (el dueño, de forma remota) | Ve ventas, inventario y caja desde su celular o PC y manda órdenes a la caja | [Supervisor](modulos/SUPERVISOR.md) |

## Las pantallas

| Pantalla (id interno) | Para qué sirve | Documento |
|---|---|---|
| **Inicio** (`inicio`) | Resumen del día, apertura y cierre de caja, efectivo esperado | [Cierre de caja](modulos/CIERRE-DE-CAJA.md) |
| **Vender** (`ventas`) | Cesta, cobro, vuelto, recibo | [Venta](modulos/VENTA.md) |
| **Inventario** (`catalogo`) | Productos, precios, stock | [Inventario](modulos/INVENTARIO.md) |
| **Gestión** (`clientes`) | Clientes (fiado, abonos, saldo a favor), proveedores y **Nómina** (solo Administrador: adelantos, pagos, bonos, descuentos y mercancía que se lleva el empleado) | [CASO-005](../casos/CASO-005-nomina-simple.md) |
| **Reportes** (`reportes`) | Ventas y ganancia por período. Solo Administrador | — |
| **Ajustes** (`ajustes`) | Negocio (incluye Nómina: precio de la mercancía de empleados), usuarios, sistema, licencia, supervisor. Solo Administrador | — |

Además existen la vista del dueño (**Supervisor / Monitor**) y la calculadora.

## Los principios que explican casi todo

1. **El dinero va en dólares.** Se guarda en USD y los bolívares se calculan con la tasa del momento. Ver [Reglas del dinero](modulos/REGLAS-DEL-DINERO.md).
2. **Primero se guarda en el equipo.** La venta queda en el equipo y luego sube a la nube. Por eso la caja no se detiene si cae internet.
3. **Todo movimiento deja rastro.** Ventas, cobros, gastos, aperturas y cierres son registros que no se borran: se anulan.
4. **Una venta es todo o nada.** Si algo falla a la mitad, no queda a medias.

## Dónde guarda las cosas

| Qué | Dónde |
|---|---|
| Ventas, productos, clientes | Almacén local del navegador (IndexedDB) vía `src/utils/storageService.js`; claves `bodega_sales_v1`, `bodega_products_v1`, `bodega_customers_v1` |
| Copia en la nube | Supabase (`sync_documents`, respaldos) |
| Licencias | Estación Maestra (otro proyecto Supabase) |

## Mapa de carpetas

| Carpeta | Qué hay |
|---|---|
| `src/core/` | Motor financiero y almacén de estado |
| `src/utils/` | Procesos de negocio: cobrar, anular, cerrar caja, dinero, granel |
| `src/services/` | Servicios (auditoría, tasas, supervisor) |
| `src/hooks/` | Lógica de pantallas (cobro, inicio, sincronización) |
| `src/views/` y `src/components/` | Pantallas y piezas visuales |
| `supabase/migrations/` | Cambios de base de datos |
| `docs/` | Esta documentación, planes, informes y auditorías |

Para el detalle técnico completo, ver [AGENT.md](../../AGENT.md). Palabras difíciles: [Glosario](GLOSARIO.md).
