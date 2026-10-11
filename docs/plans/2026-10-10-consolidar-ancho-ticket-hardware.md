# Consolidación del Ancho de Ticket en Ticketera & Hardware (Opción 1)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminar la tarjeta huérfana duplicada de "Tamaño de Ticket" en `SettingsTabNegocio.jsx`, centralizando toda la configuración de periféricos de impresión en `Ajustes > Ventas > Ticketera & Hardware`.

**Architecture:** Se retira la sección renderizada en `SettingsTabNegocio.jsx`, limpiando las importaciones huérfanas (`Printer`), las props huérfanas (`paperWidth`, `setPaperWidth`) de su firma y la llamada innecesaria en `SettingsView.jsx`. `Ajustes > Negocio` queda focalizado exclusivamente en la identidad comercial (Nombre, RIF, Monedas y Etiquetas de estante). La gestión de hardware permanece en `PrinterHardwareManager.jsx` dentro de `SettingsTabVentas`.

**Tech Stack:** React 19, Tailwind CSS, Lucide Icons, Vitest.

> [!IMPORTANT]
> **3 gaps críticos corregidos respecto al plan original:**
> 1. Props `paperWidth`/`setPaperWidth` deben eliminarse de la **firma** del componente y de la **llamada** en `SettingsView.jsx`.
> 2. `labelGenerator` debe ser mockeado en el test (usa jsPDF/canvas que no existen en jsdom).
> 3. Los efectos async de `PdfPreview` requieren un tick de drenado extra antes de los assertions.

---

### Task 1: Crear Test Automatizado para Verificar la Estructura Limpia de `SettingsTabNegocio`

**Files:**
- Create: `tests/settingsTabNegocio.test.jsx`

**Step 1: Escribir la prueba unitaria (failing test)**

```jsx
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import SettingsTabNegocio from '../src/components/Settings/tabs/SettingsTabNegocio';

// CORRECCIÓN GAP-2: Mock de labelGenerator (usa jsPDF/canvas → no disponible en jsdom)
vi.mock('../src/utils/labelGenerator', () => ({
    generarPreviewLabel: vi.fn().mockResolvedValue('blob:mock-preview-url'),
}));

describe('SettingsTabNegocio - Consolidación y Limpieza de Tarjeta Huérfana', () => {
    let container;
    let root;

    // CORRECCIÓN GAP-1: paperWidth y setPaperWidth ya NO son props de SettingsTabNegocio
    const mockProps = {
        businessName: 'Mi Bodega C.A.',
        setBusinessName: vi.fn(),
        businessRif: 'J-12345678',
        setBusinessRif: vi.fn(),
        labelCurrencyMode: 'bs',
        setLabelCurrencyMode: vi.fn(),
        labelOffsetNameX: '0', setLabelOffsetNameX: vi.fn(),
        labelOffsetNameY: '0', setLabelOffsetNameY: vi.fn(),
        labelOffsetPriceX: '0', setLabelOffsetPriceX: vi.fn(),
        labelOffsetPriceY: '0', setLabelOffsetPriceY: vi.fn(),
        labelOffsetSecPriceX: '0', setLabelOffsetSecPriceX: vi.fn(),
        labelOffsetSecPriceY: '0', setLabelOffsetSecPriceY: vi.fn(),
        labelOffsetFooterX: '0', setLabelOffsetFooterX: vi.fn(),
        labelOffsetFooterY: '0', setLabelOffsetFooterY: vi.fn(),
        labelOffsetFontName: '8', setLabelOffsetFontName: vi.fn(),
        labelOffsetFontPrice: '10', setLabelOffsetFontPrice: vi.fn(),
        labelOffsetFontSecPrice: '8', setLabelOffsetFontSecPrice: vi.fn(),
        labelOffsetFontFooter: '7', setLabelOffsetFontFooter: vi.fn(),
        copEnabled: false,
        setCopEnabled: vi.fn(),
        autoCopEnabled: false,
        setAutoCopEnabled: vi.fn(),
        tasaCopManual: '4150',
        setTasaCopManual: vi.fn(),
        copPrimary: false,
        setCopPrimary: vi.fn(),
        calculatedTasaCop: 0,
        effectiveRate: 79.5,
        handleSaveBusinessData: vi.fn(),
        forceHeartbeat: vi.fn(),
        showToast: vi.fn(),
        triggerHaptic: vi.fn(),
    };

    beforeEach(() => {
        globalThis.IS_REACT_ACT_ENVIRONMENT = true;
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        if (root) {
            await act(async () => { root.unmount(); });
        }
        if (container && container.parentNode) {
            container.parentNode.removeChild(container);
        }
        vi.clearAllMocks();
    });

    it('renderiza las secciones propias de la identidad del negocio', async () => {
        await act(async () => {
            root.render(<SettingsTabNegocio {...mockProps} />);
        });
        // CORRECCIÓN GAP-3: drenar efectos async del PdfPreview sub-componente
        await act(async () => { await new Promise(r => setTimeout(r, 0)); });

        expect(container.textContent).toContain('Mi Negocio');
        expect(container.textContent).toContain('Etiquetas de Productos');
        expect(container.textContent).toContain('Peso Colombiano (COP)');
    });

    it('NO debe renderizar la tarjeta redundante de Tamaño de Ticket', async () => {
        await act(async () => {
            root.render(<SettingsTabNegocio {...mockProps} />);
        });
        // CORRECCIÓN GAP-3: drenar efectos async del PdfPreview
        await act(async () => { await new Promise(r => setTimeout(r, 0)); });

        // La tarjeta duplicada no debe existir en Negocio
        expect(container.textContent).not.toContain('Tamaño de Ticket');
        expect(container.textContent).not.toContain('58 mm (Pequeña)');
        expect(container.textContent).not.toContain('80 mm (Estándar)');
    });

    it('el botón Guardar del negocio sigue funcionando', async () => {
        await act(async () => {
            root.render(<SettingsTabNegocio {...mockProps} />);
        });
        await act(async () => { await new Promise(r => setTimeout(r, 0)); });

        const saveBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent.includes('Guardar'));
        expect(saveBtn).toBeDefined();
        await act(async () => { saveBtn.click(); });
        expect(mockProps.handleSaveBusinessData).toHaveBeenCalledTimes(1);
    });
});
```

**Step 2: Ejecutar el test — verificar que falla**

```powershell
npm test tests/settingsTabNegocio.test.jsx
```
Esperado: FAIL — `"Tamaño de Ticket"` y `"58 mm (Pequeña)"` aún están presentes en el render.

---

### Task 2: Limpiar `SettingsTabNegocio.jsx`

**Files:**
- Modify: `src/components/Settings/tabs/SettingsTabNegocio.jsx` (líneas 3, 90-93, 227-244)

**Step 1: Retirar `Printer` del import de lucide-react**

Cambiar:
```jsx
import { Store, Printer, Coins, Check, Tag } from 'lucide-react';
```
por:
```jsx
import { Store, Coins, Check, Tag } from 'lucide-react';
```

**Step 2: Retirar `paperWidth` y `setPaperWidth` de la firma del componente**

Cambiar la función:
```jsx
export default function SettingsTabNegocio({
    businessName, setBusinessName,
    businessRif, setBusinessRif,
    paperWidth, setPaperWidth,       // ← eliminar estas dos líneas
    labelCurrencyMode, setLabelCurrencyMode,
    ...
```
por:
```jsx
export default function SettingsTabNegocio({
    businessName, setBusinessName,
    businessRif, setBusinessRif,
    labelCurrencyMode, setLabelCurrencyMode,
    ...
```

**Step 3: Eliminar el bloque JSX de la tarjeta "Tamaño de Ticket" (líneas 227-244)**

Eliminar el bloque completo:
```jsx
{/* Impresora - Sólo Tamaño de Ticket */}
<SectionCard icon={Printer} title="Tamaño de Ticket" subtitle="Configuración del ancho de papel" iconColor="text-brand">
    <label className="text-[11px] uppercase tracking-wider font-extrabold text-slate-500 dark:text-slate-400 block mb-1.5">Ancho de Papel</label>
    <div className="grid grid-cols-2 gap-2">
        {[{ val: '58', label: '58 mm (Pequeña)' }, { val: '80', label: '80 mm (Estándar)' }].map(opt => (
            <button
                key={opt.val}
                onClick={() => { setPaperWidth(opt.val); localStorage.setItem('printer_paper_width', opt.val); triggerHaptic?.(); }}
                className={...}
            >
                {opt.label}
            </button>
        ))}
    </div>
</SectionCard>
```

---

### Task 3: Retirar las props huérfanas de `SettingsView.jsx`

**Files:**
- Modify: `src/views/SettingsView.jsx` (zona de `<SettingsTabNegocio>`)

**Step 1: Eliminar props `paperWidth` y `setPaperWidth` del `<SettingsTabNegocio>` en `SettingsView.jsx`**

Cambiar:
```jsx
<SettingsTabNegocio
    businessName={businessName} setBusinessName={setBusinessName}
    businessRif={businessRif} setBusinessRif={setBusinessRif}
    paperWidth={paperWidth} setPaperWidth={setPaperWidth}   // ← eliminar
    labelCurrencyMode={labelCurrencyMode} ...
```
por:
```jsx
<SettingsTabNegocio
    businessName={businessName} setBusinessName={setBusinessName}
    businessRif={businessRif} setBusinessRif={setBusinessRif}
    labelCurrencyMode={labelCurrencyMode} ...
```

> [!NOTE]
> `paperWidth` y `setPaperWidth` siguen llegando correctamente a `<SettingsTabVentas>` (unos renglones más abajo en `SettingsView.jsx`). No tocar esa llamada.

---

### Task 4: Verificación Completa y Compilación

**Step 1: Correr tests de Negocio y Ventas en conjunto**

```powershell
npm test tests/settingsTabNegocio.test.jsx tests/settingsTabVentas.test.jsx
```
Esperado: Todos en verde.

**Step 2: ESLint sobre los archivos modificados**

```powershell
npx eslint src/components/Settings/tabs/SettingsTabNegocio.jsx src/views/SettingsView.jsx
```
Esperado: 0 errores. Los warnings de `localStorage` pre-existentes están presentes antes del cambio → no son regresión.

**Step 3: Build de producción**

```powershell
npm run build
```
Esperado: Código de salida 0 sin errores.

---

### Task 5: Commit en Git

```powershell
git add src/components/Settings/tabs/SettingsTabNegocio.jsx src/views/SettingsView.jsx tests/settingsTabNegocio.test.jsx "docs/plans/2026-10-10-consolidar-ancho-ticket-hardware.md"
git commit -m "refactor(settings): consolidar ancho de ticket en Ventas > Ticketera y eliminar tarjeta duplicada de Negocio"
```
