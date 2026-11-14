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
- **Solución:** ver el plan [2026-10-21-fix-deduccion-stock-bultos-unidades](plans/2026-10-21-fix-deduccion-stock-bultos-unidades.md) y el informe `REPORTE-FIX-STOCK-BULTOS-2026-10-21.md` (raíz).
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
- **Solución:** ver `REPORTE-CAUSA-RAIZ-EGRESS-Y-SOLUCION.md` (raíz).
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
