# Reporte: Cliente con dos locales e inventario único (versión 2)

**Fecha:** 13 de noviembre de 2026
**Reemplaza a:** `REPORTE-CLIENTE-DOS-SEDES.md` (versión 1, sigue en el Escritorio, fuera del repo), que recomendaba Listo POS Lite.
**Sistemas evaluados:** Precios al Día Bodega (`luiggiberaldi/preciosaldia2026`) y Listo POS Lite (`luiggiberaldi/listo_pos_lite-`)
**Decisión:** el cliente **necesita las funciones de Precios al Día** (compras, proveedores, gastos internos). Por eso la multicaja se construye **dentro de Precios al Día**, encendida solo para las cuentas que la necesiten. **No** se crea una versión aparte.

---

## 1. Qué necesita el cliente

- Tiene **dos locales físicos** (dos sedes).
- Quiere **un solo sistema** para los dos.
- Quiere **un inventario único**, es decir, los mismos productos y la misma información en ambos locales.
- Necesita compras, proveedores y gastos internos, que solo tiene Precios al Día.
- Por lo tanto habrá **al menos una caja en cada local vendiendo al mismo tiempo**.

> **Pregunta pendiente para el cliente (decide el diseño):**
> ¿Quiere ver **cuánto hay en cada local por separado**, o le basta con **un solo total**?
>
> - **Opción A, stock compartido:** "Tengo 10 harinas en total, me da igual dónde estén."
> - **Opción B, stock por sede:** "Tengo 6 en el local A y 4 en el B, y quiero ver el total." Es lo más común con dos tiendas físicas, porque así el sistema no deja vender en A algo que solo hay en B.
>
> Si elige la B, la sede tiene que estar en el diseño **desde el primer día** del libro de movimientos, no agregarse después.

---

## 2. Cómo están los dos sistemas

| | Precios al Día | Listo POS Lite |
|---|---|---|
| Tamaño | ~90.000 líneas, 355 archivos | ~39.000 líneas, 177 archivos |
| Funciones | Compras y proveedores, gastos internos, Cashea, asistente IA, arqueo rápido, Modo Supervisor completo, ventas en espera… | Lo básico de un punto de venta |
| Varias cajas vendiendo a la vez | ❌ Una sola caja vende; los demás equipos son monitores | 🟡 Tiene la base, pero el stock todavía se puede descuadrar |
| Ventas e inventario en el servidor | ❌ Todo se calcula en la caja y se sube como documento (`sync_documents`) | ✅ `api/checkout.js`, `api/inventory-operation.js`, `api/kardex.js` |
| Letra por caja, numeración por caja, lista de equipos | ❌ | ✅ (migración `014_register_codes.sql`) |

**Algo que Precios al Día ya tiene:** el monitor puede **vender a distancia a través de la caja principal** (`supervisor.sale.create`, migración `20261029_supervisor_remote_sales.sql`). El monitor arma la venta y la caja principal la registra con su catálogo. Como el stock lo lleva una sola caja, **no se descuadra**. Pero tiene límites:

- La caja principal del local A tiene que estar **encendida y con internet** para que el local B pueda vender.
- Si la caja no toma la venta en **2 minutos**, la venta caduca.
- Solo acepta ventas **de contado** (no fiado).
- El local B **no puede vender sin internet**.

Sirve como puente provisional, no como solución para dos tiendas con clientes en cola.

---

## 2b. Ya existe un intento: `preciosaldia-multilocal`

Repo `luiggiberaldi/preciosaldia-multilocal` (público, sin llaves expuestas). Es una copia de Precios al Día (v2.2.0, ~80.000 líneas) con trabajo multisede del 29 de septiembre al 9 de octubre de 2026.

**Lo que ya tiene y sirve:**
- **Decisiones de producto tomadas** (`docs/DECISIONES-PENDIENTES-SYNC-MULTISEDE.md`): inventario **por sede** (D1, es la opción B); clientes y fiados compartidos, pero cada abono guarda su sede (D3); **sin traslados entre sedes** por ahora (D6); qué pasa sin internet (vender, avisar y dejar la diferencia para que el dueño la revise).
- **Libro de movimientos de stock en el servidor** (`supabase/migrations/007_stock_ledger.sql`): cada venta, anulación o ajuste es un movimiento con ID único; el stock = conteo inicial + movimientos. Es justo la pieza P3.
- Lista de equipos, límite por licencia y "permiso sin internet" (`supabase/functions/offline-lease`).
- Arreglos de sincronización entre sedes y una prueba con dos navegadores (con servidor simulado).

**Lo que le falta:**
- Las **compras** (`RECEIPT`) todavía no generan movimientos; solo ventas, anulaciones y ediciones.
- Los **fiados** no están en un libro de movimientos.
- Nunca se probó con dos cajas reales ni se activó para un cliente.
- **Quedó atrás de Precios al Día:** desde el 9 de octubre, Precios al Día sumó un mes de trabajo (ventas y compras desde el Supervisor, IVA, respaldos…) que el multilocal no tiene.

**Conclusión:** no seguirlo como producto aparte (volvería a separarse de Precios al Día), sino **usarlo como fuente de piezas y de diseño**: llevar a Precios al Día, detrás del interruptor, el libro de stock, el contexto por sede, el permiso sin internet y las decisiones D1–D10. Esto **recorta el plan de la sección 4** en unas 2–3 semanas, porque el diseño de P3 y P4 ya está pensado y en parte escrito.

---

## 3. Por qué no hacer una versión aparte

Hoy ya se mantienen Precios al Día Bodega, Farmacia y Listo. Una copia más ("Precios al Día multicaja") obligaría a arreglar cada error en 3 o 4 lugares, y con el tiempo las copias se separan hasta que no se pueden volver a juntar.

Tampoco conviene llevar las funciones de Precios al Día hacia Listo: son unas 50.000 líneas, mucho más trabajo que llevar la parte de varias cajas en la dirección contraria.

**Camino elegido:** multicaja **dentro de Precios al Día**, con un **interruptor por cuenta**. Las cuentas normales siguen exactamente igual que hoy, con el Modo Supervisor intacto, y solo la cuenta de este cliente usa el motor nuevo.

---

## 4. Plan de trabajo en Precios al Día

| Parte | Qué es | De dónde sale | Tiempo aprox. |
|---|---|---|---|
| P0 | Interruptor por cuenta (`multicaja` encendido o apagado) y equipos con letra (A, B…) | Se trae de Listo: `account_devices`, `register_code`, migración 014 | 1 semana |
| P1 | Turnos y cierres por caja | Plan M1 de Listo | 1–1,5 semanas |
| P2 | Equipos "solo consulta" (el teléfono del dueño no gasta un cupo de caja) | Plan M2 de Listo | 3 días |
| P3 | Stock y fiados calculados en el servidor con un libro de movimientos | `api/checkout.js`, `api/inventory-operation.js`, `api/kardex.js` de Listo, adaptados a compras y proveedores de Precios al Día | 4–5 semanas |
| P4 | (Si elige la opción B) stock por sede, traslados entre locales y reportes por local | Nuevo | +2–3 semanas |
| P5 | Banco de pruebas con dos cajas | Plan M4 de Listo | 1 semana |
| **Total** | | | **~2,5–3 meses (A) · ~3–3,5 meses (B)** |

**Lo más delicado:** las compras de mercancía, los ajustes del supervisor y las anulaciones de Precios al Día también mueven el stock. En el motor nuevo **todas** tienen que pasar por el libro de movimientos, no solo las ventas.

---

## 5. Cómo entregar sin hacer esperar al cliente

1. **Mes 1:** el cliente empieza en **un solo local** con Precios al Día normal y carga productos, proveedores y compras.
2. **Opcional, si urge abrir el local B antes:** usar la venta a distancia del Supervisor como puente, sabiendo que depende de que la caja del local A esté encendida, solo acepta contado y no funciona sin internet.
3. **Al terminar P0–P3 y pasar P5:** se enciende el interruptor multicaja en su cuenta y el local B pasa a tener su propia caja.

**Prueba mínima antes de encender el segundo local:**
- Dos cajas venden el mismo producto 10 veces cada una → stock final = inicial − 20.
- Una caja sin internet vende 5, se reconecta → nada se duplica ni se pierde.
- El mismo cliente fía en A y abona en B a la vez → saldo correcto.
- A y B abren y cierran turno por separado → cada cuadre sale bien y el consolidado del día suma bien.

---

## 6. Lo que no hay que hacer

- **No crear una copia aparte de Precios al Día para multicaja.**
- **No encender dos cajas que vendan a la vez** antes de que pase el banco de pruebas: el cliente vería descuadres de inventario y de caja.
- **No cambiar el Modo Supervisor de las cuentas actuales.** Todo lo nuevo va detrás del interruptor.

---

## 7. Antes de empezar (urgente, aparte de este cliente)

El repo público `estaci-n-listo-pos-lite` tiene escrita la llave `service_role` de la base de datos de producción de Listo, y un endpoint (`/api/delete-user`) que borra cuentas sin pedir login. Hay que **cambiar esa llave en Supabase** y cerrar el endpoint antes de seguir.

---

## 8. Próximo paso

Preguntarle al cliente: **¿quiere el stock separado por local o un solo total?** Con esa respuesta se arma el plan detallado en Precios al Día, con fechas, y se fija el precio y la fecha de entrega.
