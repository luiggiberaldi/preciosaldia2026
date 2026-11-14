# Auditoría: nómina de «Donde Juancho» y propuesta para Precios al Día Bodega

**Fecha:** 14-11-2026 · **Tipo:** solo lectura (no se cambió código ni se hizo commit en ningún proyecto)

- Origen revisado: `sistemas personalizados\donde juancho\sistema pos\projects\donde juancho`
- Destino revisado: `preciosaldia-supervisor-production-alignment`, rama `feat/inicio-estilo-farmacia` (último commit `54ac217`)

---

## 1. Resumen en 30 segundos

- **Lo que tiene Donde Juancho:** una nómina **semanal y sencilla**. Cada empleado tiene un **sueldo fijo semanal en $**. Durante la semana puede **llevarse mercancía de la tienda** («consumo de empleado»), y eso se le **descuenta del sueldo**. El domingo el Administrador **liquida**: paga *sueldo − consumos* en efectivo o pago móvil. Si paga en efectivo, sale de la gaveta y aparece en el cierre.
- **Calidad:** el diseño es bueno (candado, idempotencia, recuperación, montos congelados, pruebas). Pero, según la lectura del código, tiene **3 errores serios de dinero o datos** (sección 4). **No conviene copiarlo tal cual.**
- **Bodega hoy:** no tiene nada de nómina. Sí tiene las piezas donde encajaría: roles Administrador y Cajero, la caja con apertura y cierre, «Gastos internos» (incluido el autoconsumo) y reportes de gastos.
- **Recomendación:** hacer en Bodega una **«Nómina simple» propia**, copiando las **ideas** de Donde Juancho y no su código. Primero sueldo fijo más **adelantos (vales)** pagados desde la caja. El «consumo de mercancía descontado del sueldo» va en una segunda fase, si el dueño lo quiere. Solo el Administrador la usa, funciona sin internet y empieza **sin** Supervisor remoto.

> **Analogía:** Donde Juancho tiene una libreta de fiado para empleados. Lo que se llevan se anota y el domingo se resta del sobre de sueldo. La idea es buena, pero la libreta tiene dos páginas que se borran solas y un botón que no funciona. A Bodega le conviene una libreta nueva, con la misma idea y sin esos defectos.

---

## 2. Qué hay en Donde Juancho (mapa)

| Pieza | Archivo | Qué hace |
|---|---|---|
| Plan de diseño | `docs/plans/2026-08-19-empleados-consumos-nomina.md` | Reglas de negocio, contratos de datos y fases |
| Cálculos puros | `src/utils/employeePayrollModel.js` (427 líneas) | Semana lunes–domingo (hora de Caracas), límite de consumo, neto = sueldo − consumos, normalizadores |
| Servicio (el «motor») | `src/services/employeeService.js` (1.100 líneas) | Crear/desactivar empleados, registrar consumo (descuenta inventario y Kardex), anular, liquidar, anular liquidación, recuperar operaciones a medias |
| Ajustes › Empleados | `src/components/Settings/EmployeesManager.jsx` | Solo ADMIN: alta y edición de sueldo y límite, historial, botón «Liquidar», recibo térmico/PDF |
| POS › Consumo personal | `src/components/Employees/EmployeeConsumptionModal.jsx` (se abre desde `SalesHeader`) | El cajero anota lo que se lleva el empleado |
| Monitor (Supervisor) | `MonitorNominaTab.jsx`, `useMonitorPayroll.js`, `RemoteEmployeeModal.jsx` | Ver resumen semanal; el supervisor puede crear/editar empleados y anular consumos a distancia |
| Recibo PDF | `src/utils/employeePayrollPdfGenerator.js` | Comprobante de pago |
| Respaldo y sincronización | `src/config/backupKeys.js`, `remoteAuditService.js`, `supabase_remote_audit_setup.sql` | 5 claves nuevas en respaldo; solo un «resumen» viaja al Monitor; detalle por RPC `read_paired_employee_payroll_detail` |
| Pruebas | `tests/employeePayroll.test.js` (≈17 pruebas) | Consumo, límite, idempotencia, recuperación, liquidación efectivo/pago móvil, permisos |

### 2.1 Modelo de datos (todo local, en el almacenamiento del equipo; **no** hay tablas Supabase normalizadas)

| Clave | Contenido |
|---|---|
| `bodega_employees_v1` | Empleado: nombre, cédula, cargo, `salarioSemanalUsd`, `limiteConsumoPorc`, activo, usuario enlazado |
| `bodega_employee_consumptions_v1` | Consumos: productos con precio y costo congelados, total $ y Bs, tasa, estado (PENDING/APPLIED/VOIDED/FAILED_RETRYABLE) |
| `bodega_payroll_periods_v1` | Semanas, con una «foto» del sueldo y del límite de cada empleado al empezar la semana |
| `bodega_payroll_settlements_v1` | Liquidaciones: sueldo, consumos, neto $ y Bs, tasa, pagos, estado, movimiento de caja enlazado |
| `bodega_employee_payroll_projection_v1` | Resumen pequeño para el Monitor |

### 2.2 Cálculos que **sí** tiene y los que **no**

| Concepto | ¿Lo tiene? | Detalle |
|---|---|---|
| Sueldo fijo semanal en $ | ✅ | Congelado por semana, así un cambio de sueldo a mitad de semana no altera esa semana |
| Periodo semanal lunes–domingo | ✅ | Zona `America/Caracas`, intervalo `[inicio, fin)` |
| Quincenal / mensual | ❌ | Solo semanal |
| Pago diario / por hora / horas extra | ❌ | Fuera del alcance |
| Comisiones / bonos | ❌ | Fuera del alcance |
| **Adelantos / vales en efectivo** | ❌ | El plan lo deja expresamente «fuera del MVP» |
| Descuento por mercancía consumida | ✅ | A precio de venta; descuenta inventario y Kardex; no cuenta como venta |
| Límite de consumo (% del sueldo) | ✅ | Bloquea; el ADMIN puede autorizar una excepción |
| Moneda $ / Bs con tasa | ✅ | Neto en Bs = neto $ × tasa BCV del momento de pagar |
| Prestaciones / IVSS / cesta ticket | ❌ | No aplica (no es nómina legal) |

### 2.3 Cómo sale el dinero de la caja

Al liquidar se crea un movimiento `GASTO_INTERNO`, categoría `nomina`, con `isPayrollSettlement: true`, dentro de las ventas (`bodega_sales_v1`).
- **Efectivo:** `afectaCaja: true`, así que baja el «efectivo esperado» del cierre. Exige caja abierta.
- **Pago móvil / digital:** `afectaCaja: false`. Queda registrado, pero no toca la gaveta.

Es la idea correcta, y **Bodega ya usa ese mismo tipo de movimiento** para sus gastos.

### 2.4 Permisos

| Acción | Quién |
|---|---|
| Crear y editar empleados y sueldo | ADMIN local, **y también el Supervisor remoto** |
| Registrar consumo | ADMIN o CAJERO |
| Anular consumo | ADMIN, o Supervisor remoto |
| Liquidar / anular liquidación | Solo ADMIN local |
| ⚠️ Si `requireLogin` está apagado | **Cualquiera** pasa como ADMIN (`canOperateWithoutLogin`) |

---

## 3. Lo que está bien hecho (vale la pena copiar la **idea**)

1. **Todo el dinero con `dinero.js`** (`round2`, `sumR`, `subR`…), sin sumar decimales sueltos.
2. **Candado `pos_write_lock`** en cada operación, para que dos clics o dos pantallas no pisen datos.
3. **Idempotencia:** si se pulsa «Pagar» dos veces, el pago queda una sola vez (`idempotencyKey`).
4. **Recuperación:** si la app se cierra a mitad de un pago, al volver lo termina sin duplicarlo.
5. **Montos congelados:** precio del consumo, sueldo de la semana y tasa del pago quedan como estaban ese día.
6. **No se borra historial:** los empleados se desactivan y los errores se corrigen anulando.
7. **Escritura verificada:** guarda, vuelve a leer y compara (`persistAndVerify`).
8. **Monitor liviano:** solo viaja un resumen, no todo el historial (ahorra internet y egress).

---

## 4. Errores y riesgos encontrados (por gravedad)

> Todo sale de **leer el código**: no se ejecutó la app. Los marco como «muy probable» cuando la lectura es directa.

| # | Gravedad | Qué pasa | Dónde |
|---|---|---|---|
| **E1** | 🔴 Pérdida de datos | **Al liquidar a un empleado se borran los consumos de todos los demás empleados y de las otras semanas.** El servicio lee solo los consumos *de ese empleado y esa semana* y luego guarda esa lista corta **encima de la lista completa**. Las pruebas no lo detectan porque siempre usan un solo empleado. | `employeeService.js` ≈ líneas 1000 y 1027–1032 (`getEmployeeConsumptions({employeeId, periodoId})` → `persistAndVerify(CONSUMPTIONS, updatedConsumptions)`) |
| **E2** | 🔴 Descuadre de caja | **Anular un pago de nómina en efectivo resta la plata otra vez en vez de devolverla.** La reversión se guarda como otro `GASTO_INTERNO` con montos **positivos**, y el motor del cierre convierte todo gasto en negativo (`valToDeduct = val < 0 ? val : -Math.abs(val)`). Ejemplo: pagas $95, te equivocas y anulas. El cierre espera **$190 menos** en lugar de $0. | `buildPayrollVoidMovement` en el servicio + `src/core/FinancialEngine.js` ≈ línea 245 |
| **E3** | 🔴 Función rota | **El botón «Liquidar» de Ajustes no funcionaría.** La pantalla envía `pagos: [{metodoId, monto, moneda}]` y **no envía la tasa**. El servicio espera `payments` / `metodoPago` / `currency` / `tasaBcv`. Resultado esperado: siempre sale el error «La tasa BCV para liquidar nómina debe ser mayor que cero». Además, el resumen no trae `netoAPagarBs`, así que pagar en Bs mostraría 0. | `EmployeesManager.jsx` ≈ 434–444 vs. `employeeService.js` ≈ 975 |
| E4 | 🟠 Seguridad | Con `requireLogin` apagado, cualquier persona en la caja puede cambiar sueldos y liquidar. | `canOperateWithoutLogin` |
| E5 | 🟠 Control | El **Supervisor remoto puede cambiar sueldos** a distancia (`saveEmployeeFromSupervisor`). Es útil, pero riesgoso si el teléfono emparejado se pierde. | `useSupervisorCommands.js` ≈ 694, 1034 |
| E6 | 🟡 Dinero | La normalización recorta un neto negativo a 0 (`positiveNumber`) sin avisar. Si el empleado consumió más que el sueldo (con excepción ADMIN), la deuda «desaparece». | `normalizePayrollSettlement` |
| E7 | 🟡 Dinero | Un pago en Bs se valida con una tolerancia de ±$0,01 tras convertir con una tasa redondeada a 2 decimales. Con tasas altas, eso son varios Bs de diferencia aceptada. | `normalizePayrollPayments` |
| E8 | 🟡 Reportes | Un pago de nómina digital (`afectaCaja: false`) **no aparece en el cierre** (el motor lo salta). Queda solo en el historial de nómina, y el dueño puede no ver el gasto del día. | `FinancialEngine.js` |
| E9 | ⚪ Específico del negocio | El «consumo de mercancía» tiene sentido en un restaurante o licorería donde el personal come o bebe del negocio. En una bodega puede aplicar o no, y lo decide el dueño. | — |

**Conclusión:** la **arquitectura** es buena, pero el código tiene fallas justo en los puntos donde se mueve dinero. Portarlo tal cual a Bodega traería E1–E3 consigo.

---

## 5. Cómo está Bodega hoy (dónde encajaría)

| Área | Estado actual | Archivo | Qué significa para la nómina |
|---|---|---|---|
| Usuarios / roles | 2 roles: `ADMIN` y `CAJERO`, con PIN | `src/hooks/store/useAuthStore.js`, Ajustes › Usuarios (`SettingsTabUsuarios.jsx`) | Ya sirve para «solo Administrador». Un empleado de nómina **no** tiene que ser un usuario del sistema |
| Portero de pantallas | `ADMIN_ONLY_TABS = {'reportes','ajustes'}` | `src/app/roleTabs.js` | Si la nómina va dentro de Ajustes, el Cajero ya no la ve sin tocar `roleTabs` |
| Caja abierta / cierre | `findOpenCashShift`, `isShiftCashMovement` (ya cuentan `GASTO_INTERNO` y respetan `afectaCaja:false` y `ANULADA`) | `src/utils/cashShift.js`, `cajaEsperada.js`, `dailyCloseGenerator.js` | Un pago de nómina como `GASTO_INTERNO` **ya cuadraría** en el cierre sin tocar el motor |
| Anular | Bodega anula marcando `status: 'ANULADA'` (y el cierre ignora las anuladas) | `voidSaleProcessor.js`, `cashShift.js` | **Mejor que Donde Juancho:** anular = marcar ANULADA, sin un segundo movimiento. Así se evita el error E2 |
| Gastos internos | Existe, con categoría `personal` y modo `autoconsumo` (descuenta inventario sin tocar caja) | `src/hooks/useGastosInternos.js`, `GastosInternosModal.jsx` | Hoy un dueño puede pagar un sueldo como «gasto › Personal», pero sin ficha de empleado ni historial |
| ⚠️ Debilidad de gastos | `registrarGasto` guarda **sin candado**, sobre la lista de ventas que tiene la pantalla (puede pisar una venta simultánea), **sin `round2`**, **sin anotar quién** lo hizo y **sin exigir caja abierta** | `useGastosInternos.js` ≈ 26–75 | La nómina **no** debe reutilizar esta función. Debe escribir con candado y verificación (`withLock`, `verifiedWrite.js`) |
| Reportes | Pestaña de gastos (`ReportsExpensesTab.jsx`), cierre detallado por categoría (`CATEGORY_LABELS` incluye `personal`) | `reportsProcessor.js`, `dailyCloseGenerator.js` | Basta añadir la categoría `nomina` («Nómina») para que se vea separada |
| Respaldo | Lista única de claves | `src/config/backupKeys.js` | Hay que añadir las claves nuevas (si no, el respaldo las pierde) |
| Nube / Supervisor | Lista blanca única `SUPERVISOR_SYNC_KEYS`; las ventas viajan por meses (`bodega_sales_v1:<YYYY-MM>`) | `src/hooks/useCloudSync.js`, `services/supervisorContracts.js` | El pago de nómina, al ser un `GASTO_INTERNO`, **ya viaja** con las ventas. Las fichas de empleados **no** hace falta sincronizarlas en la fase 1 |
| Pruebas | ~237 archivos Vitest + e2e Playwright (`tests/e2e/*.e2e.spec.js`) | `tests/` | Hay base para arneses de nómina |

---

## 6. Propuesta para Bodega

### 6.1 Qué copiar, qué adaptar y qué no

| Idea de Donde Juancho | Decisión | Por qué |
|---|---|---|
| Ficha de empleado (nombre, cédula, cargo, sueldo, activo) | ✅ Copiar | Básico |
| Sueldo congelado por periodo | ✅ Copiar | Evita sorpresas si se cambia el sueldo a mitad de periodo |
| Pago como `GASTO_INTERNO` categoría `nomina`, con efectivo sí o no | ✅ Copiar | Bodega ya lo cuadra en el cierre |
| Candado + idempotencia + escritura verificada + recuperación | ✅ Copiar (la idea) | Evita pagos dobles |
| Montos con `dinero.js` | ✅ Copiar | Ya existe en Bodega |
| Periodo solo semanal | 🔧 Adaptar | Que el dueño elija: semanal, quincenal o mensual |
| **Adelantos / vales** | ➕ **Añadir** (Donde Juancho no lo tiene) | En una bodega es lo más común: «dame $10 adelantado» |
| Anular con un movimiento de reversa | ❌ No copiar | Usar `status: 'ANULADA'` como el resto de Bodega (evita E2) |
| Guardar una lista filtrada encima de la completa | ❌ No copiar | Es el error E1 |
| Pantalla «Liquidar» con datos mal nombrados | ❌ No copiar | Es el error E3. Bodega tendrá una prueba que pulse el botón de verdad |
| Consumo de mercancía descontado del sueldo | ⏸️ Fase 2, opcional | Solo si el dueño lo pide. Puede reutilizar el «autoconsumo» que ya existe |
| Supervisor remoto edita sueldos | ❌ No (fase 1) | Riesgo E5. Como mucho, ver un resumen en una fase posterior |
| Saltarse permisos si `requireLogin` está apagado | ❌ No | Para la nómina, pedir siempre PIN de Administrador |

### 6.2 Modelo de datos propuesto (local, offline)

| Clave nueva | Qué guarda |
|---|---|
| `bodega_employees_v1` | `{ id, nombre, cedula, cargo, sueldoUsd, frecuencia: 'semanal'|'quincenal'|'mensual', activo, fechaIngreso, creadoPor, actualizadoAt }` |
| `bodega_payroll_entries_v1` | Una sola lista de «renglones» por empleado y periodo: `{ id, employeeId, periodoId, tipo: 'ADELANTO'|'PAGO'|'BONO'|'DESCUENTO', montoUsd, montoBs, tasa, movimientoCajaId, status: 'ACTIVO'|'ANULADO', actor, timestamp, idempotencyKey }` |

- **Saldo del periodo** = sueldo congelado + bonos − descuentos − adelantos − pagos ya hechos. Se **calcula**, no se guarda.
- Cada `ADELANTO` y cada `PAGO` crea **un** `GASTO_INTERNO` (`category: 'nomina'`, `payrollEntryId`, `afectaCaja` según el método) en `bodega_sales_v1`. Anular = marcar los dos como `ANULADO` / `ANULADA`.
- Las **dos** claves van a `backupKeys.js`. **No** van a la nube en la fase 1.

> **Analogía:** cada empleado tiene una **tarjeta de cartón** (la ficha) y un **sobre** por quincena. Cada vale o pago es un papelito que se mete en el sobre y, al mismo tiempo, un papelito en la caja registradora. Si te equivocas, tachas los dos papelitos; no escribes uno nuevo al revés.

### 6.3 Pantallas y navegación

- **Ajustes › Empleados** (pestaña nueva junto a «Usuarios»). Como Ajustes ya está en `ADMIN_ONLY_TABS`, el Cajero no la ve **sin tocar `roleTabs`**.
  - Lista de empleados con su «saldo por cobrar» del periodo.
  - Botones **«Dar adelanto»** y **«Pagar periodo»**: monto, método (efectivo $ / efectivo Bs / pago móvil…) y nota, con confirmación y PIN de Administrador.
  - Historial por periodo y recibo imprimible (reutilizar el ticket térmico de Bodega).
- **Reportes › Gastos:** la categoría «Nómina» aparece separada.
- **Cierre:** una línea «Nómina / adelantos» dentro de los egresos (ya sale sola con la categoría nueva).
- *Alternativa, si el dueño quiere acceso rápido:* un botón «Adelanto a empleado» dentro de «Gastos internos». En ese caso habría que **ocultarlo al Cajero** explícitamente.

### 6.4 Integración con la caja (las barandas)

1. Un pago en **efectivo** exige **caja abierta** (`findOpenCashShift`). Si no hay, sale el mensaje «Abre la caja para pagar en efectivo».
2. Opcional: avisar si el efectivo esperado de la gaveta es menor que el pago.
3. Escritura con `withLock('pos_write_lock')`, leyendo los datos **frescos dentro del candado** y con escritura verificada. Ni la lista de la pantalla ni la función actual `registrarGasto`.
4. `idempotencyKey` por pago, para que un doble clic no pague doble.
5. Anular un pago de un **turno ya cerrado** queda **bloqueado** (o pasa al turno actual con un aviso claro). Es una decisión del dueño.
6. No se permite pagar más que el saldo, salvo una confirmación explícita del Administrador («queda debiendo $X para el próximo periodo»).

### 6.5 Fases (tamaño aproximado)

| Fase | Contenido | Tamaño | Riesgo |
|---|---|---|---|
| **F0** | Arreglar `registrarGasto` (candado, `round2`, actor, lectura fresca) para no heredar su fragilidad | Pequeño (½ día) | Bajo. Toca el flujo de gastos existente, así que lleva arnés |
| **F1** | Modelo puro (`payrollModel.js`: periodos semanal/quincenal/mensual, saldo) + pruebas | Pequeño (1 día) | Bajo |
| **F2** | Servicio (`payrollService.js`): empleados, adelanto, pago, anular, candado, idempotencia, recuperación + respaldo | Mediano (2 días) | Medio (dinero) |
| **F3** | Pantalla Ajustes › Empleados + recibo + categoría «Nómina» en reportes y cierre | Mediano (2 días) | Medio |
| **F4** | Arnés e2e (Playwright): abrir caja → adelanto en efectivo → cierre cuadra → anular → cierre vuelve a cuadrar | Pequeño (1 día) | Bajo |
| F5 *(opcional)* | Consumo de mercancía descontado del sueldo (reutilizar autoconsumo) | Mediano (2 días) | Medio (inventario) |
| F6 *(opcional)* | Resumen de nómina de solo lectura en el Supervisor | Mediano | Medio (nube, egress, lista blanca SQL y JS) |

**Total del núcleo (F0–F4): unos 6–7 días de trabajo.**

### 6.6 Pruebas mínimas (arneses) que deben existir

- Pagar a **dos empleados** y comprobar que el historial del otro **sigue intacto** (la prueba que le falta a Donde Juancho: E1).
- Adelanto en efectivo de $10: el efectivo esperado baja $10. Al anularlo, **vuelve** al valor anterior (E2).
- Pulsar el botón real «Pagar» desde la pantalla (no solo el servicio) en $ y en Bs (E3).
- Doble clic: un solo movimiento.
- Sin caja abierta: el efectivo se rechaza y el pago móvil se acepta.
- El Cajero no ve ni puede abrir Empleados (portero `roleTabs` + servicio).
- Respaldo → restaurar conserva empleados y renglones.
- Cambio de sueldo a mitad de periodo: el periodo en curso usa el sueldo congelado.
- Redondeo: $33,33 × 3 = $99,99, sin centavos fantasma; Bs con una tasa de 4 decimales.

---

## 7. Preguntas para el dueño (deciden el diseño)

1. **¿Cada cuánto paga?** ¿Semanal, quincenal, mensual, o distinto por empleado?
2. **¿Da adelantos (vales)?** ¿Hay un tope (por ejemplo, máximo el 50 % del sueldo)?
3. **¿Los empleados se llevan mercancía** que hay que descontarles? (Si no, se omite la fase 5.)
4. **¿Paga en $ o en Bs?** Si el sueldo está en $ y se paga en Bs, ¿con qué tasa: BCV del día o la tasa de la tienda?
5. **¿Hay sueldo diario, comisiones o bonos?** (Por defecto, solo sueldo fijo + bono/descuento manual.)
6. **¿Puede anularse un pago de un día ya cerrado?** ¿O solo los del turno abierto?
7. **¿Quiere ver la nómina desde el Supervisor** (teléfono)? ¿Solo mirar, o también pagar? (Recomendado: más adelante y solo mirar.)
8. **¿El Cajero puede dar adelantos** con PIN del Administrador, o solo el Administrador directamente?

---

## 8. Recomendación clara

**Construir en Bodega una «Nómina simple» propia (fases F0–F4)**, usando Donde Juancho **solo como inspiración**:

- **Sí:** ficha de empleado, sueldo congelado por periodo, **adelantos y pagos que salen de la caja** como `GASTO_INTERNO` categoría `nomina`, candado + idempotencia + escritura verificada, anular marcando `ANULADA`, solo Administrador, sin internet.
- **No (por ahora):** copiar su código, el consumo de mercancía, el Supervisor remoto editando sueldos, cálculos legales.
- **Primero F0:** reforzar «Gastos internos», porque la nómina va a mover dinero por el mismo camino.

**Aviso para Donde Juancho (fuera del alcance de esta tarea):** los errores E1–E3 afectan a ese cliente **hoy** si usa la nómina. Vale la pena revisarlos y corregirlos allí en una tarea aparte.
