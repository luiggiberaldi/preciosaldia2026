# CASO-002 — Caja: apertura duplicada y fondo real de la gaveta

**Fecha:** 2026-11-13
**Estado:** Aplicado (sin commit al escribir esto)

## Qué pidió el dueño
Auditar la apertura de caja tras ver «Efectivo esperado −2.159,35 Bs». Informe completo: `C:\Users\luigg\Desktop\AUDITORIA-APERTURA-CAJA-2026-11-13.md` (fuera del repo).

## Qué se hizo
Tres arreglos, marcados en el código con `CAJA-APERTURA-001`, `CAJA-FONDO-001` y `CAJA-FONDO-002`:
- No se puede abrir una segunda caja si ya hay una abierta (`src/hooks/useCheckoutFlow.js`).
- Una sola regla para saber qué movimientos pertenecen a la caja abierta y para calcular el fondo real de la gaveta (`src/utils/cashShift.js`, `src/utils/fondoGaveta.js`).
- Aviso legible cuando el vuelto en Bs supera los Bs que hay (`src/components/Sales/AvisoFondoGaveta.jsx` y componentes del cobro).

## Qué no cambió
El resto del flujo de cobro y de cierre de caja.

## Pruebas
Ver el informe de auditoría. Verificación completa pendiente de repasar al hacer commit.

## Errores
[ERR-001, ERR-002, ERR-003](../ERRORES.md).

## Después
La misma corrección está pendiente en Farmacia (P-001 de su `PENDIENTES.md`).
