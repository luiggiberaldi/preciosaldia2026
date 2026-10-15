# Vinculacion rapida de supervisor desde la pantalla de acceso - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Permitir que una caja genere un codigo/QR temporal para vincular un dispositivo supervisor directamente desde la pantalla inicial, protegido por el PIN de un administrador y sin duplicar el flujo existente de Ajustes.

**Architecture:** Se extraera la emision y el seguimiento del emparejamiento a un servicio compartido. La pantalla inicial solo abrira un modal de autorizacion; despues de validar un PIN de administrador sin cambiar la sesion activa, el modal reutilizara `generate_pairing_token`, mostrara el QR/codigo y esperara el emparejamiento. El celular supervisor continuara usando `PairingScanScreen` y `pair_monitor_device`, mientras Ajustes conservara el flujo actual como alternativa.

**Tech Stack:** React 19, Zustand, Supabase RPC, `qrcode`, Vitest, Tailwind CSS, lucide-react.

---

## Contexto auditado

- `src/App.jsx` ya controla `showPairingScan` y abre `PairingScanScreen` desde `LockScreen`.
- `src/components/security/LockScreen.jsx` ya muestra la accion `Entrar en Modo Supervisor`, pero esa accion representa al dispositivo supervisor que se conecta a una caja; no genera el codigo.
- `src/components/Settings/PairingManager.jsx` ya genera el token mediante `generate_pairing_token`, renderiza el QR y consulta `device_pairings` hasta detectar la vinculacion.
- `src/components/PairingScanScreen.jsx` ya consume el token mediante `pair_monitor_device` y activa `pda_pairing_mode=monitor`.
- `supabase/migrations/20261014_supervisor_seguridad_practica.sql` ya exige sesion Supabase, licencia permanente, token de un solo uso, hash del token y expiracion. El RPC actual configura una expiracion de 30 minutos; el nuevo flujo debe mostrar el tiempo real recibido por el servicio y no inventar un TTL distinto en la interfaz.
- `src/hooks/store/useAuthStore.js` ya contiene verificacion PBKDF2/legacy y bloqueo progresivo por intentos fallidos. La autorizacion nueva debe reutilizar esa politica y no implementar una segunda verificacion insegura.

## Decisiones de UX y seguridad

1. En la pantalla inicial se agregara una segunda accion discreta debajo de `Entrar en Modo Supervisor`:

   `¿Necesitas conectar otro dispositivo?`  `Vincular supervisor`

   No se agregara un campo PIN permanente junto a las tarjetas de Cajero/Administrador; mezclaria inicio de sesion con vinculacion y haria menos claro el flujo.

2. Al pulsar `Vincular supervisor` se abre un modal con el titulo `Autorizar vinculacion` y un campo PIN. El texto explica: `Necesitas el PIN de un administrador para generar el acceso temporal.`

3. El PIN solo autoriza la emision. No se envia a Supabase, no se guarda, no cambia `usuarioActivo` y no se usa como credencial en el celular.

4. El codigo se mostrara como QR y como texto copiable. Nunca se agregara a URL, query string, logs, telemetria ni mensajes de error.

5. Estados visibles del modal:

   - `pin`: solicitar autorizacion.
   - `generating`: validar sesion, sincronizar datos necesarios y generar token.
   - `ready`: mostrar QR, codigo, contador y boton copiar.
   - `waiting`: indicar `Esperando conexion del supervisor` mientras se consulta el estado.
   - `success`: mostrar dispositivo vinculado y cerrar o volver a la pantalla inicial.
   - `expired`: explicar que el codigo vencio y ofrecer `Generar otro`.
   - `error`: mostrar mensaje accionable y conservar el PIN fuera del formulario.

6. Si ya existe un supervisor activo, se mostrara el mensaje del backend y un acceso a Ajustes para desvincularlo. El modal no debe intentar reemplazar el dispositivo silenciosamente.

7. El flujo de Ajustes continuara disponible como respaldo. La mejora es un acceso rapido, no eliminar la ruta administrativa existente.

## Plan de implementacion

### Tarea 1: Definir contrato compartido y pruebas primero

Archivos:

- Crear `src/services/supervisorPairingService.js`.
- Crear `tests/supervisorPairing.test.js`.

Implementacion:

- Definir constantes y funciones puras para normalizar el codigo, formatear el tiempo restante, clasificar errores conocidos y limpiar secretos en memoria.
- Definir el contrato del servicio:

  ```js
  createPairingToken({ deviceId, supabase, ensureSession, syncBeforeIssue })
  watchPairing({ deviceId, supabase, onPaired, onError, intervalMs })
  revokePairingWatch(subscription)
  ```

- `createPairingToken` debe:
  1. validar `deviceId` localmente;
  2. asegurar la sesion mediante `ensureSupervisorSession`;
  3. ejecutar la sincronizacion previa existente solo una vez y reportar su resultado;
  4. llamar `generate_pairing_token`;
  5. devolver el token solo al componente que lo necesita y un `expiresAt` calculado con el TTL acordado;
  6. traducir el error de supervisor ya conectado a un error de dominio reconocible.
- `watchPairing` debe reutilizar el polling actual de `device_pairings`, detenerse al vincular, vencer o desmontar el componente, y no crear un polling por cada render.
- El servicio no debe iniciar listeners globales ni repetir consultas de catalogo. El polling del estado de pairing debe ser la unica lectura recurrente.

Pruebas antes de la implementacion:

- normalizacion de token en mayusculas y espacios;
- rechazo de `deviceId` invalido;
- traduccion de `generate_pairing_token` exitoso;
- traduccion de caja ya vinculada, licencia ausente, sesion ausente y token expirado;
- `watchPairing` detiene el intervalo al recibir `monitor_device_id`;
- `watchPairing` limpia el intervalo al cancelar.

Verificacion:

```powershell
npx vitest run tests/supervisorPairing.test.js --pool=forks --maxWorkers=1
```

### Tarea 2: Agregar autorizacion de PIN de administrador sin iniciar sesion

Archivos:

- Modificar `src/hooks/store/useAuthStore.js`.
- Crear o ampliar la prueba de seguridad correspondiente, preferiblemente `tests/authStore.test.js` si ya existe; si no existe, crear `tests/adminPinAuthorization.test.js`.

Implementacion:

- Agregar una accion explicita como `verifyAdminPin(pinInput)` que recorra solo usuarios con rol administrativo y `requirePin !== false`.
- La accion debe devolver `{ success, user }` en caso valido y no modificar `usuarioActivo`, `sesion`, `lastActivity` ni el perfil operativo actual.
- Reutilizar `verifyPin`, `_computeLockout`, `failedAttempts`, `lockUntil` y `consecutiveLockouts` existentes. No duplicar PBKDF2 ni crear un bypass para el PIN.
- Rechazar cajeros aunque conozcan su propio PIN.
- Mantener el PIN fuera de `localStorage`, logs, errores de Supabase y estados persistidos de Zustand.
- Si el estado ya esta bloqueado, devolver el tiempo restante con un mensaje apto para UI.
- Hacer que el modal borre el valor del input al cerrar, al fallar y despues de un intento exitoso.

Pruebas:

- PIN valido de administrador autoriza;
- PIN valido de cajero rechaza;
- PIN invalido incrementa el bloqueo existente;
- intento durante `lockUntil` no consulta hashes;
- el usuario activo no cambia en ningun caso.

### Tarea 3: Extraer el generador de Ajustes al servicio comun

Archivos:

- Modificar `src/components/Settings/PairingManager.jsx`.
- Modificar `src/services/supervisorPairingService.js`.
- Si hace falta separar funciones de autenticacion, reutilizar `src/services/supervisorAuth.js` sin mover su contrato publico.

Implementacion:

- Reemplazar la llamada directa a `generate_pairing_token` y el polling local de `PairingManager` por el servicio compartido.
- Conservar la sincronizacion previa con `forceSyncAllPOSData(deviceId, true)`, pero evitar que el modal de acceso y Ajustes mantengan dos implementaciones distintas.
- Conservar las acciones actuales de desvincular y consultar estado en Ajustes.
- Asegurar que desmontar `PairingManager` cancele timers y que cambiar de pestaña no deje polling activo.
- Mantener el codigo y el QR fuera del historial o de cualquier payload de sincronizacion.

Pruebas de regresion:

- el flujo existente de Ajustes sigue generando QR;
- un supervisor ya vinculado sigue apareciendo como vinculado;
- desvincular mantiene el contrato de `unpair_monitor`;
- los errores de licencia y sesion muestran mensajes accionables.

### Tarea 4: Crear el modal de vinculacion rapida

Archivos:

- Crear `src/components/security/QuickSupervisorPairingModal.jsx`.
- Crear `tests/QuickSupervisorPairingModal.test.jsx`.

Implementacion:

- Props sugeridas:

  ```js
  {
    isOpen,
    deviceId,
    onClose,
    triggerHaptic,
    onOpenSettings
  }
  ```

- Usar `QRCode` ya instalado; no agregar una dependencia nueva.
- No generar el QR durante el render. Generarlo cuando el servicio devuelva un token y limpiar canvas/refs al cerrar.
- Mostrar:
  - nombre `Vincular supervisor`;
  - QR grande con contraste suficiente;
  - codigo de respaldo con boton `Copiar codigo`;
  - contador `Disponible por MM:SS`;
  - instrucciones de tres pasos: abrir la app en el celular, pulsar `Entrar en Modo Supervisor`, escanear o escribir el codigo;
  - estado de espera y boton `Cancelar`.
- En movil, hacer que el modal sea una hoja inferior o ocupe casi toda la pantalla; en escritorio, limitarlo a un ancho corto para mantener el foco.
- En `success`, mostrar `Supervisor vinculado` y el identificador abreviado del dispositivo, nunca el token.
- En `expired`, destruir el token local y permitir generar otro sin volver a navegar por Ajustes.
- Manejar `Escape`, cierre, desmontaje y cambio de visibilidad para cancelar polling y limpiar el secreto.
- Evitar que el modal se pueda abrir dos veces en paralelo.

Pruebas:

- el modal no llama Supabase mientras esta cerrado;
- PIN invalido no genera token;
- PIN valido pasa a `generating` y luego `ready`;
- copiar usa el portapapeles y muestra confirmacion;
- la expiracion pasa a `expired`;
- el emparejamiento pasa a `success`;
- cerrar limpia token, intervalo y estado de PIN;
- errores de backend no dejan el boton en `Enviando...` indefinidamente.

### Tarea 5: Integrar la accion en la pantalla inicial

Archivos:

- Modificar `src/App.jsx`.
- Modificar `src/components/security/LockScreen.jsx`.

Implementacion:

- En `App.jsx`, agregar un estado independiente, por ejemplo `showPairingIssuer`, sin reutilizar `showPairingScan`.
- Pasar a `LockScreen` una callback dedicada, por ejemplo `onOpenPairingIssuer`.
- Montar `QuickSupervisorPairingModal` con el `deviceId` local ya utilizado por la caja.
- Mantener `onOpenPairing` para el celular supervisor; no cambiar su comportamiento.
- No mostrar el emisor cuando `pda_pairing_mode=monitor` o cuando la vista activa ya es `OwnerMonitorView`.
- En `LockScreen.jsx`, agregar la accion secundaria debajo de `Entrar en Modo Supervisor`, con texto de ayuda y jerarquia visual menor que la seleccion de usuario.
- Usar la paleta existente de Precios Al Dia: verde para accion segura/exitosa, azul solo para informacion y naranja/rojo para advertencias; evitar introducir un color de marca nuevo.
- Mantener accesibilidad: foco visible, `aria-label`, `aria-describedby`, boton de cierre y navegacion por teclado.

Pruebas de integracion:

- la pantalla de acceso conserva las tarjetas de usuario;
- `Entrar en Modo Supervisor` continua abriendo el scanner;
- `Vincular supervisor` abre el emisor y pide PIN;
- cerrar el emisor no abre el scanner ni cambia de modo;
- la accion no aparece en modo supervisor.

### Tarea 6: Alinear expiracion, concurrencia y auditoria del backend

Archivos a revisar:

- `supabase/migrations/20261014_supervisor_seguridad_practica.sql`.
- Crear una migracion nueva solo si la implementacion lo requiere, con nombre `supabase/migrations/20261015_supervisor_pairing_audit.sql`.

Implementacion:

- Mantener `token_hash`, `token_used_at`, `revoked_at`, licencia activa y rechazo de segundo supervisor como reglas del servidor.
- No crear una segunda RPC para la pantalla inicial: el mismo `generate_pairing_token` debe proteger ambos puntos de entrada.
- Validar si los 30 minutos actuales son aceptables para la operacion. Si se decide acortar el tiempo, cambiarlo en la RPC y en el servicio de forma coordinada; nunca cambiar solo el contador visual.
- Si se requiere auditoria remota, registrar eventos sin almacenar PIN ni token: `pairing_token_issued`, `pairing_completed`, `pairing_expired`, `pairing_revoked`, con `device_id`, usuario administrativo anonimizado o id interno y timestamps. Reutilizar la tabla/evento de auditoria existente si ya esta disponible.
- Mantener la posibilidad de operar con el flujo local y sincronizar despues; no agregar lecturas continuas para alimentar un contador.
- Revisar que las politicas de acceso no permitan que un cliente anonimo llame directamente los RPC.

Pruebas SQL/seguridad:

- `authenticated` puede emitir solo con licencia valida;
- `anon` no puede llamar el RPC;
- token usado o expirado no vuelve a vincular;
- un segundo monitor activo se rechaza;
- el PIN nunca forma parte de una peticion RPC.

### Tarea 7: Verificacion manual y regresion de bajo consumo

Ejecutar:

```powershell
npm run lint:supervisor
npm run typecheck
npm run test:supervisor
npm run build
```

Si el entorno vuelve a presentar timeouts al iniciar workers de Vitest, repetir el archivo nuevo con `--pool=forks --maxWorkers=1`, documentar el fallo de infraestructura y separar esa limitacion de los resultados funcionales.

Checklist manual:

1. En una caja sin supervisor, abrir la pantalla inicial y confirmar que `Vincular supervisor` sea visible.
2. Probar PIN de cajero, PIN incorrecto, bloqueo temporal y PIN administrativo correcto.
3. Confirmar que aparece el QR, el codigo copiable y el tiempo real de expiracion.
4. Desde un segundo dispositivo, usar `Entrar en Modo Supervisor` y completar por QR.
5. Confirmar que la caja muestra exito y que el celular entra en modo supervisor.
6. Intentar generar otro codigo con un supervisor activo y verificar el mensaje para desvincular.
7. Cerrar, recargar y cambiar de pestaña; confirmar que no quedan timers ni estados atascados.
8. Revisar DevTools: no debe aparecer el PIN ni el token en URL, logs, errores ni payloads de sincronizacion.
9. Confirmar que Ajustes sigue funcionando como ruta alternativa.
10. Repetir con red lenta/intermitente y validar que el boton nunca quede bloqueado sin una accion de recuperacion.

## Criterios de aceptacion

- El administrador puede iniciar la vinculacion desde la pantalla inicial sin entrar primero a Configuracion.
- El PIN de administrador autoriza la operacion sin cambiar el usuario activo ni quedar persistido.
- El token se genera una sola vez mediante el RPC existente, se muestra como QR/codigo y se limpia al cerrar o vencer.
- El supervisor utiliza el flujo actual de scanner/codigo y el backend mantiene sus guardarrailes.
- Ajustes y la pantalla inicial comparten servicio, mensajes de error y manejo de expiracion.
- No se agregan consultas recurrentes de catalogo ni listeners globales; solo se mantiene el polling de pairing mientras el modal esta abierto.
- La vinculacion, expiracion, error, cancelacion y supervisor ya conectado tienen estados visibles y recuperables.
- Lint, typecheck, pruebas de supervisor y build pasan, o cualquier limitacion del entorno queda documentada.

## Puntos de commit sugeridos

1. `test: define supervisor pairing service contract`
2. `feat: add admin pin authorization without session switch`
3. `refactor: share supervisor pairing issuer with settings`
4. `feat: add quick supervisor pairing modal`
5. `feat: expose supervisor pairing from lock screen`
6. `test: cover quick pairing security and regressions`

Cada commit debe mantenerse pequeno y verificable para poder revertir la mejora de acceso rapido sin afectar el scanner o la desvinculacion existentes.
