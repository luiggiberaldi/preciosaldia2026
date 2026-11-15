# Auditoría: Apertura de caja — Bodega vs Farmacia
**Fecha:** 13-nov-2026 · **Tipo:** solo lectura (no se cambió ningún archivo, ni se hizo commit, ni se cambió de rama)

- **Bodega:** `preciosaldia-supervisor-production-alignment`, rama `feat/inicio-estilo-farmacia`
- **Farmacia:** `preciosaldia-farmacia`, rama `pruebas` (commit clave: `3f373dd` "varios cierres al día para farmacias de 24 horas", del 13-nov)

> **Analogía para todo el informe:** la caja es como una **gaveta con un cuaderno**. *Abrir caja* = escribir en la primera línea del cuaderno "hoy empiezo con $20 y 500 Bs en la gaveta" (el **fondo**, el dinero para dar vuelto). Todo lo que pasa después se anota debajo. *Cerrar caja* = contar la gaveta, comparar con el cuaderno y pasar la página.

---

## 1. Tabla lado a lado

| Tema | Bodega | Farmacia |
|---|---|---|
| **Dónde se abre** | Solo en **Ventas**: aparece la pantalla "Caja Cerrada" con el botón "Aperturar Caja Ahora" (`CajaCerradaOverlay.jsx`). **El Inicio no tiene botón de abrir**, solo el de "Cerrar Caja". | Igual: solo en Ventas (`views/sales/PosMainSection.jsx:48`). |
| **Campos** | Efectivo en $, en Bs y en COP (este último solo si COP está activo; aparece primero si COP es la moneda principal). | Los mismos tres campos. |
| **Ayuda para llenar** | Ninguna: empiezas con todo en blanco. | Muestra **lo que se contó en el cierre anterior** (número, hora y quién cerró) y un botón "Usar estos montos". No lo llena solo, porque al cerrar se pudo haber retirado dinero (`AperturaCajaModal.jsx` de Farmacia, líneas 70-94). |
| **Texto** | "Fondo inicial **del día**". | "Fondo inicial **del turno**". |
| **Quién abre** | **No se guarda.** El registro de apertura no tiene nombre de usuario (`useCheckoutFlow.js:108-118`). | Se guarda `sellerName` y `sellerRol` (ERR-092). El cierre detallado ya no dice siempre "Administrador". |
| **Quién puede abrir** | Cualquiera que tenga acceso a Ventas (no hay control por rol). | Igual. |
| **Validaciones** | No acepta montos negativos; un candado evita que se abra dos veces por doble clic. **No revisa si ya hay una caja abierta** (por ejemplo, en otra pestaña). | Las mismas, con el mismo hueco. |
| **Si no se abre** | No se puede vender: Ventas muestra "Caja Cerrada" y se bloquean los atajos de teclado. El Inicio no avisa nada; solo dice "Sin ventas pendientes · La caja está limpia". | Igual. |
| **Caja abierta de ayer** | La caja **no se cierra sola a medianoche**: sigue abierta hasta el cierre manual (`cashShift.js:4-5`). **No hay aviso visible** de "esta caja está abierta desde ayer". El recordatorio de cierre se basa en la cantidad de movimientos, no en las horas. | Igual, pero además **avisa cuando el turno lleva 12 h abierto**, una sola vez por turno: "El turno lleva 12 h abierto (desde…)". Ver `useNotifications.js:16-30` y `useDashboardSaleActions.js:22-38`. |
| **Turno que cruza la medianoche** | Funciona: las ventas posteriores a la apertura cuentan aunque cambie la fecha (`cashShift.js:38-47`). | Funciona, y además corrige el **relevo** (ERR-091): un gasto anotado a las 5:55, entre el cierre de las 5:50 y la apertura de las 6:00, entra al turno nuevo en vez de quedar huérfano. |
| **Efecto en "Efectivo esperado"** | El fondo se suma a la gaveta y luego se restan los vueltos entregados (`cajaEsperada.js:19-24`, `FinancialEngine.js:185-200`). La tarjeta solo la ve el administrador. | Fórmula idéntica (archivo igual). |
| **Varios cierres en un día** | Posible, pero el PDF no lleva número ni hora del cierre. | Pensado para eso: número de cierre y hora local en el PDF (ERR-090). |

---

## 2. Errores y riesgos encontrados

### En los dos sistemas

**R1 — El "fondo actual" que usa el cobro está mal calculado (importante).**
`SalesView.jsx:379-391` (Bodega) y `views/sales/usePosCartTotals.js:73-85` (Farmacia).
- Filtra los movimientos **por la fecha del calendario**, no por el turno abierto. Después de medianoche, el fondo de la apertura de ayer **desaparece** del cálculo.
- **No resta los vueltos ya entregados.** Si ya se dieron 2.000 Bs de vuelto, el sistema cree que esos 2.000 Bs siguen en la gaveta.
- Efecto: el aviso "Excede fondo de caja" del cobro sale cuando no debe, o no sale cuando sí debería.
- Además, en `CheckoutModal.jsx:173`, si el fondo en $ es 0, se trata como **infinito** (`Infinity`), es decir, "sin límite".

**R2 — El caso de hoy: "Efectivo esperado −2.159,35 Bs".**
Pasó así:
1. Se abrió la caja con 0 Bs.
2. Un cliente pagó en $ y el vuelto se calculó con la "sugerencia realista" (`computeRealisticSplit`): billetes de $ y el resto en Bs.
3. Esa sugerencia **no toma en cuenta si hay Bs en la gaveta**.
4. El aviso "Excede fondo de caja" (`CheckoutModal.jsx:746`, `PaymentLeftColumn.jsx:402`, `MobileChangeAllocation.jsx:237`) es **suave**: es un texto naranja diminuto (`text-[9px]`) y no detiene el cobro.

Hay que distinguir dos situaciones:
- El número negativo **es correcto** si el vuelto en Bs salió del bolsillo del cajero o de otra gaveta. Así funciona un cuaderno honesto: salió dinero que no estaba anotado.
- Es una **señal de un error de captura** si el vuelto en realidad se dio en $.

¿Debería la apertura prevenirlo? **En parte.**
- **(a) En la apertura:** si el fondo en Bs es 0, mostrar un aviso suave: "Sin fondo en Bs no podrás dar vuelto en bolívares. ¿Seguro?". No conviene bloquear, porque hay bodegas que solo dan vuelto en $.
- **(b) En el cobro:** usar el fondo **real** (corregir R1). Si el vuelto en Bs supera lo que hay en la gaveta, la sugerencia debe pasarse a $ o pedir que se confirme ("Vas a dar Bs que no hay en caja. ¿Registrar un aporte primero?").
- **(c) En el Inicio:** si el esperado es negativo, mostrar debajo del número rojo la explicación que ya existe en el cierre ("La gaveta usó Bs X extra para dar cambio", `CierreCajaWizard.jsx:435`) y un botón "Registrar aporte".

**R3 — No se impide abrir una segunda caja si ya hay una abierta.**
`useCheckoutFlow.js:121-126` (Bodega) y `:126-131` (Farmacia). Dentro del candado se lee la lista de movimientos, pero no se revisa si ya existe una apertura sin cerrar. Con dos pestañas abiertas, o con la pantalla de Ventas desactualizada, quedan **dos aperturas abiertas**:
- `findOpenCashShift` solo toma la más reciente.
- El fondo de la primera **no se suma** al esperado.

Solución: dentro del candado, si `findOpenCashShift(existingSales)` devuelve algo, no crear otra apertura y usar la existente.

**R4 — El esperado en COP no resta vueltos en COP.**
`cajaEsperada.js:22`. El motor solo registra vuelto en $ y Bs (`FinancialEngine.js:486-491`). Hoy no se da vuelto en COP, así que no hay daño, pero queda anotado por si se habilita.

**R5 — Nadie controla quién puede abrir.**
Un cajero puede abrir la caja con cualquier fondo, y nadie confirma ese monto. Para una sola caja está bien. Para multicaja conviene registrar quién abrió y permitir que el administrador corrija el fondo, dejando la corrección anotada.

### Solo en Bodega

**B1 — No se guarda quién abrió.** `useCheckoutFlow.js:108-118`. Farmacia ya lo corrigió (ERR-092).

**B2 — Movimientos del relevo quedan fuera de todo cierre.** `cashShift.js:38-47`: solo cuenta lo que ocurrió **después** de la apertura. Un gasto anotado entre un cierre y la siguiente apertura no entra en ningún cierre (es el ERR-091 de Farmacia).

**B3 — Si no hay apertura, el cierre solo toma lo de hoy.** `DashboardView.jsx:336-341`. Un movimiento suelto de ayer sin cerrar se queda pendiente para siempre. Farmacia lo cambió a "cerrar todo lo pendiente".

**B4 — El Inicio no tiene botón para abrir la caja ni avisa que está cerrada.** `DashboardCashControls.jsx:52-86`: si la caja está cerrada, solo dice "Sin ventas pendientes · La caja está limpia". Eso confunde: suena a "todo bien", cuando en realidad no se puede vender. *(Confirmado en la app de prueba, puerto 5181.)*

**B5 — No hay aviso de caja abierta desde hace muchas horas.** El recordatorio de Bodega (`useNotifications.js:130`, `DashboardView.jsx:238-246`) depende de los movimientos, no de las horas abiertas.

### Solo en Farmacia

**F1 — Riesgo al "meter todo lo pendiente" al turno.** `cashShift.js:44-49`. Con la nueva regla, **cualquier** movimiento viejo sin cerrar (datos migrados o restaurados de un respaldo) entra al turno actual y altera el esperado. Para una farmacia de 24 h está bien. Para multicaja hará falta filtrar también por caja (`registerCode`).

**F2 — La sugerencia "Usar estos montos" toma lo contado, no lo que quedó.** Si en el cierre se retiró dinero, el monto sugerido es mayor que el real. El texto lo advierte, pero sería mejor guardar en el cierre un campo "fondo que se deja para el siguiente turno".

---

## 3. Propuesta (en orden de prioridad)

Tamaños: **XS** < 30 líneas · **S** ~30-80 · **M** ~80-200 · **L** > 200

| # | Qué | De dónde | Tamaño | Por qué |
|---|---|---|---|---|
| 1 | **Corregir el fondo actual del cobro (R1):** usar el turno abierto (`isRecordInOpenCashShift`) y `calcularEfectivoEsperado` en vez de filtrar por fecha. | Arreglo nuevo, para los dos | **S** | Es la raíz de avisos falsos y de casos como el −2.159 Bs. |
| 2 | **Botón "Abrir caja" en el Inicio (B4):** cuando no hay apertura, cambiar la tarjeta "Sin ventas pendientes" por una tarjeta "Caja cerrada · Abrir caja" que abra el mismo formulario. Hay que mover el formulario y `handleSaveApertura` a un componente compartido para que Ventas e Inicio usen el mismo. | Nuevo (sirve para los dos) | **M** | El dueño suele empezar el día en el Inicio. Hoy tiene que ir a Ventas para descubrir que la caja está cerrada. |
| 3 | **Impedir una segunda apertura (R3).** | Nuevo, para los dos | **XS** | Evita fondos "perdidos". |
| 4 | **Guardar quién abre (B1).** | Farmacia → Bodega (ERR-092) | **XS** | Trazabilidad, y se necesita para multicaja. |
| 5 | **Sugerir lo contado en el cierre anterior** al abrir. | Farmacia → Bodega (`findLastClose` + bloque del formulario) | **S** | Ahorra digitar y reduce errores. |
| 6 | **Movimientos del relevo y cierre sin apertura (B2, B3).** | Farmacia → Bodega (ERR-091) | **S**, con sus pruebas de `cashShift.test.js` | Ningún movimiento queda huérfano. |
| 7 | **Avisos sobre el fondo en Bs (R2 a/b/c):** aviso al abrir con 0 Bs; en el cobro, si el vuelto en Bs supera lo que hay, sugerirlo en $ o pedir confirmación; explicar el número rojo en el Inicio. | Nuevo, para los dos | **M** | Ataca el caso de hoy sin bloquear a quien solo da vuelto en $. |
| 8 | **Aviso de turno abierto por 12 h** y etiqueta "Abierta desde ayer 6:00 p. m." en el Inicio. | Farmacia → Bodega (`cierreAvisoStatus`) | **S** | Evita turnos de varios días por olvido. |
| 9 | **Número y hora del cierre en el PDF.** | Farmacia → Bodega (ERR-090, `closeFileName.js`) | **S** | Útil con varios cierres por día. |
| 10 | Cambiar "Fondo inicial del día" por "**del turno**". | Farmacia → Bodega | **XS** | Coherente con turnos que cruzan la medianoche. |

**De Bodega hacia Farmacia:** nada propio de la apertura que valga la pena traer. Los puntos 1, 2, 3 y 7 son nuevos y sirven para los dos.

### Pensando en la versión multicaja (`registerCode`)

Decisiones que conviene tomar **ahora**, al hacer los puntos 2 a 6, para no rehacer después:

1. **Cada apertura con su "cédula de turno".** Agregar `shiftId` (un identificador único), `registerCode` (qué caja) y `openedBy` ({id, nombre, rol}) al registro `APERTURA_CAJA`. Hoy el `id` se arma con la hora (`apertura_${Date.now()}`), y dos cajas podrían chocar en el mismo milisegundo; mejor usar `crypto.randomUUID()`.
2. **Cada venta, gasto o aporte con el `shiftId` de su turno** al momento de crearse. Así "¿a qué turno pertenece?" se responde mirando una etiqueta, no comparando horas. Esto elimina de raíz los problemas de medianoche, de relevo (B2/F1) y de relojes desfasados entre cajas. `useRemoteCommands.js:641` ya escribe `shiftId` al cerrar a distancia, así que hay un comienzo.
3. **`findOpenCashShift(records, registerCode)`:** buscar la caja abierta **de esta caja**, no la de todo el negocio. Una sola función compartida (`cashShift.js`) para Ventas, Inicio, cierre y fondo del cobro, como en el punto 1.
4. **Un solo formulario de apertura y una sola función para guardarla** (`openCashShift()` en `utils/` o en un servicio). Así, cuando la apertura pase a guardarse en el servidor (Supabase), se cambia en un solo lugar.
5. **Guardar en el cierre el "fondo que se deja"**, separado de lo contado (F2). En multicaja, el fondo de la caja 2 no debe mezclarse con el de la caja 1.

---

## 4. Verificación visual

- **Bodega (http://localhost:5181, sin sesión iniciada y sin caja abierta):** el Inicio muestra el resumen "HOY $0", la tasa BCV, **"Sin ventas pendientes · La caja está limpia"**, "Registrar Gasto" y "Vender (F1)". **No hay botón ni aviso de abrir caja** (confirma B4). La tarjeta "Efectivo esperado" no aparece porque solo la ve el administrador.
- **Farmacia:** no se levantó su servidor de prueba. El código del Inicio (`views/dashboard/DashboardBody.jsx`) usa el mismo `DashboardCashControls` y tampoco tiene botón de abrir caja.
- No se ejecutaron las pruebas automáticas (era una auditoría de solo lectura).
