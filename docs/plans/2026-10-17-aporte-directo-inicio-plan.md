# Apertura Directa de Modal "Registrar Aporte" en Dashboard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Permitir que el botón "Registrar Aporte" en el Dashboard principal abra directamente el modal `AporteCajaModal` y guarde el aporte en la caja sin redirigir al usuario a la vista de ventas.

**Architecture:** Se desacopla la acción del botón de la navegación `onNavigate('ventas')`, agregando la propiedad `onOpenAporte` en `DashboardCashControls`. En `DashboardView`, se gestiona el estado local `isAporteOpen`, se monta el modal `AporteCajaModal` y se persiste el aporte directamente en IndexedDB (`storageService.setItem`) con control de concurrencia (`withLock`), actualización reactiva de ventas y registro en auditoría.

**Tech Stack:** React 18, Tailwind CSS, Lucide React, Vitest, Testing Library, localforage / storageService.

---

### Task 1: Soporte directo de `onOpenAporte` en `DashboardCashControls`

**Files:**
- Test: `tests/dashboardCashControls.test.jsx`
- Modify: `src/components/Dashboard/DashboardCashControls.jsx:20-30`, `src/components/Dashboard/DashboardCashControls.jsx:85-125`

**Step 1: Write the failing test**

Crear el archivo `tests/dashboardCashControls.test.jsx` con pruebas que verifiquen:
1. Al pulsar "Registrar Aporte", si se provee `onOpenAporte`, se invoca esta función directamente.
2. Si solo se provee `onGoVentas` (retrocompatibilidad), se llama a `onGoVentas`.

```jsx
// @vitest-environment jsdom
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DashboardCashControls from '../src/components/Dashboard/DashboardCashControls';

describe('DashboardCashControls - Registrar Aporte direct trigger', () => {
    let container;
    let root;

    beforeEach(() => {
        globalThis.IS_REACT_ACT_ENVIRONMENT = true;
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
    });

    it('calls onOpenAporte when Registrar Aporte is clicked', async () => {
        const onOpenAporte = vi.fn();
        const onGoVentas = vi.fn();
        const triggerHaptic = vi.fn();

        await act(async () => {
            root.render(
                <DashboardCashControls
                    isAdmin={true}
                    todayApertura={{ id: 'ap_1', montoTotalBs: 100 }}
                    onOpenGasto={vi.fn()}
                    onOpenAporte={onOpenAporte}
                    onGoVentas={onGoVentas}
                    triggerHaptic={triggerHaptic}
                />
            );
        });

        const buttons = Array.from(container.querySelectorAll('button'));
        const aporteBtn = buttons.find(b => b.textContent.includes('Registrar Aporte'));

        expect(aporteBtn).toBeTruthy();

        await act(async () => {
            aporteBtn.click();
        });

        expect(onOpenAporte).toHaveBeenCalledTimes(1);
        expect(onGoVentas).not.toHaveBeenCalled();
        expect(triggerHaptic).toHaveBeenCalledTimes(1);
    });

    it('falls back to onGoVentas if onOpenAporte is not provided', async () => {
        const onGoVentas = vi.fn();

        await act(async () => {
            root.render(
                <DashboardCashControls
                    isAdmin={true}
                    todayApertura={{ id: 'ap_1', montoTotalBs: 100 }}
                    onOpenGasto={vi.fn()}
                    onGoVentas={onGoVentas}
                />
            );
        });

        const buttons = Array.from(container.querySelectorAll('button'));
        const aporteBtn = buttons.find(b => b.textContent.includes('Registrar Aporte'));

        expect(aporteBtn).toBeTruthy();

        await act(async () => {
            aporteBtn.click();
        });

        expect(onGoVentas).toHaveBeenCalledTimes(1);
    });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/dashboardCashControls.test.jsx`
Expected: FAIL (porque `onOpenAporte` aún no se recibe ni se llama en el botón de `DashboardCashControls`).

**Step 3: Write minimal implementation**

En `src/components/Dashboard/DashboardCashControls.jsx`:
1. Agregar `onOpenAporte` a las props destructuradas:
```jsx
export default function DashboardCashControls({
    isAdmin,
    paymentBreakdown,
    fondoBreakdown,
    copEnabled,
    copPrimary,
    tasaCop,
    bcvRate,
    todayCashFlow,
    todayApertura,
    todaySales,
    todayTotalUsd,
    todayTotalCop,
    onDailyClose,
    onOpenGasto,
    onTasaClick,
    onOpenAporte,
    onGoVentas,
    triggerHaptic,
}) {
```
2. Modificar la condición de render y click:
```jsx
                <div className={`grid grid-cols-1 ${isAdmin && todayApertura && (onOpenAporte || onGoVentas) ? 'sm:grid-cols-2' : ''} gap-3`}>
                    <button
                        type="button"
                        onClick={() => { triggerHaptic && triggerHaptic(); onOpenGasto && onOpenGasto(); }}
                        className="w-full min-h-[96px] bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/60 text-rose-600 dark:text-rose-400 border border-rose-200/70 dark:border-rose-900/50 rounded-2xl p-4 shadow-sm active:scale-[0.98] transition-all flex items-center justify-between group"
                    >
                    ...
                    </button>
                    {isAdmin && todayApertura && (onOpenAporte || onGoVentas) && (
                        <button
                            type="button"
                            onClick={() => {
                                triggerHaptic && triggerHaptic();
                                if (onOpenAporte) onOpenAporte();
                                else if (onGoVentas) onGoVentas();
                            }}
                            className="w-full min-h-[96px] bg-emerald-50 dark:bg-emerald-950/30 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200/70 dark:border-emerald-900/50 rounded-2xl p-4 shadow-sm active:scale-[0.98] transition-all flex items-center justify-between group"
                        >
                            <span className="flex items-center gap-3 min-w-0">
                                <span className="w-11 h-11 bg-emerald-100 dark:bg-emerald-900/40 rounded-xl flex items-center justify-center shadow-inner shrink-0">
                                    <Wallet size={22} className="text-emerald-600 dark:text-emerald-400" />
                                </span>
                                <span className="text-left min-w-0">
                                    <span className="block text-sm font-black">Registrar Aporte</span>
                                    <span className="block text-[11px] text-emerald-600/80 dark:text-emerald-400/80 font-bold">Efectivo adicional del turno</span>
                                </span>
                            </span>
                            <span className="w-8 h-8 bg-emerald-100 dark:bg-emerald-900/40 rounded-lg flex items-center justify-center group-hover:scale-110 transition-transform shrink-0">
                                <Plus size={18} className="text-emerald-600 dark:text-emerald-400" />
                            </span>
                        </button>
                    )}
                </div>
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/dashboardCashControls.test.jsx`
Expected: PASS (2 tests pasados).

**Step 5: Commit**

```bash
git add tests/dashboardCashControls.test.jsx src/components/Dashboard/DashboardCashControls.jsx
git commit -m "feat(dashboard): soporte directo de onOpenAporte en DashboardCashControls"
```

---

### Task 2: Integrar `AporteCajaModal` y guardado atómico en `DashboardView`

**Files:**
- Modify: `src/views/DashboardView.jsx`
- Test: `tests/dashboardAporteIntegration.test.jsx`

**Step 1: Write the failing test**

Crear `tests/dashboardAporteIntegration.test.jsx` que renderice un mock representativo del flujo en `DashboardView` o verifique la función de guardado `handleSaveAporteFromDashboard`:
1. Valida permisos: si el usuario no es admin con sesión requerida, no permite guardar.
2. Si los datos son válidos, llama a `buildAporteCajaRecord`, guarda en `storageService` con `pos_write_lock`, registra en `auditLog` y muestra toast de éxito.

```jsx
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildAporteCajaRecord } from '../src/utils/cajaAporte';
import { storageService } from '../src/utils/storageService';
import { withLock } from '../src/utils/withLock';

describe('Dashboard Aporte Flow Integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('builds APORTE_CAJA record and appends to storage', async () => {
        const mockSales = [{ id: 'sale_1', totalUsd: 10 }];
        vi.spyOn(storageService, 'getItem').mockResolvedValue(mockSales);
        vi.spyOn(storageService, 'setItem').mockResolvedValue(true);

        const data = {
            aporteUsd: 20,
            aporteBs: 0,
            aporteCop: 0,
            motivo: 'Fondo para sencillo'
        };

        const usuario = { id: 'admin_1', nombre: 'Carlos Admin' };
        const record = buildAporteCajaRecord({ ...data, usuario });

        expect(record.tipo).toBe('APORTE_CAJA');
        expect(record.aporteUsd).toBe(20);
        expect(record.motivo).toBe('Fondo para sencillo');
        expect(record.registradoPor).toBe('Carlos Admin');

        await withLock('pos_write_lock', async () => {
            const existingSales = await storageService.getItem('bodega_sales_v1', []);
            await storageService.setItem('bodega_sales_v1', [...existingSales, record]);
        });

        expect(storageService.setItem).toHaveBeenCalledWith(
            'bodega_sales_v1',
            [mockSales[0], record]
        );
    });
});
```

**Step 2: Run test to verify it passes**

Run: `npm test -- tests/dashboardAporteIntegration.test.jsx`
Expected: PASS.

**Step 3: Modify `src/views/DashboardView.jsx`**

1. Importar los módulos requeridos al inicio:
```jsx
import { withLock } from '../utils/withLock';
import { buildAporteCajaRecord } from '../utils/cajaAporte';
import AporteCajaModal from '../components/Sales/AporteCajaModal';
```

2. Agregar estado para el modal (junto a los otros modales de UI):
```jsx
    const [isAporteOpen, setIsAporteOpen] = useState(false);
```

3. Crear el manejador `handleSaveAporteFromDashboard`:
```jsx
    const handleSaveAporteFromDashboard = async (data) => {
        if (requireLogin && usuarioActivo?.rol !== 'ADMIN') {
            showToast('Solo el administrador puede registrar aportes de efectivo.', 'error');
            return false;
        }

        let record;
        try {
            record = buildAporteCajaRecord({ ...data, usuario: usuarioActivo });
        } catch (err) {
            showToast(err.message, 'error');
            return false;
        }

        try {
            await withLock('pos_write_lock', async () => {
                const existingSales = await storageService.getItem(SALES_KEY, []);
                await storageService.setItem(SALES_KEY, [...existingSales, record]);
                setSales(prev => [record, ...prev]);
            });
            showToast('Aporte de efectivo registrado en caja', 'success');
            auditLog('CAJA', 'APORTE_CAJA', `Aporte de efectivo registrado: $${record.aporteUsd || 0} / Bs ${record.aporteBs || 0}`);
            if (triggerHaptic) triggerHaptic();
            setIsAporteOpen(false);
            return true;
        } catch (error) {
            console.error('Error al registrar aporte de caja desde inicio:', error);
            showToast('Error al registrar el aporte', 'error');
            return false;
        }
    };
```

4. Pasar la prop `onOpenAporte` a `<DashboardCashControls>`:
```jsx
                <DashboardCashControls
                    isAdmin={isAdmin}
                    paymentBreakdown={paymentBreakdown}
                    fondoBreakdown={fondoBreakdown}
                    copEnabled={copEnabled}
                    copPrimary={copPrimary}
                    tasaCop={tasaCop}
                    bcvRate={bcvRate}
                    todayCashFlow={todayCashFlow}
                    todayApertura={todayApertura}
                    todaySales={todaySales}
                    todayTotalUsd={todayTotalUsd}
                    todayTotalCop={todayTotalCop}
                    onDailyClose={handleDailyClose}
                    onOpenGasto={() => setIsAddGastoOpen(true)}
                    onOpenAporte={isAdmin && todayApertura ? () => setIsAporteOpen(true) : null}
                    onTasaClick={() => setShowMonitor(true)}
                    triggerHaptic={triggerHaptic}
                />
```

5. Renderizar `<AporteCajaModal>` en la sección de modales (junto a `<GastosInternosModal>`):
```jsx
            <AporteCajaModal
                isOpen={isAporteOpen}
                onClose={() => setIsAporteOpen(false)}
                onConfirm={handleSaveAporteFromDashboard}
                copEnabled={copEnabled}
                copPrimary={copPrimary}
            />
```

**Step 4: Run typecheck and tests**

Run:
```bash
npm test -- tests/cajaAporte.test.js tests/dashboardCashControls.test.jsx tests/dashboardAporteIntegration.test.jsx
npx tsc --noEmit
```
Expected: PASS (todos los tests pasan y 0 errores de typescript).

**Step 5: Commit**

```bash
git add src/views/DashboardView.jsx tests/dashboardAporteIntegration.test.jsx
git commit -m "feat(dashboard): abrir AporteCajaModal directo desde inicio sin ir a ventas"
```

---

### Task 3: Verificación General de Regresión

**Files:**
- N/A (suite de validación)

**Step 1: Ejecutar suite de pruebas de caja y cierre**
```bash
npm test -- tests/cajaAporte.test.js tests/cajaTurnos.test.js tests/dashboardCashControls.test.jsx
```
Expected: 100% PASS.

**Step 2: Commit final o verificación de estado**
```bash
git status
```
Expected: Directorio de trabajo limpio.
