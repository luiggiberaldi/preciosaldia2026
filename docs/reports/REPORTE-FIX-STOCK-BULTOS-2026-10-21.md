# REPORTE Y PLAN DE FIX — Deducción Incorrecta de Stock en Productos por Bulto/Unidad

**Fecha:** 2026-10-21 (revisado y corregido tras auditoría)  
**Repo:** `preciosaldia-supervisor-production-alignment` (branch `main`; números de línea verificados contra HEAD `8cd9772`)  
**Clasificación:** 🐛 Bug crítico de inventario — afecta integridad del stock

> **⚠️ Aviso de working tree:** hay cambios **sin commitear** del plan "stock delta" (`stockEffects`) en `src/utils/checkoutProcessor.js` y `src/utils/voidSaleProcessor.js`. Los números de línea citados corresponden al estado **commiteado (HEAD)**; en el working tree el bloque de deducción está desplazado. **Localizar siempre por símbolo** (`totalDeducted`, `totalToRestore`), no por línea. Ver TAREA 0 antes de tocar nada.

---

## 1. DESCRIPCIÓN DEL PROBLEMA

Al vender productos de bulto — `packagingType === 'lote'` (legado `unit === 'paquete'`; en el carrito el modo es `_mode: 'package'`) — el sistema **descuenta del stock la cantidad de bultos vendidos en lugar de las unidades que representan**.

> **Corrección de terminología (auditoría):** no existe `packagingType === 'package'`. `'package'` es el valor de `_mode` en el carrito. Los productos de bulto usan `packagingType: 'lote'` o el campo legado `unit: 'paquete'`. No clavear ninguna lógica del fix en `packagingType === 'package'`.

### Ejemplo concreto
- Producto: **"Caja de Leche"** → `unitsPerPackage = 12`, `stock = 120` (120 unidades en inventario; ver §2.1)
- Venta: 1 bulto (`qty: 1`, `_mode: 'package'`)
- **Resultado actual:** se descuentan **1 unidad** del stock → stock queda en 119 ❌
- **Resultado correcto:** se deben descontar **12 unidades** → stock debe quedar en 108 ✅

Inversamente, al vender una unidad suelta (`_mode: 'unit'`) de ese mismo bulto:
- Venta: 1 unidad suelta (`qty: 1`, `_mode: 'unit'`, `_unitsPerPackage: 12`)
- **Resultado actual:** `divR(1, 12) = 0.08` (divR redondea a 2 decimales) y al aplicar `round0(120 − 0.08) = 120` → **cero unidades descontadas** ❌ (nota: con cantidades parciales el error no siempre es 0; queda difuso ±1 por el redondeo)
- **Resultado correcto:** se debe descontar **1 unidad** → stock debe quedar en 119 ✅

El stock canónico **siempre se almacena en unidades individuales**. La lógica de conversión está invertida.

---

## 2. ANÁLISIS DE CAUSA RAÍZ

### 2.1 Filosofía de almacenamiento canónico

| Tipo de producto | Unidad canónica en `product.stock` |
|---|---|
| Granel (kg/L) | Kilogramos o Litros (decimal, 3 dec.) |
| Bulto/Lote (`packagingType: 'lote'`, legado `unit: 'paquete'`) | **Unidades individuales** (entero) |
| Suelto / unidad (con o sin `unitsPerPackage`) | **Unidades individuales** (entero) |

El stock NO se almacena en bultos. Si hay 5 bultos de 20 unidades → `stock = 100`.

**Evidencia verificada:**
- `src/utils/productProcessor.js` (`buildProductPayload`): para `lote`, `finalStock = stockInLotes × unitsPerPackage`; para el resto, unidades directas.
- `src/components/Products/StockBatchModal.jsx`: al ajustar "en lotes" convierte `qty × unitsPerPackage` antes de tocar el stock; muestra `bultos = stock / unitsPerPackage`.
- ProductCard / ProductFormQuick: "= X bultos" = `stock / unitsPerPackage`.

### 2.2 Fórmula correcta para deducción

```
Producto de bulto, modo 'package': deducir = qty × unitsPerPackage   (ej: 1 bulto × 20 = 20 unidades)
Modo 'unit' (unidad suelta):       deducir = qty                     (ej: 1 ud suelta = 1 unidad)
Suelto/unidad (aunque tenga        deducir = qty                     (qty ya está en unidades;
 unitsPerPackage configurado)                                         NO multiplicar — ver §6)
Granel:                            deducir = qty                     (ya correcto, no tocar)
```

### 2.3 Código con el bug

**`checkoutProcessor.js`** (reducción de stock en venta) — `totalDeducted`, L358-362 en HEAD (L321-324 en el working tree actual):
```js
// ❌ ACTUAL (INCORRECTO)
const totalDeducted = cartItemsForThisProduct.reduce((sum, item) => {
    if (isGranelProduct(item)) return round3(sum + item.qty);           // ✅ granel OK
    if (item._mode === 'unit') return round3(sum + divR(item.qty, item._unitsPerPackage || 1)); // ❌ divide cuando debería sumar qty
    return round3(sum + item.qty);  // ❌ bulto: suma qty (1) en vez de qty * unitsPerPackage (20)
}, 0);

// ✅ CORRECTO
const totalDeducted = cartItemsForThisProduct.reduce((sum, item) => {
    const deduction = calculateItemStockDeduction(item);
    if (isGranelProduct(item)) return round3(sum + deduction);
    return sum + deduction; // entero estricto para package/unit
}, 0);
```

**`voidSaleProcessor.js`** (restauración de stock en anulación) — `totalToRestore`, L87-91 en HEAD (L89-92 en el working tree actual):
```js
// ❌ ACTUAL (idéntico bug en la restauración)
const totalToRestore = itemsInSale.reduce((sum, item) => {
    if (isGranelProduct(item)) return round3(sum + item.qty);
    if (item._mode === 'unit') return round3(sum + divR(item.qty, item._unitsPerPackage || 1)); // ❌
    return round3(sum + item.qty);  // ❌
}, 0);
```

**`SalesView.jsx` — L514, L518, L535, L539, L627, L630** (guardia de stock antes de agregar al carrito):
```js
// ❌ ACTUAL
const stockNeeded = forceMode === 'unit' ? newQty / (product.unitsPerPackage || 1) : newQty;
// Para 'unit': divide cuando debería ser = newQty (1 ud suelta necesita 1 de stock)
// Para 'package': no multiplica cuando debería ser newQty * unitsPerPackage

// ❌ ACTUAL en updateQty
if (item._mode === 'unit') return sum + (normalizedQty / (item._unitsPerPackage || 1));
return sum + normalizedQty; // bulto sin multiplicar
```

---

## 3. ARCHIVOS AFECTADOS

| Archivo | Líneas | Descripción del bug |
|---|---|---|
| `src/utils/checkoutProcessor.js` | `totalDeducted` — L358-362 en HEAD (L321-324 en working tree) | Fórmula de deducción invertida en venta |
| `src/utils/voidSaleProcessor.js` | `totalToRestore` — L87-91 en HEAD (L89-92 en working tree) | Fórmula de restauración invertida en anulación |
| `src/views/SalesView.jsx` | L514, L518, L535, L539, L627, L630 | Guards de stock disponible usan fórmula invertida |
| `src/testing/SystemTester.js` | ~L650-700 (`suiteStockModos`) | El helper `calcDeduccion` y los tests `d1/d3/d4/d5` reflejan el comportamiento INCORRECTO actual |
| `src/utils/granel.js` | — | Agregar nueva función pura `calculateItemStockDeduction` |
| `tests/packageStockDeduction.test.js` | — | Nuevo archivo TDD (a crear) |

---

## 4. PLAN DE IMPLEMENTACIÓN DEL FIX (CORREGIDO Y AUDITADO)

---

### TAREA 0 — Rollback (ejecutar si algo sale mal)

> **⚠️ PELIGRO — NO ejecutar `git checkout HEAD --` sobre los archivos del fix en el working tree actual.** `src/utils/checkoutProcessor.js` y `src/utils/voidSaleProcessor.js` tienen cambios **sin commitear** del plan "stock delta" (`stockEffects`, `tests/stockDeltaReconciliation.test.js`, `src/services/cloudPublishQueue.js`). Un `git checkout HEAD --` los destruiría.

**Procedimiento seguro:**

```bash
# 1. ANTES de empezar: preservar el trabajo en vuelo
git add -p && git commit -m "wip: stock delta en doc de venta"   # o:
git stash push -u -m "wip-stock-delta"

# 2. Implementar el fix en SU PROPIO commit (nunca mezclado con lo anterior)

# 3. Rollback = revertir SOLO el commit del fix
git revert <hash-del-commit-de-fix> --no-edit
```

Si el fix aún no está commiteado, deshacer con `git checkout -- <archivos-del-fix>` **solo funciona si los hunos del fix están separados** de los hunos "stock delta"; si se mezclaron, restaurar manualmente o usar el stash.

---

### TAREA 1 — Suite TDD (crear ANTES del fix)

**Archivo:** `tests/packageStockDeduction.test.js`

> Convención del repo: importar `describe/it/expect` desde `'vitest'` y usar `it` (ver `tests/granelGuardrails.test.js`). El config tiene `globals: true`, pero se sigue la convención existente.

```js
/**
 * TDD: Deducción correcta de stock para modos 'package' y 'unit'.
 * Ejecutar: npx vitest tests/packageStockDeduction.test.js
 */
import { describe, it, expect } from 'vitest';
import { calculateItemStockDeduction } from '../src/utils/granel.js';

describe('calculateItemStockDeduction — bultos y unidades sueltas', () => {

  // ── Modo package (bultos) ──────────────────────────────────────────────────
  it('1 bulto de 20 unidades deduce 20 del stock', () => {
    const item = { qty: 1, _mode: 'package', packagingType: 'lote', _unitsPerPackage: 20 };
    expect(calculateItemStockDeduction(item)).toBe(20);
  });

  it('3 bultos de 6 unidades deducen 18 del stock', () => {
    const item = { qty: 3, _mode: 'package', packagingType: 'lote', _unitsPerPackage: 6 };
    expect(calculateItemStockDeduction(item)).toBe(18);
  });

  it('bulto sin unitsPerPackage (default 1) deduce qty × 1', () => {
    const item = { qty: 2, _mode: 'package', packagingType: 'lote' };
    expect(calculateItemStockDeduction(item)).toBe(2);
  });

  it('producto legado unit=paquete también multiplica', () => {
    const item = { qty: 2, _mode: 'package', unit: 'paquete', _unitsPerPackage: 10 };
    expect(calculateItemStockDeduction(item)).toBe(20);
  });

  // ── Modo unit (unidades sueltas) ───────────────────────────────────────────
  it('1 unidad suelta deduce 1 del stock (no divide)', () => {
    const item = { qty: 1, _mode: 'unit', packagingType: 'lote', _unitsPerPackage: 20 };
    expect(calculateItemStockDeduction(item)).toBe(1);
  });

  it('5 unidades sueltas de bulto-12 deducen 5 del stock', () => {
    const item = { qty: 5, _mode: 'unit', packagingType: 'lote', _unitsPerPackage: 12 };
    expect(calculateItemStockDeduction(item)).toBe(5);
  });

  // ── NO multiplicar fuera de bulto (regresión) ──────────────────────────────
  it('suelto/unidad con unitsPerPackage configurado NO multiplica', () => {
    const item = { qty: 2, _mode: 'package', packagingType: 'suelto', _unitsPerPackage: 24 };
    expect(calculateItemStockDeduction(item)).toBe(2);
  });

  // ── Granel (no tocar — debe seguir igual) ─────────────────────────────────
  // Nota: llevan _unitsPerPackage a propósito; si la rama granel se elimina,
  // qty × 20 rompería el test y la prueba fallaría (tests discriminantes).
  it('granel 0.125 kg deduce 0.125 exacto del stock', () => {
    const item = { qty: 0.125, _mode: 'package', isWeight: true, granelUnit: 'kg', _unitsPerPackage: 20 };
    expect(calculateItemStockDeduction(item)).toBeCloseTo(0.125, 3);
  });

  it('granel 2.5 L deduce 2.5 del stock', () => {
    const item = { qty: 2.5, _mode: 'package', isWeight: true, granelUnit: 'litro', _unitsPerPackage: 20 };
    expect(calculateItemStockDeduction(item)).toBeCloseTo(2.5, 3);
  });
});
```

> **NOTA IMPORTANTE:** Estos tests deben fallar antes del fix (validan el comportamiento CORRECTO). Al aplicar el fix deben pasar al 100%.

---

### TAREA 2 — Nueva función pura en `granel.js`

**Archivo:** `src/utils/granel.js`  
**Acción:** Agregar al **final** del archivo (sin tocar nada existente):

```js
// ── BULTOS-001: deducción canónica por modo de venta ─────────────────────────
// Centraliza la fórmula correcta para checkoutProcessor, voidSaleProcessor y
// los guards de SalesView.
// Granel → qty directo (decimal, 3 dec.)
// Unidad suelta → qty directo (1 ud = 1 del stock canónico)
// Bulto/Lote → qty × unitsPerPackage (1 bulto = N unidades del stock)
// Suelto/unidad con unitsPerPackage configurado → qty (NO multiplicar: su qty
// ya está en unidades; unitsPerPackage solo sirve para ajustes por bulto en
// StockBatchModal — ver productProcessor.js)
export function calculateItemStockDeduction(item) {
    // Granel: usa la cantidad directa en kg/L
    if (isGranelProduct(item)) return item.qty;

    // Modo 'unit': una unidad suelta equivale a 1 unidad en stock canónico
    if (item._mode === 'unit') return item.qty;

    // Solo los productos de bulto descuentan qty × uds por bulto.
    const isBulto = item.packagingType === 'lote' || item.unit === 'paquete';
    if (!isBulto) return item.qty;

    const uPP = item._unitsPerPackage || item.unitsPerPackage || 1;
    return item.qty * uPP;
}
```

> **PRECAUCIÓN 1:** el guard `isBulto` es **obligatorio**. `addToCart` setea `_unitsPerPackage: product.unitsPerPackage || 1` sin importar el tipo de producto, y `buildProductPayload` conserva `unitsPerPackage` a propósito en productos suelto ("permite ajuste por bulto en StockBatchModal"). Sin el guard, un producto suelto con `unitsPerPackage = 24` descontaría `qty × 24` en cada venta y bloquearía ventas válidas en los guards.
>
> **PRECAUCIÓN 2:** `isGranelProduct` ya está definido en `granel.js`. La función NO necesita `round3` ni `divR` — el redondeo ocurre en el punto de uso (acumulador del reduce). Para granel se aplica `round3` en el acumulador; para package/unit el resultado es entero estricto.
>
> **PRECAUCIÓN 3 (detección de granel):** `isGranelProduct` detecta `packagingType === 'granel'`, unidades legadas (kg/litro/…), `isWeight`, `soldByWeight` y `granelUnit`, y devuelve `false` para `suelto`/`lote`. Con eso la rama granel protege también a los ítems del carrito (llevan `isWeight`, `granelUnit`, `packagingType`).

---

### TAREA 3 — Fix en `checkoutProcessor.js`

**Archivo:** `src/utils/checkoutProcessor.js`  
**Localizar por símbolo:** el reduce que define `totalDeducted` (L358-362 en HEAD; L321-324 en el working tree actual).

**Import:** `isGranelProduct` ya se importa desde `./granel.js` — agregar `calculateItemStockDeduction` al mismo import (no crear un import duplicado):
```js
import { isGranelProduct, calculateItemStockDeduction } from './granel.js';
```

**Reemplazar el reduce:**
```js
// ❌ ANTES
const totalDeducted = cartItemsForThisProduct.reduce((sum, item) => {
    if (isGranelProduct(item)) return round3(sum + item.qty);
    if (item._mode === 'unit') return round3(sum + divR(item.qty, item._unitsPerPackage || 1));
    return round3(sum + item.qty);
}, 0);

// ✅ DESPUÉS
const totalDeducted = cartItemsForThisProduct.reduce((sum, item) => {
    const deduction = calculateItemStockDeduction(item);
    if (isGranelProduct(item)) return round3(sum + deduction);
    return sum + deduction; // entero estricto para package/unit
}, 0);
```

> No eliminar el `round3` del acumulador del path granel — es correcto. El path package/unit no necesita round3 porque el resultado es siempre entero.
>
> **Housekeeping:** si `divR` queda sin uso en este archivo tras el cambio, limpiar el import (lint lo marca).

---

### TAREA 4 — Fix en `voidSaleProcessor.js`

**Archivo:** `src/utils/voidSaleProcessor.js`  
**Localizar por símbolo:** el reduce que define `totalToRestore` (L87-91 en HEAD; L89-92 en el working tree actual).

**Import:** igual que TAREA 3, ampliar el import existente de `./granel.js`.

**Reemplazar el reduce:**
```js
// ❌ ANTES
const totalToRestore = itemsInSale.reduce((sum, item) => {
    if (isGranelProduct(item)) return round3(sum + item.qty);
    if (item._mode === 'unit') return round3(sum + divR(item.qty, item._unitsPerPackage || 1));
    return round3(sum + item.qty);
}, 0);

// ✅ DESPUÉS
const totalToRestore = itemsInSale.reduce((sum, item) => {
    const deduction = calculateItemStockDeduction(item);
    if (isGranelProduct(item)) return round3(sum + deduction);
    return sum + deduction;
}, 0);
```

---

### TAREA 4B — Anulación de ventas históricas (pre-fix)

Las ventas registradas **antes** del fix descontaron menos de lo correcto (p. ej. 1 en vez de 12). Si se anulan con la fórmula nueva se restauraría de más y el stock quedaría inflado.

**Regla:** si la venta tiene `stockEffects` registrados (plan "stock delta"), restaurar el **delta real registrado** en vez de recalcular de los items:

```js
// Preferir el delta real registrado (correcto sin importar la era de la venta)
const recorded = (freshSale.stockEffects || []).filter(e => e.productId === p.id);
const totalToRestore = recorded.length > 0
    ? -recorded.reduce((sum, e) => sum + (e.delta || 0), 0)   // invertir deltas reales
    : /* fallback: reduce con calculateItemStockDeduction (TAREA 4) */;
```

- Coordinar con el plan "stock delta" (en vuelo en el working tree) para no duplicar lógica.
- Para ventas antiguas **sin** `stockEffects`, se usa la fórmula nueva con esta advertencia: el stock restaurado puede quedar sobrevalorado respecto a lo que realmente se descontó en su momento. Para esas ventas se recomienda ajuste manual / recuento posterior (ver §6).

---

### TAREA 5 — Fix en `SalesView.jsx` (guards de stock)

**Archivo:** `src/views/SalesView.jsx`

Hay **2 bloques** que calculan `stockNeeded` con la lógica errónea (L507-526 y L529-545), más el bloque `updateQty` (L613-638). Los 3 se unifican usando `calculateItemStockDeduction` (importarla desde `../utils/granel`, que ya se importa en este archivo).

> **⚠️ Corrección de auditoría (bug en la versión anterior de esta tarea):** NO usar `forceMode === 'package'` como condición para multiplicar. La mayoría de productos se agregan **sin** `forceMode` (solo la jerarquía de `sellByUnit` lo pasa) y el modo se resuelve como `forceMode || 'package'`. Con `forceMode === 'package' ? ×uPP : qty`, esos items caían en la rama sin multiplicar — el guard seguía mal para los productos que venden bultos completos. El helper resuelve el modo como `forceMode || 'package'` y aplica además el guard de bulto (TAREA 2), cubriendo ambos huecos.

**Patrón a reemplazar en `addToCart` (aparece 2 veces, L514 y L535):**
```js
// ❌ ANTES
const stockNeeded = forceMode === 'unit' ? newQty / (product.unitsPerPackage || 1) : newQty;

// ✅ DESPUÉS
const stockNeeded = calculateItemStockDeduction({
    ...product,
    qty: newQty,
    _mode: forceMode || 'package',
    _unitsPerPackage: product.unitsPerPackage || 1,
});
```

**Patrón a reemplazar en `addToCart` — otherCartItems (aparece 2 veces, L518 y L539):**
```js
// ❌ ANTES
const otherStockUsed = otherCartItems.reduce((sum, item) => {
    if (item._mode === 'unit') return sum + (item.qty / (item._unitsPerPackage || 1));
    return sum + item.qty;
}, 0);

// ✅ DESPUÉS
const otherStockUsed = otherCartItems.reduce(
    (sum, item) => sum + calculateItemStockDeduction(item),
    0
);
```

**Patrón a reemplazar en `updateQty` (L627 y L630):**
```js
// ❌ ANTES
const totalUsed = currentCart.reduce((sum, item) => {
    if ((item._originalId || item.id) !== originalId) return sum;
    if (item.id === id) return sum;
    const normalizedQty = adjustStockValue(item.qty, 0, isGranelProduct(item));
    if (item._mode === 'unit') return sum + (normalizedQty / (item._unitsPerPackage || 1));
    return sum + normalizedQty;
}, 0);
const thisItemStock = cartItem._mode === 'unit' ? newQty / (cartItem._unitsPerPackage || 1) : newQty;

// ✅ DESPUÉS
const totalUsed = currentCart.reduce((sum, item) => {
    if ((item._originalId || item.id) !== originalId) return sum;
    if (item.id === id) return sum;
    return sum + calculateItemStockDeduction({
        ...item,
        qty: adjustStockValue(item.qty, 0, isGranelProduct(item)),
    });
}, 0);
const thisItemStock = calculateItemStockDeduction({ ...cartItem, qty: newQty });
```

> Nota: el helper ya maneja granel (`isGranelProduct(item)` → `qty`), por lo que los guards comparan siempre en unidades canónicas contra `product.stock`. Los items del carrito llevan `_mode` explícito (`forceMode || 'package'` al agregarlos), pero el helper NO depende solo de `_mode`: también exige que el producto sea de bulto para multiplicar.

---

### TAREA 6 — Corregir tests en `SystemTester.js`

**Archivo:** `src/testing/SystemTester.js`  
**Localizar por símbolo:** `suiteStockModos` (~L650-700).

**Dos cosas que corregir** (la versión anterior de esta tarea solo listaba d3/d4 — incompleto):

**6a. El helper local `calcDeduccion` (L654-659) copia la fórmula vieja.** Actualizarlo al nuevo comportamiento (o importar `calculateItemStockDeduction` desde `../utils/granel`). Ojo: hoy ramifica por `item.isWeight`, no por `isGranelProduct`:

```js
// ✅ DESPUÉS (espejo de calculateItemStockDeduction)
function calcDeduccion(items) {
    return items.reduce((sum, item) => {
        if (item.isWeight) return sum + item.qty;
        if (item._mode === 'unit') return sum + item.qty;
        const isBulto = item.packagingType === 'lote' || item.unit === 'paquete';
        if (!isBulto) return sum + item.qty;
        return sum + item.qty * (item._unitsPerPackage || item.unitsPerPackage || 1);
    }, 0);
}
```

**6b. Valores esperados** — la API del archivo es `assertEqual` / `assertClose` (NO `expect(...).toBe(...)`):

```js
// d1: valor sin cambios (3), pero la etiqueta cambia de significado
const d1 = calcDeduccion([{ qty: 3 }]);
assertEqual(d1, 3, 'Stock: producto simple → deduce qty unidades');

// d1b (nuevo): producto de bulto sí multiplica
const d1b = calcDeduccion([{ qty: 3, packagingType: 'lote', _unitsPerPackage: 20 }]);
assertEqual(d1b, 60, 'Stock: 3 bultos de 20 uds → 60 unidades deducidas');

// d3: 12 unidades sueltas de un bulto de 6 → deducen 12 (no 2)
const d3 = calcDeduccion([{ qty: 12, _mode: 'unit', _unitsPerPackage: 6 }]);
assertEqual(d3, 12, 'Stock: modo unidad 12u sueltas → 12 unidades deducidas');

// d4: 3 unidades sueltas de un bulto de 4 → deducen 3 (no 0.75)
const d4 = calcDeduccion([{ qty: 3, _mode: 'unit', _unitsPerPackage: 4 }]);
assertEqual(d4, 3, 'Stock: modo unidad 3u sueltas → 3 unidades deducidas');

// d5: mezcla de modos — TAMBIÉN cambia (antes esperaba 4.5)
const d5 = calcDeduccion([
    { qty: 2 },                                        // simple
    { qty: 0.5, isWeight: true },                      // peso
    { qty: 8, _mode: 'unit', _unitsPerPackage: 4 },   // unidad suelta (8 uds)
]);
assertClose(d5, 10.5, 'Stock: mezcla de modos → 2 + 0.5 + 8 = 10.5', 0.001);

// d6: _unitsPerPackage ausente → default 1 (sin cambios: 4)
const d6 = calcDeduccion([{ qty: 4, _mode: 'unit' }]);
assertEqual(d6, 4, 'Stock: sin _unitsPerPackage → default 1 → deduce qty unidades');

// d7 (nuevo): suelto con unitsPerPackage NO multiplica (regresión)
const d7 = calcDeduccion([{ qty: 2, packagingType: 'suelto', _unitsPerPackage: 24 }]);
assertEqual(d7, 2, 'Stock: suelto con uds/bulto configurado → NO multiplica');
```

> **PRECAUCIÓN:** verificar visualmente los nombres exactos de las variables antes de modificar. Los bloques `applyStock` (stock negativo) NO cambian.

---

### TAREA 7 — Verificación de build

```bash
npm run build
```

Debe completar con código de salida `0` sin errores ni advertencias de sintaxis.

---

### TAREA 8 — Verificación de tests

```bash
# Test nuevo (TDD)
npx vitest tests/packageStockDeduction.test.js

# Test de regresión completo
npx vitest --run
```

Todos los tests deben pasar al 100% en verde.

---

### TAREA 9 — Aplicar en staging y commit

```bash
# 1. Verificar que el fix funciona en production-alignment
npm run build  # debe ser exit 0

# 2. Copiar los mismos cambios a staging
cd ../preciosaldia-supervisor-staging
# (repetir las mismas ediciones)

# 3. Commit atómico en ambos repos (el fix en SU PROPIO commit, ver TAREA 0)
git add src/utils/checkoutProcessor.js src/utils/voidSaleProcessor.js src/views/SalesView.jsx src/utils/granel.js src/testing/SystemTester.js tests/packageStockDeduction.test.js
git commit -m "fix(stock): corregir deducción de unidades en venta/anulación de bultos (BULTOS-001)"

# Staging
cd ../preciosaldia-supervisor-staging
git add <mismos archivos>
git commit -m "fix(stock): corregir deducción de unidades en venta/anulación de bultos (BULTOS-001)"
```

---

## 5. RESUMEN DE CAMBIOS

| # | Archivo | Tipo | Impacto |
|---|---|---|---|
| 1 | `tests/packageStockDeduction.test.js` | Crear | Suite TDD nueva (incluye regresión suelto/granel) |
| 2 | `src/utils/granel.js` | Añadir export | Función `calculateItemStockDeduction` (con guard de bulto) |
| 3 | `src/utils/checkoutProcessor.js` | Fix reduce `totalDeducted` | Deducción correcta en checkout |
| 4 | `src/utils/voidSaleProcessor.js` | Fix reduce `totalToRestore` | Restauración correcta en anulación |
| 5 | `src/utils/voidSaleProcessor.js` (TAREA 4B) | Fix anulación histórica | Preferir deltas `stockEffects` registrados |
| 6 | `src/views/SalesView.jsx` | Fix 6 líneas | Guards de stock disponibles vía helper único |
| 7 | `src/testing/SystemTester.js` | Fix `calcDeduccion` + d1/d3/d4/d5 + d1b/d7 | Tests alineados al comportamiento correcto |

---

## 6. NOTAS ADICIONALES

### Por qué `_unitsPerPackage` y no `unitsPerPackage`
El carrito agrega el campo como `_unitsPerPackage` (prefijo `_` para campos internos del snapshot). En `voidSaleProcessor.js` los items vienen de `freshSale.items` (persistidos), por lo que algunos ítems históricos pueden tener solo `unitsPerPackage`. La función `calculateItemStockDeduction` resuelve ambos con `item._unitsPerPackage || item.unitsPerPackage || 1`.

### Por qué el guard `isBulto` (packagingType lote / unit paquete)
`addToCart` setea `_unitsPerPackage: product.unitsPerPackage || 1` **sin importar el tipo de producto**, y `buildProductPayload` conserva `unitsPerPackage` también en productos suelto/granel (para ajustes por bulto en StockBatchModal). Solo los productos de bulto (`packagingType === 'lote'`, legado `unit === 'paquete'`) significan "qty = bultos" en el carrito; para suelto/unidad la qty ya está en unidades y multiplicar sería una regresión.

### Por qué granel no cambia
`isGranelProduct` detecta `packagingType === 'granel'`, unidades legadas (kg/litro/…), `isWeight`, `soldByWeight` y `granelUnit` (y excluye `suelto`/`lote`). Para granel, `qty` ya representa la cantidad en kg/L directamente. El bug solo afecta el path de productos de bulto con `_mode: 'package'` (y el path `_mode: 'unit'`, que dividía en vez de descontar 1:1).

### Stock negativo
El sistema respeta la configuración `allow_negative_stock`. El fix no cambia esta lógica, solo garantiza que el **monto deducido** sea correcto antes de aplicar el límite de negativos.

### Ventas históricas (pre-fix)
Las ventas antiguas descontaron menos de lo correcto; el stock actual en tiendas ya arrastra ese desfase. Tras el fix se recomienda **recuento de inventario** de los productos de bulto afectados. Al anular ventas pre-fix sin `stockEffects`, la restauración puede quedar sobrevalorada (ver TAREA 4B).

### Fuera de alcance — `inventoryFinancials`
`src/context/ProductContext.jsx` (`inventoryFinancials`, ~L358-359) trata el stock como bultos (`stockQty × unitsPerPackage` para `sellByUnit`), lo que sobrevalúa el inventario ×uPP bajo la semántica de unidades. Es la misma familia de bug pero solo afecta la métrica "Valor Total Venta $" del inventario; queda como fix aparte para no ampliar el alcance de este cambio.

---

*Documento generado por auditoría de código — no implementar sin revisión del equipo.*
