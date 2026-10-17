# Rediseño Visual del Inventario Supervisor (Mobile & PC) - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Modernizar y elevar visualmente la interfaz de Inventario en el Supervisor de Precios al Día adaptando la estética Bento-Grid de Donde Juancho en PC y creando una versión ultra-compacta y ergonómica para móviles, estrictamente a nivel visual y sin alterar la lógica de comandos remotos ni sincronización.

**Architecture:** Se desacopla la vista de catálogo inline de `OwnerMonitorView.jsx` hacia un componente modular `SupervisorInventoryCatalog.jsx` manteniendo la totalidad de props, data-testids y contratos de mutación. Se rediseñan las fichas en formato Bento con borde acentuado cromático lateral según el nivel de stock (`w-2`), subpanel financiero (costo, venta USD/Bs, margen) y controles táctiles de stock ergonómicos diferenciados entre móvil y PC.

**Tech Stack:** React 18, Tailwind CSS (soporte Dark Mode completo), Lucide React Icons, Vitest + Testing Library / JSDOM.

---

### Task 1: Componente Base y Test de Catálogo de Inventario

**Files:**
- Create: `tests/supervisorInventoryCatalog.test.jsx`
- Create: `src/components/Monitor/SupervisorInventoryCatalog.jsx`

**Step 1: Write the failing test**

Crear el test unitario en `tests/supervisorInventoryCatalog.test.jsx` que valide:
1. Renderizado de fichas con `data-testid="supervisor-product-row-${p.id}"`.
2. Presencia de los botones con títulos accesibles `title="Editar Producto Remotamente"` y `title="Eliminar Producto Remotamente"`.
3. Borde cromático lateral según estado de stock (rojo si agotado/negativo, ámbar si bajo stock, verde si disponible).
4. Subpanel de precios (costo, venta USD y Bs, ganancia).

```jsx
// tests/supervisorInventoryCatalog.test.jsx
// @vitest-environment jsdom
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SupervisorInventoryCatalog from '../src/components/Monitor/SupervisorInventoryCatalog';

const mockProducts = [
    {
        id: 'prod-1',
        name: 'Harina PAN 1kg',
        barcode: '7591001',
        category: 'Viveres',
        stock: 12,
        minStock: 5,
        costPrice: 0.90,
        priceUsd: 1.20,
    },
    {
        id: 'prod-2',
        name: 'Arroz Mary 1kg',
        barcode: '7591002',
        category: 'Granos',
        stock: 3,
        minStock: 5,
        costPrice: 0.80,
        priceUsd: 1.10,
    },
    {
        id: 'prod-3',
        name: 'Aceite Mazeite 1L',
        barcode: '7591003',
        category: 'Aceites',
        stock: 0,
        minStock: 5,
        costPrice: 2.00,
        priceUsd: 2.80,
    },
];

describe('SupervisorInventoryCatalog Visual Component', () => {
    it('renderiza las fichas Bento con sus testids e indicadores cromáticos', () => {
        render(
            <SupervisorInventoryCatalog
                products={mockProducts}
                paginatedProducts={mockProducts}
                filteredProducts={mockProducts}
                bcvRate={50}
                inventoryMetrics={{
                    count: 3,
                    totalQty: 15,
                    totalCost: 13.20,
                    totalRetail: 17.70,
                    expectedProfit: 4.50,
                    lowStockCount: 1,
                    outOfStockCount: 1,
                }}
                remoteActionsAvailable={true}
                SUPERVISOR_REMOTE_MUTATIONS_ENABLED={true}
                SUPERVISOR_REMOTE_PRODUCTS_ENABLED={true}
                stockOpStatus={{}}
                believedStockOf={(p) => p.stock}
                formatBs={(val) => Number(val).toFixed(2)}
                toTitleCase={(str) => str}
            />
        );

        // Verifica existencia de tarjetas con data-testid
        expect(screen.getByTestId('supervisor-product-row-prod-1')).toBeDefined();
        expect(screen.getByTestId('supervisor-product-row-prod-2')).toBeDefined();
        expect(screen.getByTestId('supervisor-product-row-prod-3')).toBeDefined();

        // Verifica botones de acción remota requeridos por e2e
        const editButtons = screen.getAllByTitle('Editar Producto Remotamente');
        expect(editButtons.length).toBe(3);
        const deleteButtons = screen.getAllByTitle('Eliminar Producto Remotamente');
        expect(deleteButtons.length).toBe(3);
    });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/supervisorInventoryCatalog.test.jsx`
Expected: FAIL with "Cannot find module '../src/components/Monitor/SupervisorInventoryCatalog'"

**Step 3: Write minimal implementation**

Crear `src/components/Monitor/SupervisorInventoryCatalog.jsx` con el esqueleto funcional y exportación por defecto que reciba los props de inventario.

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/supervisorInventoryCatalog.test.jsx`
Expected: PASS

**Step 5: Commit**

```bash
git add tests/supervisorInventoryCatalog.test.jsx src/components/Monitor/SupervisorInventoryCatalog.jsx
git commit -m "feat(supervisor): scaffolding base de SupervisorInventoryCatalog y test unitario"
```

---

### Task 2: Implementación de Tarjetas Bento Grid para Escritorio (PC)

**Files:**
- Modify: `src/components/Monitor/SupervisorInventoryCatalog.jsx`
- Test: `tests/supervisorInventoryCatalog.test.jsx`

**Step 1: Write test for Desktop Bento layout details**

Agregar en `tests/supervisorInventoryCatalog.test.jsx`:
- Validación de subpanel financiero con Costo, Venta USD/Bs y Ganancia en %.
- Presencia del indicador lateral cromático (`w-2 absolute left-0 top-0 bottom-0`).
- Validación de que el botón de stock en PC tenga `title="Toca para escribir el stock exacto"`.

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/supervisorInventoryCatalog.test.jsx`
Expected: FAIL on newly added assertions.

**Step 3: Implement Desktop Bento layout**

En `src/components/Monitor/SupervisorInventoryCatalog.jsx`, diseñar la versión de escritorio de la tarjeta Bento:
- Contenedor flotante con `bg-white dark:bg-slate-900 rounded-3xl border-2 border-slate-200/90 dark:border-slate-800 p-4 sm:p-5 shadow-sm hover:shadow-md transition-all relative overflow-hidden group pl-5 sm:pl-6`.
- Borde lateral cromático absoluto de `w-2`:
  - `bg-rose-600` si `stock < 0` (Saldo Negativo).
  - `bg-rose-500` si `stock === 0` (Agotado).
  - `bg-amber-500` si `stock > 0 && stock <= minStock` (Bajo Stock).
  - `bg-emerald-500` si `stock > minStock` (Disponible).
- Subpanel financiero estilizado con 3 columnas en caja redondeada con borde sutil:
  - Costo: `${(p.costPrice || 0).toFixed(2)}`
  - Venta: `${p.priceUsd.toFixed(2)}` y cálculo en Bs `{formatBs(p.priceUsd * bcvRate)} Bs`.
  - Margen: ganancia en `$ profitUsd` y porcentaje `{profitPct}%`.
- Controles de stock y acciones remotas:
  - Botón o input de stock directo con indicador de `provisional` (dashed) en caso de sincronización en vuelo.
  - Botones de incremento/decremento `+` y `-` con touch target confortable.
  - Botones de edición (`Pencil`) y eliminación (`Trash2`).
  - Banner en línea para confirmar/descartar cuando hay cambios pendientes o estados de error.

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/supervisorInventoryCatalog.test.jsx`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/Monitor/SupervisorInventoryCatalog.jsx tests/supervisorInventoryCatalog.test.jsx
git commit -m "feat(supervisor): diseno bento-grid para inventario en escritorio"
```

---

### Task 3: Implementación de Tarjetas Ultra-Compactas y Ergonómicas para Móvil

**Files:**
- Modify: `src/components/Monitor/SupervisorInventoryCatalog.jsx`
- Test: `tests/supervisorInventoryCatalog.test.jsx`

**Step 1: Write test for Mobile Compact layout**

Agregar en `tests/supervisorInventoryCatalog.test.jsx`:
- Validación de que en dispositivos móviles existan los controles integrados tipo cápsula `[-] [Stock] [+]`.
- Comprobar que la tarjeta móvil conserve el borde cromático lateral (`w-2`).
- Comprobar que las acciones principales se mantengan visibles sin scroll horizontal.

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/supervisorInventoryCatalog.test.jsx`
Expected: FAIL on mobile compact layout elements.

**Step 3: Implement Mobile Compact Ergonomic layout**

En `src/components/Monitor/SupervisorInventoryCatalog.jsx`, diseñar la versión móvil (< `lg` o responsive adaptativo):
- Altura reducida a ~115-125px (evitando las tarjetas gigantes de 210px que solo permitían ver 2.5 productos en pantalla).
- **Fila Superior:**
  - Borde lateral cromático `w-2`.
  - Nombre del producto en mayúsculas negrita, truncado en 1 línea para evitar saltos excesivos.
  - Badge compacto de estado (`Disponible`, `Bajo Stock`, `Agotado`).
  - Botón de edición rápida (`Pencil`, 34x34px touch target) ubicado en la esquina superior derecha.
- **Fila Intermedia:**
  - Código de barras con icono `#` + Categoría en tipografía compacta (`text-[10px] text-slate-400`).
- **Fila Inferior:**
  - **Lado Izquierdo (Micro-ficha financiera):**
    - Venta: `${p.priceUsd.toFixed(2)}` (en verde esmeralda destacado).
    - Equivalencia en Bs: `{formatBs(p.priceUsd * bcvRate)} Bs`.
    - Ganancia: `+${profitPct}%`.
  - **Lado Derecho (Cápsula stepper ergonómica para pulgar):**
    - Contenedor horizontal integrado `[ - ] [ Stock ] [ + ]`:
      - Botón `-` (36x36px, borde rosa suave, decrece en 1).
      - Botón central de Stock (toca para edición manual directa).
      - Botón `+` (36x36px, borde esmeralda suave, incrementa en 1).
- Si hay estado de confirmación o error de stock, se expande fluidamente un micro-banner en la base de la tarjeta con `Confirmar` y `Descartar`.

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/supervisorInventoryCatalog.test.jsx`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/Monitor/SupervisorInventoryCatalog.jsx tests/supervisorInventoryCatalog.test.jsx
git commit -m "feat(supervisor): diseño compacto y ergonomico para moviles en catalogo de inventario"
```

---

### Task 4: Modernización de Barra de Acciones y Filtros (`SupervisorInventoryToolbar`)

**Files:**
- Modify: `src/components/Monitor/SupervisorInventoryToolbar.jsx`
- Test: `tests/supervisorResponsive.test.js`

**Step 1: Check existing Toolbar tests**

Run: `npx vitest run tests/supervisorResponsive.test.js`
Verificar que los requisitos actuales sigan cubiertos (no selects nativos, botones accesibles).

**Step 2: Update Toolbar styling to match Donde Juancho modern UI**

En `src/components/Monitor/SupervisorInventoryToolbar.jsx`:
- Contenedor con `rounded-3xl border border-slate-200/60 bg-white p-3.5 sm:p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900`.
- Buscador con input `rounded-2xl`, icono `Search` a la izquierda, botón `X` de limpieza rápida a la derecha, y focus ring en esmeralda.
- Segmentación de stock estilo pastilla con fondo `bg-slate-100 dark:bg-slate-950 p-1 rounded-2xl` y pestañas deslizables:
  - `Todos (${counts.total})`
  - `Bajo stock (${counts.low})` (con indicador ámbar)
  - `Agotados (${counts.out})` (con indicador rojo)
  - `Movidos (${counts.moved})` (con indicador esmeralda)
  - Si hay negativos: `Negativos (${counts.negative})`
- Botonera de acciones ("Recepción rápida", "Egreso rápido", "Nuevo producto") con `rounded-2xl`, sombras suaves y microinteracción `active:scale-95`.

**Step 3: Run tests to verify**

Run: `npx vitest run tests/supervisorResponsive.test.js tests/supervisorInventoryCatalog.test.jsx`
Expected: PASS

**Step 4: Commit**

```bash
git add src/components/Monitor/SupervisorInventoryToolbar.jsx
git commit -m "style(supervisor): barra de herramientas y filtros modernizada con diseño Donde Juancho"
```

---

### Task 5: Integración en `OwnerMonitorView.jsx` y Limpieza

**Files:**
- Modify: `src/views/OwnerMonitorView.jsx`
- Test: `tests/supervisorResponsive.test.js`
- Test: `tests/supervisorLifecycle.test.js`

**Step 1: Verify current baseline tests**

Run: `npx vitest run tests/supervisorResponsive.test.js tests/supervisorLifecycle.test.js`
Expected: PASS

**Step 2: Integrate `SupervisorInventoryCatalog` in `OwnerMonitorView.jsx`**

- Importar `SupervisorInventoryCatalog` en `OwnerMonitorView.jsx`.
- Reemplazar el bloque repetitivo inline de la lista de productos (líneas ~1788 a 2138) con `<SupervisorInventoryCatalog ... />`, pasando todos los handlers existentes:
  - `openStockEditor`
  - `commitStockEdit`
  - `stepStockEdit`
  - `applyTargetStock`
  - `setProductToEditRemote`
  - `setProductToDeleteRemote`
  - `stockOpStatus`, `stockPendingConfirm`, `believedStockOf`, `formatStockValue`
  - `canMutate`, `canCreateProduct`
  - Paginación y métricas.
- Conservar los modales y handlers requeridos por `supervisorResponsive.test.js` (`handleConfirmDeleteProductRemote`, etc.).

**Step 3: Run regression tests to verify everything passes**

Run: `npx vitest run tests/supervisorResponsive.test.js tests/supervisorLifecycle.test.js tests/supervisorInventoryCatalog.test.jsx tests/supervisorInventoryBatchPanel.test.jsx`
Expected: PASS (todas las pruebas pasan limpiamente).

**Step 4: Commit**

```bash
git add src/views/OwnerMonitorView.jsx
git commit -m "refactor(supervisor): integracion de SupervisorInventoryCatalog en OwnerMonitorView"
```

---

### Task 6: Verificación Global, Build y TypeScript Check

**Files:**
- Test: Todos los tests de supervisor y suite e2e.

**Step 1: TypeScript Check**

Run: `npx tsc --noEmit`
Expected: 0 errores de tipado o compilación.

**Step 2: Full Supervisor Test Suite**

Run: `npx vitest run tests/supervisor*.test.js*`
Expected: Todos los archivos de prueba pasando al 100%.

**Step 3: Commit de finalización**

```bash
git add .
git commit -m "chore(supervisor): verificacion global y suite de pruebas del rediseño visual de inventario"
```

---

## Execution Handoff

Plan complete and saved to `docs/plans/2026-10-17-plan-rediseño-visual-inventario-supervisor.md`. Two execution options:

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration
**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach?**
