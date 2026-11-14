# CASO-003 — Vender estilo Farmacia: fichas, buscador, cesta compacta y más vendidos

**Fecha:** 2026-11-14
**Estado:** Aplicado (sin commit)

## Qué pidió el dueño
Auditar la zona de Vender de Precios al Día Farmacia y traer a Bodega lo que sirve, fase a fase, preguntando en el proceso. Informe y plan: [AUDITORIA-VENDER-BODEGA-VS-FARMACIA-2026-11-13.md](../auditorias/AUDITORIA-VENDER-BODEGA-VS-FARMACIA-2026-11-13.md) y [2026-11-13-plan-vender-bodega-alinear-con-farmacia.md](../plans/2026-11-13-plan-vender-bodega-alinear-con-farmacia.md) (este último tiene todas las medidas antes y después).

Durante el trabajo el dueño pidió además:
- «Se ve todo muy apretado» → fichas uniformes medianas (en vez de las compactas del primer intento).
- Copiar tal cual la opción «Cesta» de Ajustes → Ventas de Farmacia.
- «Vaciar cesta» en el encabezado de la cesta, como Farmacia.
- «Los nombres de los productos no se deben cortar.»
- Dejar solo dos modos del buscador, con nombres claros: «Teclado y escáner» y «Pantalla táctil».
- «En móvil debe ser siempre la cesta compacta.»
- Que la cesta compacta muestre el precio por unidad cuando se lleva más de uno, sin dejar de verse profesional.

## Qué se hizo

| Fase | Qué cambia para el cajero | Archivos |
|---|---|---|
| 1 | El cuadro «TASA BCV» dice a qué hora se actualizó («hoy 11:32 p. m.») | `src/utils/rateStamp.js` (nuevo), `src/views/SalesView.jsx` |
| 2 | Fichas uniformes: todas con un recuadro de imagen del mismo alto; sin foto o con foto rota salen las iniciales («MK»). En PC caben las que entren (mín. 170 px). Insignia ámbar de «queda poco». Un producto sin precio avisa y no se agrega a $0. Botones de bulto/unidad de 38 px en PC. Nombre completo, sin «…» | `tailwind.config.js` (pantalla `short` = PC de ≤ 800 px de alto), `src/components/Sales/CategoryBar.jsx`, `src/utils/productInitials.js` (nuevo) |
| 3 | Con una sola categoría (lo normal: todo en «General») se esconden «Todos» y «General», que mostraban lo mismo. Ayuda = botón «?». Botones y acciones en una sola fila que se acomoda sola | `CategoryBar.jsx` |
| 4 | Buscador: solo dos modos, «Teclado y escáner» (ícono teclado) y «Pantalla táctil» (ícono mano), botones de 31 px en PC. Quien tenía «Lista» guardado abre en «Teclado y escáner» (también en Supervisor › Vender) | `src/components/Sales/SearchBar.jsx`, `SalesView.jsx`, `src/components/Monitor/RemoteSalePanel.jsx` |
| 5 | Ajustes → Ventas → «Cesta»: Automática / Siempre compacta / Siempre amplia (textos iguales a Farmacia). Cesta compacta = una línea por artículo. En teléfono y tablet siempre compacta. Con 2 o más (o granel) la fila compacta muestra el precio por unidad en gris («$0.75 c/u · $1.50 · 1.371,03 Bs»). «Vaciar» en el encabezado verde de la cesta (PC) | `src/config/salesFeatures.js` (nuevo), `src/components/Settings/tabs/SettingsTabVentas.jsx`, `src/components/Sales/CartPanel.jsx`, `CategoryBar.jsx` |
| 6 | La rejilla muestra primero lo que más se agrega en esta caja; con la cesta vacía salen «Productos frecuentes» (hasta 6) | `src/utils/hotProducts.js` (nuevo), `CategoryBar.jsx`, `CartPanel.jsx`, `SalesView.jsx` |

Medidas principales (1366×768, 2.400 productos de prueba): fichas enteras a la vez de 5 a 8; a 1920×1080, de 10 a 18. Detalle en el plan.

## Qué no cambió
- El cobro, el stock, los totales, el IVA y la forma de guardar la venta: no se tocaron.
- No se trajo nada propio de farmacia: récipe, blíster, otros nombres, familias/variantes, lotes, descuento por artículo ni el interruptor de descuento.
- «Más vendidos» es un contador local de la caja (`pos_hot_counts`); no toca inventario ni ventas.

## Diferencias con Farmacia (decididas aquí)
- Mínimo de ficha 170 px (Farmacia 160) y recuadro de imagen fijo con iniciales (Farmacia: ficha sin foto compacta).
- En teléfono la cesta es siempre compacta (en Farmacia sigue el ajuste).
- Buscador con 2 modos (Farmacia tiene 3) y botones más grandes.
- Botón de ayuda de 36 px (Farmacia 28).

## Pruebas
- Nuevas: `tests/rateStamp.test.js`, `tests/productInitials.test.js`, `tests/salesFeaturesCartCompact.test.js`, `tests/hotProducts.test.js`. Ajustada: `tests/posSearchViewModes.test.jsx` (2 modos).
- Archivos de Vender y Ajustes: 39 de 39 pasan; ESLint sin errores (solo avisos que ya existían).
- Batería completa (2026-11-14): 2.241 de 2.244 pasan (16 omitidas); fallan las mismas 3 de licencias que ya fallaban antes (`licenseMonitoringMissing` ×2, `licensePolicy` ×1), ajenas a este caso.
- En el navegador (1366×768, 1920×1080, 1024×768, 768, 375): rejilla, buscador con «X» visible, cesta compacta automática y «Siempre amplia», bloque «Cesta» en Ajustes, «Vaciar» del encabezado con su confirmación, productos frecuentes, sin desbordes horizontales.
- No verificado en pantalla: el caso con varias categorías (los datos de prueba solo tienen «General») y las fichas con fotos reales (en los datos de prueba las fotos fallan y salen iniciales).

## Errores
- [ERR-007](../ERRORES.md): un producto sin precio se agregaba a la cesta a $0.00 sin aviso. Resuelto.
- [ERR-008](../ERRORES.md): en tema oscuro, precios de las fichas y total de la cesta casi invisibles. Ya existía antes de este caso. **Descartado:** el dueño decidió que el sistema no usará tema oscuro ([P-007](../../PENDIENTES.md)).
