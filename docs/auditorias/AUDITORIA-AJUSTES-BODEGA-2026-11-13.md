# Auditoría de Ajustes — Precios al Día Bodega

**Fecha:** 13-nov-2026 · **Rama:** `feat/inicio-estilo-farmacia`
**Cómo se revisó:** en el navegador a 375 px (teléfono), 1100 px con la barra lateral abierta (laptop) y 1600 px (PC). Cada pestaña se revisó con un script que busca contenido que se sale de la pantalla, botones pequeños y letra diminuta, y además con capturas. Se comparó con los Ajustes de Farmacia (rama `pruebas`).

---

## 1. Problemas que afectan a todas las pestañas

| # | Problema | Dónde se ve | Gravedad |
|---|---|---|---|
| T1 | **Tres columnas de navegación seguidas en PC.** La barra lateral de la app (224 px) + el menú «Opciones» de Ajustes (208 px) dejan unos 600 px para el contenido. Las tarjetas de Ventas se aprietan en 3 columnas estrechas y los textos se parten en 4 o 5 renglones (por ejemplo «Modo de Cobro (Interfaz)» o «Tasa de IVA»). Es lo que se ve en tu captura. | Ventas › Terminal & Cobro, Sistema, Negocio | 🔴 Alta |
| T2 | **Las columnas se deciden por el ancho de la ventana y no por el espacio real.** `lg:grid-cols-3` (≥1024 px) pone 3 columnas aunque las barras laterales se coman la mitad. | `SettingsTabVentas.jsx:268`, `SettingsTabNegocio.jsx:194`, `SettingsTabSistema.jsx:155`, `SettingsTabUsuarios.jsx:14`, `SettingsTabLicencia.jsx:185` | 🔴 Alta |
| T3 | **En el teléfono, las pestañas de arriba se cortan sin aviso.** «Licencia» aparece como «L…» y «Sistema» no se ve; lo mismo con «Políticas & Crédito» y «Ticketera & Hardware». Se pueden deslizar, pero nada indica que haya más. | Fila de pestañas y sub-pestañas de Ventas | 🟠 Media |
| T4 | **Textos sin tilde:** «PRECAUCION», «Codigo», «Informacion», «calculos». | `SettingsTabNegocio.jsx:276-280`, `SettingsTabSistema.jsx:92,161,211,239,378` | 🟡 Baja |

**Lo que está bien:** en ninguna pestaña ni tamaño el contenido se sale de la pantalla ni obliga a deslizar hacia los lados. El teléfono se ve ordenado, en una sola columna.

---

## 2. Pestaña por pestaña

### Negocio
- ✅ Se ve bien en teléfono y PC.
- Propuesta: la vista previa del ticket podría ir junto al formulario en PC (hoy queda abajo).
- «Peso Colombiano (COP)»: el subtítulo dice «calculos» sin tilde.

### Ventas › Terminal & Cobro
- 🔴 Con la barra lateral abierta, las 3 tarjetas (Modo de Cobro, IVA, Ticket) quedan muy estrechas (T1/T2). La tarjeta de IVA es la peor: el campo «Tasa de IVA» queda apretado y el botón «Restaurar 16 % (de fábrica)» se parte en dos renglones.
- «Unidad de Granel» queda sola en una cuarta fila.
- Propuesta: 2 columnas hasta que haya espacio de verdad, y agrupar «IVA + Ticket» y «Modo de Cobro + Granel».

### Ventas › Caja & Vuelto
- 🟠 5 botones de menos de 32 px de alto y 4 textos de menos de 10 px en el teléfono (los campos «Billete más pequeño» y «Redondeo en Bs» y sus etiquetas). En pantalla táctil cuesta tocarlos.
- Farmacia **ocultó** la tarjeta «Cómo entrega la caja el cambio» (commit `84b09d1`) porque confundía. En Bodega sí tiene sentido (se maneja mucho efectivo), así que la dejaría, pero con letra y campos más grandes.

### Ventas › Políticas & Crédito
- ✅ Se ve bien.
- «Reparar cartera desde el ledger» (TÉCNICO) es una herramienta de soporte al alcance del dueño. Propuesta: moverla a Sistema › Zona de Peligro o esconderla detrás del PIN maestro.
- «Ledger» y «libro mayor» son términos contables; para el dueño sirve más algo como «Recalcular deudas desde el historial».

### Ventas › Ticketera & Hardware
- ✅ Sin problemas de tamaño.

### Usuarios
- 🟠 **En el teléfono los nombres se cortan** («Admi…», «Caje…»): la fila mete la insignia «Sin PIN» y 3 íconos (llave, lápiz, papelera) en el mismo renglón. Propuesta: en el teléfono, los botones en un segundo renglón o detrás de un menú «⋯».
- 🟠 3 botones pequeños y 3 textos diminutos en el teléfono.
- **Seguridad:** el Administrador aparece «Sin PIN». Si la pantalla de inicio está activa y el Administrador no tiene PIN, cualquiera entra como dueño. Propuesta: al activar «Pantalla de Inicio de Sesión», pedir que se cree el PIN del Administrador. Farmacia cambió esta fila en `f355fa1` («Administrador sin "Con PIN"»); conviene revisar qué decidió y alinearlo.

### Licencia
- ✅ Se ve bien.
- ⚠️ El texto dice «Válido para **solo 1 equipo (Caja)** con el Modo Supervisor». Habrá que cambiarlo cuando exista el plan multicaja.
- Botón de copiar el ID: un objetivo táctil pequeño en el teléfono.

### Sistema
- 🔴 Mismo problema de columnas (T1/T2): «Datos y Respaldo» queda en una columna estrecha con textos partidos («Sincronizar con la Nube» en 3 renglones).
- 🟠 **«Empezar desde cero» está entre los respaldos**, a un toque de «Exportar» e «Importar». Farmacia lo movió a la Zona de Peligro con confirmación propia (CASO-021).
- 🟡 «Diagnóstico de Empaque» y «Deshacer corrección»: Farmacia los quitó por ser herramientas de una migración vieja. En Bodega **sí** se vende a granel, así que conviene preguntar si todavía hacen falta antes de quitarlos.
- Farmacia agregó mejoras que Bodega no tiene (commit `10746d8`):
  - Respaldo separado en **Respaldo local** y **Nube**.
  - **«Último respaldo: hoy / ayer / hace N días»**, con aviso en ámbar si pasaron 7 días o más.
  - **Versión y botón «Buscar actualización»** junto al ID del equipo.
  - Sistema en columnas tipo mosaico (`columns-1 md:columns-2 xl:columns-3`), que aprovecha mejor el espacio.

---

## 3. Lo que propongo, en orden

| Prioridad | Cambio | Tamaño aprox. |
|---|---|---|
| 1 | **Arreglar las columnas** (T1/T2): que el número de columnas dependa del espacio real (el mismo método que se usó hoy en el encabezado del inicio) y, en PC con la barra lateral de la app, cambiar el menú «Opciones» por pestañas arriba para no tener dos menús laterales. | ½–1 día |
| 2 | **Sistema al estilo Farmacia:** «Empezar desde cero» a la Zona de Peligro, respaldo local/nube, «Último respaldo hace N días», versión y «Buscar actualización». Traer `backupReminder.js` y su prueba. | 1 día |
| 3 | **Usuarios en el teléfono:** que los nombres no se corten (botones en segundo renglón o menú «⋯»), y exigir PIN al Administrador cuando la pantalla de inicio está activa. | ½ día |
| 4 | **Pestañas cortadas en el teléfono** (T3): sombra o flecha que avise que hay más, o pestañas que se acomoden en dos renglones. | 2–3 h |
| 5 | **Tamaño táctil** en Caja & Vuelto, Usuarios y Licencia: botones de al menos 40 px y letra de al menos 11 px. | 2–3 h |
| 6 | **Textos:** tildes (T4); «ledger» → «historial»; la herramienta de reparar cartera a la Zona de Peligro. | 1 h |
| 7 | **Decidir contigo:** ¿se quitan «Diagnóstico de Empaque» y «Deshacer corrección»? | — |

Todo esto es independiente del inicio y se puede hacer en otra rama después de unir `feat/inicio-estilo-farmacia`.

---

## 4. Estado: corregido el 13-nov-2026 (rama `feat/inicio-estilo-farmacia`, sin commit)

Decisiones del dueño: pestañas arriba, quitar lo de empaque y exigir PIN al Administrador al activar la pantalla de inicio.

| # | Qué se hizo | Archivos |
|---|---|---|
| 1 | Menú «Opciones» reemplazado por pestañas arriba en todos los tamaños; en el teléfono las 5 caben sin deslizar. Las tarjetas usan 1, 2 o 3 columnas según el espacio real del panel. | `SettingsView.jsx`, `index.css` (`.settings-pane`, `.cq-grid`), las 5 pestañas |
| 2 | Sub-pestañas de Ventas en 2 filas en el teléfono. | `SettingsTabVentas.jsx` |
| 3 | Sistema al estilo Farmacia: Respaldo local y Nube por separado, «Último respaldo: hace N días» (aviso a los 7 días), versión con «Buscar actualización», «Empezar desde cero» en la Zona de Peligro con su propia confirmación, exportar/importar solo para el Administrador. Se quitaron Diagnóstico y Deshacer empaque. | `SettingsTabSistema.jsx`, `utils/backupReminder.js`, `useDataImportExport.js` |
| 4 | PIN del Administrador: al activar la pantalla de inicio, si entra sin PIN, se pide crear uno (no 000000). Si ya está activa, aviso rojo con «Crear PIN». Con la pantalla activa no se puede marcar al Administrador «sin PIN» ni desde Ajustes ni desde el Supervisor. | `utils/adminPinPolicy.js`, `SettingsTabUsuarios.jsx`, `UsersManager.jsx`, `useAuthStore.js`, `supervisorUserCommand.js` |
| 5 | Usuarios en el teléfono: los botones bajan a una segunda línea y el nombre ya no se corta. | `UsersManager.jsx` |
| 6 | Controles táctiles de al menos 40 px y letra de al menos 10 px en Ajustes. | Formas de pago, IVA, vuelto, licencia, sistema, usuarios |
| 7 | Tildes y textos: «Recalcular deudas desde el historial» en vez de «ledger», «De fábrica» en vez de «Nat», versión real en el pie. | Varios |

**Verificación:** navegador a 375, 1100 y 1600 px; pruebas nuevas `adminPinPolicy` (3), `backupReminder` y un caso nuevo en `supervisorUserCommand`. Suite completa: 2187 pasan; fallan las mismas 3 de antes, ajenas a este cambio. Lint sin errores, typecheck y build bien.
