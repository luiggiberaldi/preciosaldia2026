# Rediseño de Ajustes > Ventas con Sub-Pestañas Segmentadas (Propuesta A)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reorganizar la pestaña `Ajustes > Ventas` en 4 sub-pestañas segmentadas para eliminar el colapso visual, las alturas asimétricas y el desplazamiento infinito, preservando el 100% del estado, variables de `localStorage` y funcionalidades operativas.

**Architecture:** Se implementa un selector segmentado horizontal (`role="tablist"`) en la cabecera de `SettingsTabVentas.jsx` con persistencia en `localStorage('settings_ventas_active_subtab')`. Los 6 bloques y más de 10 tarjetas actuales se dividen de manera balanceada en 4 dominios cohesivos: `Terminal & Cobro`, `Caja & Vuelto`, `Políticas & Crédito` y `Ticketera & Hardware`.

**Tech Stack:** React 19, Tailwind CSS, Lucide Icons, Vitest, React Testing Library.

---

### Task 1: Arnés de Pruebas Automatizadas para `SettingsTabVentas`

**Files:**
- Create: `tests/settingsTabVentas.test.jsx`
- Modify: `package.json` (solo si se requieren flags de vitest)

**Step 1: Escribir la prueba unitaria automatizada (failing test)**

```jsx
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SettingsTabVentas from '../src/components/Settings/tabs/SettingsTabVentas';
import { ProductContext } from '../src/context/ProductContext';

// Mock de subcomponentes pesados para aislar la prueba de layout y navegación
vi.mock('../src/components/PaymentMethodsManager', () => ({
    default: () => <div data-testid="mock-payment-methods">Mock Payment Methods</div>,
}));

vi.mock('../src/components/PrinterHardwareManager', () => ({
    default: () => <div data-testid="mock-printer-hardware">Mock Printer Hardware</div>,
}));

describe('SettingsTabVentas - Rediseño con Sub-Pestañas', () => {
    const mockContextValue = {
        checkoutMode: 'auto',
        setCheckoutMode: vi.fn(),
        granelUnitMode: 'gr_ml',
        setGranelUnitMode: vi.fn(),
    };

    const mockProps = {
        allowNegativeStock: false,
        setAllowNegativeStock: vi.fn(),
        forceHeartbeat: vi.fn(),
        showToast: vi.fn(),
        triggerHaptic: vi.fn(),
        paperWidth: '58',
        setPaperWidth: vi.fn(),
    };

    const renderComponent = () => {
        return render(
            <ProductContext.Provider value={mockContextValue}>
                <SettingsTabVentas {...mockProps} />
            </ProductContext.Provider>
        );
    };

    beforeEach(() => {
        localStorage.clear();
        vi.clearAllMocks();
    });

    it('renderiza la barra de navegación con las 4 sub-pestañas', () => {
        renderComponent();
        expect(screen.getByRole('tab', { name: /terminal & cobro/i })).toBeDefined();
        expect(screen.getByRole('tab', { name: /caja & vuelto/i })).toBeDefined();
        expect(screen.getByRole('tab', { name: /políticas & crédito/i })).toBeDefined();
        expect(screen.getByRole('tab', { name: /ticketera & hardware/i })).toBeDefined();
    });

    it('por defecto abre en la sub-pestaña Terminal & Cobro', () => {
        renderComponent();
        expect(screen.getByText(/Modo de Pantalla/i)).toBeDefined();
        expect(screen.getByText(/Ticket de Venta/i)).toBeDefined();
        expect(screen.getByText(/Unidad de Granel/i)).toBeDefined();
        // Las secciones de otros paneles no deben estar visibles en el DOM
        expect(screen.queryByTestId('mock-payment-methods')).toBeNull();
        expect(screen.queryByTestId('mock-printer-hardware')).toBeNull();
    });

    it('permite cambiar a la sub-pestaña Caja & Vuelto y persiste en localStorage', () => {
        renderComponent();
        const tabCaja = screen.getByRole('tab', { name: /caja & vuelto/i });
        fireEvent.click(tabCaja);

        expect(localStorage.getItem('settings_ventas_active_subtab')).toBe('caja');
        expect(screen.getByText(/Cómo entrega la caja el cambio/i)).toBeDefined();
        expect(screen.getByTestId('mock-payment-methods')).toBeDefined();
    });

    it('permite cambiar a la sub-pestaña Políticas & Crédito', () => {
        renderComponent();
        const tabPoliticas = screen.getByRole('tab', { name: /políticas & crédito/i });
        fireEvent.click(tabPoliticas);

        expect(screen.getByText(/Vender sin Stock/i)).toBeDefined();
        expect(screen.getByText(/Cashea/i)).toBeDefined();
    });

    it('permite cambiar a la sub-pestaña Ticketera & Hardware', () => {
        renderComponent();
        const tabTicketera = screen.getByRole('tab', { name: /ticketera & hardware/i });
        fireEvent.click(tabTicketera);

        expect(screen.getByTestId('mock-printer-hardware')).toBeDefined();
    });
});
```

**Step 2: Ejecutar la prueba para verificar que falla**

Ejecutar:
```powershell
npm test tests/settingsTabVentas.test.jsx
```
Esperado: FAIL (faltan roles `tab`, sub-pestañas y persistencia de subtab en el componente actual).

---

### Task 2: Implementación de la Barra de Sub-Pestañas y Reorganización de Paneles en `SettingsTabVentas.jsx`

**Files:**
- Modify: `src/components/Settings/tabs/SettingsTabVentas.jsx`

**Step 1: Agregar el estado de sub-pestaña activa con persistencia**

```jsx
const [activeSubTab, setActiveSubTab] = useState(() => {
    const saved = localStorage.getItem('settings_ventas_active_subtab');
    return ['terminal', 'caja', 'politicas', 'ticketera'].includes(saved) ? saved : 'terminal';
});

const handleSubTabChange = (tabId) => {
    setActiveSubTab(tabId);
    localStorage.setItem('settings_ventas_active_subtab', tabId);
    triggerHaptic?.();
};
```

**Step 2: Definir las 4 sub-pestañas con sus metadatos e íconos**

```jsx
const SUB_TABS = [
    { id: 'terminal', label: 'Terminal & Cobro', icon: LayoutGrid, desc: 'Pantalla, ticket y pesaje' },
    { id: 'caja', label: 'Caja & Vuelto', icon: HandCoins, desc: 'Cambio, avances y formas de pago' },
    { id: 'politicas', label: 'Políticas & Crédito', icon: ShieldCheck, desc: 'Inventario, Cashea y fiados' },
    { id: 'ticketera', label: 'Ticketera & Hardware', icon: Printer, desc: 'Papel, driver y calibración' },
];
```

**Step 3: Renderizar el selector segmentado horizontal estilizado y accesible**

```jsx
<div role="tablist" aria-label="Subsecciones de Ventas" className="flex items-center gap-1.5 p-1.5 bg-slate-100 dark:bg-slate-900/90 rounded-2xl border border-slate-200/80 dark:border-slate-800 overflow-x-auto shadow-xs">
    {SUB_TABS.map(tab => {
        const isActive = activeSubTab === tab.id;
        const Icon = tab.icon;
        return (
            <button
                key={tab.id}
                role="tab"
                aria-selected={isActive}
                type="button"
                onClick={() => handleSubTabChange(tab.id)}
                className={`flex-1 min-w-[140px] flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs font-black transition-all cursor-pointer select-none active:scale-[0.98] ${
                    isActive
                        ? 'bg-brand text-white shadow-sm ring-2 ring-brand/20'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/60 dark:hover:bg-slate-800/60'
                }`}
            >
                <Icon size={15} />
                <span>{tab.label}</span>
            </button>
        );
    })}
</div>
```

**Step 4: Distribuir los bloques en paneles condicionales limpios y balanceados**

1. **Panel `terminal` (Terminal & Cobro):**
   - Tarjeta 1: Modo de Cobro (Interfaz Móvil / PC / Auto).
   - Tarjeta 2: Ticket de Venta (Moneda Bs / USD / Mixto).
   - Tarjeta 3: Unidad de Granel (Kg-Lt vs Gramos-ml).
   - *Layout:* `grid grid-cols-1 lg:grid-cols-3 gap-4 items-stretch`. Las 3 tarjetas tienen alturas similares y no compiten con listas largas.

2. **Panel `caja` (Caja & Vuelto):**
   - Tarjeta 1 (Fila superior): Desglose del cambio en divisas (billete menor USD, redondeo Bs, a favor del cliente/tienda).
   - Tarjeta 2 (Fila superior): Avance de efectivo (toggle + porcentaje de recargo).
   - Tarjeta 3 (Fila inferior full-width): Formas & Cuentas de Pago (`PaymentMethodsManager`).
   - *Layout:* `grid grid-cols-1 lg:grid-cols-2 gap-4` arriba + bloque completo abajo.

3. **Panel `politicas` (Políticas & Crédito):**
   - Tarjeta 1: Inventario (Vender sin stock, Cesta viva).
   - Tarjeta 2: Financiamiento Cashea (Activar + monto mínimo).
   - Tarjeta 3: Cuentas por cobrar & Fiados (Separar fiados en reporte + Reparar cartera desde el ledger con advertencia de seguridad).
   - *Layout:* `grid grid-cols-1 lg:grid-cols-2 gap-4`.

4. **Panel `ticketera` (Ticketera & Hardware):**
   - Tarjeta unificada: `PrinterHardwareManager` (ancho de rollo 58mm/80mm, instalador de driver USB Windows, prueba de corte).

---

### Task 3: Verificación con Tests Automatizados y Lint

**Step 1: Ejecutar la suite de pruebas del componente**

```powershell
npm test tests/settingsTabVentas.test.jsx
```
Esperado: 4/4 passed (100% verde).

**Step 2: Ejecutar las pruebas relacionadas de granel y configuración**

```powershell
npm test tests/granelUnits.test.js tests/changeSplitSettings.test.js
```
Esperado: Todas las pruebas en verde.

**Step 3: Compilar la aplicación para producción**

```powershell
npm run build
```
Esperado: Código de salida 0 sin errores de sintaxis ni importaciones rotas.

---

### Task 4: Revisión Visual y Commit

**Step 1: Verificar en la interfaz web**
- Confirmar que las 4 sub-pestañas cambian de vista suavemente.
- Confirmar que al recargar la página la sub-pestaña seleccionada se mantiene activa.
- Confirmar que el modo oscuro y modo claro renderizan con contraste óptimo.

**Step 2: Crear el commit de git**

```powershell
git add src/components/Settings/tabs/SettingsTabVentas.jsx tests/settingsTabVentas.test.jsx docs/plans/2026-10-10-rediseño-ajustes-ventas-subtabs.md
git commit -m "feat(settings): reorganizar pestaña Ventas en sub-pestañas segmentadas para eliminar sobrecarga visual"
```
