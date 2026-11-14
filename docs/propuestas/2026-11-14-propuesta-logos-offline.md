# Propuesta: logos que se vean bien sin internet — Precios al Día Bodega

Fecha: 14-11-2026 · Rama revisada: `feat/inicio-estilo-farmacia` · **No se cambió código.**
Capturas: carpeta `C:\Users\luigg\Desktop\PROPUESTA-LOGOS-OFFLINE-BODEGA-capturas` (fuera del repo). Plan que salió de esta propuesta: [2026-11-14-plan-logos-offline.md](../plans/2026-11-14-plan-logos-offline.md).

---

## 1. En pocas palabras

- **Qué pasa:** cuando la app abre sin internet, el **logo grande «Precios Al Día»** del inicio sale como imagen rota (se ve el texto «Precios Al Día» con un iconito roto). También sale roto el **avatar del asistente** (el botón redondo de abajo a la derecha). Y en los **tickets y PDF de cierre** el logo desaparece sin avisar.
- **Por qué:** la app guarda una "copia para usar sin internet" (el *precache* del service worker) solo de los archivos que están en una lista. En Bodega esa lista **no incluye** `logo.png`, `logodark.png` ni `bot-avatar.png`. Sin internet el navegador no tiene de dónde sacarlos.
- **Farmacia ya lo resolvió:** en su `vite.config.js` agregó esos tres archivos a la lista con el comentario *"Logos de fábrica y avatar del asistente: sin esto no se ven sin internet."* Bodega nunca recibió ese cambio.
- **Arreglo principal:** agregar 3 nombres de archivo a la lista (≈ 44 KB más de descarga, una sola vez). Lo probé sobre una copia del build y **los logos se ven bien sin internet** (captura 6).

## 2. Cómo lo reproduje

1. Hice el build de producción en una carpeta temporal (`C:\tmp\logos-offline`, fuera del proyecto) y lo serví con `vite preview` (el service worker no funciona con `vite dev`).
2. Con Playwright (Chrome) abrí la app con los datos de prueba de las pruebas e2e, esperé a que el service worker tomara control y recargué.
3. Corté la red (`setOffline`) y recargué otra vez.
4. Revisé cada imagen de la pantalla (si cargó o no) y el contenido de la caché del navegador.

| Imagen | Con internet | Sin internet |
|---|---|---|
| `apple-touch-icon.png` (ícono «D» en barra lateral y celular) | ✅ | ✅ (está en la lista) |
| `logo.png` (logo ancho del inicio, tema claro) | ✅ | ❌ **roto** |
| `bot-avatar.png` (botón del asistente) | ✅ | ❌ **roto** |

Capturas:
- `1-inicio-con-internet.png` — todo bien.
- `2-inicio-sin-internet.png` y `3-encabezado-sin-internet.png` — logo roto en el centro del encabezado y avatar roto abajo a la derecha.
- `4/5/6-despues-...` — misma prueba, pero con los 3 archivos añadidos a mano a la lista de la copia temporal: **todo se ve bien sin internet**.

El build actual guarda 45 archivos (≈ 3,8 MB). En la lista de imágenes guardadas aparecen solo: `apple-touch-icon.png`, `favicon.ico`, `pwa-144/192/512`, `pwa-maskable-192/512`, `pwa-splash-transparent-512`, `transparent-splash-icon`.

## 3. Inventario de logos e imágenes

| # | Imagen | Dónde se ve | ¿Funciona sin internet hoy? | Motivo |
|---|---|---|---|---|
| 1 | `apple-touch-icon.png` | Barra lateral (`SideNav.jsx`), encabezado en celular y en pantallas medianas (`DashboardSummary.jsx`) | ✅ Sí | Está en `includeAssets` |
| 2 | `pwa-*.png`, `favicon.ico`, splash | Ícono de la app instalada, pestaña, pantalla de arranque | ✅ Sí | En `includeAssets` y manifiesto |
| 3 | `logo.png` (13 KB) | Logo ancho del inicio en tema claro (`DashboardView.jsx:520`), **pantalla de bloqueo** (`LockScreen.jsx`), **bienvenida** (`OnboardingOverlay.jsx`), **Monitor de tasas** (`MonitorView.jsx`), **ticket PDF** (`ticketGenerator.js`), **cierre del día PDF** (`dailyCloseGenerator.js`), ticket/cierre HTML (`ticketHtmlTemplate.js`, `dailyCloseHtmlTemplate.js`), PDF de auditoría (`AuditLogViewer.jsx`) | ❌ **No** | No está en la lista del precache y no hay regla de caché para imágenes propias |
| 4 | `logodark.png` (10 KB) | Logo ancho del inicio en tema oscuro | ❌ **No** | Igual que el anterior |
| 5 | `bot-avatar.png` (21 KB) | Asistente IA (`AIAssistantWidget.jsx`, 4 lugares) | ❌ **No** | Igual que el anterior |
| 6 | `/pwa-192x192.png` | Monitor del dueño (`OwnerMonitorView.jsx`) | ✅ Sí | Está en la lista. Usa ruta con `/` al inicio (en Electron puede fallar, pero no por falta de internet) |
| 7 | Logos de métodos de pago (Pago Móvil, Punto, Biopago, Zelle, Binance, Cashea…) | Cobro, Ajustes › Ventas, reportes | ✅ Sí | No son imágenes: son íconos dibujados (lucide), emojis y un SVG (`CasheaIcon.jsx`) dentro del código |
| 8 | Logos de bancos | — | — | Bodega no usa imágenes de bancos |
| 9 | **Logo propio del negocio** | — | — | **Bodega todavía no tiene esta función.** Farmacia sí (`src/utils/brandLogo.js`: se sube en Ajustes › Negocio y se guarda en el propio equipo como dataURL, por eso funciona sin internet) |
| 10 | Catálogo base `public/images/catalog/*` (≈ 600 fotos, 42 MB) | Fotos de productos | ⚠️ Solo las que ya se vieron con internet | Regla de caché "CacheFirst" (`catalog-images-cache`, 700 fotos, 1 año). Es a propósito: precargar 42 MB sería muy pesado |
| 11 | Fotos de productos subidas a Supabase Storage | Inventario / Vender | ⚠️ Solo las que ya se vieron con internet | Regla `product-images-cache` (1200 fotos, 90 días). `SmartImage.jsx` ya muestra un respaldo si falla |
| 12 | Código QR de pago (`api.qrserver.com`) | Billetera › Compartir QR (`WalletView.jsx:428`) | ❌ **No** | Se pide a una página externa. La app ya tiene la librería `qrcode` instalada y podría generarlo sin internet |
| 13 | Letras (Google Fonts: Outfit, Work Sans, etc.) | Toda la app, incluido el texto «Precios Al Día» de la barra lateral | ⚠️ Solo si ya se abrió una vez con internet | Se bajan de Google. Farmacia las tiene **dentro de la app** (`@fontsource`), Bodega no. Además la regla de Bodega guarda máximo 10 archivos de letras y la app usa más; algunas pueden borrarse y cambiar de aspecto sin internet |

## 4. Comparación con Farmacia

| Punto | Bodega | Farmacia |
|---|---|---|
| `logo.png`, `logodark.png`, `bot-avatar.png` en `includeAssets` | ❌ No | ✅ Sí |
| Letras dentro de la app (`@fontsource` + `globPatterns` con `woff2`) | ❌ No (Google Fonts) | ✅ Sí |
| Logo propio del negocio (`brandLogo.js`, guardado en el equipo, en respaldos) | ❌ No existe | ✅ Sí |
| Reglas de caché de catálogo y Storage | ✅ Iguales | ✅ Iguales |

## 5. Propuesta (en orden)

### Paso 1 — Guardar los logos de fábrica para usar sin internet (lo urgente)
- En `vite.config.js`, agregar a `includeAssets`: `logo.png`, `logodark.png`, `bot-avatar.png` (copiar el comentario de Farmacia).
- Peso extra: **≈ 44 KB**, una sola vez. Riesgo: muy bajo. Arregla inicio, pantalla de bloqueo, bienvenida, Monitor de tasas, tickets y PDF de cierre.
- Ya probado sobre la copia temporal: funciona.

### Paso 2 — Que nunca se vea una imagen rota (respaldo visual)
- Logo ancho del inicio (`BrandLogo` en `DashboardSummary.jsx`): si la imagen falla (`onError`), mostrar el ícono «D» (`apple-touch-icon.png`, que sí está guardado) o el texto «Precios Al Día» con las letras de la app.
- Avatar del asistente: si falla, mostrar un ícono dibujado (por ejemplo `Bot` de lucide).
- Pantalla de bloqueo / bienvenida / Monitor: lo mismo, ocultar o cambiar por el ícono «D».
- Tickets y PDF ya ocultan el logo si falla; con el Paso 1 dejará de fallar.

### Paso 3 — Prueba automática para que no vuelva a pasar
- Nueva prueba Playwright (por ejemplo `tests/e2e/logos-offline.e2e.spec.js`) que corra contra el **build** (`vite preview`), espere al service worker, corte la red, recargue y verifique que **todas las imágenes visibles cargaron** (`naturalWidth > 0`). Es lo mismo que hice a mano para este informe.
- Una prueba rápida (Vitest) que lea la configuración PWA y verifique que cada imagen usada como `src="./algo.png"` en `src/` esté en `includeAssets`. Así, si alguien agrega otro logo y lo olvida, la prueba falla.
- Nota: las pruebas e2e actuales usan `vite dev`; esta necesita su propio arranque con build + preview (≈ 1–2 minutos más).

### Paso 4 — Letras dentro de la app (recomendado, como Farmacia)
- Pasar de Google Fonts a `@fontsource` y agregar `woff2` a `globPatterns`, como Farmacia.
- Peso extra: depende de cuántas letras se dejen; conviene quitar las que no se usan (la app pide 6 familias). Estimado 150–400 KB.
- Beneficio: la app se ve igual aunque nunca se haya abierto con internet en ese equipo.

### Paso 5 — Código QR de la Billetera sin internet
- Generar el QR con la librería `qrcode` que ya está instalada, en lugar de pedirlo a `api.qrserver.com`. Peso: nada nuevo.

### Paso 6 (opcional, función nueva) — Logo propio del negocio
- Traer de Farmacia `brandLogo.js` + la opción en Ajustes › Negocio. El logo se guarda **en el propio equipo** (dataURL, máx. ~300 KB) y entra en los respaldos, así funciona sin internet desde el primer momento.
- Es una función nueva (no un arreglo); ya estaba anotada como pendiente en `DashboardSummary.jsx` y en el plan del inicio estilo Farmacia.

## 6. Riesgos y cuidados

- **Actualización del service worker:** Bodega usa `registerType: 'prompt'` (no recarga sola en medio de una venta). Los equipos que ya tienen la app instalada recibirán los logos **cuando acepten la actualización**. Hasta entonces el problema sigue en esos equipos.
- **Peso del precache:** hoy ≈ 3,8 MB. Pasos 1 + 4 suman menos de 0,5 MB. No se recomienda precargar el catálogo (42 MB): se queda con su regla actual.
- **Primera vez sin internet:** si un equipo nunca abrió la versión nueva con internet, no tendrá nada guardado. Eso no tiene arreglo técnico; solo se evita abriendo la app una vez con internet después de actualizar.
- **Electron:** usa rutas locales, no depende del service worker. `AuditLogViewer.jsx` y `OwnerMonitorView.jsx` usan rutas con `/` al inicio (`/logo.png`, `/pwa-192x192.png`) que en Electron podrían no encontrarse; conviene pasarlas a `./` en el mismo cambio.

## 7. Decisiones que necesita el dueño

1. **¿Arreglo mínimo (Pasos 1–3) o completo como Farmacia (Pasos 1–5)?** Recomendado: 1–3 ya, 4–5 en el mismo bloque si no apura.
2. **Respaldo visual del logo ancho cuando falle:** ¿mostrar el ícono «D» o el texto «Precios Al Día»? Recomendado: ícono «D» (es igual a lo que ya se ve en el celular).
3. **¿Traer ahora el "logo propio del negocio" de Farmacia (Paso 6)** o dejarlo para después? Es una función nueva.

## 8. Otra cosa vista de paso (no es de logos)

- En la prueba sin internet la etiqueta del encabezado siguió diciendo **«Online»** (verde). Puede ser efecto de cómo la prueba bloquea la red, no confirmado; vale revisarlo por separado.
