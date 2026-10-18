# Búsqueda POS con Desplegable Desplazable (Scroll) y Auto-Enfoque Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Permitir que el desplegable de búsqueda en el Punto de Venta muestre una ventana visible contenida (~5.5 a 6 productos) con barra de desplazamiento suave para explorar hasta 50 coincidencias, manteniendo el producto seleccionado siempre a la vista al navegar con las flechas del teclado.

**Architecture:** Se amplía el límite de resultados en `SalesView.jsx` de 6 a 50 coincidencias (`POS_SEARCH_MAX_RESULTS`). En `SearchBar.jsx`, se estructura el desplegable en un contenedor `flex flex-col` con una lista interna con `max-h-[380px]` y `overflow-y-auto`, conectada a un `useEffect` que sincroniza el `selectedIndex` con `scrollIntoView({ block: 'nearest' })`, y un pie fijo con el contador de coincidencias y atajos de teclado.

**Tech Stack:** React 18, Tailwind CSS, Lucide React, Vitest, Testing Library.

---

### Task 1: Ampliar límite de resultados y crear suite de pruebas para desplegable desplazable

**Files:**
- Modify: `src/views/SalesView.jsx:335-345`
- Test: `tests/posSearchScrollDropdown.test.jsx`

**Step 1: Write the failing test**

Crear `tests/posSearchScrollDropdown.test.jsx`:
Verifica que `SearchBar` renderice más de 6 elementos cuando se le pasen, que el contenedor tenga las clases de desplazamiento (`overflow-y-auto` y `max-h-`), y que el pie muestre el total de coincidencias.

```jsx
// @vitest-environment jsdom
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/components/SmartImage', () => ({
    default: () => null,
}));

import SearchBar from '../src/components/Sales/SearchBar';

const generateMockProducts = (count) => {
    return Array.from({ length: count }, (_, i) => ({
        id: `prod_${i + 1}`,
        name: `Producto de Prueba ${i + 1}`,
        category: 'Viveres',
        stock: 10,
        priceUsd: 1.5,
        priceUsdt: 1.5,
    }));
};

const baseProps = {
    searchTerm: 'producto',
    onSearchChange: vi.fn(),
    onKeyDown: vi.fn(),
    selectedIndex: 0,
    setSelectedIndex: vi.fn(),
    effectiveRate: 10,
    addToCart: vi.fn(),
    isRecording: false,
    isProcessingAudio: false,
    startRecording: vi.fn(),
    stopRecording: vi.fn(),
    hierarchyPending: null,
    setHierarchyPending: vi.fn(),
    weightPending: null,
    setWeightPending: vi.fn(),
    posSearchViewMode: 'hybrid',
    onViewModeChange: vi.fn(),
};

describe('SearchBar - Desplegable con scroll y más de 6 resultados', () => {
    it('renderiza más de 6 resultados con contenedor desplazable (overflow-y-auto)', () => {
        const products = generateMockProducts(12);

        const { container } = render(
            <SearchBar
                {...baseProps}
                searchResults={products}
                selectedIndex={0}
            />
        );

        // Verifica que todos los 12 productos están presentes en el DOM para poder scrollear
        expect(screen.getByText('Producto de Prueba 1')).toBeTruthy();
        expect(screen.getByText('Producto de Prueba 12')).toBeTruthy();

        // Verifica que el contenedor con scroll exista
        const scrollContainer = container.querySelector('[data-testid="search-results-scroll-container"]');
        expect(scrollContainer).toBeTruthy();
        expect(scrollContainer.className).toContain('overflow-y-auto');

        // Verifica que el pie muestre el contador total de coincidencias
        expect(screen.getByText(/12 coincidencias|12 resultados/i)).toBeTruthy();
    });

    it('soporta navegación y mantiene el elemento resaltado', () => {
        const products = generateMockProducts(8);

        const { container } = render(
            <SearchBar
                {...baseProps}
                searchResults={products}
                selectedIndex={4}
            />
        );

        const buttons = container.querySelectorAll('[data-testid="search-results-scroll-container"] button');
        expect(buttons.length).toBe(8);
        // El 5to elemento (índice 4) debe tener la clase de selección
        expect(buttons[4].className).toContain('border-l-emerald-500');
    });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/posSearchScrollDropdown.test.jsx`
Expected: FAIL (porque `data-testid="search-results-scroll-container"` y el contador en el footer no existen aún).

**Step 3: Modify `src/views/SalesView.jsx`**

En `src/views/SalesView.jsx`:
Definir la constante de límite máximo arriba o cerca de `searchResults`:
```javascript
const POS_SEARCH_MAX_RESULTS = 50;
```
Y actualizar el cálculo de `searchResults`:
```javascript
    const searchResults = useMemo(() => {
        if (deferredSearchTerm.length < 1) return [];
        return products
            .filter(p => productMatchesSearch(p, deferredSearchTerm))
            .slice(0, POS_SEARCH_MAX_RESULTS);
    }, [deferredSearchTerm, products]);
```

**Step 4: Run test to verify it still fails on SearchBar markup**

Run: `npm test -- tests/posSearchScrollDropdown.test.jsx`
Expected: FAIL (continúa fallando por las clases y testid de SearchBar).

---

### Task 2: Implementar contenedor con Scroll, efecto visual peeking y auto-scroll con teclado en `SearchBar.jsx`

**Files:**
- Modify: `src/components/Sales/SearchBar.jsx:135-240`

**Step 1: Implementar mejoras en `SearchBar.jsx`**

1. Agregar ref para el contenedor desplazable y `useEffect` para auto-scroll cuando cambia `selectedIndex`:
```jsx
    const scrollContainerRef = useRef(null);

    useEffect(() => {
        if (!scrollContainerRef.current) return;
        const selectedEl = scrollContainerRef.current.children[selectedIndex];
        if (selectedEl && typeof selectedEl.scrollIntoView === 'function') {
            selectedEl.scrollIntoView({ block: 'nearest' });
        }
    }, [selectedIndex]);
```

2. Modificar el bloque del dropdown (alrededor de la línea 138):
```jsx
            {/* Search Dropdown (oculto en modo galería: el grid es el buscador) */}
            {posSearchViewMode !== 'grid' && searchResults.length > 0 && (
                <div className="absolute top-full mt-2 left-0 right-0 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl z-20 overflow-hidden flex flex-col">
                    <div
                        ref={scrollContainerRef}
                        data-testid="search-results-scroll-container"
                        className="max-h-[380px] overflow-y-auto overscroll-contain divide-y divide-slate-100 dark:divide-slate-800/50"
                    >
                        {searchResults.map((p, index) => {
                            const isLowStock = (p.stock ?? 0) <= (p.lowStockAlert ?? 5) && (p.stock ?? 0) >= 0;
                            const isOutOfStock = (p.stock ?? 0) === 0;
                            const catInfo = BODEGA_CATEGORIES.find(c => c.id === p.category);
                            const catColor = catInfo ? CATEGORY_COLORS[catInfo.color] : null;
                            const CatIcon = catInfo ? CATEGORY_ICONS[catInfo.id] : null;
                            const isSelected = index === selectedIndex;
                            return (
                                <button
                                    key={p.id}
                                    type="button"
                                    onClick={() => addToCart(p)}
                                    onMouseEnter={() => setSelectedIndex(index)}
                                    className={`w-full flex items-center gap-3 px-3 py-2.5 transition-all active:scale-[0.98]
                                        ${isSelected
                                            ? 'bg-emerald-50 dark:bg-emerald-900/20 border-l-4 border-l-emerald-500'
                                            : 'bg-transparent border-l-4 border-l-transparent hover:bg-slate-50 dark:hover:bg-slate-800/50'
                                        }
                                        ${isOutOfStock ? 'opacity-50' : ''}`}
                                >
                                    {/* Contenido existente del producto (SmartImage, nombre, precios, etc.) */}
                                    ...
                                </button>
                            );
                        })}
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-950 px-3 py-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[10px] font-bold text-slate-400 uppercase tracking-widest shrink-0">
                        <span>
                            {searchResults.length} {searchResults.length === 1 ? 'coincidencia' : 'coincidencias'}
                        </span>
                        <span className="flex items-center gap-1.5">
                            <span>Navega</span>
                            <span className="px-1 py-0.5 bg-slate-200 dark:bg-slate-800 rounded font-mono text-slate-600 dark:text-slate-300">↓</span>
                            <span className="px-1 py-0.5 bg-slate-200 dark:bg-slate-800 rounded font-mono text-slate-600 dark:text-slate-300">↑</span>
                            <span>Enter</span>
                            <span className="px-1 py-0.5 bg-slate-200 dark:bg-slate-800 rounded font-mono text-slate-600 dark:text-slate-300">↵</span>
                        </span>
                    </div>
                </div>
            )}
```

**Step 2: Run test to verify it passes**

Run: `npm test -- tests/posSearchScrollDropdown.test.jsx tests/posSearchViewModes.test.jsx`
Expected: PASS (todas las pruebas pasan).

**Step 3: Commit**

```bash
git add src/views/SalesView.jsx src/components/Sales/SearchBar.jsx tests/posSearchScrollDropdown.test.jsx
git commit -m "feat(pos): desplegable de busqueda con scroll suave, auto-scroll de teclado y hasta 50 resultados"
```

---

### Task 3: Verificación Completa y Chequeo de Tipos

**Step 1: Ejecutar suite de pruebas de ventas y búsqueda**

```bash
npm test -- tests/posSearchScrollDropdown.test.jsx tests/posSearchViewModes.test.jsx tests/searchMatch.test.js tests/checkout.test.js
npx tsc --noEmit
```
Expected: PASS (0 errores en tests y 0 errores de TypeScript).
