# Glosario

Palabras que aparecen en el sistema, explicadas con comparaciones cotidianas.

| Palabra | Qué es |
|---|---|
| **Apertura de caja** | Anotar con cuánto dinero empieza el turno, como escribir en el cuaderno «arranco con $20 y 500 Bs». Es un registro de tipo `APERTURA_CAJA`; no es una venta |
| **Fondo de la gaveta** | El efectivo que realmente hay en la gaveta ahora: apertura + cobros en efectivo − vueltos entregados (`src/utils/fondoGaveta.js`) |
| **Efectivo esperado** | Lo que *debería* haber en la gaveta según los registros. Al cerrar se compara con lo que se cuenta a mano |
| **Turno / caja abierta** | Desde una apertura hasta su cierre. No se reinicia a medianoche: sigue abierta hasta que se cierra (`src/utils/cashShift.js`) |
| **Cierre de caja** | Contar el efectivo, compararlo con el esperado y guardar el resumen del día (asistente de 3 pasos: Resumen, Conteo, Resultado) |
| **Fiado** | Venta que el cliente paga después. Genera una deuda (`VENTA_FIADA`) |
| **Abono / cobro de deuda** | Pago de una deuda (`COBRO_DEUDA`) |
| **Saldo a favor** | Dinero que el cliente dejó guardado, como un monedero; se gasta en ventas |
| **Cashea** | Financiamiento donde Cashea paga parte de la venta; lo financiado lo debe Cashea, no el cliente (`VENTA_CASHEA`) |
| **Vuelto** | El cambio que se entrega al cliente; puede darse en USD, Bs o COP |
| **Tasa BCV** | Precio oficial del dólar en bolívares. Hay también tasa paralela/USDT y euro |
| **Granel** | Producto que se vende por peso o volumen (kg, litros, gramos, ml). El stock siempre se guarda en kg/L |
| **Bulto** | Paquete que trae varias unidades. El stock se guarda en **unidades**, no en bultos |
| **Anular** | Deshacer una venta sin borrarla: queda marcada `ANULADA` y el stock vuelve |
| **Supervisor** | La app en el celular del dueño para ver la caja y mandarle órdenes |
| **Vinculación** | Emparejar el celular del dueño con una caja, como ligar dos radios al mismo canal |
| **Orden / comando** | Instrucción que el Supervisor manda a la caja (por ejemplo, cambiar un precio) |
| **Offline-first** | Funciona sin internet y sincroniza después |
| **Candado de escritura (`withLock`)** | Turno para escribir datos: evita que dos acciones a la vez se pisen |
| **Egress** | Datos que salen de Supabase hacia las cajas; consumirlos de más cuesta dinero |
| **Estación Maestra** | Proyecto aparte donde se administran las licencias |
