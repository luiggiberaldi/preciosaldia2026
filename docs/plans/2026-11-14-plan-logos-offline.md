# Plan: logos e imágenes que funcionan sin internet (Bodega)

Fecha: 14-11-2026 · Rama: `feat/inicio-estilo-farmacia`
Origen: [docs/propuestas/2026-11-14-propuesta-logos-offline.md](../propuestas/2026-11-14-propuesta-logos-offline.md) (diagnóstico; las capturas siguen en `C:\Users\luigg\Desktop\PROPUESTA-LOGOS-OFFLINE-BODEGA-capturas`).
Referencia (solo lectura): Precios al Día Farmacia, `C:\Users\luigg\Desktop\precios al dia farmacia\preciosaldia-farmacia`.

## Resumen

Sin internet, `logo.png`, `logodark.png` y `bot-avatar.png` salen rotos porque no están en el precache del
service worker. Este plan los arregla y además deja la app lista para funcionar sin internet en letras,
QR de la Billetera y logo propio del negocio, igual que Farmacia.

Cada fase es **un commit aparte**, se puede probar sola y se puede revertir sin tocar las demás.

| Fase | Qué | Tamaño | Riesgo | Depende de |
|---|---|---|---|---|
| F1 | Logos de fábrica en el precache | 1 archivo, +44 KB | Muy bajo | — |
| F2 | Respaldo visual si una imagen falla | 5–6 archivos | Bajo | — |
| F3 | Pruebas automáticas (offline + lista de imágenes) | 2 pruebas nuevas | Bajo | F1 (para pasar) |
| F4 | Letras dentro de la app (`@fontsource`) | `package.json`, `main.jsx`, `index.html`, `vite.config.js` | Medio | — |
| F5 | QR de la Billetera generado en el equipo | 1 archivo | Bajo | — |
| F6 | Logo propio del negocio (función nueva) | 1 utilidad nueva, 1 componente nuevo, ~10 archivos que usan el logo, respaldos | Medio | F2 |

Orden recomendado: **F1 → F3 → F2 → F5 → F4 → F6**. F1 y F3 juntas cierran el problema reportado y evitan
que vuelva; F6 al final porque es la más grande y toca los mismos archivos que F2.

---

## F1 — Logos de fábrica en el precache

**Archivo:** `vite.config.js`

- Agregar a `VitePWA({ includeAssets: [...] })`:
  ```js
  // Logos de fábrica y avatar del asistente: sin esto no se ven sin internet.
  'logo.png',
  'logodark.png',
  'bot-avatar.png',
  ```
  (mismo texto que Farmacia).
- De paso, cambiar rutas con `/` inicial a `./` para que no fallen en Electron (`base: './'`):
  - `src/components/Settings/AuditLogViewer.jsx:74` → `img.src = './logo.png'`
  - `src/views/OwnerMonitorView.jsx:1128` → `src="./pwa-192x192.png"`

**Cómo se comprueba:**
- `npm run build` → en la salida, `dist/sw.js` contiene `url:"logo.png"`, `url:"logodark.png"`, `url:"bot-avatar.png"`.
- El precache pasa de 45 a 48 entradas (≈ 3,8 MB → ≈ 3,85 MB).

**Ojo:** `AuditLogViewer.jsx` tiene cambios sin guardar de otra sesión (Ajustes). Hacer F1 después de que
esa sesión haga su commit, o tocar solo esa línea.

---

## F2 — Que nunca se vea una imagen rota

**Idea:** un componente pequeño reutilizable `src/components/AppLogo.jsx`:

```jsx
// Muestra una imagen; si falla (sin internet, archivo borrado) pone el respaldo.
export function SafeImg({ src, fallback, ...props }) { /* useState(failed) + onError */ }
```

Respaldos:

| Lugar | Archivo | Si falla |
|---|---|---|
| Logo ancho del inicio (`BrandLogo`) | `src/views/dashboard/DashboardSummary.jsx` | Ícono «D» (`./apple-touch-icon.png`, ya está en el precache) |
| Pantalla de bloqueo | `src/components/security/LockScreen.jsx:159` | Ícono «D» |
| Bienvenida | `src/components/OnboardingOverlay.jsx:126` | Ícono «D» |
| Monitor de tasas | `src/views/MonitorView.jsx:133` | Texto «Precios Al Día» con `font-outfit` |
| Asistente IA (4 lugares) | `src/components/AIAssistantWidget.jsx:316, 356, 376, 498` | Ícono `Bot` de lucide-react |
| Tickets / cierres PDF y HTML | `ticketGenerator.js`, `dailyCloseGenerator.js`, `*HtmlTemplate.js` | Ya ocultan el logo si falla: no se cambia |

**Decisión del dueño (pendiente):** respaldo del logo ancho = ícono «D» (recomendado) o texto «Precios Al Día».

**Cómo se comprueba:**
- Prueba Vitest `tests/safeImg.test.jsx`: al disparar `error` en el `<img>`, se muestra el respaldo.
- A mano: renombrar temporalmente `logo.png` en `dist/` → el inicio muestra la «D», no un ícono roto.

---

## F3 — Pruebas automáticas para que no vuelva a pasar

### F3a. Prueba rápida (Vitest): toda imagen usada está en el precache
**Archivo nuevo:** `tests/pwaAssets.test.js`
- Recorre `src/**/*.{js,jsx}` buscando `src="./algo.png"`, `img.src = './algo.png'` y `'./algo.png'` en general.
- Lee la lista `includeAssets` de `vite.config.js` (por texto o exportándola en una constante).
- Falla si alguna imagen de `public/` usada por la app no está en la lista
  (excepción: `public/images/catalog/*`, que va por caché en tiempo de ejecución).

### F3b. Prueba real sin internet (Playwright contra el build)
**Archivos nuevos:**
- `playwright.offline.config.js` — arranca `vite build && vite preview --port 4199` como `webServer`
  (el service worker no existe en `vite dev`, que es lo que usan las demás pruebas e2e).
- `tests/e2e/logos-offline.e2e.spec.js` — los pasos ya probados en el diagnóstico:
  1. `seedAudit(page)` (de `tests/e2e/helpers/auditHarness.js`) y abrir `/`.
  2. Esperar `navigator.serviceWorker.ready`, recargar, verificar `navigator.serviceWorker.controller`.
  3. `context.setOffline(true)` y recargar.
  4. Verificar que **todas las imágenes visibles** tienen `naturalWidth > 0`, en tema claro y oscuro,
     en ancho de PC (1440) y de celular (390).
  5. Abrir el asistente y verificar su avatar.
- Script en `package.json`: `"test:e2e:offline": "playwright test -c playwright.offline.config.js"`.
- Tarda ≈ 2 min (incluye el build): no va en el arranque rápido, sí antes de publicar.

**Cómo se comprueba:** con F1 deshecha, ambas pruebas fallan; con F1, pasan.

---

## F4 — Letras dentro de la app (como Farmacia)

Hoy las letras vienen de Google (`index.html:40-45`). Sin internet, solo se ven si ya se abrió la app
con internet, y la regla de caché `gstatic-fonts-cache` guarda máximo 10 archivos (la app usa más).

**Pasos:**
1. `npm install @fontsource/instrument-serif @fontsource/work-sans @fontsource/jetbrains-mono @fontsource/dm-mono @fontsource/outfit @fontsource/plus-jakarta-sans`
2. `src/main.jsx`: copiar los `import '@fontsource/...latin-XXX.css'` de Farmacia (`src/main.jsx:11-28`).
   Bodega pide además Plus Jakarta Sans 900: confirmar si se usa (`grep font-jakarta` + `font-black`) y
   agregar `latin-900.css` solo si hace falta.
3. `index.html`: quitar los `<link>` de Google Fonts y dejar el comentario de Farmacia.
4. `vite.config.js`: `workbox.globPatterns: ['**/*.{js,css,html,woff2}']`; quitar las dos reglas
   `runtimeCaching` de `fonts.googleapis.com` / `fonts.gstatic.com`.
5. Mirar que el CSP (si existe en `vercel.json` / `index.html`) no cambie nada importante.

**Peso:** solo subconjunto latino; ≈ 18 archivos woff2 × 15–25 KB ≈ **300–400 KB** más en el precache.

**Cómo se comprueba:**
- Build: el precache incluye los `.woff2`.
- Prueba F3b ampliada: sin internet, `document.fonts.check('700 16px Outfit')` es `true`.
- Captura antes/después del inicio: las letras se ven idénticas.

**Riesgo:** medio-bajo. Si falta un peso, el navegador usa uno parecido (no se rompe nada).

---

## F5 — QR de la Billetera sin internet

**Archivo:** `src/views/WalletView.jsx:428`

- Hoy: `<img src="https://api.qrserver.com/...">` (sale roto sin internet y además manda los datos de la
  cuenta a un servicio externo).
- Cambio: generar el QR en el equipo con la librería `qrcode`, que ya se usa en `PairingManager.jsx`:
  ```js
  const [qr, setQr] = useState(null);
  useEffect(() => { if (showShareModal) QRCode.toDataURL(getQRData(showShareModal), { width: 200, margin: 1, color: { dark: '#0f172a', light: '#ffffff' } }).then(setQr); }, [showShareModal]);
  ```
- Mientras se genera, mostrar un recuadro gris; si falla, el texto «No se pudo crear el QR».

**Peso:** nada nuevo (la librería ya está en el bundle).

**Cómo se comprueba:** prueba Vitest que monte el modal y espere un `src` que empiece con `data:image/png`;
a mano, sin internet, Billetera › Compartir › QR se ve.

---

## F6 — Logo propio del negocio (función nueva, traída de Farmacia)

El dueño sube su logo en **Ajustes › Negocio** y se usa en todas partes. Se guarda en el propio equipo
(localStorage, data URL PNG ≤ ~300 KB), así funciona sin internet desde el primer momento.

**Archivos a traer de Farmacia (casi sin cambios):**
- `src/utils/brandLogo.js` → igual. Importa `round0, round2, floorR, ceilR` de `./dinero.js`;
  Bodega ya las tiene (verificado), pero `ceilR` puede tener otra firma: revisar al copiar.
- `src/components/Settings/BrandLogoSettings.jsx` (83 líneas) → igual.
- `tests/brandLogo.test.js` (81 líneas) → igual.

**Archivos de Bodega a conectar (cambiar `'./logo.png'` fijo por `useBrandLogo()` / `getLogoSrc()`):**

| Archivo | Cambio |
|---|---|
| `src/components/Settings/tabs/SettingsTabNegocio.jsx` | Mostrar `<BrandLogoSettings />` |
| `src/views/DashboardView.jsx:520` | `logoSrc` sale de `useBrandLogo({ dark })` |
| `src/views/dashboard/DashboardSummary.jsx` | Logo propio: sin recorte del lema (el recorte solo aplica al de fábrica); quitar la nota «todavía no tiene el logo propio» |
| `src/components/security/LockScreen.jsx` | `useBrandLogo()` |
| `src/components/OnboardingOverlay.jsx` | `useBrandLogo()` |
| `src/views/MonitorView.jsx` | `useBrandLogo()` |
| `src/utils/ticketGenerator.js` | `loadLogoImage(getLogoSrc())` + `fitLogo` (no deformar) |
| `src/utils/dailyCloseGenerator.js` | Igual |
| `src/utils/ticketHtmlTemplate.js`, `src/utils/dailyCloseHtmlTemplate.js` | `getLogoSrc()` en el `<img>` |
| `src/components/Settings/AuditLogViewer.jsx` | `getLogoSrc()` |

**Respaldos (que el logo no se pierda al restaurar):** agregar `'business_logo'` junto a `business_rif` en:
- `src/config/backupKeys.js`
- `src/utils/backupRestoreService.js:46`
- `src/utils/storageService.js:200`
- Revisar el tamaño máximo del respaldo en la nube: +300 KB por equipo como mucho.

**Cómo se comprueba:**
- `tests/brandLogo.test.js` pasa.
- Prueba de respaldo: exportar con logo → borrar → importar → el logo vuelve.
- Prueba F3b ampliada: con un logo propio sembrado en localStorage, sin internet se ve en el inicio.
- A mano: subir PNG, JPG y WEBP; un archivo de más de 5 MB muestra el aviso; «Quitar logo» vuelve al de fábrica.

**Riesgo:** medio (toca tickets y PDF). Mitigación: la prueba de tickets existente
(`tests/e2e/zz-tmp-cierre-pdf.e2e.spec.js` y similares) debe seguir pasando.

**Ojo:** `SettingsTabNegocio.jsx` y `AuditLogViewer.jsx` tienen cambios sin guardar de otra sesión.
Hacer F6 después de que esa sesión haga commit.

---

## Al terminar todo

1. `npm run test` (Vitest) y `npm run test:e2e` siguen en verde.
2. `npm run test:e2e:offline` en verde.
3. Build: precache ≈ 4,2–4,3 MB (antes 3,8 MB).
4. Agregar una entrada en las novedades (`src/data/releaseNotes.js`):
   «Los logos, las letras y el QR de pago ahora se ven aunque no haya internet. Puedes poner el logo de tu negocio en Ajustes › Negocio.»
5. Recordatorio para los equipos ya instalados: verán el arreglo **al aceptar la actualización**
   (la app pide permiso, `registerType: 'prompt'`) y tras abrirla una vez con internet.

## Decisiones pendientes del dueño

1. Respaldo del logo ancho cuando falle: ícono «D» (recomendado) o texto «Precios Al Día».
2. F6: ¿el logo propio también reemplaza el ícono «D» de la barra lateral y del celular? En Farmacia no
   (solo el logo ancho, tickets y pantallas grandes). Recomendado: igual que Farmacia.
