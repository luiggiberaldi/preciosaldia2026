# Fix de ingresos del turno en Supervisor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminar transacciones fantasma del resumen de ingresos del turno y hacer que métodos de pago, total acumulado y ticket promedio representen únicamente operaciones reales del turno activo.

**Architecture:** Mantener separadas las fuentes de verdad: las ventas/cobranzas determinan ingresos y ticket promedio; la apertura de caja se muestra únicamente como fondo inicial; gastos, avances, cierres y movimientos de inventario no se convierten en pagos. La lógica de clasificación vivirá en `supervisorFinancials.js` para que la vista y los reportes usen el mismo contrato.

**Tech Stack:** React, JavaScript, Vitest, Vite, `localforage` para datos sincronizados y las estructuras existentes de ventas del POS.

---

### Task 1: Congelar el caso que produce las 5 transacciones fantasma

**Files:**
- Modify: `tests/supervisorFinancials.test.js`
- Test: `tests/supervisorFinancials.test.js`

**Step 1: Write the failing tests**

Agregar casos que pasen a `calculateSupervisorPaymentBreakdown()` registros sin ingreso real:

```js
it('ignora cierres, gastos, avances y ajustes sin pago real', () => {
    const breakdown = calculateSupervisorPaymentBreakdown([
        { tipo: 'REGISTRO_CIERRE', totalUsd: 0, totalBs: 0 },
        { tipo: 'GASTO_INTERNO', totalUsd: 0, totalBs: 0 },
        { tipo: 'PAGO_PROVEEDOR', totalUsd: 0, totalBs: 0 },
        { tipo: 'AVANCE_EFECTIVO', totalUsd: 0, totalBs: 0 },
        { tipo: 'AJUSTE_SALIDA', unitsDelta: -4 },
    ]);

    expect(breakdown).toEqual([]);
});
```

Agregar también un caso que garantice que una venta real continúa contando y que una cobranza conserva su método de pago.

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/supervisorFinancials.test.js --pool=forks --maxWorkers=1`

Expected: FAIL porque los registros desconocidos caen actualmente en el método por defecto `efectivo_bs` y aumentan el contador aunque tengan monto cero.

**Step 3: Commit the failing test**

```bash
git add tests/supervisorFinancials.test.js
git commit -m "test: reproduce phantom supervisor income transactions"
```

### Task 2: Centralizar la clasificación de movimientos monetarios válidos

**Files:**
- Modify: `src/services/supervisorFinancials.js`
- Test: `tests/supervisorFinancials.test.js`

**Step 1: Define the allowed payment movement contract**

Crear una constante exportada y un predicado explícito:

```js
export const SUPERVISOR_PAYMENT_TYPES = Object.freeze([
    'VENTA',
    'VENTA_FIADA',
    'VENTA_CASHEA',
    'COBRO_DEUDA',
    'COBRO_CASHEA',
    'APERTURA_CAJA',
    'APORTE_CAJA',
]);

export const isSupervisorPaymentMovement = (sale) => (
    SUPERVISOR_PAYMENT_TYPES.includes(sale?.tipo)
);
```

Usar el predicado al inicio del `for` de `calculateSupervisorPaymentBreakdown()`. Los tipos de caja no monetarios o de salida que no tengan una rama explícita deben ignorarse, nunca caer en `efectivo_bs` por defecto.

**Step 2: Run the focused tests**

Run: `npx vitest run tests/supervisorFinancials.test.js --pool=forks --maxWorkers=1`

Expected: PASS; las ventas, cobranzas, fondo de apertura y aportes existentes conservan su comportamiento.

**Step 3: Commit the financial classification**

```bash
git add src/services/supervisorFinancials.js tests/supervisorFinancials.test.js
git commit -m "fix: ignore non-payment movements in supervisor breakdown"
```

### Task 3: Usar solamente ingresos reales en la tarjeta del turno activo

**Files:**
- Modify: `src/views/OwnerMonitorView.jsx:187-230`
- Modify: `src/services/supervisorFinancials.js`
- Test: `tests/supervisorFinancials.test.js`

**Step 1: Add a view-specific active income filter**

En `OwnerMonitorView`, construir el flujo del desglose a partir de:

- `VENTA`
- `VENTA_FIADA`
- `VENTA_CASHEA`
- `COBRO_DEUDA`
- `COBRO_CASHEA`

Excluir `APERTURA_CAJA` del desglose porque ya se presenta en “Fondo de apertura de turno”. Excluir también `APORTE_CAJA` del total de ventas; si se requiere mostrarlo, debe aparecer como bloque separado de “Otros movimientos de caja” y no mezclarse con el porcentaje de ventas.

Mantener `activeShiftSales` como fuente del total de ventas y del ticket promedio. No calcular el porcentaje de métodos de pago contra registros que no son ventas/cobranzas.

**Step 2: Add regression coverage for mixed turn data**

Agregar un fixture con apertura, una venta, un gasto, un avance, un cierre y un ajuste. Verificar que:

- El total de ventas sea el total de la venta válida.
- El contador de pagos no incluya gasto, avance, cierre ni ajuste.
- El ticket promedio sea `totalUsd / cantidadDeVentas`.

**Step 3: Run tests to verify the corrected aggregation**

Run: `npx vitest run tests/supervisorFinancials.test.js tests/supervisorMetrics.test.js --pool=forks --maxWorkers=1`

Expected: PASS sin regresiones en reportes ni cierres.

**Step 4: Commit the active-turn fix**

```bash
git add src/views/OwnerMonitorView.jsx src/services/supervisorFinancials.js tests/supervisorFinancials.test.js
git commit -m "fix: align active shift income with real sales"
```

### Task 4: Corregir el estado vacío y el ticket promedio

**Files:**
- Modify: `src/views/OwnerMonitorView.jsx:740-805`
- Test: `tests/supervisorResponsive.test.js` or a focused pure-metric test in `tests/supervisorFinancials.test.js`

**Step 1: Define the empty-state behavior**

Cuando no existan ventas/cobranzas válidas:

- Mostrar “Sin ventas cobradas en este turno”.
- No mostrar una fila de `Efectivo Bs` con contador cero.
- Mostrar `—` en “Ticket promedio” en lugar de `$0.00`.

Cuando existan ventas válidas, conservar `$0.00` solamente si el total real de la venta es cero y dejar visible una alerta de datos incompletos si aplica.

**Step 2: Verify the visual states manually**

Probar en Supervisor estos escenarios:

1. Turno recién abierto sin ventas.
2. Turno con una venta en Bs.
3. Turno con venta fiada y cobranza.
4. Turno con gastos, avances y ajustes, pero sin ventas.
5. Turno con venta anulada.

Expected: los movimientos operativos no aparecen como transacciones de pago y el total coincide con las ventas válidas.

### Task 5: Validación integral y despliegue

**Files:**
- Verify: `src/views/OwnerMonitorView.jsx`
- Verify: `src/services/supervisorFinancials.js`
- Verify: `tests/supervisorFinancials.test.js`

**Step 1: Run focused tests**

Run: `npx vitest run tests/supervisorFinancials.test.js tests/supervisorMetrics.test.js tests/supervisorLifecycle.test.js --pool=forks --maxWorkers=1`

Expected: todos los archivos y pruebas pasan.

**Step 2: Run typecheck**

Run: `npm run typecheck`

Expected: `tsc --noEmit` termina sin errores.

**Step 3: Build the production bundle**

Run: `npm run build`

Expected: Vite genera `dist` sin errores; las advertencias de tamaño de chunks no bloquean el despliegue.

**Step 4: Commit the UI and validation changes**

```bash
git add src/views/OwnerMonitorView.jsx src/services/supervisorFinancials.js tests/supervisorFinancials.test.js
git commit -m "fix: correct supervisor active shift income summary"
```

**Step 5: Deploy and verify with real data**

Desplegar el frontend, recargar la caja y el supervisor, abrir un turno de prueba y confirmar que una venta de `10 Bs` aparece como una transacción y que un gasto/avance no crea una fila de pago adicional.
