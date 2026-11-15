# CASO-002 — Caja: apertura duplicada y fondo real de la gaveta

**Fecha:** 2026-11-13
**Estado:** Aplicado y guardado (commit «fix(caja): …» del 2026-11-13)

## Qué pidió el dueño
Auditar la apertura de caja tras ver «Efectivo esperado −2.159,35 Bs». Informe completo: [AUDITORIA-APERTURA-CAJA-2026-11-13.md](../auditorias/AUDITORIA-APERTURA-CAJA-2026-11-13.md).

## Decisiones del dueño
- Si el vuelto pide más Bs de los que hay: **avisar grande y dar opciones, sin bloquear el cobro**. No redondear a un billete de más.
- Bodega primero; Farmacia después, cuando su otra sesión guarde sus cambios.

## Qué se hizo
Tres arreglos, marcados en el código con `CAJA-APERTURA-001`, `CAJA-FONDO-001` y `CAJA-FONDO-002`:
- No se puede abrir una segunda caja si ya hay una abierta (`src/hooks/useCheckoutFlow.js`).
- Una sola regla para saber qué movimientos pertenecen a la caja abierta (`isShiftCashMovement` en `src/utils/cashShift.js`). El fondo real de la gaveta para el cobro (`calcularFondoEnGaveta` en `src/utils/fondoGaveta.js`) es la misma cuenta del «Efectivo esperado» del Inicio: sigue el turno y resta los vueltos. Se usa en `src/views/SalesView.jsx` y `src/hooks/useDashboardMetrics.js`.
- Aviso legible de efectivo insuficiente (`src/components/Sales/AvisoFondoGaveta.jsx`):
  - recuadro rojo en los paneles de vuelto (`CheckoutModal.jsx`, `PaymentLeftColumn.jsx`, `MobileChangeAllocation.jsx`);
  - recuadro grande en «Confirmar distribución del cambio» (`ChangeConfirmationModal.jsx`) con «Registrar aporte», «Dejar en saldo a favor» (solo con cliente elegido) y el botón «Confirmar igual».
- Aviso suave al abrir la caja con 0 Bs (`AperturaCajaModal.jsx`) y explicación bajo el número rojo del Inicio (`EfectivoEsperadoCard.jsx`).
- El fondo de la gaveta vale `null` cuando no se conoce (venta remota del supervisor). En ese caso no se avisa.

## Qué no cambió
El resto del flujo de cobro y de cierre de caja. No cambia cómo se guardan las ventas.

## Pruebas
- `tests/fondoGaveta.test.js` (9) y `tests/aperturaDuplicada.test.js` (3): pasan.
- Pruebas de caja y cobro: 124 de 124.
- Batería completa: 2.241 de 2.244. Fallan 3 de licencias, ajenas a este cambio.
- Navegador (puerto 5181): abrir con $20 y 0 Bs → aviso; venta de $2,50 pagada con $10 y vuelto «Todo en Bs» → aviso rojo y luego aviso grande con «Confirmar igual»; aporte de 7.000 Bs → el aviso desaparece; Inicio con USD 30,00 y 144,84 Bs.

## Errores
[ERR-001, ERR-002, ERR-003](../ERRORES.md).

## Después
- La misma corrección está pendiente en Farmacia: P-001 de su `PENDIENTES.md`, con los pasos.
- Visto de paso, sin arreglar: al pasar de Ventas al Inicio con el menú lateral, el Inicio no se refresca hasta recargar la página.
