# Instalador y Configuración de Impresoras Térmicas POS — Plan de Implementación

> **Para el agente ejecutor:** REQUIRED SUB-SKILL: Use superpowers:executing-plans para implementar este plan tarea por tarea.

**Goal:** Integrar el instalador de drivers de impresoras térmicas POS (`Diver Generico POS (2).exe`) en el sistema Precios al Día Bodega. Proveer descarga directa en 1 clic desde los Ajustes, selector de formato de papel (58 mm/80 mm), ticket de calibración impreso al instante, y enlace de ayuda en el modal de cierre de caja.

**Architecture:**
- El paquete de instalación y scripts auxiliares se sirven como activos estáticos desde `public/drivers/`.
- La lógica de generación del ticket de prueba se encapsula en `src/utils/printerTestUtils.js`.
- El componente de UI `PrinterHardwareManager.jsx` es **stateless respecto a `paperWidth`**: recibe el ancho de papel como prop desde `SettingsView`, que ya posee el estado `paperWidth` + `setPaperWidth` (ver `SettingsView.jsx` línea ~67). Esto evita doble fuente de verdad sobre `printer_paper_width` en localStorage.

**Tech Stack:** React 18, Vite, Tailwind CSS, Lucide Icons, HTML5 Print API (`window.open` / iframe fallback), Inno Setup V7.17 (driver POS genérico).

---

> [!IMPORTANT]
> **Hallazgos de la auditoría** (correcciones ya aplicadas en este plan):
> 1. `SettingsView.jsx` ya tiene `const [paperWidth, setPaperWidth]` leyendo `printer_paper_width`. `PrinterHardwareManager` recibe estos como props para evitar estado duplicado.
> 2. `Printer` no está en la lista de imports existente de `SettingsTabVentas.jsx` — se agrega a la línea existente, no como import separado.
> 3. `autoCut` / `handleAutoCutToggle` eran dead code — eliminados hasta tener UI visible.
> 4. `CheckCircle` y `FileText` no se usaban en el JSX del componente — eliminados para evitar warning de Vite.
> 5. Comando PowerShell del Task 1 usa ruta absoluta desde la raíz del proyecto.
> 6. Task 6 tiene URL concreta de verificación en dev.

---

## Task 1 — Alojar el paquete de controladores en `public/drivers/`

**Archivos a crear:**
- `public/drivers/Instalador_Impresora_POS.exe` (copia de `Diver Generico POS (2).exe`)
- `public/drivers/instalar_silencioso.bat`
- `public/drivers/LEEME_INSTRUCCIONES.txt`

### Step 1.1 — Crear el directorio y copiar el ejecutable

Ejecutar desde la raíz del proyecto `preciosaldia-bodega`:

```powershell
$root = "C:\Users\luigg\Desktop\sistemas generales\precios al dia final\preciosaldia-bodega"
New-Item -ItemType Directory -Force -Path "$root\public\drivers"
Copy-Item "$root\Diver Generico POS (2).exe" "$root\public\drivers\Instalador_Impresora_POS.exe"
```

### Step 1.2 — Crear `public/drivers/instalar_silencioso.bat`

```bat
@echo off
title Asistente de Instalacion de Impresora Termica - Precios al Dia
echo ==============================================================
echo    PRECIOS AL DIA - INSTALADOR DE IMPRESORA TERMICA POS
echo    Driver: POS Printer Driver V7.17
echo ==============================================================
echo Instalando controladores en segundo plano...
echo.
"%~dp0Instalador_Impresora_POS.exe" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART
if %ERRORLEVEL% EQU 0 (
    echo.
    echo [EXITO] Driver instalado correctamente.
    echo Conecte su impresora USB y seleccione POS-58 o POS-80 en el instalador.
) else (
    echo.
    echo [AVISO] Iniciando instalador interactivo...
    "%~dp0Instalador_Impresora_POS.exe"
)
pause
```

### Step 1.3 — Crear `public/drivers/LEEME_INSTRUCCIONES.txt`

```txt
===========================================================
  PRECIOS AL DIA - GUIA DE INSTALACION DE TICKETERA TERMICA
  Driver: POS Printer Driver V7.17 (Inno Setup 5.5.7)
  Compatibilidad: Windows 7 / 8 / 10 / 11 (32 y 64 bits)
===========================================================

PASOS RAPIDOS:
1. Conecta la impresora termica a la corriente electrica.
2. Coloca el rollo de papel termico (cara brillante hacia arriba).
3. Conecta el cable USB a la computadora.
4. Enciende la impresora.
5. Ejecuta "instalar_silencioso.bat" como Administrador.
   (O haz doble clic en "Instalador_Impresora_POS.exe" para instalacion interactiva.)

EN EL INSTALADOR INTERACTIVO:
- Selecciona tu modelo segun el ancho del papel:
    "POS-58" → rollo angosto de 58 mm (impresoras compactas/portatiles)
    "POS-80" → rollo ancho de 80 mm con guillotina (impresoras de mostrador)
- Puerto recomendado: USB001
- Haz clic en "Install Now".

DESPUES DE INSTALAR:
- Abre Precios al Dia.
- Ve a Ajustes > Ventas > Impresora Termica.
- Selecciona el mismo ancho de papel (58 mm o 80 mm).
- Presiona "Imprimir Ticket de Prueba" para verificar.

SOPORTE:
Si el ticket sale cortado o desalineado, verifica que el ancho
configurado en Precios al Dia coincida con tu rollo fisico.
===========================================================
```

### Step 1.4 — Verificar los 3 archivos

```powershell
Get-ChildItem -Path "C:\Users\luigg\Desktop\sistemas generales\precios al dia final\preciosaldia-bodega\public\drivers"
```

**Expected:** 3 entradas: `Instalador_Impresora_POS.exe` (≈2.7 MB), `instalar_silencioso.bat`, `LEEME_INSTRUCCIONES.txt`.

---

## Task 2 — Módulo de ticket de calibración (`printerTestUtils.js`)

**Archivos a crear:**
- `src/utils/printerTestUtils.js`

> [!NOTE]
> `openPrintWindow(html)` está en `src/utils/printerUtils.js` línea 41. Su firma es `(html: string) => void`.
> `getPaperConfig(paperWidth)` está en `src/utils/ticketConstants.js` línea 22. Retorna `{ cssPageSize, cssBodyWidth, fSmall, fBase, fTitle, fTiny, ... }`.
> El ticket de prueba es contenido estático controlado — no se usan campos de usuario, por lo que **no se necesita `escapeHtml()`**.

### Step 2.1 — Crear `src/utils/printerTestUtils.js`

```javascript
/**
 * Genera y envía a imprimir un ticket de calibración para ticketeras térmicas.
 *
 * @module utils/printerTestUtils
 */
import { openPrintWindow } from './printerUtils';
import { getPaperConfig } from './ticketConstants';

/**
 * Imprime un ticket de calibración con regla de caracteres y datos del sistema.
 *
 * @param {'58'|'80'} paperWidth - Ancho del rollo en milímetros.
 */
export function imprimirTicketPrueba(paperWidth = '58') {
    const config = getPaperConfig(paperWidth);
    const is80 = paperWidth === '80';

    const fechaHora = new Date().toLocaleString('es-VE', {
        dateStyle: 'short',
        timeStyle: 'medium',
    });

    // Regla de longitud calibrada por ancho
    const regla80 = '================================================';
    const regla58 = '================================';
    const regla    = is80 ? regla80 : regla58;
    const nums80   = '1234567890123456789012345678901234567890123456789';
    const nums58   = '123456789012345678901234567890123';
    const nums     = is80 ? nums80 : nums58;

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="utf-8">
    <title>Ticket de Prueba</title>
    <style>
        @page {
            size: ${config.cssPageSize};
            margin: 0;
        }
        * { box-sizing: border-box; }
        body {
            margin: 0;
            padding: 4mm;
            width: ${config.cssBodyWidth};
            font-family: 'Courier New', Courier, monospace;
            color: #000;
            background: #fff;
            font-size: ${config.fSmall};
            line-height: 1.3;
            -webkit-print-color-adjust: exact;
        }
        .c  { text-align: center; }
        .b  { font-weight: bold; }
        .hr { border: none; border-top: 1px dashed #000; margin: 2mm 0; }
        .title { font-size: ${config.fTitle}; }
        .badge {
            display: inline-block;
            border: 1px solid #000;
            padding: 1mm 3mm;
            font-size: ${config.fBase};
            margin: 2mm 0;
        }
        .tiny  { font-size: ${config.fTiny}; }
        .foot  { font-size: ${config.fTiny}; margin-top: 3mm; }
    </style>
</head>
<body>
    <div class="c">
        <div class="b title">PRECIOS AL DIA</div>
        <div class="b">SISTEMA POS &amp; BODEGA</div>
        <div class="badge b">TICKET DE PRUEBA</div>
        <div>${fechaHora}</div>
    </div>

    <hr class="hr">

    <div><b>ANCHO:</b> ${paperWidth} mm — ${is80 ? 'Rollo Ancho (80mm)' : 'Rollo Angosto (58mm)'}</div>
    <div><b>ESTADO:</b> CONEXION EXITOSA</div>
    <div><b>ALINEACION:</b> CORRECTA</div>

    <hr class="hr">

    <div class="c tiny">
        ${regla}<br>
        ${nums}<br>
        ${regla}
    </div>

    <hr class="hr">

    <div class="c b">
        Ticketera lista para emitir<br>tickets y recibos de venta!
    </div>

    <div class="c foot">
        *** PRECIOS AL DIA — LISTO ***<br><br>
        .<br>.<br>
    </div>
</body>
</html>`;

    openPrintWindow(html);
}
```

---

## Task 3 — Componente de configuración de hardware (`PrinterHardwareManager.jsx`)

**Archivos a crear:**
- `src/components/Settings/PrinterHardwareManager.jsx`

> [!IMPORTANT]
> **Diseño de props corregido (auditoría Error 1):**
> `SettingsView.jsx` ya controla `paperWidth` / `setPaperWidth` y los persiste vía `handleSaveBusinessData`. Este componente **no crea estado local** para `paperWidth` — lo recibe como prop y llama a `setPaperWidth` directamente. Esto mantiene una única fuente de verdad en `SettingsView`.

### Step 3.1 — Crear `src/components/Settings/PrinterHardwareManager.jsx`

```jsx
/**
 * Sección de configuración de impresora térmica para el panel de Ajustes.
 *
 * Props:
 *  - paperWidth   {'58'|'80'}  Ancho actual del papel (controlado por SettingsView).
 *  - setPaperWidth (width: string) => void  Setter que actualiza localStorage y re-renderiza SettingsView.
 *  - showToast    (msg: string, type: string) => void
 *  - triggerHaptic () => void
 */
import React from 'react';
import { Printer, Download, HelpCircle, Check } from 'lucide-react';
import { imprimirTicketPrueba } from '../../utils/printerTestUtils';

export default function PrinterHardwareManager({ paperWidth, setPaperWidth, showToast, triggerHaptic }) {

    const handlePaperWidthChange = (width) => {
        setPaperWidth(width);
        localStorage.setItem('printer_paper_width', width);
        triggerHaptic?.();
        showToast?.(`Formato configurado: ${width} mm. Guarda los datos del negocio para conservar el cambio.`, 'info');
    };

    const handlePrintTest = () => {
        triggerHaptic?.();
        imprimirTicketPrueba(paperWidth);
        showToast?.('Enviando ticket de prueba a la impresora…', 'info');
    };

    return (
        <div className="space-y-4">

            {/* ── Selector de ancho de papel ── */}
            <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">
                    Ancho de papel de tu ticketera
                </label>
                <div className="grid grid-cols-2 gap-2">
                    {[
                        { value: '58', label: '58 mm (Angosto)', sub: 'Impresoras portátiles o compactas' },
                        { value: '80', label: '80 mm (Estándar)', sub: 'Impresoras de caja con guillotina' },
                    ].map(({ value, label, sub }) => (
                        <button
                            key={value}
                            type="button"
                            onClick={() => handlePaperWidthChange(value)}
                            className={`p-3 rounded-xl border text-left transition-all flex items-start gap-2.5 active:scale-[0.98] ${
                                paperWidth === value
                                    ? 'border-brand bg-brand/5 dark:bg-brand/10 ring-2 ring-brand/20'
                                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700'
                            }`}
                        >
                            <div className={`w-4 h-4 rounded-full mt-0.5 border flex items-center justify-center shrink-0 ${
                                paperWidth === value
                                    ? 'border-brand bg-brand text-white'
                                    : 'border-slate-300 dark:border-slate-600'
                            }`}>
                                {paperWidth === value && <Check size={10} />}
                            </div>
                            <div>
                                <div className="text-xs font-black text-slate-800 dark:text-white">{label}</div>
                                <div className="text-[10px] text-slate-400 dark:text-slate-500">{sub}</div>
                            </div>
                        </button>
                    ))}
                </div>
            </div>

            {/* ── Acciones: descarga e impresión de prueba ── */}
            <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-slate-100 dark:border-slate-800/80">
                <a
                    href="/drivers/Instalador_Impresora_POS.exe"
                    download="Instalador_Impresora_POS.exe"
                    className="flex-1 py-2.5 px-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-black text-xs flex items-center justify-center gap-2 shadow-sm transition-all active:scale-[0.98]"
                >
                    <Download size={14} /> Descargar Driver (.exe)
                </a>

                <button
                    type="button"
                    onClick={handlePrintTest}
                    className="flex-1 py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs flex items-center justify-center gap-2 shadow-sm transition-all active:scale-[0.98]"
                >
                    <Printer size={14} /> Imprimir Ticket de Prueba
                </button>
            </div>

            {/* ── Instrucción contextual ── */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400 flex items-start gap-2">
                <HelpCircle size={15} className="text-blue-500 shrink-0 mt-0.5" />
                <span>
                    <strong>¿Primera vez instalando?</strong> Conecta la ticketera por USB, descarga e instala el driver seleccionando <em>POS-{paperWidth}</em> · puerto USB001. Luego pulsa <em>Imprimir Ticket de Prueba</em> para verificar márgenes.
                </span>
            </div>
        </div>
    );
}
```

---

## Task 4 — Integrar en `SettingsTabVentas.jsx`

**Archivos a modificar:**
- `src/components/Settings/tabs/SettingsTabVentas.jsx`

> [!IMPORTANT]
> **Auditoría Error 2 corregido:** `Printer` se agrega a la línea de imports de lucide-react **existente** (línea 2). No se crea un segundo bloque `import`.

### Step 4.1 — Agregar `Printer` a los imports de lucide ya existentes (línea 2)

**Antes:**
```jsx
import { Package, CreditCard, FileText, DollarSign, LayoutGrid, SlidersHorizontal, ShieldCheck, Zap, Smartphone, Monitor, Check, HandCoins } from 'lucide-react';
```

**Después:**
```jsx
import { Package, CreditCard, FileText, DollarSign, LayoutGrid, SlidersHorizontal, ShieldCheck, Zap, Smartphone, Monitor, Check, HandCoins, Printer } from 'lucide-react';
```

### Step 4.2 — Agregar import de `PrinterHardwareManager` después de la línea de `CasheaIcon`

Agregar la siguiente línea después de `import CasheaIcon from '../../CasheaIcon';`:

```jsx
import PrinterHardwareManager from '../PrinterHardwareManager';
```

### Step 4.3 — Actualizar la firma del componente para recibir `paperWidth` y `setPaperWidth`

**Antes (línea 8–11):**
```jsx
export default function SettingsTabVentas({
    allowNegativeStock, setAllowNegativeStock,
    forceHeartbeat, showToast, triggerHaptic
}) {
```

**Después:**
```jsx
export default function SettingsTabVentas({
    allowNegativeStock, setAllowNegativeStock,
    forceHeartbeat, showToast, triggerHaptic,
    paperWidth, setPaperWidth,
}) {
```

### Step 4.4 — Insertar el bloque "Ticketera Térmica" antes del bloque de Métodos de Pago

Localizar el comentario `{/* BLOQUE 3: MÉTODOS DE PAGO */}` (línea ~523) e insertar **inmediatamente antes**:

```jsx
{/* ── BLOQUE: TICKETERA TÉRMICA & HARDWARE ── */}
<div>
    <div className="flex items-center gap-2 mb-3 px-1">
        <Printer size={16} className="text-brand dark:text-brand" />
        <h2 className="text-xs font-black uppercase tracking-wider text-slate-400 dark:text-slate-500">
            Impresora Térmica &amp; Hardware
        </h2>
    </div>
    <SectionCard
        icon={Printer}
        title="Configuración de Ticketera"
        subtitle="Drivers, formato de papel (58 mm / 80 mm) y calibración de impresión"
        iconColor="text-brand"
    >
        <PrinterHardwareManager
            paperWidth={paperWidth}
            setPaperWidth={setPaperWidth}
            showToast={showToast}
            triggerHaptic={triggerHaptic}
        />
    </SectionCard>
</div>
```

---

## Task 5 — Pasar `paperWidth` / `setPaperWidth` a `SettingsTabVentas` desde `SettingsView`

**Archivos a modificar:**
- `src/views/SettingsView.jsx`

> [!NOTE]
> `SettingsView.jsx` ya tiene `const [paperWidth, setPaperWidth]` (línea ~67) y ya llama a `<SettingsTabVentas>`. Solo hay que agregar las dos props nuevas al JSX de invocación.

### Step 5.1 — Agregar las props al JSX de `<SettingsTabVentas>` en `SettingsView.jsx`

Localizar:
```jsx
<SettingsTabVentas
    allowNegativeStock={allowNegativeStock} setAllowNegativeStock={setAllowNegativeStock}
    forceHeartbeat={forceHeartbeat}
    showToast={showToast}
    triggerHaptic={triggerHaptic}
/>
```

Reemplazar con:
```jsx
<SettingsTabVentas
    allowNegativeStock={allowNegativeStock} setAllowNegativeStock={setAllowNegativeStock}
    forceHeartbeat={forceHeartbeat}
    showToast={showToast}
    triggerHaptic={triggerHaptic}
    paperWidth={paperWidth}
    setPaperWidth={setPaperWidth}
/>
```

---

## Task 6 — Enlace de ayuda en `CierreCajaSummaryModal.jsx`

**Archivos a modificar:**
- `src/components/Dashboard/CierreCajaSummaryModal.jsx`

> [!NOTE]
> El botón "Imprimir Ticket de Cierre" está en la línea 180–185. El enlace se inserta **inmediatamente después** del cierre `</button>` de ese botón (línea 185), dentro del `<div className="space-y-2 pt-2">`.

### Step 6.1 — Insertar el enlace contextual de descarga de drivers

Agregar después del `</button>` de imprimir (línea 185):

```jsx
{/* Enlace de ayuda para instalación de driver si la impresión falla */}
<div className="flex items-center justify-center gap-1 text-[10px] text-slate-400 dark:text-slate-500">
    <span>¿Problemas al imprimir?</span>
    <a
        href="/drivers/Instalador_Impresora_POS.exe"
        download="Instalador_Impresora_POS.exe"
        className="text-blue-500 hover:text-blue-600 hover:underline font-bold"
    >
        Descarga los drivers POS aquí
    </a>
</div>
```

---

## Task 7 — Verificación y compilación

### Step 7.1 — Build de producción sin errores

```bash
npm run build
```

**Expected:** salida `✓ built in ...ms` sin ningún error. Verificar específicamente que no aparezcan:
- `'CheckCircle' is defined but never used` (fue removido en el plan corregido).
- `'FileText' is defined but never used` (idem).
- `Duplicate import of 'Printer'` (se agrega a la línea existente, no en bloque aparte).

### Step 7.2 — Verificar la descarga del instalador en dev

```bash
npm run dev
```

Abrir en el navegador: `http://localhost:5173/drivers/Instalador_Impresora_POS.exe`

**Expected:** el navegador descarga el archivo (≈2.7 MB) sin error 404. Verificar también `http://localhost:5173/drivers/LEEME_INSTRUCCIONES.txt`.

### Step 7.3 — Verificar la sección en UI

1. Ir a **Ajustes → Ventas** en la app.
2. Verificar que aparece la tarjeta **"Configuración de Ticketera"** con los dos selectores de papel.
3. Cambiar de 58 mm a 80 mm → confirmar toast de aviso.
4. Pulsar **"Imprimir Ticket de Prueba"** → confirmar que se abre la ventana de impresión con la regla de calibración correcta.
5. Pulsar **"Descargar Driver (.exe)"** → confirmar descarga del instalador.
6. Abrir modal de Cierre de Caja y confirmar que aparece el enlace "Descarga los drivers POS aquí".

### Step 7.4 — Commit

```bash
git add public/drivers/ \
        src/utils/printerTestUtils.js \
        src/components/Settings/PrinterHardwareManager.jsx \
        src/components/Settings/tabs/SettingsTabVentas.jsx \
        src/components/Dashboard/CierreCajaSummaryModal.jsx \
        src/views/SettingsView.jsx

git commit -m "feat: instalador y configuración de impresoras térmicas POS

- Sirve Instalador_Impresora_POS.exe (Driver V7.17) desde public/drivers/
- Agrega instalar_silencioso.bat y LEEME_INSTRUCCIONES.txt
- Crea printerTestUtils.imprimirTicketPrueba() con regla de calibración
- Nuevo PrinterHardwareManager (stateless en paperWidth, props desde SettingsView)
- Sección 'Impresora Térmica & Hardware' en SettingsTabVentas
- Enlace contextual de descarga de drivers en CierreCajaSummaryModal
- Correcciones auditoría: sin estado duplicado, imports limpios, rutas absolutas"
```
