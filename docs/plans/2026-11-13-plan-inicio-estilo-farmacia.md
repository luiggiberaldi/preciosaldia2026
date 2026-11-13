# Plan: inicio y navegación de Bodega al estilo Farmacia

**Fecha:** 13-nov-2026 · **Rama:** `feat/inicio-estilo-farmacia` (desde `main` e15eea6)
**Origen:** `preciosaldia-farmacia`, rama `pruebas` (Farmacia salió de Bodega el 29-oct-2026).
**Regla:** se traen los detalles uno por uno, con los colores y las pestañas de Bodega. No se copia nada propio de Farmacia (lotes, récipe, verde clínico, «Gestión»).

## Inventario de detalles

### Lote 1 — Barra lateral y pantalla completa (este PR)
| # | Detalle | Archivo de Farmacia | Estado |
|---|---|---|---|
| 1 | Barra lateral fija a la izquierda, solo en PC (≥1024 px) | `src/app/shared.jsx` → `SideNav` | ✅ |
| 2 | Ícono «D» + «Precios Al Día» + subtítulo «BODEGA» arriba de la barra (el `pwa-splash-transparent-512.png` de Bodega viene en blanco; se usa `apple-touch-icon.png`) | `SideNav` | ✅ |
| 3 | Pestañas con ícono, marcada la activa | `SideNav` | ✅ |
| 4 | Contador rojo del carrito en «Vender» | `SideNav` | ✅ |
| 5 | Atajos `Alt+1…Alt+6` con su etiqueta `Alt+N` en cada pestaña | `SideNav` | ✅ |
| 6 | Tarjeta del usuario (iniciales, nombre, rol) con botón «Cerrar sesión» | `SideNav` | ✅ |
| 7 | Botón **Pantalla completa** / «Salir de pantalla»; avisa «Pulsa F11» si se entró con F11; se oculta si el equipo no lo permite | `FullscreenButton.jsx`, `useFullscreen.js` | ✅ |
| 8 | Botón **Plegar** / expandir; con la barra plegada, cada ícono muestra su nombre al pasar el ratón | `SideNav` | ✅ |
| 9 | La barra recuerda si quedó plegada; sin preferencia, arranca plegada en pantallas < 1280 px | `App.jsx` | ✅ |
| 10 | En Vender, con pantallas < 1440 px (1366×768), la barra se recoge sola para dar espacio a los productos | `App.jsx` | ✅ |
| 11 | El contenido se centra en el espacio que deja la barra (máximo 1400 px) | `AppMainLayout.jsx` | ✅ |
| 12 | Barra inferior solo en teléfono y tablet; ocupa todo el ancho, pegada abajo | `BottomNav` | ✅ |
| 13 | Arreglo: la barra inferior llamaba un *hook* después de un `return` (error #310 de React al abrir el teclado) | `BottomNav` | ✅ |
| 14 | Descarga anticipada de Vender e Inventario para que el primer toque no espere | `usePrefetchMainViews` | ✅ |

### Lote 2 — Encabezado del inicio (este PR)
| # | Detalle | Estado |
|---|---|---|
| 15 | Hora en letra monoespaciada y fecha debajo | ✅ |
| 16 | Chip **BCV** con punto verde que late; al tocarlo abre el Monitor de tasas (reemplaza el botón «Monitor») | ✅ |
| 17 | Tasa COP en el mismo chip cuando está activada | ✅ |
| 18 | Logo al centro, más compacto y sin el lema «Actualizado donde vayas» (se recorta); en el teléfono va el ícono «D» porque el logo ancho no cabe | ✅ |
| 19 | Botón **Vender** con etiqueta `F1`, y la tecla F1 abre Vender desde el inicio | ✅ |
| 20 | Estado de conexión (Online) | ✅ |
| 21 | Iniciales del usuario; nombre y rol en pantallas muy anchas; «Salir» solo en teléfono y tablet (en PC está en la barra) | ✅ |
| 22 | Se quitan los 4 botones grandes (Vender, Inventario, Clientes, Monitor): ya están en la barra | ✅ |
| 23 | Versión de teléfono en una sola fila: logo, chip BCV, Vender, conexión, salir | ✅ |
| 24 | Línea inferior del encabezado en color de la marca, más marcada al bajar | ✅ |

### Lote 3 — Pantallas por rol (este PR)
| # | Detalle | Estado |
|---|---|---|
| 25 | «Portero» único: el cajero nunca abre Reportes ni Ajustes, venga de la barra, la paleta `Ctrl+K`, un aviso o un enlace | ✅ |
| 26 | La paleta `Ctrl+K` no le muestra al cajero las pantallas que no puede abrir | ✅ |
| 27 | Al cambiar de usuario se cierran las pantallas que dejó abiertas el anterior | ✅ |

### Fuera de este PR (cada uno es una función con sistema propio)
| # | Detalle | Por qué aparte |
|---|---|---|
| 28 | Campana de avisos | Necesita el historial de avisos y las notificaciones push de Farmacia (`useNotificationHistory`, `pushNotifications`). |
| 29 | Logo propio del negocio (el de «Casa Médica») | Necesita `brandLogo.js` y su pantalla en Ajustes. |
| 30 | Pagos fijos con contador en la barra | Función de Farmacia que Bodega no tiene. |

## Verificación (13-nov-2026)
- Navegador a 1600×900: barra abierta y plegada, `Alt+2` abre Vender, F1 abre Vender desde el inicio, botón de pantalla completa presente, barra inferior oculta.
- 1366×768: en Vender la barra se recoge sola (64 px) y en Inicio vuelve a abrirse (224 px).
- Teléfono 375: encabezado en una fila sin desbordar y barra inferior a todo el ancho.
- Cajero: la barra y `Ctrl+K` no muestran Reportes ni Ajustes; `Alt+4` no lo lleva a ninguna pantalla prohibida.
- `tests/roleTabs.test.js` (4 pruebas) en verde; lint sin errores; typecheck y build bien.
- Suite completa: 3 fallas que no vienen de este cambio: `licenseMonitoringMissing.test.js` (archivo sin seguimiento del trabajo del 6-nov que quedó guardado aparte), `licensePolicy.test.js` (compara con la carpeta vecina `bodega-licensepolicy-farmacia`) y `receivablesDeterministic.test.js` (pasa sola; falla por tiempo con toda la suite).

## Cómo se prueba
- `bun run lint`, `bun run typecheck`, `bun run test`, `bun run build`.
- En el navegador: PC 1920×1080, 1366×768 (barra recogida en Vender), tablet 768 y teléfono 375.
- Pantalla completa: entrar y salir con el botón y con Esc.
- Cajero: no ve Reportes ni Ajustes en la barra ni en `Ctrl+K`.
