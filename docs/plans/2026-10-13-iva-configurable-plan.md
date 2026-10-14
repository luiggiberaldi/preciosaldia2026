# Plan: IVA configurable (general + excepción por producto)

**Fecha:** 2026-10-13
**Repo:** `preciosaldia-bodega`
**Estado:** propuesta, pendiente de decisiones (ver sección 2)

## 1. Objetivo

Agregar IVA al POS con un valor general de **16% de fábrica**, editable desde Ajustes, y una **tasa opcional por producto** (exento, reducida u otra) que tenga prioridad sobre la general.

## 2. Decisiones pendientes (bloquean la fórmula)

1. **¿Los precios ya incluyen IVA o se suma encima?**
   - *Se suma (recomendado):* el precio guardado es base; el total = base + IVA. No altera precios históricos.
   - *Incluido:* el precio es final; se desglosa `base = precio / (1 + tasa/100)`.
2. **¿Hay productos exentos o con tarifa reducida?** Define si `ivaRate` por producto se usa desde el inicio o queda para después.
3. **¿El IVA aplica a pagos en Bs y COP igual que en USD?** Propuesta: sí, se calcula en USD y se convierte con la misma tasa de la venta.

## 3. Estado actual (auditoría, HEAD)

- No existe ningún uso de IVA, impuesto o tax en `src` (0 coincidencias).
- Motor de totales: `src/core/FinancialEngine.js`, método `buildCartTotals` (~L585–640). Calcula `subtotalUsd`, descuento, `totalUsd`, `totalBs` y `totalCop`.
- Hay dos rutas de precio por línea: `priceUsd` (normal) y `priceBsUsdRef`/`exactBs` (modo `dual_usd` con pago en Bs). Ambas deben recibir IVA.
- Ajustes no tiene campo de tasa BCV; la tasa se maneja desde otro flujo. No encontré sincronización de configuración de negocio hacia el monitor.
- Hay 402 usos de `localStorage`; los ajustes no están en un store central.

## 4. Diseño propuesto

### 4.1 Fuente única de configuración
- Nuevo módulo `src/config/taxConfig.js` con:
  - `DEFAULT_TAX_CONFIG = { ivaEnabled: false, ivaRate: 16 }`
  - `resolveLineIvaRate(item, config)` → `item.ivaRate ?? config.ivaRate` (0 = exento).
- Persistencia en `localStorage` con clave versionada (p. ej. `tax_config_v1`), leída con un hook `useTaxConfig`.
- `ivaEnabled` arranca en `false` para no cambiar el total de quien aún no decide. Ver decisión 1.

### 4.2 Cálculo centralizado
- `FinancialEngine.buildCartTotals` recibe `taxConfig` y devuelve, además de los campos actuales:
  - `ivaUsd` (suma de IVA por línea, redondeado con `round2` por línea antes de sumar)
  - `baseUsd` (subtotal sin IVA después de descuento)
  - `totalUsd = baseUsd + ivaUsd` cuando `ivaEnabled`
- El descuento se aplica **antes** del IVA (sobre la base), para que el IVA sea sobre el monto cobrado.
- Mismo tratamiento en `totalBs` y `totalCop` usando `ivaUsd` convertido con la tasa de la venta.

### 4.3 Consumidores (no recalculan, solo leen)
- `src/hooks/useCheckoutCalculations.js` y `src/components/Sales/CheckoutModalPOS/index.jsx` (`dynamicCartTotals`).
- Reportes: `ReportsMetricsTab.jsx` (`subtotalUsd`, `netProfitUsd`) y cierre de caja.
- Ticket e impresión (`labelGenerator`).
- Historial de ventas: guardar `ivaUsd` y `ivaRate` en cada venta para que los reportes no dependan de la configuración actual.

### 4.4 Ajustes
- Campo en la pestaña **Sistema** (o Negocio): switch "Cobrar IVA", input de tasa 0–100 y botón **"Restaurar 16%"** (valor de fábrica).
- Cambiar la tasa **no** reprecia las ventas ya guardadas; solo aplica a ventas nuevas.

### 4.5 Productos
- Campo opcional `ivaRate` en el formulario de producto. Vacío = usar general; `0` = exento.
- Migración: productos existentes quedan con `ivaRate` vacío (usan la general), sin reescritura masiva.

## 5. Fases

| Fase | Contenido | Entregable |
|---|---|---|
| 1 | `taxConfig.js` + hook + tests unitarios de `resolveLineIvaRate` | Módulo probado |
| 2 | `buildCartTotals` con IVA + tests de fórmula | Totales correctos con IVA on/off |
| 3 | Campo en Ajustes con "Restaurar 16%" | Editable y restaurable |
| 4 | Consumo en checkout, ticket, reportes, cierre | Mismo total en todas las vistas |
| 5 | Campo `ivaRate` por producto + migración sin reescritura | Excepciones funcionando |
| 6 | Pruebas E2E (sección 6) y ajuste de documentación | Verificado en navegador |

## 6. Pruebas

**Unitarias (`FinancialEngine`):**
- Producto 10 USD, IVA 16% activo → `ivaUsd` 1.60, `totalUsd` 11.60.
- IVA desactivado → `totalUsd` 10.00, `ivaUsd` 0.
- Tasa 0% → total igual a sin IVA.
- Producto exento (`ivaRate: 0`) dentro de carrito con IVA general → IVA solo sobre el resto.
- Descuento 10% sobre 10 USD con IVA 16% → base 9.00, IVA 1.44, total 10.44.
- Línea `dual_usd` pagando en Bs → IVA calculado sobre `priceBsUsdRef`.

**E2E (navegador, Playwright):**
- Cambiar IVA en Ajustes, vender, verificar total en checkout y en ticket.
- "Restaurar 16%" devuelve el valor de fábrica.
- Reporte de ventas y cierre de caja coinciden con el total de la venta.
- Venta anterior al cambio de tasa conserva su IVA original.

**Regresión:** correr `bun run test` y `bun run typecheck` completos; los tests existentes de `FinancialEngine` deben pasar sin cambios cuando el IVA está desactivado.

## 7. Riesgos

- **Doble conteo:** si el precio ya incluye IVA y se suma otra vez. Se resuelve con la decisión 1.
- **Reportes históricos:** sin guardar `ivaUsd` por venta, un cambio de tasa alteraría reportes pasados. Por eso se persiste en la venta.
- **Monitor remoto:** `RemoteProductFormModal` calcula precio desde Bs; debe respetar `ivaRate` del producto o el precio remoto diferirá. No hay sincronización de ajustes hoy, así que la tasa general quedaría solo en el POS.
- **Repo con cambios sin commitear:** `preciosaldia-bodega` tiene trabajo ajeno en curso; la implementación debe hacerse en commits separados.

## 8. Fuera de alcance

- Facturación fiscal electrónica (SENIAT), libro de ventas y retenciones.
- IVA en licencias de la estación maestra.
- Sincronización de la tasa general hacia el monitor (queda como fase posterior, si se necesita).
