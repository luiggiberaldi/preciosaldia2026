# Auditoría: Proveedores y Nómina — Lite vs Pro (multilocal)

Fecha: 2026-10-12
- Lite: `C:\Users\luigg\Desktop\sistemas generales\precios al dia final\preciosaldia-bodega`
- Pro: `C:\Users\luigg\Desktop\sistemas personalizados\bily bodega consmeticos\preciosaldia-multilocal`

## Resumen

- **Proveedores**: Lite tiene la misma base (proveedores, facturas, pagos, deuda), pero le faltan funciones que Pro sí tiene: fecha de factura, foto de factura, rango de fechas en el estado de cuenta y en los reportes, y plazo/vencimiento calculado.
- **Nómina**: Lite no tiene nada de nómina. Pro tiene un módulo completo (empleados, consumos, liquidación, recibo). No es un copiar-y-pegar: depende de piezas de Pro que Lite no tiene (ver sección 3).

## 1. Proveedores

### Archivos

| Pieza | Lite | Pro |
|---|---|---|
| `hooks/useSupplierManagement.js` | 174 líneas | 184 líneas (casi idéntico) |
| `components/Suppliers/SupplierModals.jsx` | 405 líneas | 619 líneas |
| `components/Suppliers/SuppliersList.jsx` | 201 líneas | 236 líneas |
| `utils/supplierReportGenerator.js` | 520 líneas | 527 líneas |
| `utils/supplierReportRange.js` | no existe | 123 líneas |
| `utils/invoicePhotos.js` | no existe | 161 líneas |

### Igual en ambos
- Claves de storage: `bodega_suppliers_v1`, `bodega_supplier_invoices_v1`, pagos como `PAGO_PROVEEDOR` en `bodega_sales_v1`.
- Flujo: alta/edición/borrado de proveedor, registrar factura (suma deuda), pagar (resta deuda y crea movimiento; `retiraCaja` decide si sale de caja).
- Backup: ambas incluyen las claves de proveedor en `backupKeys.js`.

### Lo que Lite no tiene (brechas)

| # | Funcionalidad | Pro | Lite | Impacto |
|---|---|---|---|---|
| 1 | Fecha de la factura (`invoiceDate`), distinta de la fecha de registro | Sí (`SupplierModals.jsx:102,150`) | No: `date` = `new Date().toISOString()` | Alto: no se puede registrar una factura de días pasados con su fecha real; reportes por período quedan mal |
| 2 | Plazo en días que calcula el vencimiento | Sí | No (solo fecha de vencimiento manual) | Medio |
| 3 | Foto de la factura (IndexedDB, solo local, nunca a la nube) | Sí (`invoicePhotos.js`) | No | Medio: sin respaldo visual de la factura |
| 4 | Estado de cuenta filtrable por rango de fechas (`desde`/`hasta`) | Sí (`SupplierModals.jsx:431+`) | No | Medio |
| 5 | Lista de proveedores filtrable por rango para reportes | Sí (`SuppliersList.jsx:22-27`) | No | Medio |
| 6 | Reportes PDF con rango (`buildSupplierActivityLines`, `filterActivityByRange`) | Sí (`supplierReportRange.js`) | No: `supplierReportGenerator.js` no recibe rango | Medio–alto: el reporte de deuda siempre es "todo el historial" |
| 7 | Estado VENCIDA / por vencer en el historial | Sí (`SupplierModals.jsx:551-556`) | Parcial: solo muestra "Venc:" | Bajo–medio |

### Qué NO es brecha (igual en ambas, pero conviene saberlo)
- Ninguna de las dos sincroniza proveedores ni facturas a la nube (no aparecen en `supervisorContracts.js` ni `useCloudSync.js`). Si se quiere que el supervisor vea proveedores, hay que agregarlo en ambos.
- Facturas en USD con equivalentes Bs/COP: igual en ambos.

### Bugs/riesgos observados en Lite
- `handleAddInvoice` y `handlePayInvoice` escriben en dos pasos (factura/proveedor y luego ventas) sin transacción. Si falla el segundo, la deuda cambia sin movimiento. Mismo riesgo en Pro; no es brecha, pero es un punto de fragilidad.
- Lite no tiene `desde/hasta` en ningún lado, así que el reporte de deuda puede crecer sin límite con el historial.

## 2. Nómina

- Lite: **no existe** (ni `payroll`, ni `employee`, ni `NominaView`).
- Pro: `NominaView.jsx`, `services/payrollService.js` (768 líneas), `utils/payroll.js`, `utils/payrollReceiptGenerator.js`, `components/Payroll/*`, `tests/payrollService.test.js`.
- Pro depende de piezas que Lite no tiene o no ha verificado:
  - `utils/roles.js` con `TABS_DUENO` y `isOwner()` (Lite tiene roles, pero hay que confirmar que `isOwner`/`isAdministrador` existan igual).
  - `utils/stockAdjust.js` (`adjustStockForItems`, con lock y granel).
  - Sincronización de documentos de nómina (`pushPayrollDoc` en `useCloudSync.js`, validadores en `supervisorContracts.js`). Sin esto, los consumos no llegan a otros equipos.
  - `checkoutProcessor.js` escribe `vendedorId` (Pro lo tiene; Lite no lo verificó).
  - `auditService.logEvent`.
- Pendiente según `PLAN-NOMINA-PRO.md`: la opción de 56 mm del recibo no aparece en el código de Pro (`grep "'56'"` sin resultados en `src/**/*.jsx`).
- **Tests de Pro**: `tests/payrollService.test.js` pasa (15/15, exit 0).
- Confirmado en Lite: no existen `src/utils/roles.js`, `src/utils/stockAdjust.js`, ni referencias a proveedores en `supervisorContracts.js`/`useCloudSync.js`, ni `vendedorId`.

## 3. Recomendación

1. **Proveedores (bajo riesgo, alto valor)**: portar en este orden:
   1. Fecha de factura + plazo (cambio en `SupplierModals.jsx` y en el dato guardado).
   2. Rango de fechas en `supplierReportGenerator.js` con `supplierReportRange.js` (copiar tal cual; es puro).
   3. Foto de factura con `invoicePhotos.js` (copiar tal cual; solo IndexedDB).
   4. Estado VENCIDA en el historial.
   Antes de portar 1, revisar que las facturas de Lite ya guardadas no tengan `date` mal usado; la migración sería solo un campo opcional.
2. **Nómina (riesgo alto, no es copiar)**: primero confirmar que Lite tiene el sistema de roles, stock lock y sincronización de documentos. Si no, nómina en Lite implica portar esas piezas antes. Sugiero hacerlo como fase separada, después de proveedores.

## Limitaciones
- No ejecuté tests de ninguno de los dos proyectos en esta auditoría.
- No revisé todas las pantallas visualmente.
- Las cifras de líneas son de `wc -l` sobre el estado actual de cada repo (con cambios sin commit).
