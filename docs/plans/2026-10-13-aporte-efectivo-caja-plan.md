# Plan: aporte de efectivo a la caja (preciosaldia-bodega)

Fecha: 2026-10-13
Estado: propuesta, sin implementar.

## Objetivo

Permitir registrar, durante el turno, dinero en efectivo que entra a la caja (por ejemplo, cambio de monedas o fondo adicional), sin que cuente como venta ni como ingreso, y que el cierre lo refleje como efectivo para no marcar faltante.

Esta app ya tiene apertura de caja (`APERTURA_CAJA`). El aporte es el equivalente a mitad de turno.

## Punto de partida (lo que ya existe aquí)

- **Apertura:** `handleSaveApertura` en [src/hooks/useCheckoutFlow.js](src/hooks/useCheckoutFlow.js) guarda un registro `APERTURA_CAJA` con `openingUsd`, `openingBs`, `openingCop`, `timestamp` y `cajaCerrada: false`. Va dentro de `pos_write_lock`.
- **Modal de apertura:** [src/components/Dashboard/AperturaCajaModal.jsx](src/components/Dashboard/AperturaCajaModal.jsx), sin validación de rol.
- **Arqueo:** [src/core/FinancialEngine.js](src/core/FinancialEngine.js) suma la apertura a `efectivo_usd`, `efectivo_bs` y `efectivo_cop`, y la excluye de los ingresos.
- **Cierre:** los registros con `cajaCerrada: false` pertenecen al turno activo. `DashboardView` cierra la caja marcándolos.
- **Roles:** existen `ADMIN` y `CAJERO` (`usuarioActivo.rol`). No hay módulo `roles.js`; las comprobaciones están dispersas (`App.jsx`, `CustomersView.jsx`, `useAutoLock.js`).
- **Login:** `requireLogin` es `true` solo si hay cloud configurado (`VITE_SUPABASE_CLOUD_URL`); si no, es `false` y no hay usuario activo.

## Decisiones de diseño

1. **Mismo modelo que la apertura.** El aporte es un registro nuevo `APORTE_CAJA` en el listado de ventas, con `cajaCerrada: false`, para que entre al turno activo y se cierre con él. No se crea un almacén nuevo.
2. **No es ingreso.** `FinancialEngine` lo suma a los buckets de efectivo y lo excluye de ingresos, igual que la apertura. Así el cierre no marca faltante ni infla las ventas.
3. **Permiso por rol.** Con login activo, solo `ADMIN` puede aportar; el cajero no. En modo sin login (`requireLogin === false`) cualquiera con acceso a la caja puede aportar, igual que la apertura. **Decidido por el dueño.**
4. **Validación en el hook, no solo en la UI.** `handleSaveAporte` valida montos >= 0, al menos un monto > 0 y motivo obligatorio (**decidido: el motivo es obligatorio**). La UI solo avisa.
5. **Anulación.** Un aporte anulado no suma efectivo. Se maneja igual que una venta anulada: `FinancialEngine` ya descarta `status === 'ANULADA'`.

## Cambios propuestos

| Archivo | Cambio |
|---|---|
| `src/utils/cajaAporte.js` (nuevo) | `buildAporteCajaRecord` (validación y registro) y `TIPO_APORTE_CAJA = 'APORTE_CAJA'`. Funciones puras, sin I/O. |
| `src/core/FinancialEngine.js` | Rama `APORTE_CAJA` que suma a los buckets de efectivo y hace `return` (no es revenue). |
| `src/hooks/useCheckoutFlow.js` | `handleSaveAporte`: valida con `buildAporteCajaRecord` y guarda dentro de `pos_write_lock`. |
| `src/components/Sales/AporteCajaModal.jsx` (nuevo) | Modal con montos USD/Bs/COP (COP solo si `copEnabled`) y motivo. |
| `src/views/SalesView.jsx` | Botón "Aporte" solo con caja abierta (`todayAperturaData` sin cerrar). Monta el modal. |
| `src/views/DashboardView.jsx` | Añadir `APORTE_CAJA` a `validTiposParaCerrar` para que se cierre con el turno. |
| `src/utils/dailyCloseGenerator.js` y `src/services/supervisorFinancials.js` | Mostrar el aporte como línea de efectivo en el cierre. |
| `tests/cajaAporte.test.js` (nuevo) | Validación, suma a efectivo sin ingreso, anulación, y alerta si el efectivo baja de un umbral. |

## Fuera de alcance (esta primera versión)

- Umbral de efectivo bajo y alerta: **segunda fase (decidido por el dueño)**, en su propio cambio.
- Retiros de efectivo (salida de caja): es el caso inverso y necesita su propio plan.
- Aportes en otros turnos o días: solo se aceptan con caja abierta.

## Verificación

- Tests unitarios de `buildAporteCajaRecord` y de la rama `APORTE_CAJA` en `FinancialEngine`.
- Test de cierre: caja con apertura + aporte + ventas en efectivo cuadra sin faltante.
- Build (`vite build`) y tests de `tests/` relacionados con caja y cierre.
- Prueba manual: aporte con login de cajero (debe bloquearse si `requireLogin` está activo) y con admin.

## Decisiones del dueño (2026-10-13)

1. En modo sin login, cualquiera con acceso a la caja puede registrar un aporte, como la apertura.
2. El motivo del aporte es obligatorio.
3. El umbral de alerta de efectivo bajo va en una segunda fase.
