# Auditoría: ventana «Procesar Pago» y lógica de vueltos — Bodega vs Farmacia

**Fecha:** 2026-11-14
**Quién pidió:** el dueño (con 3 capturas del cobro en PC)
**Alcance:** solo lectura. No se cambió código de ninguna de las dos apps y no hay commit ni push.
**Bodega:** `preciosaldia-supervisor-production-alignment`, rama `feat/inicio-estilo-farmacia`.
**Farmacia:** `preciosaldia-farmacia`, rama `pruebas` (hasta el commit `c313721`).

---

## 1. Resumen en 30 segundos

Piensa en la caja registradora de la tienda. Las dos apps tienen **la misma máquina por dentro** (las mismas cuentas del vuelto, la misma propina, la misma billetera). Lo que cambió en Farmacia en los últimos días (CASO-056, 057, 058) es sobre todo **la pantalla**: qué tan grande son los botones y qué tan claro es el vuelto.

Lo que encontré:

1. **Lo que se ve distinto (las 3 capturas) es casi todo pantalla**, y se puede traer a Bodega sin tocar las cuentas del dinero. Es trabajo mediano, concentrado en una sola carpeta (`CheckoutModalPOS/`), así que **no choca** con los cambios de Vender que tiene la otra sesión.
2. **Bodega va adelante en algo importante:** el aviso de «no hay suficiente efectivo en la gaveta para este vuelto» (el commit `5a3ce3a`). Farmacia solo tiene una línea chica y todavía no recibió ese arreglo. Al traer cosas de Farmacia **hay que cuidar de no perderlo**.
3. **Hay 4 riesgos de dinero que existen hoy en Bodega** (algunos también en Farmacia). El más importante: en el cobro de PC, «Todo en $» puede mandar a entregar **$3,27 en dólares**, y eso no se puede dar en la vida real (no hay monedas de dólar). La caja entrega $3 + unos bolívares y el cierre de caja no cuadra. Bodega ya tiene la cuenta correcta guardada (`computeRealisticSplit`), pero **solo la usa el cobro de celular**, no el de PC.
4. **Los ajustes «Caja & Vuelto» (billete más pequeño, redondeo en Bs) no hacen nada en el cobro de PC.** Solo afectan al cobro de celular/tablet. Farmacia ocultó esa tarjeta (commit `84b09d1`); Bodega todavía la muestra y promete algo que en PC no pasa.
5. **Zelle, Binance y Biopago:** Bodega no los trae de fábrica, pero ya se pueden crear como métodos propios en Ajustes. Lo realmente útil que viene con ellos es la **referencia de pago (últimos 4 dígitos)**. Es decisión tuya.

---

## 2. Cómo se ve en pantalla: tabla de diferencias (PC)

| # | Qué | Bodega hoy | Farmacia hoy | ¿Traer a Bodega? |
|---|---|---|---|---|
| 1 | Total y estado | Total negro arriba. Aparte: «Monto pagado» y una tarjeta «Falta por pagar» (el mismo número repetido 3 veces) | Un solo panel negro: **TOTAL / PAGADO / FALTA** (ámbar) o **VUELTO** (verde) o «Pago completo» | **Sí** |
| 2 | Botón de cobrar | Abajo a la derecha de la columna de métodos, lejos del total. Dice «PAGAR (LISTO)» | Bajo el resumen, grande (60 px). Dice «COBRAR $6.73» o «FALTAN $4.73». Si no se puede, sale gris oscuro con borde punteado | **Sí** |
| 3 | Tamaño de la ventana | Cambia de alto al escribir (saltos) | Alto mínimo fijo (34 rem), no salta | **Sí** |
| 4 | Llenar lo que falta | Un ⚡ de 26 px dentro del campo | Botón **«⚡ Completar»** de 114×56 px al lado del campo | **Sí** |
| 5 | Atajos de efectivo $ | 1·5·10·20·50·100, de 30 px de alto, sin el signo $ | $5·$10·$20·$50·$100, de 44 px | **Sí** (y decidir si se queda el $1: ver pregunta 4) |
| 6 | Equivalencia «≈ $» de un monto en Bs | Flota debajo del campo y puede taparse | En la fila del título, no suma alto | **Sí** |
| 7 | Etiqueta «USD/Bs» dentro del campo | La tiene (se come espacio) | La quitó (la moneda ya la dice la tarjeta) | Sí |
| 8 | Vuelto: cómo se elige | 4 botones chicos (34 px, letra 10 px): Todo en $, Todo en Bs, En Caja, Billetera. Más dos campos «Cambio en $ / Bs» con «Todo» dentro y un campo «Parte que queda en caja». Lo que falta repartir sale 3 veces («Resta», «Queda», Bs) | **«¿Cómo entregas el vuelto?»** con 5 opciones de 48 px: Todo en $, Todo en Bs, En $ y Bs, Lo deja (propina), A su billetera («Billetera: elige cliente» si no hay cliente). Solo «En $ y Bs» muestra los campos | **Sí** |
| 9 | Vuelto «En $ y Bs» | Hay que escribir el resto a mano en la otra moneda | Escribes un campo y el otro **se llena solo** (etiqueta «auto»). «⚡ Completar» y «El resto lo deja / A su billetera» | **Sí** (con cuidado, ver 4.3) |
| 10 | Confirmación del vuelto | Siempre sale el modal «Confirmar distribución del cambio» (más un clic) | En PC, si el vuelto ya está repartido, **cobra directo**. El modal queda para celular. Se rediseñó: «Entrega el vuelto / Dale al cliente…» | **Con condición**: Bodega debe seguir mostrando el modal cuando falte efectivo en la gaveta |
| 11 | Aviso de efectivo en gaveta | **Grande y claro**, con «Registrar aporte», «Dejar en saldo a favor», «Confirmar igual». Entiende «fondo desconocido» (venta remota) | Una línea naranja: «El vuelto supera el efectivo que hay en caja». Todavía sin el cálculo por turno | **Bodega gana. No perderlo** |
| 12 | Métodos de pago de fábrica | Efectivo $, Efectivo Bs, Pago móvil, Punto de venta (y COP si se enciende) | Esos + **Zelle, Binance** (en $) + **Biopago** (Bs) | Decisión tuya (pregunta 3) |
| 13 | Referencia de pago (últimos 4) | Cuadro de 8 caracteres debajo del método, sin forma fija | Casilla «Ref» en la fila del título, 4 caracteres, obligatoria/opcional por método, avisa repetidas, sale en recibo, historial y cierre | Decisión tuya (pregunta 3) |
| 14 | Pantalla táctil | Usa el teclado de Windows (se come media pantalla) | Teclado numérico propio (se enciende solo si el equipo es táctil; hay interruptor en Ajustes) | Solo si tienes pantallas táctiles (pregunta 5) |
| 15 | Teclado físico | Flechas/Enter pasan al siguiente campo; Espacio = completar; F9 abre el cobro desde Vender. Dentro del cobro: sin F9 | Igual. La «Fase 4» (F9 dentro del cobro, Enter en el último campo cobra, Alt+1…4) está **pendiente** en Farmacia | Se puede hacer en Bodega sin esperar a Farmacia (ver 3.3) |
| 16 | Cabe en 1366×768 sin desplazar | No medido en Bodega | Medido: sí, hasta con 7 métodos y teclado (694 px de 768) | Medir en Bodega después de cambiar |
| 17 | Archivos | `index.jsx` de 811 líneas y `CheckoutModal.jsx` de 1010 | Partidos en piezas de ≤ 366 líneas (`parts/`) | Ver 6 (conviene partir al portar) |

---

## 3. Diseño y usabilidad en PC

### 3.1 Lo que está bien en Bodega (no tocar)
- Dos columnas, el cobro cabe en pantalla de PC y el modal se adapta a celular (`h-[100dvh]` en celular, barra de cobrar pegada abajo con el borde seguro del iPhone).
- Al abrir, el cursor cae solo en el primer campo (a los 120 ms).
- Flechas ↑↓ y Enter pasan al campo siguiente. Espacio llena lo que falta. La referencia solo aparece cuando el método tiene monto.
- Hay etiquetas de accesibilidad: `role="dialog"`, `aria-modal`, pestañas de moneda con `role="tab"`.
- En celular y tablet (menos de 1024 px o navegador móvil) se usa el **cobro básico**, que es otro modal. **Nada de lo que se cambie en `CheckoutModalPOS/` afecta al celular.** Esto sirve para no romper tablet/teléfono: solo hay que cuidar que los cambios usen `lg:` (PC) y dejen igual lo móvil, como ya hace Farmacia con `lg:hidden`.

### 3.2 Problemas de uso que vi en Bodega (todos por leer el código; ninguno probado en pantalla)
1. **El botón de cobrar está lejos del dinero.** El ojo va al total (izquierda arriba), la mano al botón (derecha abajo). En Farmacia el botón quedó pegado al resumen.
2. **El mismo número 3 veces** (Total, «Monto pagado», «Falta por pagar»). Es como tener tres relojes en la pared con la misma hora: cuesta decidir cuál mirar.
3. **Letras de 8 a 10 px y botones de 26 a 34 px** en el vuelto y los atajos. En una laptop de 1366×768 se ven chicos y para dedo no sirven (el mínimo cómodo es 44 px).
4. **Escape hace dos cosas a la vez.** Dentro de un campo de monto, `Esc` lo vacía (`PaymentInputs.jsx:85`), pero además la vista de Vender escucha `Esc` en toda la ventana y **cierra el cobro entero y quita al cliente elegido** (`SalesView.jsx:427`). Un cajero que solo quería borrar un número puede perder todo lo escrito. Farmacia tiene el mismo código. *No lo probé en pantalla; sale de leer los dos archivos.*
5. **La ventana cambia de alto** según haya o no vuelto (en Farmacia midieron 436 px sin vuelto y 521 px con vuelto, antes de fijar el mínimo). Eso hace que los botones «salten» de sitio justo cuando el cajero va a pulsar.
6. **El foco inicial solo se pone una vez al abrir.** Si el cajero elige «Todo en $» con el mouse, el foco no vuelve a un lugar útil. Con Enter en el último campo no pasa nada (no cobra).

### 3.3 Teclado y escáner
- **Escáner:** el cobro se abre con F9 desde Vender; el escáner sigue funcionando en el buscador porque, al cerrar el cobro, el foco vuelve al buscador (`SalesView.jsx:414`). Con el cobro abierto el escáner no hace nada (bien: no se agregan productos a mitad de un pago).
- **F9** dentro del cobro no hace nada. **Propuesta chica:** F9 (o Enter en el último campo) cobra cuando el botón está activo; así un cajero rápido no toca el mouse. Es lo que Farmacia tiene anotado como «Fase 4 pendiente». Bodega puede hacerlo primero.
- **Alt+1…4** para saltar entre métodos: opcional, bajo valor con solo 4 métodos.

### 3.4 Tablet y teléfono
- No se rompen mientras los cambios se queden dentro de `lg:` (PC). Farmacia ya lo resolvió así.
- Laptop táctil de 1024 px o más: entra al cobro de PC y **abre el teclado de Windows**. Si tienes ese tipo de equipo, el teclado numérico propio de Farmacia (CASO-056 fase 3, archivos `NumericKeypad.jsx`, `keypadInput.js`, `useCoarsePointer.js`) sirve. Si todos tus equipos son con mouse, no hace falta.

---

## 4. Lógica de vueltos, paso a paso

### 4.1 Cómo funciona (igual en las dos apps)
Imagina el cajón de la caja registradora:

1. **El total** viene del carrito (descuentos e IVA ya aplicados). Si hay un producto de «doble precio» y se paga en Bs, el total se recalcula con el precio en Bs (aparece el aviso de re-precio).
2. **Lo pagado** = suma de cada método convertido a dólares. Los Bs se dividen entre la tasa (`usePaymentCalculations.js`). Más saldo a favor y Cashea, si se usan.
3. **Falta** = total − pagado (nunca menos de 0). **Vuelto** = pagado − total (nunca menos de 0). Todo con `dinero.js` (`subR`, `sumR`, `divR`), que evita errores de coma flotante.
4. **El cajero reparte el vuelto** en cuatro destinos posibles, que se pueden combinar: dólares en efectivo, bolívares en efectivo, **propina** (se queda en caja) y **billetera** del cliente (saldo a favor).
5. **Topes entre sí:** lo que pones en Bs le quita lugar a los $ y al revés (`maxVueltoUSD/BS`). No se puede repartir más vuelto del que existe.
6. **Propina grande** (más de `TIP_MAX_AUTO_USD`) pide pulsar dos veces. La moneda de la propina sale de qué efectivo hay más en la gaveta (TIP-004).
7. **Si el reparto queda incompleto, el botón no cobra** (`changeAllocationComplete`).
8. **Al cobrar**, el procesador (`checkoutProcessor.js`) **no se fía de la pantalla** y vuelve a calcular: el vuelto real es el techo (FIN-034), nunca se entrega ni se dona más que eso; si el cajero declaró de más, se recorta; si el reparto es explícito y sobra algo sin destino, **rechaza la venta** («Vuelto sin asignar»); bloquea vueltos «raros» de más de 5 veces el total (FIN-005); revisa que dólares y bolívares sean coherentes con la tasa (FIN-022).
9. **Fiado:** en la pestaña Crédito, pagar de menos deja lo que falta como deuda (pide cliente). Pagar **de más** en Crédito se rechaza en pantalla y en el procesador («cambia a Contado»). En Contado no se puede pagar de menos.

### 4.2 Qué casos cubre cada uno

| Caso | Bodega | Farmacia | Comentario |
|---|---|---|---|
| Pago mixto $ + Bs | Sí | Sí | Igual |
| Vuelto en Bs pagando con $ | Sí | Sí | Igual (y en Farmacia se llena solo el resto) |
| Propina (cliente deja el vuelto) | Sí, total o parcial (campo «Parte que queda en caja») | Sí: «Lo deja (propina)» total, o parcial con «En $ y Bs» + «El resto lo deja» | Igual por dentro |
| Billetera / saldo a favor | Sí, requiere cliente | Sí, igual | Igual |
| Usar saldo a favor para pagar | Sí | Sí | Igual |
| Pagar de menos = fiado | Sí (pestaña Crédito) | Sí | Igual |
| Cashea | Sí | Sí | Igual |
| Descuento | Sí, ya viene en el total | Sí, + descuento por artículo (CASO-055, propio de farmacia) | No aplica el de artículo |
| Monto libre | Sí (`CustomAmountModal`) | Sí | Igual |
| Avance de efectivo | Sí | Sí | Igual |
| Fondo de caja disponible para el vuelto | **Sí, por turno, restando vueltos ya dados** | Solo aviso simple, cálculo viejo (pendiente P-001 de Farmacia) | **Bodega gana** |
| Billete más pequeño y redondeo en Bs | **Solo en celular** | **Solo en celular** (tarjeta oculta) | Ver riesgo R1 |
| Registro del centavo que falta (≤ $0,01) | **No** | **Sí** (`redondeoUsd`) | Ver riesgo R2 |

### 4.3 Riesgos de dinero (ordenados)

**R1 · «Todo en $» con centavos manda a entregar dólares que no existen** · Media-alta · *Bodega y Farmacia*
- Qué pasa: con un vuelto de $3,27, «Todo en $» pone 3,27 en el campo de dólares (`index.jsx:290-320`). La caja anota «entregué $3,27 en dólares». En la vida real da $3 y 27 centavos en Bs.
- Consecuencia: el «Efectivo esperado» del cierre cree que salieron $3,27 de la gaveta de dólares. Cada día, un poco de descuadre en dólares y un poco de sobra en Bs.
- Lo curioso: Bodega **ya tiene** la cuenta correcta (`computeRealisticSplit`: billetes enteros en $ + resto en Bs, respetando billete más pequeño, redondeo y efectivo en caja; 58 pruebas). Pero solo la usa el cobro de celular (`CheckoutModal.jsx:171`). En `ChangeConfirmationModal` de PC el botón «Entregar realista» existe pero nunca se muestra porque PC no le pasa `realisticSplit` (grep lo confirma).
- Cómo se evita con poco trabajo: una opción nueva en «¿Cómo entregas el vuelto?» (por ejemplo **«Sugerido: $3 + Bs …»**) que use esa función. No cambia las cuentas del procesador. Ver pregunta 2.

**R2 · El centavo que falta se pierde sin rastro** · Media · *solo Bodega*
- Qué pasa: si faltan $0,01 (por redondeo de Bs), Bodega deja pasar la venta como pagada y **no anota nada**. Farmacia lo anota en `redondeoUsd` (CASO-004 punto 6, probado en `financialFixes.test.js`).
- Consecuencia: ventas con 1 centavo de diferencia que nadie puede explicar al cuadrar.
- Arreglo: copiar la línea `redondeoUsd` del procesador y sus 2 pruebas. Pequeño, sin cambio visual.

**R3 · `Esc` cierra todo el cobro** · Media · *Bodega y Farmacia* (ver 3.2 punto 4). Arreglo pequeño: que `Esc` dentro del campo no suba a la ventana (`stopPropagation`) y que, con el modal del vuelto abierto, `Esc` cierre solo ese modal.

**R4 · Modal final del vuelto con 3 decimales («Bs 7.375,006»)** · Baja (solo se ve) · *Bodega*
- Farmacia lo arregló como ERR-116. Bodega tiene el mismo código viejo: `formatBs` pone `minimumFractionDigits: 2` pero no `maximumFractionDigits` (`ChangeConfirmationModal.jsx:6`), y se le pasa `cambioUSD × tasa` sin redondear. Arreglo de una línea.

**R5 · La tasa cambia mientras se cobra** · Baja-media · *Bodega y Farmacia* · **no probado**
- Los totales y la conversión de Bs usan la tasa viva. Si el precio del BCV se actualiza con el cobro abierto, el total en Bs y lo ya escrito en Bs cambian solos. Además, al tocar COBRAR con vuelto se arma una «foto» de los pagos con la tasa de ese momento y se guarda al confirmar en el modal; si la tasa cambia entre un paso y otro, la foto queda vieja. El procesador rechaza lo que no cuadra (FIN-022), así que el peor caso es un error visible, no dinero mal anotado. Hay una prueba de tasa estable para el desglose (`paymentBreakdownRateStable.test.js`) pero ninguna del cobro con tasa cambiando.
- Sugerencia: congelar la tasa al abrir el cobro y mostrar «La tasa cambió a X. ¿Actualizar?». Es decisión de diseño, no urgente.

**R6 · Doble cobro (doble clic)** · Baja · *protegido*
- `useCheckoutFlow` usa un candado síncrono (`isProcessingRef`) y `withLock`; el botón se desactiva y dice «PROCESANDO…». Está bien. Solo hay que **mantenerlo** si se cambia el cobro directo.

**R7 · Cobro directo sin modal puede saltarse el aviso de efectivo** · Media · *riesgo al traer la mejora #10*
- Farmacia salta el modal si el vuelto ya está repartido (`useCheckoutPosPay.js`). En Bodega el aviso grande de «no hay efectivo» vive justo en ese modal. Si se copia tal cual, el aviso desaparece. Regla segura: **cobrar directo solo si el efectivo alcanza** (`evaluarFondoParaVuelto` → `alcanza`); si no alcanza o el fondo es desconocido con vuelto en efectivo, mostrar el modal como hoy.

**R8 · Cierre de caja que no cuadra** (resumen)
Las causas posibles son R1 (dólares imposibles), R2 (centavos), la falta de fondo (ya cubierta en Bodega) y la apertura duplicada (ya cubierta en `5a3ce3a`). Con R1 y R2 resueltos, el cierre debería cuadrar mejor. Hay que probarlo con ventas reales de varios días.

---

## 5. Lo que cambió Farmacia sobre vuelto y por qué (historial)

- **CASO-056** (13-nov): cobro a la medida de 1366×768 y táctil. Fase 1: resumen único + botón COBRAR junto al resumen. Fase 2: «Completar» y atajos $5–$100 de 44 px. Fase 3: teclado numérico táctil. Vuelto en 5 opciones. «En $ y Bs» con resto automático. Modal «Entrega el vuelto» y cobro directo en PC. Mediciones: la ventana cabe sin desplazar.
- **CASO-057**: Zelle, Binance y Biopago de fábrica.
- **CASO-058**: referencia de pago (últimos 4) y pantalla completa.
- **ERR-109** (modo de cobro «automático» se decide una sola vez al cargar). **ERR-110/111/112** (referencias). **ERR-116** (3 decimales en Bs).
- **CASO-004**: arreglos del motor financiero (IVA por resto mayor, `redondeoUsd`, descuento sin redondear el porcentaje).
- **Commit `84b09d1`** (9-nov): oculta con `SHOW_CHANGE_SPLIT_SETTING = false` la tarjeta «Cómo entrega la caja el cambio» de Ajustes → Ventas → Caja & Vuelto. El mensaje del commit no dice por qué; solo que los valores guardados siguen aplicándose. *Mi lectura (no confirmada): se pidió ocultar varias tarjetas a la vez («datos legales, granel, desglose de cambio y fiados») para simplificar Ajustes, y de paso esa tarjeta no afecta al cobro de PC.*
- **Bodega, `5a3ce3a`**: no abrir dos cajas, fondo real de la gaveta (por turno, restando vueltos ya dados) y aviso grande de efectivo insuficiente. En Farmacia sigue **pendiente (P-001)**; hay una nota de traspaso en la carpeta compartida de notas.

**Ajustes «Caja & Vuelto» de Bodega.** Hoy muestra: «Cómo entrega la caja el cambio» (billete más pequeño, redondeo en Bs a favor del cliente o de la tienda), «Avance de efectivo» y métodos de pago. Esas dos primeras opciones **no cambian nada en el cobro de PC** (solo en celular/tablet). Quien las mueva esperando efecto en PC se va a confundir.

---

## 6. Pruebas que existen y las que faltan

**Bodega, ya existen (corrí las 6 principales y pasaron: 88 de 88):**
`checkout.test.js` (vuelto, propina parcial, billetera, fiado, drift USD/Bs), `tipDonated.test.js` (12), `fondoGaveta.test.js` (9), `changeSplit.test.js` (39), `changeSplitSteppers.test.js` (19), `changeSplitSettings.test.js`, `checkoutProcessorRemote.test.js`, `paymentBreakdownRateStable.test.js`, `aperturaDuplicada.test.js`, `cajaEsperada.test.js`.

**Farmacia tiene y Bodega no:** `vueltoRepartoAuto.test.js` (11, reparto automático), `tecladoCobroTactil.test.js` (14), `referenciaPago.test.js` (11), `financialFixes.test.js` (`redondeoUsd`, IVA por resto mayor), `casheaCheckoutReceivable.test.js`, e2e de captura de cobro móvil.

**Falta en los dos (casos que propongo probar):**
1. Cobro de PC como pantalla (componente): pagar con $10 una venta de $6,73 → «Todo en Bs» → botón activo; «En $ y Bs» con resto automático; la propina de más de $20 pide doble toque.
2. `Esc` dentro de un campo no cierra el cobro (R3).
3. `Esc` con el modal del vuelto abierto cierra solo el modal.
4. Pago por Bs exactos que deja $0,01 de diferencia: queda `redondeoUsd` (R2).
5. Vuelto de $3,27 en PC: el sugerido da $3 + Bs del resto, y la suma cuadra con el vuelto (R1).
6. Vuelto en Bs con tasas altas (700, 1200): ida y vuelta Bs→$→Bs no pierde ni gana un centavo.
7. Cobro directo no se salta el aviso si no alcanza el efectivo (R7).
8. Tasa que cambia entre «COBRAR» y «Confirmar» (R5): o se avisa o se rechaza con mensaje claro.
9. Doble clic rápido en COBRAR y en «Vuelto entregado»: una sola venta.
10. Venta mixta $ + Bs + saldo a favor + vuelto a billetera, con descuento e IVA encendidos.
11. Ancho 1366 y 1024 (PC) y 375 (celular): sin desplazamiento horizontal, botón visible.

---

## 7. Qué SÍ y qué NO traer a Bodega

### Sí (por orden de valor)
| # | Qué | Por qué | Tamaño |
|---|---|---|---|
| 1 | Resumen único Total / Pagado / Falta-Vuelto, botón COBRAR bajo el resumen, alto mínimo fijo | Es lo que más se nota en las capturas y lo que más ayuda a leer rápido | Mediano |
| 2 | «Completar» de 44 px y atajos $5–$100 de 44 px; «≈ $» en la fila del título; quitar etiqueta «USD/Bs» interna | Botones que sí se pueden tocar; caben montos largos en Bs | Pequeño |
| 3 | «¿Cómo entregas el vuelto?» (5 opciones) | Reemplaza 4 botones + 3 campos + 3 avisos repetidos | Mediano |
| 4 | Reparto «En $ y Bs» con resto automático (`changeSplit.js` de la carpeta `parts/`, funciones puras + 11 pruebas) | No escribir cuentas a mano | Pequeño-mediano |
| 5 | Arreglos de dinero: `redondeoUsd` (R2), 3 decimales (R4), `Esc` (R3) | Son errores reales, baratos de arreglar | Pequeño |
| 6 | Opción **«Sugerido»** con `computeRealisticSplit` en el cobro de PC (R1) | Evita dólares imposibles; ya existe y tiene pruebas | Pequeño-mediano |
| 7 | Cobro directo sin modal, **solo si alcanza el efectivo** (R7) | Un clic menos por venta con vuelto | Pequeño |
| 8 | F9/Enter para cobrar dentro del cobro | Rapidez de teclado | Pequeño |
| 9 | Teclado numérico táctil | Solo si hay pantallas táctiles | Mediano |
| 10 | Referencia de pago (últimos 4) + `refMode` por método | Cuadrar con el banco; no depende de tener Zelle | Mediano-grande (toca ticket, recibo, cierre, historial) |

### No (o no todavía)
- **No copiar archivos de Farmacia tal cual encima de los de Bodega.** Perderías `AvisoFondoGaveta`, `onOpenAporte`, `onCreditShortfall` y el fondo «desconocido = null» de Bodega. Se porta pieza por pieza.
- **No traer** nada de lo propio de farmacia que aparece en esos archivos: Récipe, lotes/FEFO (`allocateFefo`), descuento por artículo (CASO-055), `RxCheckoutGate`, `StockCheckoutGate`, `cartStockShortfall` (esto último sí puede servir en Bodega, pero es otra auditoría).
- **No ocultar** el ajuste «Caja & Vuelto» como hizo Farmacia, **si** vas a conectar el «Sugerido» (R1) al cobro de PC: en ese caso la tarjeta pasa a tener sentido. Si NO se conecta, conviene ocultarla para no prometer algo que no ocurre.
- **Biopago:** es el sistema de pago con huella del Banco de Venezuela. Si tu bodega no lo usa, no lo traigas (queda como botón muerto). Se puede crear como método propio el día que lo uses.
- **Zelle y Binance de fábrica:** ya se pueden crear como método propio en Ajustes → Métodos de pago (Bodega permite crear métodos). Lo que cambia con «de fábrica» es que todos los equipos los traen encendidos y con nombre correcto en reportes. Ojo con duplicados: Bodega ya borra silenciosamente un método propio con el mismo nombre que uno de fábrica (`getAllPaymentMethods`), y las ventas viejas quedarían con el id anterior (`custom_…`).
- **Billetera: sin cambios de lógica.** Ya funciona igual; solo se cambia cómo se elige.

---

## 8. Orden recomendado y tamaño

| Fase | Contenido | Archivos aprox. | Tamaño | Choca con la otra sesión (Vender) |
|---|---|---|---|---|
| 0 | Arreglos baratos: R2 `redondeoUsd`, R4 decimales, R3 `Esc` + sus pruebas | 3 (`checkoutProcessor.js`, `ChangeConfirmationModal.jsx`, `SalesView.jsx`) | Pequeño | **Sí en `SalesView.jsx` (Esc)**; hacerlo cuando la otra sesión haya hecho commit |
| 1 | Resumen único + COBRAR bajo el resumen + alto mínimo + Completar + atajos | 5 (`TransactionSummary`, `PaymentLeftColumn`, `PaymentFooter`, `PaymentInputs`, `index.jsx`) | Mediano | No |
| 2 | «¿Cómo entregas el vuelto?» + reparto automático (+ `ChangeCard.jsx`, `changeSplit.js` nuevos) | 3 editados + 2 nuevos + 1 prueba | Mediano | No |
| 3 | «Sugerido» realista en PC (R1) y decidir qué pasa con la tarjeta de Ajustes | 2-3 | Pequeño-mediano | Una línea en `SettingsTabVentas.jsx` (la otra sesión lo tiene sin guardar) |
| 4 | Cobro directo con condición de efectivo (R7) | 1-2 | Pequeño | No |
| 5 | F9/Enter dentro del cobro | 1-2 | Pequeño | No |
| 6 | Partir `index.jsx` (811 líneas) en piezas como Farmacia (`parts/`) | 4-5 | Mediano, **sin cambio visible** | No |
| 7 | Referencia de pago y métodos Zelle/Binance (si lo apruebas) | 10+ | Grande | No |
| 8 | Teclado numérico táctil (si lo apruebas) | 4 | Mediano | No |

Notas de método:
- Cada fase se mide a 1366×768, 1024×768, 768 y 375 de ancho, y se prueba que celular y tablet sigan igual.
- Las fases 1 a 6 se quedan en `CheckoutModalPOS/`. Así **no tocan** `CartPanel`, `CategoryBar`, `SearchBar` ni la mayor parte de `SalesView` que la otra sesión tiene sin guardar.
- Conviene hacer la fase 6 (partir archivos) **antes** de la 1 y 2, o al mismo tiempo: pasar cambios a un archivo de 811 líneas es más propenso a errores.

---

## 9. Preguntas para el dueño (decisiones)

1. **¿Quieres que el cobro de PC de Bodega se parezca por completo al de Farmacia** (resumen único, botón COBRAR junto al total, 5 opciones de vuelto) o solo algunas partes? *Recomiendo todo menos lo de farmacia.*
2. **Vuelto con centavos (R1):** cuando el vuelto es $3,27, ¿qué debe pasar al pulsar «Todo en $»?
   - (a) Lo de hoy: entrega $3,27 en dólares (no existen).
   - (b) Se ofrece un «Sugerido»: $3 en billetes + el resto en Bs.
   - (c) «Todo en $» solo se permite si es un número entero.
   *Recomiendo (b), y que el «Sugerido» respete lo que pongas en Ajustes → Caja & Vuelto (billete más pequeño y redondeo).*
3. **Zelle, Binance y Biopago:** ¿los usa tu bodega? ¿Los quieres **de fábrica**, o prefieres crearlos tú en Ajustes cuando haga falta? ¿Y la **referencia de pago (últimos 4)** te sirve para cuadrar con el banco, obligatoria en Pago Móvil y Zelle como en Farmacia?
4. **Atajos de efectivo:** Farmacia usó $5, $10, $20, $50, $100 (sin $1). En una bodega, ¿se paga a menudo con billetes de $1 y $2? ¿Dejamos el $1?
5. **¿Tus cajas tienen pantalla táctil?** Si sí, traemos el teclado numérico propio. Si no, no.
6. **Tarjeta «Cómo entrega la caja el cambio» en Ajustes:** ¿se oculta como hizo Farmacia, o se conecta al cobro de PC (opción 2b) y se queda visible?
7. **Cobro directo sin modal:** ¿quieres ahorrar el clic extra cuando el vuelto ya está repartido y alcanza el efectivo? (Si falta efectivo, el modal con el aviso grande saldría igual.)
8. **Centavo faltante (R2):** ¿se anota el faltante de hasta $0,01 como en Farmacia (`redondeoUsd`), o prefieres exigir el pago exacto?
9. **Tasa durante el cobro (R5):** ¿congelar la tasa al abrir el cobro y avisar si cambia, o dejar que se actualice sola?
10. **Orden:** ¿empezamos por los arreglos baratos (fase 0) o por lo que se ve (fase 1)? ¿Esperamos a que la otra sesión de Vender guarde su trabajo para tocar `SalesView.jsx` y `SettingsTabVentas.jsx`?

---

## 10. Qué verifiqué y qué no

**Verifiqué leyendo código de ambos repos:** `CheckoutModalPOS/` completo en los dos, `useCheckoutPosChange/Amounts/Pay` y `changeSplit.js` (Farmacia), `checkoutProcessor.js` (Bodega), `fondoGaveta.js`, `changeSplit.js`, `paymentMethods.js` de ambos, `SettingsTabVentas.jsx`, el commit `84b09d1`, los documentos CASO-004, 056, 057, 058 y ERR-116 de Farmacia, y la nota de traspaso `PORTAR-A-FARMACIA-apertura-y-fondo.md`.

**Corrí:** `npx vitest run` de 6 archivos de Bodega (checkout, tipDonated, fondoGaveta y las 3 de changeSplit): **88 de 88 pasan**.

**No hice:**
- No abrí el cobro en el navegador. Las medidas de Bodega (tamaños, saltos de alto) vienen del código y de las mediciones de Farmacia, **no son medidas propias**. `Esc` (R3) y los 3 decimales (R4) salen de leer el código; deberían confirmarse en pantalla antes de arreglarlos.
- No probé la tasa cambiando durante el cobro (R5).
- No corrí la suite completa ni los e2e.
- No revisé el cobro de celular (modal `CheckoutModal.jsx`) más que para saber que usa el desglose realista.
- No probé con ventas reales de varios días el cuadre del cierre (R8).

Nada se cambió ni se guardó en ningún repositorio.
