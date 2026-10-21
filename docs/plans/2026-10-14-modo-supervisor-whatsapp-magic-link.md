# Modo Supervisor: Conexión Instantánea por WhatsApp (Magic Link) - Plan de Implementación

> **Para el Agente:** REQUERIMIENTO: Implementar paso a paso con pruebas y verificación de compilación.

**Objetivo:** Permitir que el dueño de la bodega conecte su celular como Monitor Supervisor en 1 solo clic desde WhatsApp, sin códigos manuales, sin registros engorrosos y sin fricción.

**Arquitectura:**
1. **Caja (Emisor):** `PairingManager.jsx` genera un token seguro existente (`generate_pairing_token`), construye el enlace mágico (`https://<dominio>/?pair=<TOKEN>`) y abre WhatsApp con un mensaje predeterminado dirigido al número del dueño.
2. **Celular (Receptor):** Al abrir el enlace `?pair=<TOKEN>`, `App.jsx` / `AutoPairHandler` detecta el parámetro, ejecuta la vinculación de fondo (`ensureSupervisorSession` + `pair_monitor_device_with_secret`), guarda el local en `monitorLocales`, limpia la URL y activa `OwnerMonitorView` al instante.
3. **Respaldo:** Se conserva la opción de copiar enlace directo y un botón para desplegar el Código QR tradicional si se prefiere escanear.

**Stack Tecnológico:** React 19, Tailwind CSS, Lucide Icons, Supabase Cloud RPC (`generate_pairing_token`, `pair_monitor_device`).

---

### Tarea 1: Módulo de Auto-Vinculación por Enlace Mágico (`useMagicPairing.js`)

**Archivos:**
- Crear: `src/hooks/useMagicPairing.js`
- Test: `tests/magicPairing.test.js`

**Paso 1: Escribir la prueba unitaria**
- Probar la detección y extracción del token `?pair=ABCDEF...` de la URL.
- Probar la sanitización del token (longitud, caracteres válidos).
- Probar la limpieza del parámetro de la URL sin recargar la página.

**Paso 2: Implementar `useMagicPairing`**
- Hook que se monta en `App.jsx`.
- Si `window.location.search` contiene `pair` o `token`:
  - Activa estado `isPairingViaLink: true`.
  - Ejecuta la autenticación anónima y el RPC de vinculación.
  - Guarda las credenciales locales (`pda_paired_device_id`, `pda_pairing_mode`).
  - Limpia la URL para evitar re-ejecución accidental.

---

### Tarea 2: Rediseño de `PairingManager.jsx` (Experiencia WhatsApp First)

**Archivos:**
- Modificar: `src/components/Settings/PairingManager.jsx`

**Paso 1: Simplificar la interfaz visual**
- Input para número de teléfono (pre-llenado con el teléfono configurado del negocio).
- Botón principal de alto impacto: **"📲 Enviar enlace a mi WhatsApp"** (color verde esmeralda / WhatsApp).
- Botón secundario: **"📋 Copiar enlace directo"**.
- Botón colapsable: **"📷 Mostrar Código QR"** para escaneo tradicional.
- Eliminar la confusión de "código de reclamo de 10 minutos" para el usuario final.

**Paso 2: Manejo de estado de espera amigable**
- Mientras el token está activo (5-15 min), mostrar: *"Esperando que abras el enlace en tu celular... ⏳"*.
- En cuanto el celular toca el enlace, la caja detecta la vinculación en tiempo real y muestra: *"¡Celular vinculado exitosamente! ✅"*.

---

### Tarea 3: Overlay de Conexión en el Celular (`AutoPairingOverlay.jsx`)

**Archivos:**
- Crear: `src/components/Monitor/AutoPairingOverlay.jsx`
- Modificar: `src/App.jsx`

**Paso 1: Crear el componente visual**
- Pantalla de bienvenida limpia:
  - Icono de bodega / seguridad animado.
  - Mensaje: *"Conectando con tu caja registradora..."*.
  - Indicador de progreso o spinner estilizado.
  - Manejo de error claro si el enlace expiró con opción de reintentar.

**Paso 2: Conectar en `App.jsx`**
- Integrar la detección al arranque de la aplicación.
- Al vincularse exitosamente, pasar a `OwnerMonitorView` sin fricción.

---

### Tarea 4: Verificación E2E y Pruebas de Compilación

**Archivos:**
- Ejecutar suite de pruebas: `npm test`
- Compilación de producción: `npm run build`

**Criterios de Aceptación:**
- [ ] La caja abre WhatsApp con el enlace exacto formateado al número del dueño.
- [ ] Al abrir el enlace en el navegador, el celular se empareja automáticamente sin pedir escribir ningún código.
- [ ] La URL se limpia automáticamente tras la vinculación.
- [ ] La caja detecta la vinculación en tiempo real y actualiza su estado.
- [ ] Cero errores de compilación (`npm run build` exitoso).
