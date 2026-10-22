# Plan de Corrección: Deducción Exacta de Stock en Bultos y Unidades

> **Objetivo:** Corregir la deducción y restauración de inventario al vender productos por bulto/paquete (`_mode === 'package'`) o unidad suelta (`_mode === 'unit'`), garantizando que un bulto de $N$ unidades descuente $N$ unidades de inventario y que la venta por unidad suelta descuente $1$ unidad individual.

**Arquitectura:** Centralizar la fórmula canónica de conversión de cantidades de carrito a unidades de inventario en una función pura reutilizable (`calculateItemStockDeduction`), aplicarla simétricamente en el cobro (`checkoutProcessor.js`), la anulación (`voidSaleProcessor.js`) y las guardas reactivas de stock máximo en caja (`SalesView.jsx`), respaldada por una suite exhaustiva de pruebas unitarias automatizadas (TDD).

**Tech Stack:** React 19, Vitest, JavaScript ES6+, Vite.

---

## 1. Diagnóstico y Especificación del Problema

### El Modelo Canónico de Datos
En PreciosAlDía, el stock de catálogo (`product.stock`) **siempre se almacena en UNIDADES individuales** (o Kg/L para productos a granel):
- Al crear o registrar un lote de 5 bultos con 20 unidades/bulto, `productProcessor.js` almacena `stock = 100` unidades.
- Las tarjetas de producto en catálogo y caja muestran `100 UNDS` y derivan `= 5 bultos` mediante `Math.floor(stock / unitsPerPackage)`.

### El Fallo en Checkout y Caja
En `checkoutProcessor.js` (L358-362), `voidSaleProcessor.js` (L88-92) y `SalesView.jsx` (L514, L518, L627-630), el código asumía erróneamente que `product.stock` estaba expresado en *bultos*:
1. **Al vender 1 Bulto (`_mode === 'package'`):** Retornaba `item.qty = 1` y restaba solo 1 unidad del stock de 100 (quedaban 99 unidades en lugar de 80).
2. **Al vender 1 Unidad suelta (`_mode === 'unit'`):** Hacía `divR(item.qty, unitsPerPackage) = 1 / 20 = 0.05` y al redondear a entero (`round0`) restaba 0 unidades (quedaban 100 unidades intactas).

---

## 2. Tareas de Implementación Paso a Paso (TDD)

### Tarea 1: Suite de Pruebas Unitarias Automatizadas (TDD)
**Archivos:**
- Crear: `tests/packageStockDeduction.test.js`

**Paso 1.1: Escribir la prueba que expone el fallo**
Crear pruebas unitarias que verifiquen:
1. Venta de 1 bulto de 20 unidades descuenta 20 unidades exactas.
2. Venta de 2 bultos de 24 unidades descuenta 48 unidades exactas.
3. Venta de 3 unidades sueltas descuenta 3 unidades exactas.
4. Venta mixta en el mismo carrito (1 bulto + 2 unidades) descuenta 22 unidades exactas.
5. Producto simple sin empaque (`unitsPerPackage = 1`) descuenta `qty` directamente.
6. Producto a granel conserva decimales exactos sin verse afectado.
7. Anulación de venta restaura exactamente las mismas unidades deducidas.

**Paso 1.2: Ejecutar la prueba y verificar que falle en el código actual**
- Comando: `npm test tests/packageStockDeduction.test.js -- --run`
- Resultado esperado: FALLA (esperaba 20 deducidas, recibió 1).

---

### Tarea 2: Implementar Función Pura de Deducción de Stock
**Archivos:**
- Modificar: `src/utils/granel.js`

**Paso 2.1: Exportar `calculateItemStockDeduction(item)`**
```javascript
export function calculateItemStockDeduction(item) {
    if (!item) return 0;
    if (isGranelProduct(item)) {
        return round3(item.qty || 0);
    }
    const unitsPerPkg = Math.max(1, parseInt(item._unitsPerPackage || item.unitsPerPackage, 10) || 1);
    if (item._mode === 'unit') {
        return round0(item.qty || 0);
    }
    // Modo paquete / bulto o producto simple
    return round0((item.qty || 0) * unitsPerPkg);
}
```

---

### Tarea 3: Conectar Deducción en Cobro y Anulación
**Archivos:**
- Modificar: `src/utils/checkoutProcessor.js:355-375`
- Modificar: `src/utils/voidSaleProcessor.js:85-100`

**Paso 3.1: En `checkoutProcessor.js`**
Reemplazar la acumulación invertida por `calculateItemStockDeduction`:
```javascript
const totalDeducted = cartItemsForThisProduct.reduce((sum, item) => {
    return isGranelProduct(item)
        ? round3(sum + calculateItemStockDeduction(item))
        : round0(sum + calculateItemStockDeduction(item));
}, 0);
```

**Paso 3.2: En `voidSaleProcessor.js`**
Aplicar la misma función simétrica para que anular una venta de bulto reponga las 20 unidades completas:
```javascript
const totalRestored = cartItemsForThisProduct.reduce((sum, item) => {
    return isGranelProduct(item)
        ? round3(sum + calculateItemStockDeduction(item))
        : round0(sum + calculateItemStockDeduction(item));
}, 0);
```

---

### Tarea 4: Corregir Guardas de Stock Disponible en Caja (SalesView)
**Archivos:**
- Modificar: `src/views/SalesView.jsx:510-545, 620-635`

**Paso 4.1: Validación de stock al agregar al carrito (`addToCart`)**
- Calcular `stockNeeded` según el modo:
  - Si `forceMode === 'unit'`: `newQty` (cada unidad necesita 1 de stock).
  - Si es bulto: `newQty * unitsPerPackage` (cada bulto necesita `unitsPerPackage` unidades).
- Calcular `otherStockUsed` sumando `calculateItemStockDeduction(item)`.

**Paso 4.2: Validación de stock al pulsar `+` en el carrito (`updateQuantity`)**
- Usar `calculateItemStockDeduction` para que no permita agregar más bultos de los que alcanzan las unidades en stock.

---

### Tarea 5: Actualizar Pruebas del Simulador Interno (`SystemTester.js`)
**Archivos:**
- Modificar: `src/testing/SystemTester.js:650-685`

**Paso 5.1: Ajustar `suiteStockModos`**
- Actualizar las aserciones de prueba obsoletas que asumían que el stock se guardaba en bultos fraccionales.

---

### Tarea 6: Verificación y Compilación Cruzada
**Pasos:**
1. Ejecutar suite unitaria dedicada:
   `npm test tests/packageStockDeduction.test.js -- --run` &rarr; 100% verde.
2. Ejecutar suite completa de checkout y granel:
   `npm test tests/checkout.test.js tests/granelUnits.test.js -- --run` &rarr; 100% verde.
3. Compilar con Vite en producción:
   `npm run build` &rarr; Código de salida 0.
4. Replicar paridad exacta en `preciosaldia-supervisor-staging`.

---

## 3. Plan de Rollback Inmediato

Si se requiere revertir todos los cambios a su estado previo en un solo comando:
```bash
git checkout HEAD -- src/utils/granel.js src/utils/checkoutProcessor.js src/utils/voidSaleProcessor.js src/views/SalesView.jsx src/testing/SystemTester.js tests/packageStockDeduction.test.js
```
