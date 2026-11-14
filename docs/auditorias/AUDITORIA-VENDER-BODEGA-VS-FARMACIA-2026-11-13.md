# Auditoría de «Vender»: Bodega contra Farmacia

Fecha: 2026-11-13
Farmacia: `precios al dia farmacia\preciosaldia-farmacia`, rama `pruebas` (solo lectura).
Bodega: rama `feat/inicio-estilo-farmacia`.
**No se cambió ningún código.** Es solo un informe.

---

## 1. Lo más importante (resumen corto)

1. **El selector de vista (capas/lista/cuadrícula) y el micrófono YA existen en Bodega.** El código de `SearchBar.jsx` es casi igual en los dos. No hay que copiarlos.
2. **Lo que sí falta en Bodega es la hora de la tasa** («hoy 11:17 p. m.»). Es pequeño y seguro: 20 líneas. El dato ya existe en Bodega (`useRates.js` guarda `lastUpdate`), solo no se muestra.
3. **La rejilla de productos de Bodega usa columnas fijas** (3, 4 o 5). Farmacia en PC usa «caben las que entren, mínimo 160 px» y tiene un modo especial para laptops bajas (1366×768). Esto es lo que más cambia cuántos productos se ven.
4. **Ninguna de las dos usa virtualización.** Las dos muestran 30 tarjetas y un botón «Cargar Más». Con ~2.400 productos en Bodega funciona, pero no es lo ideal (ver sección 5).
5. **Ajustes → Ventas → «Cesta»** (lo que mostró la captura: Automática / Siempre compacta / Siempre amplia) **no existe en Bodega.** Se puede copiar tal cual. Detalle exacto en la sección 3.
6. **Farmacia oculta las categorías cuando solo hay una.** Bodega siempre muestra «Todos» + «General», que repiten lo mismo. Fácil de copiar.
7. **Cesta vacía con «Productos frecuentes»** y orden por «más vendidos» no existen en Bodega. Son útiles para una bodega también.

---

## 2. Tabla de diferencias

| Zona | Bodega hoy | Farmacia hoy | ¿Aplicar en Bodega? |
|---|---|---|---|
| Selector de vista (capas/lista/cuadrícula) | Existe, igual | Igual | Ya está |
| Micrófono (mantener para hablar) | Existe, igual | Igual | Ya está |
| Hora de la tasa BCV | No se muestra | «hoy 11:17 p. m.», «ayer…», «12/11…» (función `formatRateStamp` en `PosMainSection.jsx`) | **SÍ** |
| Columnas de la rejilla | Fijas: 3 / 4 / 5, separación pequeña | 3 / 4 / 5 en teléfono y tablet; en PC `auto-fill minmax(160px,1fr)`; separación menor en pantallas bajas | **SÍ** |
| Pantallas bajas (laptop 1366×768) | No hay modo especial | Variante `short:` (PC con alto ≤ 800 px) en `tailwind.config.js` | **SÍ** (base de todo lo demás) |
| Tarjeta sin foto | Reserva un cuadrado grande con ícono de categoría vacío | Si no hay foto: un espacio de solo 20 px, tarjeta compacta | **SÍ** (resuelve el «espacio vacío» de la captura) |
| Tarjeta con foto | Igual que Farmacia | Igual | Ya está |
| Nombre | 2 líneas con «…» (`line-clamp-2`), no está en mayúsculas por código | Igual, pero con letra más grande en PC (13,5 px contra 12 px) | Subir la letra en PC |
| Insignia de stock | Verde o roja («AGOTADO») | Verde / **ámbar «queda poco»** / roja; en cajas muestra «2 cajas + 9 U» | Ámbar sí; «cajas + U» solo si la bodega vende por bulto |
| Precio en $ y Bs | Sí | Sí, igual | Ya está |
| «Ref» y «(en Bs)» | Sale en productos de doble precio | Igual (es la función «Doble $») | No quitar: es de Bodega, pero ver nota abajo |
| Botones táctiles de la tarjeta (bulto / unidad) | Alto ~24 px | `lg:min-h-[38px]` en PC | **SÍ** (táctil) |
| Producto sin precio | Se agrega a $0.00 sin aviso | Avisa «no tiene precio, asígnalo en Inventario» y no lo agrega; borde rojo | **SÍ** (evita cobrar $0) |
| Más vendidos primero | No | `hotProducts.js`: contador local, orden por «más agregados»; no salta durante la venta | **SÍ** |
| Categorías | Siempre «Monto Libre, Todos, General, Ayuda, Vaciar cesta F4» | Si hay una sola categoría real, esconde los chips. «Ayuda» es un botón redondo de 28 px con «?». Las acciones bajan a la línea siguiente si no caben | **SÍ** |
| Cesta vacía | Vacía | Muestra «Productos frecuentes» (hasta 6) con un toque | **SÍ** |
| Cesta compacta | No existe | Una línea por artículo; modo en Ajustes (Automática/Siempre compacta/Siempre amplia) | **SÍ** (ver sección 3) |
| Descuento | Existe | Apagado de fábrica, se enciende en Ajustes → Ventas; solo Administrador puede editar precio por línea | Revisar en otra auditoría |
| Atajos | F9 cobrar, F7 espera, F4 vaciar, Escape | Iguales (`useSalesKeyboard.js` igual en ambas) | Ya está |
| Búsqueda por código de barras / escáner | Existe (comparten la lógica: «un-shifter», código exacto va directo a la cesta) | Igual | Ya está |
| Buscar por «otros nombres» / principio activo | No | Sí (CASO-029) | **NO** (es de farmacia) |
| Familias/variantes (¿Qué talla?) | No | Sí (CASO-032 y 044) | NO por ahora (ver sección 4) |
| Récipe / ficha farmacéutica | No | Sí (CASO-035) | **NO** |
| Blíster (tercera presentación) | No | Sí (CASO-030) | **NO** |
| Barra lateral | Igual (colapsada 64 px / expandida 224 px, solo PC) | Igual | Ya está |
| Contenedor de consultas (`@container`) | No se usa | No se usa tampoco (usan breakpoints normales + `short:`) | No hace falta |

Nota sobre «Ref» y «(en Bs)»: es la función de precio doble («$ divisa» contra «$ ref Bs»). Existe en las dos. En la captura de Bodega se ven porque esos productos de prueba son de doble precio. Lo que molesta no es el texto, sino que la insignia ocupa una línea extra. Se puede mantener y ponerla más pequeña.

---

## 3. Lo que pidió el usuario: copiar tal cual la opción «Cesta»

La captura muestra, en Ajustes → Ventas, un cuadro con:

- Título: **Cesta**
- Subtítulo: **Cuántos artículos caben en la lista**
- Texto: «La cesta compacta usa una sola línea por artículo. Automática: se activa sola en pantallas bajas (laptops chicas).»
- Tres botones: **Automática** (verde, elegido), **Siempre compacta**, **Siempre amplia**.

Dónde está en Farmacia y cómo funciona (para copiarlo exacto):

| Pieza | Archivo en Farmacia | Qué hace |
|---|---|---|
| Ajuste guardado | `src/config/salesFeatures.js` líneas 46–94 | Llave `cart_compact_mode_v1` en `localStorage`; valores `auto` / `always` / `never`; de fábrica `auto`. `resolveCartCompact(modo, pantallaBaja)` decide. `useCartCompact()` reacciona al ajuste y al alto de la pantalla |
| Pantalla de Ajustes | `src/components/Settings/tabs/ventas/VentasGeneralSection.jsx` líneas ~129–145 | Los tres botones con `aria-pressed`; al pulsar llama `setCartCompactMode(id)` |
| Dibujo compacto | `src/components/Sales/CartPanel.jsx` desde la línea ~202 (rama `if (compact && !isCashAdvance)`) | Una fila por artículo: nombre (2 líneas máximo), $ y Bs, y los botones − / cantidad / + de 28 px |
| Pantalla baja | `tailwind.config.js` línea 21 | `short: (min-width:1024px) and (max-height:800px)` |

En Bodega **no existe** nada de esto (`src/config/salesFeatures.js` no existe; `CartPanel.jsx` no tiene modo compacto). Hay que traer los 4 archivos/piezas. La parte de Ajustes de Bodega está en `SettingsTabVentas.jsx`, que además lo están tocando otras sesiones. Por eso no se tocó.

Tamaño: **mediano** (medio día). Riesgo: **bajo**, porque no toca el cobro ni el inventario. Cuidado con `CartLineAdjustChip` (descuento por artículo) y con `RxBadge`: son de Farmacia y hay que quitarlos al copiar la fila compacta.

---

## 4. Qué SÍ aplicar y qué NO

### SÍ aplicar (en este orden)

| # | Qué | Tamaño | Riesgo | Por qué |
|---|---|---|---|---|
| 1 | Hora de la tasa en el cuadro «TASA BCV» | Pequeño (1 h) | Muy bajo | Lo pidió la captura; el dato ya existe |
| 2 | Variante `short:` en Tailwind + rejilla `auto-fill minmax(160px)` en PC | Pequeño (1–2 h) | Bajo | Más productos por pantalla; ayuda en laptops 1366×768 |
| 3 | Tarjeta sin foto compacta (20 px en vez de un cuadrado) | Pequeño | Bajo | Quita el «espacio vacío». La mayoría de los productos de Bodega no tiene foto |
| 4 | Esconder chips de categoría si solo hay una; «Ayuda» como botón «?» | Pequeño | Bajo | Quita ruido («Todos» y «General» son lo mismo) |
| 5 | Aviso de «producto sin precio» al agregar | Pequeño | Bajo | Evita vender a $0.00 |
| 6 | Insignia de stock ámbar «queda poco» | Pequeño | Bajo | Se ve de un vistazo |
| 7 | Botones de bulto/unidad más altos en PC (38 px) y letras más grandes en PC | Pequeño | Bajo | Táctil y legible |
| 8 | Opción «Cesta» (Automática / compacta / amplia) | Mediano (medio día) | Bajo | Pedido directo del usuario |
| 9 | «Más vendidos» primero y «Productos frecuentes» en la cesta vacía | Mediano | Bajo | Venta más rápida. Es un archivo nuevo (`hotProducts.js`) más 2 enganches |

### NO aplicar (es de farmacia)

- Récipe, `RxBadge`, `RxCheckoutGate` (aviso «¿presentó el récipe?»).
- Ficha farmacéutica (concentración, laboratorio), buscar por principio activo, «otros nombres» (CASO-029, 046, 061).
- Blíster como tercera presentación (CASO-030).
- Fotos de insumos médicos (`public/images/catalog/medicamentos/...`).
- Lotes y vencimientos en caja (CASO-039, 048).
- Familias/variantes «¿Qué talla?» (CASO-032, 044): la bodega casi no vende ropa/tallas. Dejarlo para después y solo si lo piden.
- Descuento por artículo (CASO-055): es una decisión del dueño, aún sin publicar en Farmacia; no copiarlo sin que lo pida.

---

## 5. Rendimiento con ~2.400 productos

- **Las dos** pintan 30 tarjetas (`PAGE_SIZE = 30`) y un botón «Cargar Más (N restantes)». **No hay virtualización en ninguna.**
- Con 30 en pantalla el costo es bajo. Pero cada vez que se pulsa «Cargar Más» se suman 30 tarjetas pesadas (con imagen y sombras). Tras 6–8 pulsaciones se nota en laptops lentas.
- En Bodega, además, el filtro de búsqueda recorre los 2.400 productos en cada letra. Farmacia usa `deferredSearchTerm`; **Bodega también** (ya recibe esa propiedad), así que está bien.
- Farmacia probó 1.500 productos reales en 1366×768 (CASO-028) sin desbordes.
- **Recomendación:** no hacer virtualización ahora. Primero medir con los 2.400 de Bodega. Si hace falta, el paso barato es cambiar el botón por carga automática al llegar al final (`IntersectionObserver`), sin librerías nuevas.

## 6. Accesibilidad y táctil

- Tarjetas con `role="button"`, `tabIndex` y Enter/Espacio: ya están en las dos.
- Mínimo táctil recomendado: 44 px. Farmacia llega a 38–40 px en PC (botones de tarjeta y chips `min-h-[40px]`); Bodega queda más bajo (chips de ~28 px, botones de tarjeta ~24 px). El cobro de Farmacia midió botones de 26–34 px como «muy chicos» y los está corrigiendo (CASO-056).
- El micrófono tiene un área táctil ampliada (`p-[13px] -m-[7px]`): igual en las dos.
- Los tres botones del selector de vista miden unos 21 px (`p-1` y ícono de 13 px) en las **dos**: chicos para el dedo. Conviene subirlos a ~32 px.
- Hay texto de 8–9 px en insignias de las dos. Subir a 10 px en PC.

## 7. Barra lateral, atajos y tamaños de pantalla

- La barra lateral se colapsa a 64 px y se expande a 224 px (solo PC, `lg`). Igual en las dos. En teléfono/tablet pasa a barra inferior; el botón flotante de cesta sale con `lg:hidden`.
- Cesta lateral: 320 px / 340 px / 380 px según el ancho. Igual en las dos.
- No se usan `@container` en ninguna. Con los breakpoints actuales más `short:` alcanza.
- F9, F7, F4 y Escape funcionan igual. **Pendiente en las dos:** F4 aparece en el atajo de la barra de categorías y en la ayuda, pero `SalesView` solo muestra F9, F7 y Escape en su lista de comentarios; el manejador de F4 vive en `useSalesKeyboard.js` y existe en ambas. Sin diferencia.

## 8. Lo que Farmacia ya resolvió en Vender (historial `git log`)

Commits que tocan la caja y el buscador en Farmacia, útiles para Bodega:

- `ff04220` Tarjetas compactas, más vendidos, descuento apagado, cesta compacta (v2.1.1). **Es el commit a mirar para los puntos 2–9.**
- `3681f8c` Cobrar y recargar en el primer segundo ya no devuelve la cesta vendida.
- `52d41ed` Mensaje de tope de stock más claro («agotado / ya en la cesta / solo hay N»).
- `c579e97` La cesta refleja el inventario vigente y avisa del cambio de precio.
- `82f7323` Arreglo de capas del buscador sobre las tarjetas.
- `b9d03c7` Archivos de 600 líneas o menos: `SalesView` bajó de 1.169 a 382 líneas con `src/views/sales/*`. Bodega sigue con 1.169 líneas en `SalesView.jsx`.

Casos `CASO-NNN` de Farmacia relacionados con Vender:

| Caso | Tema | ¿Sirve a Bodega? |
|---|---|---|
| CASO-028 | Responsividad en laptop 1366×768 | **Sí** (método de medición) |
| CASO-056 | Cobro a la medida de 1366×768 y táctil | **Sí** (botones ≥ 44 px) |
| CASO-038 | Auditoría del flujo de venta (ERR-076 a 080) | **Sí, revisar**: stock que baja entre armar la cesta y cobrar (ERR-077), ventas en espera con líneas por unidad (ERR-080, solo Farmacia), venta que guarda sin bajar stock (ERR-076) |
| CASO-055 | Descuento por artículo | Después |
| CASO-035 | Récipe visible | No |
| CASO-029 / 030 / 032 / 044 / 046 | Otros nombres, blíster, familias | No |
| CASO-020 | IVA desglosado y «precios ya incluyen IVA» | Ya aplicado en Bodega (`e15eea6`) |

Otros errores del uso diario de Vender: **ERR-082** (internet débil hacía esperar ~24 s: «Verificando licencia…»). Conviene comprobar si Bodega lo tiene.

---

## 9. Qué no se pudo verificar

- No se corrió ninguna de las dos apps ni se midió en pantalla: todo viene de leer el código y las capturas del usuario.
- Cuántos de los ~2.400 productos de Bodega tienen foto: no se contó. Si casi ninguno tiene, el punto 3 es el de mayor efecto visual.
- No se probó F4 en la caja de Bodega en vivo.

---

## 10. Recomendación final

Hacerlo en **dos entregas pequeñas**, como las anteriores (inicio, barra lateral, Ajustes):

1. **Entrega A (visual de la rejilla y la barra):** puntos 1 al 7 de la tabla. Es un día de trabajo, riesgo bajo, y resuelve lo que se ve mal en las capturas (espacio vacío, pocos productos por pantalla, hora de la tasa).
2. **Entrega B (cesta y rapidez):** puntos 8 y 9: la opción «Cesta» copiada tal cual, más «Más vendidos» y «Productos frecuentes».

Antes de cualquiera: esperar a que termine la sesión de apertura de caja (toca `SettingsTabVentas.jsx` y otros archivos del mismo árbol) para no pisarse. Dejar fuera todo lo de farmacia (récipe, blíster, otros nombres, familias). Después revisar aparte CASO-038 (integridad de la venta) y ERR-082, que son más importantes que lo visual.
