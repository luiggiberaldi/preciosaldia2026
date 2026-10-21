# Mejoras Visuales de Control de Caja en Laptop Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implementar la Distribución Ejecutiva por Filas en la zona de Control de Caja (`DashboardCashControls`, `EfectivoEsperadoCard`, `TasaOficialCard`) eliminando el colapso de ~210px en laptops pequeñas (1366×768), blindando tipográficamente los textos y garantizando un procedimiento de rollback atómico de 1 solo comando que proteja al 100% los archivos de la Fase 4.

**Architecture:** Desacoplar la cuadrícula padre de `DashboardCashControls` de su compresión `xl:grid-cols-2`. Organizar el bloque en 2 filas limpias: Fila 1 de Métricas (Efectivo Esperado y Tasa Oficial a ~440px cada una) y Fila 2 de Acciones Operativas (Cerrar Caja horizontal + Gastos y Aportes en cuadrícula simétrica). Añadir blindaje tipográfico (`whitespace-nowrap`, `shrink-0`) en badges y botones.

**Tech Stack:** React 18, Tailwind CSS, Lucide Icons, Vite, Vitest.

---

## Estrategia de Rollback Seguro (Anti-Pérdida de Fase 4)

> [!CAUTION]
> En `preciosaldia-supervisor-production-alignment` existen cambios en el árbol de trabajo de la **Fase 4** (`useCloudSync.js`, `useMonitorSync.js`, etc.). **JAMÁS se debe ejecutar `git reset --hard` ni `git checkout .`**, ya que borraría los archivos de la Fase 4.

### Mecanismo de Rollback en 1 paso:
Si tras probar la nueva UI no te gusta o prefieres volver atrás, el comando de rollback restaurará **única y exclusivamente los 3 archivos visuales tocados**, dejando la Fase 4 intacta:

```bash
# Rollback seguro para Producción (solo toca los 3 archivos visuales)
git -C "preciosaldia-supervisor-production-alignment" checkout HEAD -- src/components/Dashboard/DashboardCashControls.jsx src/components/Dashboard/EfectivoEsperadoCard.jsx src/components/Dashboard/TasaOficialCard.jsx

# Rollback seguro para Staging
git -C "preciosaldia-supervisor-staging" checkout HEAD -- src/components/Dashboard/DashboardCashControls.jsx src/components/Dashboard/EfectivoEsperadoCard.jsx src/components/Dashboard/TasaOficialCard.jsx
```

---

## Tareas de Implementación

### Task 1: Blindaje Tipográfico en `EfectivoEsperadoCard.jsx`

**Archivos:**
- Modificar: `src/components/Dashboard/EfectivoEsperadoCard.jsx` (en Staging y Producción)

**Detalle del cambio:**
1. Añadir `shrink-0 whitespace-nowrap` al badge `● En vivo` para evitar que "En" y "vivo" se quiebren verticalmente.
2. Añadir `truncate min-w-0` al título para contenerlo en cabeceras estrechas.
3. Asegurar que el botón inferior `Previsualizar Arqueo` tenga `whitespace-nowrap` y padding ergonómico.

**Código exacto:**
```jsx
// En el header de la tarjeta:
<div className="flex items-center justify-between mb-2 gap-2">
    <h3 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase flex items-center gap-1.5 min-w-0 truncate">
        <Wallet size={13} className="text-brand shrink-0" />
        <span className="truncate">Efectivo esperado en caja</span>
    </h3>
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200/50 dark:border-emerald-800/30 shrink-0 whitespace-nowrap">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
        En vivo
    </span>
</div>
```

---

### Task 2: Blindaje Tipográfico en `TasaOficialCard.jsx`

**Archivos:**
- Modificar: `src/components/Dashboard/TasaOficialCard.jsx` (en Staging y Producción)

**Detalle del cambio:**
1. Añadir `shrink-0 whitespace-nowrap` al badge del modo de tasa (`BCV Oficial`, `Manual`, etc.).
2. Añadir `whitespace-nowrap` al botón inferior `Actualizar / Ajustar Tasa`.

**Código exacto:**
```jsx
// En el badge de tasa:
<span
    className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 whitespace-nowrap ${
        rateMode === 'manual'
            ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border border-amber-200/50 dark:border-amber-800/30'
            : rateMode === 'euro'
            ? 'bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400 border border-purple-200/50 dark:border-purple-800/30'
            : rateMode === 'usdt'
            ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200/50 dark:border-emerald-800/30'
            : 'bg-brand/10 text-brand border border-brand/20'
    }`}
>
```

---

### Task 3: Reorganización Ejecutiva por Filas en `DashboardCashControls.jsx`

**Archivos:**
- Modificar: `src/components/Dashboard/DashboardCashControls.jsx` (en Staging y Producción)

**Detalle del cambio:**
1. Desacoplar el contenedor padre de `grid-cols-1 xl:grid-cols-2`.
2. **Fila 1 (Métricas):** `grid grid-cols-1 sm:grid-cols-2 gap-3.5 mb-3.5`. Cada tarjeta dispone de ~440px en laptop (el doble del ancho actual).
3. **Fila 2 (Acciones):** `grid grid-cols-1 md:grid-cols-2 gap-3.5 items-stretch mb-5`.
   - Lado izquierdo: Botón `Cerrar Caja` (horizontal con gradiente, estadísticas y candado).
   - Lado derecho: Botones `Registrar Gasto` y `Registrar Aporte` en cuadrícula `grid-cols-2 gap-3`.

---

### Task 4: Verificación de Calidad y Compilación

**Comandos:**
```bash
# Compilación en Staging
npm --prefix "preciosaldia-supervisor-staging" run build

# Compilación en Producción
npm --prefix "preciosaldia-supervisor-production-alignment" run build
```
**Criterio de aceptación:** Ambos builds finalizan con exit code 0 (`✓ built in ...`), sin warnings de sintaxis ni regresiones.

---

### Task 5: Validación Visual con el Usuario y Confirmación

1. Presentar el resultado final al usuario.
2. Si el usuario aprueba: se procede al commit atómico selectivo.
3. Si el usuario desea revertir: se ejecuta el comando de **Rollback Seguro** documentado en este plan en menos de 5 segundos.
