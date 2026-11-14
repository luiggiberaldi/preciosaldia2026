# Módulo: Reglas del dinero

> Revisado 2026-11-13 leyendo `src/utils/dinero.js`, `src/core/FinancialEngine.js`, `src/utils/securityConstants.js` y la sección 12 de `AGENT.md`.

## Principios

1. **El dinero va en USD.** Los bolívares y pesos se calculan con la tasa del momento.
2. **Toda cuenta con dinero pasa por `src/utils/dinero.js`.** Nada de `Math.round`, `toFixed` ni `parseFloat` para redondear montos: ESLint lo prohíbe en `src/utils/**` y `src/core/**`.
3. **Redondeo:** USD 2 decimales; Bs entero **hacia arriba** (los precios en Bs nunca bajan); COP entero; peso/volumen 3 decimales; tasas 4 decimales. Se redondea «mitad hacia fuera» (2,005 → 2,01).

```js
import { mulR, sumR } from '../utils/dinero';
const total = mulR(priceUsd, qty);   // correcto
```

4. **Un faltante de hasta $0,01 no se fía**: la venta pasa como pagada y la diferencia queda en `redondeoUsd` ([ERR-009](../../ERRORES.md)).
5. **El vuelto real es el techo**: nunca se entrega, se deja en caja ni se acredita más vuelto del que existe (`checkoutProcessor`, FIN-034).

## Candado de escritura

Todo lo que lee y luego escribe ventas, productos, clientes o la auditoría va dentro de `withLock('pos_write_lock', …)` (`'audit_log_lock'` para la auditoría). Evita que dos acciones se pisen.

## Motor financiero

`FinancialEngine` (`src/core/FinancialEngine.js`) es puro y calcula el desglose de pagos:
- `APERTURA_CAJA` suma a los buckets de efectivo; no es ingreso.
- `VENTA_FIADA`: el bucket `fiado` recibe lo fiado, no el total.
- `COBRO_DEUDA` resta del bucket `fiado`.
- Vueltos anómalos (más de 5× el total) se bloquean al cobrar.

## Tolerancias

Las tolerancias de comparación (cierre de caja, cuadre en Bs) viven en `FINANCIAL_EPSILON` (`securityConstants.js`), no como números sueltos.

## IVA

La configuración (precios que ya incluyen IVA, productos exentos) está en `src/config/taxConfig.js`. El ticket y el cierre desglosan el IVA y marcan lo exento con (E).

## Archivos principales

`src/utils/dinero.js`, `src/core/FinancialEngine.js`, `src/utils/securityConstants.js`, `src/utils/withLock.js`, `src/config/taxConfig.js`.
