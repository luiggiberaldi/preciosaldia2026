# Plan: mejorar la zona de cobro («Procesar Pago») de Bodega

**Fecha:** 2026-11-14
**Base:** [AUDITORIA-COBRO-VUELTOS-BODEGA-VS-FARMACIA-2026-11-14.md](../auditorias/AUDITORIA-COBRO-VUELTOS-BODEGA-VS-FARMACIA-2026-11-14.md). Lee primero esa auditoría: aquí no se repite el porqué, solo el cómo.
**Repo:** `preciosaldia-supervisor-production-alignment`, rama `feat/inicio-estilo-farmacia`.
**Estado:** plan, nada ejecutado. Las decisiones del dueño que faltan están en la sección 3; mientras no las responda, el plan usa la opción recomendada y lo marca.

---

## 1. Meta y reglas

**Meta:** que el cobro de PC se lea de un vistazo, se toque cómodo en 1366×768, y que el vuelto no pueda dejar dinero mal anotado.

**Reglas que valen en todas las fases (como cajero de caja registradora: primero no perder dinero, después ir rápido):**
1. **Las cuentas del dinero no se tocan** salvo en las fases marcadas «dinero» (0 y 3), y ahí con prueba primero.
2. **Todo cambio visual va con `lg:` (PC).** Celular y tablet usan otro modal (`CheckoutModal.jsx`) y deben quedar idénticos.
3. **No se copian archivos de Farmacia encima de los de Bodega.** Se porta pieza por pieza para no perder `AvisoFondoGaveta`, `onOpenAporte`, `onCreditShortfall` ni el fondo «desconocido = null».
4. **No se trae nada propio de farmacia:** récipe, lotes/FEFO, descuento por artículo, `RxCheckoutGate`, `StockCheckoutGate`.
5. **Una fase = un commit** (cuando el dueño lo pida), con su prueba, su medición y su entrada en bitácora/`docs/casos`.
6. Cada fase termina con la **lista de comprobación común** (sección 5).
7. **Sin choques con la sesión de Vender:** `CartPanel`, `CategoryBar`, `SearchBar`, `SalesView.jsx` y `SettingsTabVentas.jsx` tienen cambios sin guardar de otra sesión. Las fases que los tocan esperan a que esa sesión haga commit (marcadas ⏸).

---

## 2. Resumen de fases

| Fase | Qué | Tipo | Tamaño | Depende de | ⏸ |
|---|---|---|---|---|---|
| 0 | Línea base: medir y confirmar lo no probado | Medición | Pequeño | — | No |
| 1 | Arreglos baratos de dinero y de uso (centavo, decimales, Esc) | **Dinero** + uso | Pequeño | 0 | Esc toca `SalesView.jsx` ⏸ |
| 2 | Partir `index.jsx` (811 líneas) en piezas | Orden interno, sin cambio visible | Mediano | 1 | No |
| 3 | Pantalla: resumen único, COBRAR junto al resumen, «Completar», atajos 44 px | Pantalla | Mediano | 2 | No |
| 4 | «¿Cómo entregas el vuelto?» + reparto automático | Pantalla | Mediano | 3 | No |
| 5 | «Sugerido» realista en PC (vuelto con centavos) | **Dinero** | Pequeño-mediano | 4 | Ajustes ⏸ |
| 6 | Cobro directo sin modal (solo si alcanza el efectivo) + F9/Enter | Flujo | Pequeño | 5 | No |
| 7 | Opcionales por decisión: teclado táctil, referencia de pago, Zelle/Binance | Opcional | Grande | 6 | No |
| 8 | Cierre: documentación, e2e, auditoría final | Cierre | Pequeño | todas | No |

Orden elegido: primero lo que protege el dinero (1), luego ordenar el archivo (2) para que los cambios grandes (3 a 5) no se hagan sobre 811 líneas, y al final el flujo y lo opcional.

---

## Fase 0 · Línea base (antes de tocar nada)

**Para qué:** la auditoría leyó el código pero no abrió el navegador. Hay que medir y confirmar antes de arreglar.

**Pasos**
1. Levantar la app de pruebas (`preview_start`) con datos de prueba y 4 métodos de fábrica. Si el puerto está ocupado por otra sesión, usar otro.
2. A 1366×768, 1024×768, 768 y 375, con venta de ejemplo (p. ej. $6,73) medir: alto de la ventana, tamaño de ⚡, atajos y botones del vuelto, scroll, con y sin vuelto. Guardar capturas «antes» en una carpeta fuera del repo.
3. **Confirmar en pantalla** (cada uno en 1 minuto):
   - R3: pulsar `Esc` dentro de un campo de monto → ¿se cierra todo el cobro y se pierde el cliente?
   - R4: vuelto con tasa que dé Bs con 3 decimales → ¿sale «Bs 7.375,006» en el modal?
   - R1: vuelto $3,27 → «Todo en $» → ¿el campo queda en 3,27?
   - R2: pagar en Bs dejando faltar $0,01 → ¿pasa sin dejar rastro en la venta guardada?
4. Correr la suite relacionada como referencia (hoy: 88 de 88 en 6 archivos).

**Entrega:** tabla «antes» (en el caso nuevo `CASO-004-cobro-pos-estilo-farmacia.md`, ver fase 8) y lista de lo confirmado/no confirmado. Si algo no se confirma, esa fase se ajusta o se descarta.

---

## Fase 1 · Arreglos baratos (dinero y uso)

### 1A. Registrar el centavo que falta (`redondeoUsd`) — dinero
- **Archivo:** `src/utils/checkoutProcessor.js` (cerca de `fiadoAmountUsd`, línea ~192). Añadir `const redondeoUsd = remainingUsd > 0 && remainingUsd <= 0.01 ? remainingUsd : 0;` y guardarlo en el objeto de la venta, igual que Farmacia (`checkoutProcessor.js:201` y `:320` allá).
- **Pruebas** (nuevo `tests/redondeoUsd.test.js`, basadas en `financialFixes.test.js:252-266` de Farmacia): faltante $0,01 no fía y queda `redondeoUsd = 0.01`; venta exacta → 0; faltante $0,02 sí fía.
- **Pregunta pendiente:** decisión 8. Recomendado: anotarlo.
- **Aceptación:** el cierre/reportes no cambian de total; solo aparece el campo. Revisar que `calcularEfectivoEsperado` y el desglose de pagos no lo sumen dos veces.

### 1B. Decimales del modal del vuelto — uso
- **Archivo:** `CheckoutModalPOS/components/ChangeConfirmationModal.jsx:6`. `formatBs` con `minimumFractionDigits: 2, maximumFractionDigits: 2` (igual que ERR-116 de Farmacia) y redondear con `round2` antes de formatear.
- **Prueba:** componente con vuelto $8,09 a tasa 911,6 muestra «Bs 7.375,01» (2 decimales).

### 1C. `Esc` no debe cerrar todo el cobro — uso
- **Archivos:** `CheckoutModalPOS/components/PaymentInputs.jsx:85` (añadir `e.stopPropagation()` al vaciar el campo) y `src/views/SalesView.jsx:427` (el manejador global de `Esc` ignora el evento si `e.defaultPrevented`, y si hay un modal interno abierto no cierra el cobro). ⏸ `SalesView.jsx`.
- **Comportamiento deseado:** `Esc` en un campo con valor → lo vacía. `Esc` en campo vacío → nada (o cierra el modal del vuelto si está abierto). Cerrar el cobro entero: solo con ✕ o con `Esc` fuera de campos y sin modal interno.
- **Pruebas:** las 3 de la lista 2 y 3 de la sección 6 de la auditoría.

**Cierre de fase 1:** commit propio. Riesgo: bajo. Si 1C se bloquea por la otra sesión, se hace 1A y 1B y 1C queda como mini-fase al final.

---

## Fase 2 · Partir `CheckoutModalPOS/index.jsx` (sin cambio visible)

**Para qué:** 811 líneas. Farmacia lo dejó en 366 con `parts/`. Las fases 3 a 5 tocan estado de vuelto, y hacerlo sobre un solo archivo grande es como cambiar cables con el tablero encendido.

**Cómo (mismo nombre y orden de hooks que Farmacia para poder comparar):**
- `parts/useCheckoutPosMethods.js`: métodos normalizados y `usePaymentState`.
- `parts/useCheckoutPosAmounts.js`: Cashea, totales dinámicos, `usePaymentCalculations`, máximos del vuelto, `changeAllocationComplete`.
- `parts/useCheckoutPosChange.js`: propina, billetera, repartos, efectos de limpieza.
- `parts/useCheckoutPosPay.js`: `llenarSaldo`, `sumarBillete`, teclado de campos, `procesarPago`.
- `index.jsx`: solo arma los hooks y dibuja.

**Reglas:** mover código tal cual, sin mejoras. El orden de los hooks no puede cambiar (si no, React se queja). **Conservar lo de Bodega:** `evaluarFondoParaVuelto`, `onOpenAporte`, `onCreditShortfall`, defaults `currentFloatUsd/Bs = null`.

**Aceptación:** `index.jsx` ≤ 400 líneas, cada pieza ≤ 600. Las 88 pruebas siguen pasando. Comparación de pantalla antes/después a 1366 y 375: idéntica. ESLint sin errores nuevos.
**Si hay `check:max-lines` en Bodega**, correrlo; si no, anotar el límite de 600 en el caso.

---

## Fase 3 · Pantalla: resumen único, COBRAR junto al resumen, Completar, atajos

Todo en PC; celular igual (`lg:hidden` donde corresponda).

| Pieza | Archivo | Cambio |
|---|---|---|
| Resumen único | `components/TransactionSummary.jsx` | Panel negro: **Total** (grande), **Pagado**, y tercera fila que cambia: **Falta** (ámbar), **Vuelto** (verde), **Pago completo**, o en Crédito **Queda debiendo / Excede la venta** (rojo). Siempre $ y Bs. `aria-live="polite"` y `data-testid` como Farmacia para que las pruebas sean comparables. Bs con `round2` y 2 decimales |
| Quitar repetidos en PC | `components/PaymentLeftColumn.jsx` | «Monto pagado», tarjeta «Falta por pagar», «Pago completo» y «Queda debiendo» pasan a `lg:hidden`. «Pago excede la venta» se queda |
| Botón COBRAR | `components/PaymentFooter.jsx` + `index.jsx` | Nueva prop `placement` (`side` en PC bajo el resumen, `bottom` en celular). Textos: «FALTAN $X», «COBRAR $X», «CONFIRMA EL CAMBIO» y los de crédito sin cambio. Desactivado: gris oscuro con borde punteado y texto legible (hoy `bg-slate-100` con texto gris: poco contraste). Alto 60 px en PC |
| Alto fijo | `index.jsx` | `lg:min-h-[34rem]` para que no salte |
| Completar | `components/PaymentInputs.jsx` | El ⚡ de 26 px pasa a botón «⚡ Completar» de 56 px de alto al lado del campo; conserva `title="Llenar saldo restante"` y la tecla Espacio |
| Atajos | `PaymentInputs.jsx` | `$5 $10 $20 $50 $100` de 44 px, con `aria-label`. **$1: decisión 4**; recomendado dejar $1 en Bodega hasta que el dueño confirme que no se usa |
| Equivalencia | `PaymentInputs.jsx` | «≈ $X» a la derecha del título del método, no flotante; quitar etiqueta «USD/Bs» interna y la tasa repetida en la tarjeta de Bs |
| Texto | varios | letra mínima 11–12 px en lo nuevo |

**Cuidado con lo de Bodega:** `AvisoFondoGaveta` en la columna izquierda no se toca; el botón COBRAR bajo el resumen no debe taparlo (la columna izquierda scrollea, el botón queda fijo).

**Pruebas**
- Nuevo `tests/cobroPosResumen.test.jsx`: estados Falta/Vuelto/Completo/Crédito/Excede; el botón dice lo correcto y está desactivado cuando corresponde.
- Actualizar e2e que busquen «PAGAR (LISTO)» (`tests/e2e/auditoria-flujos.e2e.spec.js`, ⏸ otra sesión lo tiene sin guardar): buscar «COBRAR $…».
- Medir a 1366×768 con y sin vuelto, con 4 métodos: sin scroll, ventana de alto constante.

**Aceptación:** sin cambios en lo que se guarda de la venta; celular idéntico; botones ≥ 44 px en PC.

---

## Fase 4 · «¿Cómo entregas el vuelto?» + reparto automático

**Archivos nuevos:** `components/ChangeCard.jsx` y `parts/changeSplit.js` (puro). **Editados:** `PaymentLeftColumn.jsx`, `parts/useCheckoutPosChange.js`, `index.jsx`.

**Diseño**
- 5 opciones de 48 px: **Todo en $**, **Todo en Bs**, **En $ y Bs**, **Lo deja (propina)**, **A su billetera** (sin cliente: «Billetera: elige cliente»). La elegida se marca y sale «✓ Listo».
- Solo «En $ y Bs» muestra los dos campos (48 px, sin «Todo» interno). Escribir uno rellena el otro con el resto («auto», en gris); «⚡ Completar» en cada campo; «El resto lo deja / A su billetera» si el cajero reparte una parte.
- Se quita el campo «Parte que queda en caja» (la propina parcial = «En $ y Bs» + «El resto: Lo deja»).
- Funciones nuevas en `parts/changeSplit.js`: `restoEnLaOtra`, `completarCampo`, `otroEsAutomatico`, y en el hook `elegirVuelto`, `completarVuelto`, `restoLoDeja`, `restoABilletera`. **Usan los mismos estados** (`distVueltoUSD/BS`, `isTipDonated`, `isChangeCredited`), así que no cambia ninguna cuenta.
- **Aviso de efectivo:** en `ChangeCard` usar `AvisoFondoGaveta` de Bodega (compacto), **no** la línea simple de Farmacia. Mantener `currentFloatUsd/Bs = null` = no avisa.
- Propina grande: mantener el doble toque.

**Pruebas**
- Portar `tests/vueltoRepartoAuto.test.js` de Farmacia (11) a `changeSplit.js` de la carpeta `parts/` (nombre distinto del `utils/changeSplit.js` que ya existe: **ojo con el choque de nombres**; en Bodega llamarlo `parts/changeReparto.js`).
- Nuevo `tests/cobroPosVuelto.test.jsx`: vuelto $3,27 pagando $10: Todo en Bs → botón activo; En $ y Bs con $2 → «Falta repartir $1,27» → «Lo deja» → «Vuelto repartido»; sin cliente la billetera avisa; propina > umbral pide segundo toque.
- Regresión: `checkout.test.js` y `tipDonated.test.js` siguen pasando sin cambios.

**Aceptación:** mismo resultado guardado que antes para cada combinación (comparar la venta guardada antes/después con el mismo escenario). Medir a 1366×768 con aviso de efectivo y reparto a mano: si la columna scrollea unos px, el botón COBRAR sigue visible.

---

## Fase 5 · «Sugerido» realista en PC (vuelto con centavos) — dinero

**Problema (R1):** «Todo en $» con $3,27 anota dólares inexistentes y descuadra el cierre.
**Solución propuesta (decisión 2, opción b):**
- En `ChangeCard`, una opción/chip **«Sugerido: $3 + Bs X»** calculada con `computeRealisticSplit` (ya existe en `utils/changeSplit.js` con 58 pruebas), leyendo de localStorage `checkout_smallest_usd_bill`, `checkout_bs_round_step`, `checkout_bs_round_mode` (como hace `CheckoutModal.jsx:165-170`), con `floatUsd` = efectivo real de la gaveta si se conoce.
- Si el vuelto tiene fracción, «Todo en $» muestra un aviso corto («Los dólares no tienen centavos: usa Sugerido») y no se bloquea (decisión 2 opción c queda como alternativa).
- Al aceptar el sugerido se rellenan `distVueltoUSD/BS` (mismo camino de «En $ y Bs»).
- Pasar `realisticSplit` y `onDeliverAllUsd` al `ChangeConfirmationModal` para que reaparezca «Entregar realista» cuando el reparto no cubre.
- **Ajustes (decisión 6):** si se conecta, la tarjeta «Cómo entrega la caja el cambio» se queda y su texto dice que aplica también al cobro de PC. Si el dueño prefiere ocultarla (como Farmacia), se oculta con una constante `SHOW_CHANGE_SPLIT_SETTING = false` y se documenta. ⏸ `SettingsTabVentas.jsx`.

**Pruebas:** vuelto $3,27 → sugerido $3 + Bs (resto), y la suma = vuelto (tolerancia de redondeo a favor del cliente, según ajuste); billete más pequeño $5 → todo en Bs; efectivo en gaveta insuficiente → recorta la parte en $; tasas 700 y 1200: ida y vuelta Bs→$→Bs no cambia un centavo; el procesador acepta el resultado sin «Vuelto sin asignar».
**Aceptación:** con `smallest bill = 1` y redondeo 0, el sugerido de $6,20 es $6 + Bs de $0,20. El cierre de un día de prueba cuadra con la gaveta simulada.

---

## Fase 6 · Cobro directo + teclado

### 6A. Cobro directo sin modal (decisión 7) — flujo
- En `parts/useCheckoutPosPay.js`: si el vuelto ya está repartido (`changeAllocationComplete && changeAllocationExplicit`), cobrar directo **solo si** `evaluarFondoParaVuelto(...).alcanza === true`. Si falta efectivo, o hay vuelto en efectivo con fondo desconocido (`null`) en una caja local, mostrar el modal como hoy.
- **Regla de oro:** el modal de aviso de efectivo nunca se salta.
- Rediseño del modal («Entrega el vuelto / Dale al cliente…», Enter confirma con el foco puesto) como en Farmacia, conservando «Registrar aporte», «Dejar en saldo a favor» y «Confirmar igual».
- **Pruebas:** sin cobro directo cuando no alcanza; con alcance, una sola llamada a `onConfirmSale`; doble clic = una sola venta.

### 6B. Teclado físico
- **F9** dentro del cobro cobra si el botón está activo (si no, enfoca el primer problema: campo de referencia faltante, vuelto sin repartir). **Enter** en el último campo igual. Mostrar la ayuda en `KeyboardHelpModal.jsx` (F9 dentro del cobro, Espacio completar, ↑↓/Enter mover, Esc vaciar).
- No capturar teclas cuando está abierto el selector de cliente.
- **Pruebas:** F9 con falta de pago no cobra y avisa; con todo listo cobra una vez.

---

## Fase 7 · Opcionales (solo si el dueño aprueba)

| Opcional | Cuándo | Qué incluye | Tamaño |
|---|---|---|---|
| Teclado numérico táctil | Decisión 5 = sí | `useCoarsePointer.js`, `NumericKeypad.jsx`, `keypadInput.js`, interruptor Automático/Siempre/Nunca en Ajustes → Ventas (⏸), `inputMode="none"` en táctil, 10 pruebas | Mediano |
| Referencia de pago | Decisión 3 = sí | `refMode`/`refFormat` en `config/paymentMethods.js`, selector en `PaymentMethodsManager.jsx` (⏸ tiene cambios sin guardar), casilla «Ref» en el título, aviso de repetidas, mostrar en recibo, ticket, historial y cierre | Grande (10+ archivos), plan propio |
| Zelle / Binance / Biopago de fábrica | Decisión 3 | 3 entradas en `FACTORY_PAYMENT_METHODS`, nombres en reportes, migración de métodos propios con el mismo nombre (ojo: ventas viejas `custom_…`), revisar que el cobro con 7 métodos quepa en 1366×768 | Mediano |

Cada uno se planifica y mide por separado antes de empezar.

---

## Fase 8 · Cierre

1. Documentación (ley de documentación de Bodega): `docs/casos/CASO-004-cobro-pos-estilo-farmacia.md` con tabla antes/después, `docs/casos/INDICE.md`, `docs/ERRORES.md` (ERR nuevos por R1 a R4, con causa, solución, cómo comprobarlo), `docs/sistema/modulos/VENTA.md` y `REGLAS-DEL-DINERO.md` (centavo, vuelto sugerido), bitácora/`PENDIENTES.md`.
2. e2e: añadir al menos un recorrido de cobro PC (pagar con vuelto en Bs, billetera, propina) y actualizar capturas de referencia.
3. Corrida completa: suite vitest, ESLint de lo tocado, e2e relacionados.
4. Auditoría final corta: repetir las 4 confirmaciones de la fase 0 y las mediciones a 4 anchos.
5. **Nota de traspaso a Farmacia:** R1 (sugerido realista en PC), R3 (`Esc`) y el aviso de fondo (ya en `PORTAR-A-FARMACIA-apertura-y-fondo.md`). Enviar a la otra sesión; no tocar Farmacia desde aquí.

---

## 3. Decisiones que necesito del dueño (con mi recomendación)

| # | Pregunta | Recomendado | Fase que desbloquea |
|---|---|---|---|
| 1 | ¿Cobro de PC igual al de Farmacia (menos lo de farmacia)? | Sí | 3, 4 |
| 2 | Vuelto con centavos: (a) como hoy, (b) «Sugerido» $ enteros + resto Bs, (c) «Todo en $» solo si es entero | (b) | 5 |
| 3 | Zelle/Binance/Biopago y referencia de pago | Referencia sí; Zelle/Binance los crea el dueño; Biopago no | 7 |
| 4 | ¿Se deja el atajo $1? | Sí, hasta confirmar | 3 |
| 5 | ¿Pantallas táctiles? | Según su caso | 7 |
| 6 | Tarjeta «Cómo entrega la caja el cambio» en Ajustes | Conectarla (si 2b) | 5 |
| 7 | Cobro directo sin modal si alcanza el efectivo | Sí | 6 |
| 8 | Anotar el faltante de hasta $0,01 | Sí | 1 |
| 9 | Tasa durante el cobro | Aviso «La tasa cambió» (fuera de este plan; propuesta aparte) | — |
| 10 | Orden y cuándo tocar `SalesView.jsx` / `SettingsTabVentas.jsx` | Esperar commit de la otra sesión | 1C, 3, 5 |

Si el dueño no responde, se puede arrancar con las fases 0, 1A, 1B y 2, que no dependen de decisiones.

---

## 4. Riesgos del plan y cómo se controlan

| Riesgo | Control |
|---|---|
| Perder el aviso de efectivo de Bodega al copiar de Farmacia | Regla 3; prueba de la fase 6A; revisión de `AvisoFondoGaveta` en cada diff |
| Romper celular/tablet | Todo con `lg:`; captura a 375 y 768 en cada fase; no se edita `CheckoutModal.jsx` salvo la fase 5 si se necesita |
| Cambiar cuentas sin querer en las fases de pantalla | Comparar la venta guardada antes/después en 6 escenarios fijos (exacto, vuelto $, vuelto Bs, propina, billetera, crédito) |
| Choque con la otra sesión | ⏸ marcados; commits por fase; revisar `git status` antes de editar |
| Orden de hooks al partir el archivo | Fase 2 sin cambios de lógica; mismas pruebas antes/después |
| Choque de nombre `changeSplit.js` | Usar `parts/changeReparto.js` en `CheckoutModalPOS/` |
| Cierre de caja que no cuadra tras fases 1 y 5 | Prueba con ventas simuladas de un día completo y revisión de `calcularEfectivoEsperado` |
| Ventana que desborda con más métodos | Medir con 7 métodos si se aprueba la fase 7 |

**Retroceso:** cada fase es un commit; revertir un commit devuelve el estado anterior. Nada cambia el formato de lo guardado salvo el campo opcional `redondeoUsd` (los registros viejos funcionan sin él).

---

## 5. Lista de comprobación común (cada fase)

- [ ] Pruebas nuevas de la fase pasan, y las 6 archivos base (88) siguen pasando.
- [ ] ESLint sin errores en archivos tocados.
- [ ] Capturas a 1366×768, 1024×768, 768 y 375: sin scroll horizontal, botón COBRAR visible, celular igual que antes.
- [ ] Mismo resultado guardado en los 6 escenarios fijos (salvo lo que la fase cambie a propósito).
- [ ] Bitácora/caso/ERR actualizados según la ley de documentación.
- [ ] `git status`: solo archivos de la fase; nada de la otra sesión.

---

## 6. Resultado esperado

- Un panel que dice de un vistazo cuánto falta o cuánto es el vuelto, con el botón de cobrar al lado.
- Vuelto en 5 opciones de un toque; escribir un monto rellena el otro; el sugerido evita dólares imposibles.
- Sin pérdida de centavos sin rastro, sin cobros cerrados por `Esc`, sin Bs con 3 decimales.
- Aviso de efectivo en gaveta intacto, y nunca saltado por el cobro directo.
- Celular y tablet sin cambios.

---

## 7. Decisiones del dueño (respondidas el 2026-11-14)

| # | Decisión | Efecto en el plan |
|---|---|---|
| 2 | **Sugerido** ($ enteros + resto en Bs) | Fase 5 se hace tal cual |
| 3 | **Sí:** referencia de pago, Biopago, teclado numérico táctil. **No:** Zelle y Binance de fábrica (los crea el dueño en Ajustes si hace falta) | Fase 7 queda con 3 piezas: teclado táctil, referencia de pago (grande, con plan propio) y Biopago (Bs, con referencia opcional). Se quita Zelle/Binance |
| 6 | Conectar la tarjeta «Cómo entrega la caja el cambio» al cobro de PC | Fase 5: la tarjeta se queda visible y su texto dice que aplica también a PC |
| 7 | Cobro directo **sí**, solo si alcanza el efectivo | Fase 6A tal cual |
| 4 | *(sin preguntar, por defecto)* se deja el atajo $1 | Fase 3: atajos $1·$5·$10·$20·$50·$100 de 44 px |
| 8 | *(sin preguntar, por defecto)* anotar el faltante ≤ $0,01 | Fase 1A tal cual |
| 9 | *(fuera de este plan)* tasa durante el cobro | Queda como propuesta aparte |
| 10 | *(sin preguntar)* esperar el commit de la otra sesión para `SalesView.jsx` y `SettingsTabVentas.jsx` | ⏸ se mantiene |

**Orden de arranque sugerido:** fases 0, 1A, 1B y 2 (no dependen de nadie), luego 3, 4, 5, 6 y por último 7 con su plan propio.
Si quieres cambiar el $1 o el centavo, dímelo y ajusto las fases 3 y 1A.
