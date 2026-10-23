# CASO DE ESTUDIO: Descuadre de Cartera vs Ledger y Cierres en $0.00 (Cajas Multi-Día)

**ID de Dispositivo Analizado:** `PDA-V2-A8F41C55B358445D301CDECA8F3E5B98`  
**Comercio:** MILY BEAUTY STORE  
**Fecha de Análisis:** 22 de Octubre de 2026  
**Ambiente:** Precios al Día — Versión Bodega / Supervisor  

---

## 📌 PARTE 1: Descuadre Cartera ↔ Ledger ("1 cliente · diferencia USD 2.90")

### 1.1 Síntoma
En la vista **Reportes**, aparece una alerta amarilla permanente:
> **"Cartera descuadrada con el ledger"**  
> *1 cliente · diferencia USD 2.90 · revisado 13 de 14 clientes*  
> *Diferencia total: 2,90 Bs · toca para ver el detalle por cliente.*

---

### 1.2 Diagnóstico y Causa Raíz
El sistema posee dos fuentes de verdad para las cuentas por cobrar:
1. **Ficha Snapshot (`bodega_customers_v1`):** Propiedades `customer.deuda` y `customer.favor`.
2. **Libro Mayor Transaccional (`bodega_customer_ledger_v1`):** Lista append-only de débitos y créditos con `balanceAfterUsd`.

#### Cronología del Error:
1. **26/08/2026 19:13:07 UTC (Cobro de Deuda #52):**
   * El cliente **TERAN** (`CLI-00004`, `id: 965f0643-aa41-4b19-bf56-7c8d9a28c630`) abonó su saldo pendiente de **$6.61 USD**.
   * Su saldo quedó en **USD 0.00** tanto en la ficha como en el ledger (`accountUpdatedAt: "2026-08-26T19:13:07.898Z"`).
2. **01/09/2026 22:18:20 UTC (Venta Fiada #63):**
   * Se procesó la venta fiada de 1 *Gel Removedor Tiffany 15 ML* por **USD 2.90**.
   * Se generó el movimiento en el ledger (`id: 9e75fba8-...`, `balanceAfterUsd: -2.90`).
3. **01/09/2026 22:20:04 UTC (104 segundos después — Race Condition al crear cliente):**
   * Desde la caja se creó el cliente **"LILIBETH"** mediante `handleCreateCustomer` en `src/hooks/useCheckoutFlow.js`.
   * **El Bug:** `handleCreateCustomer` utilizó el array en memoria de React `customers` (el cual aún conservaba el snapshot viejo donde TERAN tenía `deuda = 0`).
   * Hizo:
     ```javascript
     const updated = [...customers, newCustomer];
     await storageService.setItem('bodega_customers_v1', updated);
     ```
   * **Consecuencia:** Se sobreescribió la base de clientes en almacenamiento local, reseteando la ficha de TERAN a **USD 0.00**, mientras que en el ledger se conservaron los **-$2.90**.

#### Error Cosmético Adicional:
En `src/components/Reports/ReconciliationNotice.jsx` (línea 96):
```jsx
// BUG: driftUsd está en USD y se pasa a formatBs concatenando "Bs"
Diferencia total: {formatBs(driftUsd)} Bs · toca para ver el detalle por cliente.
```
Por eso el aviso decía `2,90 Bs` en lugar de `$2.90 USD`.

---

### 1.3 Fixes Recomendados para la Cartera

#### Fix 1: Corregir `handleCreateCustomer` en `useCheckoutFlow.js`
Evitar el uso del state en memoria obsoleto; leer siempre la lista fresca desde `storageService` antes de agregar un cliente.

```javascript
// En src/hooks/useCheckoutFlow.js (línea 75)
const handleCreateCustomer = async (name, documentId, phone) => {
    // Leer clientes frescos de la persistencia para no pisar ventas fiadas recientes
    const freshCustomers = await storageService.getItem('bodega_customers_v1', customers || []);
    
    const nextCodeNum = freshCustomers.reduce((mx, c) => {
        const numPart = parseInt(c.code?.replace('CLI-', ''), 10);
        return isNaN(numPart) ? mx : Math.max(mx, numPart);
    }, 0) + 1;
    const code = `CLI-${String(nextCodeNum).padStart(5, '0')}`;
    const newCustomer = { 
        id: crypto.randomUUID(), 
        code, 
        name: name.trim(), 
        documentId: documentId?.trim() || '', 
        phone: phone?.trim() || '', 
        deuda: 0, 
        favor: 0, 
        createdAt: new Date().toISOString() 
    };
    const updated = [...freshCustomers, newCustomer];
    try {
        await storageService.setItem('bodega_customers_v1', updated);
        setCustomers(updated);
    } catch (err) {
        console.error('[checkout] Error al guardar cliente:', err);
        showToast('Error al guardar el cliente', 'error');
        return null;
    }
    return newCustomer;
};
```

#### Fix 2: Corregir Texto y Formato en `ReconciliationNotice.jsx`
En `src/components/Reports/ReconciliationNotice.jsx` (línea 96):
```jsx
// REEMPLAZAR:
// Diferencia total: {formatBs(driftUsd)} Bs · toca para ver el detalle por cliente.

// POR:
Diferencia total: ${Number(driftUsd || 0).toFixed(2)} USD · toca para ver el detalle por cliente.
```

#### Fix 3: Habilitar Reparación Automática para Administradores
Actualmente `canRepairLedger` en `ReportsView.jsx` exige una clave oculta en `localStorage` (`reportes_reparacion_ledger === 'true'`).  
Se recomienda permitir la reparación directamente si el usuario tiene rol `ADMIN` o `ENCARGADO`:
```javascript
// En src/views/ReportsView.jsx (líneas 152-157)
const canRepairLedger = useMemo(() => {
    const rol = useAuthStore.getState().usuarioActivo?.rol;
    return rol === 'ADMIN' || rol === 'SUPERVISOR';
}, []);
```

---

## 📌 PARTE 2: Cierres en $0.00 y Cajas Multi-Día en Historial

### 2.1 Síntoma
En la pestaña **Historial** de Reportes:
* Solo aparecen 3 cierres de caja.
* Dos de los tres cierres muestran **`$0.00`** en el monto principal de la tarjeta.

---

### 2.2 Diagnóstico y Causa Raíz
1. **Comportamiento operativo del negocio:**
   * El cliente **no cerraba caja diariamente**.
   * Acumuló ventas desde el **13 de octubre hasta el 19 de octubre** con la caja abierta.
   * El **19 de octubre** el cajero ejecutó 3 cierres seguidos:
     * Cierre A: 17:30 UTC
     * Cierre B: 21:28 UTC
     * Cierre C: 21:29 UTC (1 minuto después)
2. **El Bug de Filtrado en `reportsProcessor.js` (`groupSalesByCierreId`):**
   * El filtro por defecto de Reportes es **"Esta Semana"** (19 al 25 de octubre).
   * La función `groupSalesByCierreId` filtra las ventas por su fecha individual de transacción (`s.timestamp >= from && s.timestamp <= to`) antes de agrupar por `cierreId`.
   * **Consecuencia:**  
     * Las ventas ocurridas el 13, 14, 15 y 16 de octubre fueron **excluidas por fecha**, a pesar de pertenecer a esa caja cerrada el 19.
     * El cierre C (de las 21:29) solo contenía el evento de cierre en la semana, mostrando **`$0.00`**.
     * El cierre A (de las 17:30) solo contenía cobros de deuda en la semana. Al calcular `totalUsd` solo con tipos `VENTA` / `VENTA_FIADA`, los cobros de deuda no sumaron al total visible, mostrando **`$0.00`**.

---

### 2.3 Fixes Recomendados para los Cierres de Caja

#### Fix 1: El Cierre como Lote Contable Indivisible
En lugar de filtrar las ventas individuales dentro de una caja por la fecha de emisión del ticket, **el filtro de fecha debe evaluar la fecha del Cierre de Caja (`cierre.timestamp` o `cierreId`)**:
* Si un cierre se ejecutó dentro de la semana seleccionada, la tarjeta debe mostrar **la totalidad de las ventas que liquidó esa caja** (sin amputar operaciones de días anteriores).

En `src/utils/reportsProcessor.js`:
```javascript
export function groupSalesByCierreId(allSales, from, to) {
    // 1. Identificar todos los eventos de cierre (o fechas de cierre)
    const cierreEvents = allSales.filter(s => s.tipo === 'REGISTRO_CIERRE');
    
    // Mapear cada cierreId con su fecha de ejecución
    const cierreTimestampMap = new Map();
    cierreEvents.forEach(c => {
        cierreTimestampMap.set(c.cierreId, getLocalISODate(new Date(c.timestamp || Number(c.cierreId))));
    });

    // 2. Filtrar cierres que ocurrieron en el rango seleccionado [from, to]
    const validCierreIds = new Set();
    cierreTimestampMap.forEach((cierreDate, cId) => {
        if (cierreDate >= from && cierreDate <= to) {
            validCierreIds.add(cId);
        }
    });

    // 3. Incluir TODAS las ventas que pertenecen a esos cierres válidos
    const cMap = {};
    allSales.forEach(entity => {
        if (!entity.cierreId || !validCierreIds.has(entity.cierreId)) return;
        
        const cId = entity.cierreId;
        if (!cMap[cId]) {
            cMap[cId] = {
                cierreId: cId,
                timestamp: cId,
                apertura: null,
                sales: [],
            };
        }
        if (entity.tipo === 'APERTURA_CAJA') {
            cMap[cId].apertura = entity;
        } else {
            cMap[cId].sales.push(entity);
        }
    });

    // 4. Calcular métricas completas por cada caja
    return Object.values(cMap)
        .filter(c => c.sales.length > 0)
        .map(c => {
            const salesForStats = c.sales.filter(s => ['VENTA', 'VENTA_FIADA', 'VENTA_CASHEA'].includes(s.tipo));
            const salesForCashFlow = c.sales.filter(s => s.tipo !== 'REGISTRO_CIERRE' && s.tipo !== 'APERTURA_CAJA');
            
            // Total recaudado en efectivo/bancos incluye ventas y abonos de deuda
            const totalUsd = sumR(salesForStats.map(s => s.totalUsd || 0));
            const totalBs = sumR(salesForStats.map(s => s.totalBs || 0));
            const totalCop = sumR(salesForStats.map(s => s.totalCop || 0));
            const totalItems = salesForStats.reduce((acc, s) => acc + (s.items ? s.items.reduce((is, it) => is + it.qty, 0) : 0), 0);
            
            const paymentBreakdown = FinancialEngine.calculatePaymentBreakdown(salesForCashFlow);

            return {
                ...c,
                dateObj: new Date(Number(c.cierreId) || c.cierreId),
                salesForStats,
                salesForCashFlow,
                totalUsd,
                totalBs,
                totalCop,
                totalItems,
                paymentBreakdown,
            };
        })
        .sort((a, b) => String(b.cierreId).localeCompare(String(a.cierreId)));
}
```

#### Fix 2: Badge Visual de "Caja Multi-Día" en `CierreHistoryCard.jsx`
Cuando el período entre la primera operación (o apertura) y el cierre supera las 24 horas, renderizar una etiqueta informativa:
```jsx
{/* Si la caja duró más de 1 día */}
{diasDuracion > 1 && (
    <span className="text-[10px] bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
        <Clock size={12} /> Caja acumulada ({diasDuracion} días)
    </span>
)}
```

#### Fix 3: Alerta Preventiva en Punto de Venta (Anti-Olvido)
En la vista principal de Cobro / Dashboard, si la apertura de caja tiene una fecha distinta a hoy:
* Mostrar un banner preventivo:  
  *"Tienes una caja abierta desde el [Fecha]. Se recomienda cerrar la caja antes de registrar las ventas de hoy."*
