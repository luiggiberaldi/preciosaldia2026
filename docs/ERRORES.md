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

ERR-004 a ERR-006 se reconstruyeron desde informes ya existentes; el detalle completo está en esos informes. ERR-001 a ERR-003 están arreglados en el árbol de trabajo, aún sin commit.

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
