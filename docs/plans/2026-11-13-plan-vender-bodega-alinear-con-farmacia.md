# Plan: alinear «Vender» de Bodega con Farmacia

Fecha: 2026-11-13
Base: [AUDITORIA-VENDER-BODEGA-VS-FARMACIA-2026-11-13.md](../auditorias/AUDITORIA-VENDER-BODEGA-VS-FARMACIA-2026-11-13.md).
Rama de trabajo: `feat/inicio-estilo-farmacia` (o una rama nueva que salga de ella).
Estado: **solo plan, nada aplicado.**

## Reglas del plan
- Un cambio pequeño por vez, con prueba y captura antes de seguir (como en inicio, barra lateral y Ajustes).
- No tocar el cobro, el inventario ni el stock. Solo pantalla y ajustes.
- No copiar nada de farmacia (récipe, blíster, otros nombres, familias, lotes, fotos de medicamentos).
- No empezar hasta que termine la sesión de apertura de caja, porque toca `SettingsTabVentas.jsx` y archivos cercanos.
- Antes de cada fase: `git status` para ver que nadie más tenga esos archivos abiertos.
- Sin commit ni push hasta que el usuario lo pida.

## Fase 0: Medir cómo está hoy (½ hora, sin código)
1. Abrir Vender de Bodega a 1366×768, a 1920×1080, en tablet (768) y en teléfono (375).
2. Anotar: cuántas tarjetas caben a la vez, alto del botón de bulto/unidad, tamaño del selector de vista, cuántos productos tienen foto de los ~2.400.
3. Guardar capturas «antes» en una carpeta junto al repositorio.
Resultado: tabla «antes» para comparar al final. Sin esto no se sabe si mejoró.

## Fase 1: Hora de la tasa (1 h) — riesgo muy bajo
- Qué: mostrar «hoy 11:17 p. m.» / «ayer…» / «12/11…» bajo el valor de TASA BCV.
- Dónde: `src/views/SalesView.jsx` (cuadro de tasa, línea ~868). Traer la función `formatRateStamp` de `PosMainSection.jsx` de Farmacia. Leer `rates.lastUpdate` de `useRates.js` (ya existe).
- Solo se muestra en tasa automática; con tasa manual sigue saliendo «MAN».
- Prueba: prueba unitaria de la función con hoy, ayer y fecha vieja; y una fecha inválida no debe mostrar nada.
- Hecho cuando: la hora aparece y no hay errores en consola.

## Fase 2: Rejilla y tarjetas (1 día) — riesgo bajo
Archivos: `tailwind.config.js`, `src/components/Sales/CategoryBar.jsx`.
1. Agregar la pantalla `short` en Tailwind: `(min-width:1024px) and (max-height:800px)`.
2. Rejilla: `grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-[repeat(auto-fill,minmax(160px,1fr))]`, separación `gap-2.5 lg:gap-3 short:gap-2`.
3. Tarjeta sin foto: en vez del cuadrado grande, un espacio de 20 px (`h-5`). Condición: `p.image || p.image_path`.
4. Letra del nombre: `lg:text-[13.5px]`. Insignias de stock `lg:text-[10.5px]`.
5. Botones de bulto/unidad: `lg:py-2 lg:min-h-[38px]`.
6. Insignia de stock ámbar «queda poco» (`isLow`, umbral de 3 unidades o el de `isLowStockProduct`).
7. Producto sin precio: borde rojo y aviso «no tiene precio, asígnalo en Inventario» al tocarlo; no se agrega.
8. Mantener «Ref» y «(en Bs)» de los productos de doble precio (es de Bodega), pero en una sola línea.
- Prueba: producto con foto, sin foto, agotado, con poco stock, sin precio, de doble precio, con bulto/unidad, granel. Medir de nuevo a 1366×768 y comparar.
- Hecho cuando: caben más tarjetas que en la medida «antes» y nada se corta.

## Fase 3: Barra de categorías y ayuda (½ día) — riesgo bajo
Archivo: `CategoryBar.jsx`.
1. Si hay una sola categoría real, esconder los chips (`showCategoryChips`). «Monto Libre» y «Vaciar cesta F4» siguen.
2. «Ayuda» pasa a botón redondo «?» con `aria-label="Ayuda y atajos de teclado"`.
3. La fila se acomoda sola (`flex-wrap`): si las acciones no caben, bajan a la línea siguiente.
4. Chips y botones con `min-h-[40px]`.
- Prueba: con 1 categoría y con varias; ancho de 1024 y 1366.

## Fase 4: Selector de vista más grande (1 h) — riesgo muy bajo
Archivo: `SearchBar.jsx`. Botones capas/lista/cuadrícula de ~21 px a ~32 px; ícono de 13 a 16 px. Mantener `onMouseDown preventDefault` (para no perder el foco del buscador).

## Fase 5: Opción «Cesta» en Ajustes, copiada tal cual (½ día) — riesgo bajo
Textos exactos de la captura de Farmacia:
- Título: **Cesta**
- Subtítulo: **Cuántos artículos caben en la lista**
- Texto: «La cesta compacta usa una sola línea por artículo. Automática: se activa sola en pantallas bajas (laptops chicas).»
- Botones: **Automática** (de fábrica) · **Siempre compacta** · **Siempre amplia**

Pasos:
1. Crear `src/config/salesFeatures.js` en Bodega con lo de Farmacia (líneas 46–94): llave `cart_compact_mode_v1`, valores `auto | always | never`, `getCartCompactMode`, `setCartCompactMode`, `resolveCartCompact`, `useCartCompact`. **No traer** el interruptor de descuento (`useDiscountEnabled`) ni nada más de ese archivo.
2. En `SettingsTabVentas.jsx`: agregar el bloque «Cesta» con los 3 botones (`aria-pressed`), igual que `VentasGeneralSection.jsx` líneas ~129–145. Mismo estilo verde del botón elegido.
3. En `CartPanel.jsx`: usar `useCartCompact()` y agregar la fila compacta (una línea: nombre de hasta 2 líneas, $ y Bs, y − / cantidad / + de 28 px). **Quitar** de la fila: `RxBadge`, `CartLineAdjustChip` y todo lo de récipe/presentación de farmacia.
4. Las filas de granel y avance de efectivo siguen con el diseño amplio.
- Prueba: cambiar entre los 3 modos y ver que la cesta cambia al instante; `auto` a 1366×768 queda compacta y a 1920×1080 amplia; el modo se recuerda al recargar; cesta en teléfono (hoja inferior) también.
- Riesgo: conflicto con la sesión de Ajustes/apertura en `SettingsTabVentas.jsx`. Por eso va después de las fases 1 a 4.

## Fase 6: Más vendidos y Productos frecuentes (½ día) — riesgo bajo
1. Crear `src/utils/hotProducts.js` (copia de Farmacia: `bumpHot`, `sortByHot`, `topHotProducts`; el contador vive solo en este equipo, `localStorage` `pos_hot_counts`).
2. `CategoryBar.jsx`: sin búsqueda, ordenar con `sortByHot`; contar con `bumpHot(p.id)` al agregar. El orden se recalcula al cambiar el filtro, no en cada venta, para que las tarjetas no salten.
3. `SalesView.jsx` y `CartPanel.jsx`: con la cesta vacía mostrar «Productos frecuentes» (hasta 6, con stock y precio), un toque agrega.
- No usa inventario ni ventas reales, solo ordena la vista. Si se borra el almacenamiento, el orden vuelve al normal.
- Prueba: sin ventas no aparece nada; después de agregar 3 productos, salen primero.

## Fase 7: Cierre y verificación (½ día)
1. Ejecutar la suite de pruebas y el linter; corregir solo lo que rompió este trabajo.
2. Repetir las mediciones de la Fase 0 y poner la tabla «antes / después».
3. Revisar tema oscuro, teléfono, tablet, 1366×768 y 1920×1080.
4. Documentar en `docs/` de Bodega (ley de documentación): un CASO nuevo con lo hecho, lo medido y lo pendiente.
5. Decidir con el usuario si se publica; sin commit hasta que lo pida.

## Fases opcionales (después, solo si se piden)
- **A. Auditoría de integridad de venta** (CASO-038 de Farmacia): ver si Bodega tiene ERR-076/077 (venta que no baja el stock o que pasa con stock que bajó) y ERR-082 (espera de ~24 s con internet débil). **Importante** para el dinero; más que lo visual.
- **B. Carga automática al final de la lista** (`IntersectionObserver`) en lugar del botón «Cargar Más», solo si con 2.400 productos se nota lento.
- **C. Partir `SalesView.jsx`** (1.169 líneas) como hizo Farmacia en `src/views/sales/*` (382 líneas). Es limpieza, no urgente.
- **D. Descuento por artículo** (CASO-055): solo si el dueño lo pide.
- **E. Botones de cobro táctiles ≥ 44 px** (CASO-056).

## Resumen de tamaño y orden

| Fase | Qué | Tamaño | Riesgo | Depende de |
|---|---|---|---|---|
| 0 | Medir «antes» | ½ h | — | — |
| 1 | Hora de la tasa | 1 h | Muy bajo | 0 |
| 2 | Rejilla y tarjetas | 1 día | Bajo | 0 |
| 3 | Categorías y ayuda | ½ día | Bajo | 2 |
| 4 | Selector de vista | 1 h | Muy bajo | — |
| 5 | Opción «Cesta» | ½ día | Bajo | sesión de apertura terminada |
| 6 | Más vendidos / frecuentes | ½ día | Bajo | 2 |
| 7 | Cierre y documentación | ½ día | — | todas |

Total aproximado: 3 a 4 días de trabajo. Se puede entregar en dos partes: **A = fases 1 a 4**, **B = fases 5 y 6**.

## Riesgos y cómo se cuidan
- **Pisar a otra sesión** en `SettingsTabVentas.jsx`/`SalesView.jsx`: revisar `git status` antes y trabajar en rama aparte.
- **Cambios que rompen la cesta o el cobro**: la fila compacta usa las mismas funciones (`updateQty`, `removeFromCart`); no se toca la lógica.
- **Sin foto = tarjeta distinta**: si un cliente prefiere el cuadrado grande, queda fácil de revertir (un solo `h-5`).
- **Copiar de más desde Farmacia**: lista «NO aplicar» del informe; revisar el diff buscando `Rx`, `recipe`, `blister`, `family`, `alias`, `lineAdjust`.
- **Táctil**: los botones nuevos deben medir al menos 40 px; verificar con medida real, no a ojo.

## Antes de empezar, el usuario decide
1. ¿Empezar por la Entrega A (fases 1 a 4) o por la «Cesta» (fase 5)?
2. ¿Se hace en una sesión aparte con su propia rama?
3. ¿Quieres que la fase opcional A (integridad de la venta) vaya antes que lo visual?

---

## Resultado de la Fase 0 (medido el 2026-11-13, tabla «ANTES»)

Cómo se midió: app de desarrollo de Bodega (rama `feat/inicio-estilo-farmacia`) en el navegador de pruebas, caja abierta con fondo 0 y **2.400 productos de prueba** cargados solo en este navegador (nombres de bodega, 1 de cada 4 con bulto/unidad, 1 de cada 9 de doble precio, 28 de 30 tarjetas sin foto). Las medidas salen de la página (`getBoundingClientRect`), no a ojo.

| Pantalla | Columnas por fila | Tarjeta (ancho × alto) | Tarjetas enteras a la vez |
|---|---|---|---|
| PC 1366×768 | 5 | 162 × 279 px | 5 (una sola fila y media) |
| PC 1920×1080 | 5 | 236 × 348 px | 10 |
| Tablet 768×1024 | 5 | 143 × 260 px | todas las 30 con desplazamiento de página |
| Teléfono 375×812 | 3 | 115 × 219 px | todas las 30 con desplazamiento de página |

Otras medidas a 1366×768:
- Zona de la rejilla: 850 × 561 px.
- Botones de bulto y unidad dentro de la tarjeta: 136 × 24 y 136 × 26 px (bajo el mínimo táctil de 44; Farmacia llega a 38).
- Botones del selector de vista (capas, lista, cuadrícula): 21 × 21 px.
- Chips «Monto Libre» y «Todos»: 118 × 40 y 98 × 40 px. **Corrección al informe:** ya miden 40 px, no ~28.
- «Todos» dice 2400: sale el número de productos pero no se esconde (Farmacia lo esconde si hay una sola categoría real).
- Ningún desbordamiento horizontal en 768 ni en 375.
- En PC la rejilla se queda en 5 columnas aunque la pantalla crezca: a 1920 las tarjetas se ponen enormes (236 × 348) en vez de caber más.
- El problema visual de las capturas se reproduce: la tarjeta sin foto reserva el cuadrado de la imagen con un ícono de categoría gris y queda mucho espacio vacío arriba.

Con estas cifras, la meta de la Fase 2 es: a 1366×768 que quepan más de 5 tarjetas enteras (la tarjeta sin foto más baja) y que a 1920 salgan 7 o más por fila.

Datos de prueba: viven solo en el IndexedDB de este navegador de desarrollo (clave `bodega_products_v1`); no tocan Supabase. Se pueden borrar con «Borrar datos del sitio» para `localhost:5174`.

## Resultado de la Fase 2 (medido el 2026-11-13, «DESPUÉS»)

Cambios: `tailwind.config.js` (pantalla `short`) y `src/components/Sales/CategoryBar.jsx` (rejilla `auto-fill minmax(150px,1fr)`, tarjeta sin foto de 20 px, insignia de stock ámbar, aviso de «sin precio», botones de bulto/unidad de 38 px en PC, letra del nombre 13,5 px en PC). Se usó 150 px de mínimo y no 160 como Farmacia, porque con 160 a 1366×768 salían 4 columnas (la zona mide 850 px) y se quería 5.

| Medida | Antes | Después |
|---|---|---|
| 1366×768, columnas | 5 | 5 |
| 1366×768, alto de fila sin foto | 279 px | 193 px |
| 1366×768, tarjetas enteras a la vez | 5 | 10 |
| 1920×1080, columnas | 5 | 7 |
| 1920×1080, tarjetas enteras a la vez | 10 | 21 |
| Botones bulto/unidad en PC | 24–26 px | 38 px |

Nota: una fila que tenga aunque sea un producto con foto sigue siendo alta (~300 px), porque la foto es un cuadrado. Es igual en Farmacia.

## Resultado de la Fase 3 (2026-11-13)

Cambio en `src/components/Sales/CategoryBar.jsx`:
- Si solo hay una categoría real (lo normal en Bodega: todo en «General»), se esconden los chips «Todos» y «General», que mostraban lo mismo. También se esconden la rayita separadora y «Ver todas».
- «AYUDA (?)» pasa a ser un botón redondo con «?» de 36 × 36 px (Farmacia usa 28; aquí se hizo más grande para el dedo), con nombre accesible «Ayuda y atajos de teclado».
- Las dos filas (botones y categorías, y acciones) son ahora una sola fila que se acomoda sola: si las acciones caben, van a la derecha en la misma línea; si no, bajan a la línea siguiente, alineadas a la derecha.
- «Vaciar cesta F4» se queda en la barra (en Farmacia se mudó al encabezado de la cesta en PC; en Bodega la cesta no tiene ese botón).

Medido:
- 1366×768 con una sola categoría: todo en una fila; la zona de la rejilla pasó de 561 a 596 px de alto (+35 px).
- 1024×768: las acciones bajan a la segunda línea, alineadas a la derecha; sin desbordes horizontales.
- No probado en pantalla: el caso con varias categorías (los datos de prueba solo tienen «General»). La lógica es la misma que en Farmacia.

## Resultado de la Fase 4 (2026-11-13)

Cambio en `src/components/Sales/SearchBar.jsx`:
- Botones de vista (híbrida, lista, cuadrícula): de 21 × 21 px a **31 × 31 px en PC** y **27 × 27 px en teléfono**; íconos de 13 a 15 px.
- Cada botón tiene nombre para lectores de pantalla («Vista híbrida», «Vista lista», «Vista cuadrícula») y dice cuál está elegido (`aria-pressed`).
- Relleno derecho del buscador subido (166 px en teléfono, 182 px desde `sm`) para que el texto no quede debajo de los botones, también cuando aparece la «X» de borrar.

Medido con texto escrito (con la «X» visible): el texto termina 1 px antes de los botones en 1366×768 y en 375×812. Espacio visible para escribir: 474 px en PC y 129 px en teléfono (unas 16 letras). Sin desbordes horizontales.
Nota: Farmacia sigue con los botones de 21 px; esta mejora es solo de Bodega.

## Ajuste a la Fase 2: fichas uniformes medianas (2026-11-13)

Motivo: con datos reales (fichas con foto, sin foto y con foto rota mezcladas) la rejilla se veía apretada y dispareja: las fichas sin foto se estiraban a la altura de las que tienen foto y quedaba un hueco blanco entre nombre y precio. El usuario preguntó si no se veían mejor las fichas grandes.

Cambio (`CategoryBar.jsx` + `src/utils/productInitials.js` nuevo, con prueba `tests/productInitials.test.js`):
- Todas las fichas tienen el mismo recuadro de imagen de 76 px de alto (64 px en laptops bajas). La foto va dentro, completa.
- Sin foto, o si la foto no carga, el recuadro muestra las iniciales del producto («MK», «SB») en gris suave, en vez del hueco o del ícono de caja.
- Mínimo de 170 px por ficha (más aire que los 150 px anteriores).

Medido con los productos de prueba:
| Pantalla | Fichas grandes (antes de todo) | Compactas (primer intento) | Uniformes medianas (ahora) |
|---|---|---|---|
| 1366×768 columnas | 5 | 5 | 4 |
| 1366×768 enteras a la vez | 5 | 10 (pero disparejas) | 8 |
| 1920×1080 columnas | 5 | 7 | 6 |
| 1920×1080 enteras a la vez | 10 | 21 | 18 |
Todas las filas miden lo mismo (~275 px con productos de bulto/unidad en la fila; menos en filas sin bulto/unidad).

## Resultado de la Fase 5 (2026-11-14)

- `src/config/salesFeatures.js` (nuevo): solo la parte de la cesta compacta de Farmacia (llave `cart_compact_mode_v1`, modos `auto` / `always` / `never`, de fábrica `auto` = compacta si la pantalla mide 800 px de alto o menos). No se trajo el interruptor de descuento.
- `SettingsTabVentas.jsx`: bloque «Cesta» en Ajustes → Ventas → Terminal, con los mismos textos y botones que Farmacia (Automática / Siempre compacta / Siempre amplia).
- `CartPanel.jsx`: fila compacta de Farmacia (una línea por artículo, − cantidad + de 28 px), sin la etiqueta de récipe ni el ajuste de precio por artículo. El avance de efectivo sigue con la fila amplia.
- Pedido del usuario: **«Vaciar» pasa al encabezado verde de la cesta en PC**, como Farmacia. En teléfono y tablet sigue en la barra de arriba (y en la hoja de la cesta).
- Prueba nueva: `tests/salesFeaturesCartCompact.test.js`.

Verificado en el navegador a 1366×768: «Automática» elegida de fábrica y la cesta sale compacta (pantalla de 768 de alto); con «Siempre amplia» la cesta vuelve al diseño amplio; el botón «Vaciar» está en el encabezado y el de la barra se esconde en PC.

## Nombres completos (pedido del usuario, 2026-11-14)
«Los nombres de los productos no se deben cortar.» Se quitó el corte («…») del nombre en: fichas de la rejilla (`CategoryBar.jsx`), desplegable del buscador (`SearchBar.jsx`), cesta amplia y cesta compacta (`CartPanel.jsx`). El nombre usa las líneas que necesite; las filas de la rejilla siguen parejas porque la rejilla iguala el alto de cada fila.

## Resultado de la Fase 6 (2026-11-14)
- `src/utils/hotProducts.js` (nuevo, copia de Farmacia) + `tests/hotProducts.test.js`: contador local «pos_hot_counts» que suma 1 cada vez que se agrega un producto desde la rejilla. No toca inventario ni ventas.
- `CategoryBar.jsx`: sin búsqueda, la rejilla muestra primero los más agregados. Se reordena al cambiar de filtro o recargar, no en cada toque, para que las fichas no salten mientras se cobra.
- `CartPanel.jsx` + `SalesView.jsx`: con la cesta vacía (PC) sale «Productos frecuentes» (hasta 6, con stock y precio); un toque los agrega.
- Verificado en el navegador: tras agregar «Aceite Vatel» y vaciar la cesta (confirmación «¿Vaciar toda la cesta?» desde el botón del encabezado), aparece en «Productos frecuentes». El botón «Vaciar» del encabezado se esconde cuando la cesta está vacía.
- Pruebas: 33 pasan en 7 archivos; ESLint sin errores.

Con esto quedan aplicadas las fases 1 a 6. Falta la Fase 7 (pruebas completas, medidas finales, revisión en tema oscuro/teléfono/tablet y documentación con un CASO nuevo).

## Modos del buscador: solo dos, con nombres claros (pedido del usuario, 2026-11-14)
- Se quitó el modo «Lista». Quedan:
  - **Teclado y escáner** (antes «Híbrido»; ícono de teclado): al escribir sale la lista rápida y debajo siguen las fichas.
  - **Pantalla táctil** (antes «Galería»; ícono de mano): solo fichas, sin lista desplegable.
- Si una caja tenía guardado «Lista», abre en «Teclado y escáner». Igual en el Supervisor › Vender (`RemoteSalePanel.jsx`).
- El buscador ganó espacio para escribir (155 px en teléfono, ~520 px en PC) al haber un botón menos.
- Archivos: `SearchBar.jsx`, `SalesView.jsx`, `RemoteSalePanel.jsx`, `tests/posSearchViewModes.test.jsx`.

## Cesta siempre compacta en teléfono (pedido del usuario, 2026-11-14)
- En teléfono y tablet (menos de 1024 px de ancho) la cesta es **siempre compacta**, aunque en Ajustes esté «Siempre amplia». El ajuste «Cesta» solo cambia la cesta de PC; el texto del bloque lo dice: «En teléfono y tablet la cesta siempre es compacta.»
- `salesFeatures.js` (`MOBILE_SCREEN_QUERY`, `resolveCartCompact(modo, pantallaBaja, esTelefono)`), `SettingsTabVentas.jsx` (texto) y prueba nueva en `tests/salesFeaturesCartCompact.test.js`.
- Verificado a 375×812 con «Siempre amplia» guardado: la cesta sale compacta.
- Esto se aparta de Farmacia (allá el teléfono sigue el ajuste).

## Precio por unidad en la cesta compacta (pedido del usuario, 2026-11-14)
Con 2 o más unidades (o en granel) la fila compacta ahora dice, en la misma línea: precio por unidad en gris, el total en verde y el total en Bs. Ejemplo: «$0.75 c/u · $1.50 · 1.371,03 Bs». En granel: «$2.00 /kg · …». Antes solo se veía el total y el precio por unidad quedaba escondido en el globo de ayuda. Archivo: `CartPanel.jsx`. Verificado en el navegador a 1366×768: cabe en una línea.

## Resultado de la Fase 7 (2026-11-14) — cierre
- Batería completa: 2.241 de 2.244 pasan (16 omitidas). Fallan las mismas 3 de licencias que ya fallaban antes de este trabajo.
- ESLint sin errores en los archivos tocados; `docs:check` al día.
- Documentado en el repo: `docs/casos/CASO-003-vender-estilo-farmacia.md`, ERR-007 (resuelto) y ERR-008 (descartado: no se usará tema oscuro) en `docs/ERRORES.md`, P-007 (descartado) y P-008 en `PENDIENTES.md`, entrada en `bitacora.md`.
- Pendiente: probar con varias categorías y fotos reales (P-008) y guardar (commit) cuando el dueño lo pida.
