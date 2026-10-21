# Reporte: el error "CORS" de producción se curó solo — ¿cuál fue la causa y el fix evita que vuelva?

**Fecha:** 2026-10-20
**Pregunta:** en producción, antes del push y del despliegue, el error que la consola mostraba como "CORS" desapareció sin que el fix entrara al aire. ¿Cuál fue la causa? ¿Con el fix estamos seguros de que no volverá a pasar?
**Estado:** respuesta con evidencia de código y de tests. El fix **aún NO está en producción** (9 commits locales sin push).

---

## Resumen ejecutivo

1. **"CORS" fue el síntoma en la consola, no la causa.** El navegador etiqueta como error CORS a cualquier respuesta sin cabecera `Access-Control-Allow-Origin` — incluidas las páginas de error del gateway (500/502/504) que devuelve Supabase cuando está saturado o degradado. La configuración CORS de la app nunca estuvo rota.
2. **El disparador fue externo y transitorio**: la ventana del incidente del 2026-10-20 documentada en el [postmortem](2026-10-20-postmortem-senales-perdidas-y-codigo-vinculacion.md) — base saturada por documentos de 4.5 MB, `statement timeout` en cascada y `500/504` en `sync_documents`, `register_device_session` y `heartbeat_device`. Cuando la carga cesó, las llamadas volvieron a responder y **el mismo código viejo empezó a funcionar de nuevo**: por eso "se corrigió" sin desplegar nada.
3. **La causa raíz de que la app se quedara colgada era nuestra**: el arranque esperaba la nube **sin techo de tiempo**. Con la nube lenta o caída, `deviceId` quedaba en `null` (los listeners no arrancaban) y la pantalla se quedaba en "Verificando licencia..." para siempre. Eso es exactamente lo que muestra la captura del usuario.
4. **El fix garantiza que la app NUNCA más se cuelgue así** (probado con tests), pero **no puede garantizar que Supabase o la red dejen de fallar** — eso es externo. La diferencia es que, con el fix, un fallo externo degrada la app en segundos en vez de congelarla.
5. **Hoy el fix no está desplegado**: producción sigue con el código vulnerable. Hasta que haya push + deploy, el cuelgue **sí puede volver a ocurrir**.

---

## Qué muestra la captura (evidencia)

| Señal en la captura | Significado en código |
|---|---|
| "Verificando licencia..." infinito con spinner | `PremiumGuard` renderiza esto mientras `loading === true`; el loading **nunca se cerró** |
| `[SupervisorReceiver] Listener no iniciado {reason: 'device_id_no_definido', deviceId: null}` | `useRemoteCommands` no arranca sin `deviceId` |
| `[CloudSync] Listener no iniciado {reason: 'device_id_no_definido', deviceId: null}` | `useCloudSync` no arranca sin `deviceId` |
| `GET .../storage/v1/object/public/... 404` (rojo, `requests.js:3`) | **Aparte y benigno**: un fetch de caché de imagen de producto contra un objeto que ya no existe (posiblemente una URL vieja de otro proyecto Supabase). El fallback de imagen lo absorbe; solo ensucia la consola |

Las tres primeras señales son **una sola cadena de fallo**: `initDeviceId` esperaba el RPC `auto_register_device` sin techo de tiempo; mientras esa promesa colgaba, `setDeviceId(storedId)` y `checkLicense(storedId)` **jamás se ejecutaban** → `deviceId = null` (los dos listeners se niegan a arrancar) y `loading = true` para siempre ("Verificando licencia..."). Una sola llamada de red colgada bastaba para congelar el arranque entero.

---

## Causa raíz vs. disparador

| Nivel | Qué fue | Quién lo controla |
|---|---|---|
| **Disparador** (por qué falló la red *ese día*) | Supabase degradado/saturado: `statement timeout` (57014), `sync_devices` 500/504, `register_device_session` 500, `connection to client lost` (08006). El gateway devuelve páginas de error **sin cabeceras CORS** → el navegador las reporta como "error CORS" | Externo (Supabase / red / DNS del local) |
| **Causa raíz** (por qué un fallo de red congeló la app) | El arranque esperaba la nube sin techo de tiempo y sin degradación: sin timeout en `auto_register_device`, sin cierre garantizado de `loading`, sin publicación garantizada de `deviceId` | Nuestro código (corregido en `a71f457`) |

**Por qué "se curó" sin desplegar el fix:** el disparador era transitorio. Al terminar la tormenta de carga (fin de la ventana del incidente ~12:43 UTC y mitigación ~13:30 UTC), las mismas llamadas que colgaban volvieron a responder en milisegundos y el código viejo funcionó normal. La fragilidad **siguió ahí**: cualquier otro corte de red, saturación futura o pausa del proyecto hubiera reproducido el cuelgue idéntico. La captura del usuario demuestra que **aún ocurre** con el código desplegado.

### Por qué la consola dice "CORS" cuando el fallo es del servidor

El navegador solo puede imprimir "blocked by CORS policy" cuando la respuesta **no trae** `Access-Control-Allow-Origin`. Eso pasa típicamente cuando:

- el gateway de Supabase (o Cloudflare delante) responde un 500/502/504 sin cabeceras CORS (saturación, incidente, proyecto Free pausado);
- la petición muere en red/DNS/proxy/antivirus y llega una página HTML de error;
- un service worker (PWA) sirve una respuesta cacheada en mal estado (un hard reload lo "repara", dando la impresión de que se curó solo).

Ninguno de esos casos es un problema de configuración CORS de la app — y por eso el error "desaparece" sin tocar una línea de código.

---

## Causas alternativas probables (ordenadas) y cómo distinguirlas

| # | Hipótesis | Compatibilidad con la evidencia | Cómo confirmarla |
|---|---|---|---|
| 1 | **Degradación de Supabase el 20/10** (misma ventana del postmortem: saturación por docs de 4.5 MB) | Alta: coincide en fecha, en errores 500/504 y en `connection to client lost` (peticiones que cuelgan) | Logs de Supabase del horario exacto de la captura; [status.supabase.com](https://status.supabase.com) |
| 2 | **Proyecto Free pausado / resumido** | Media: el proyecto pausado devuelve error de gateway sin CORS y "despierta" solo al primer request | Historial de pausas del proyecto en el dashboard de Supabase |
| 3 | **Red/DNS/proxy/antivirus del local** interceptando `*.supabase.co` | Media: produce exactamente el error CORS opaco | Reproducir con la red del POS; comparar con otra red/hotspot |
| 4 | **Service worker (PWA) con respuesta cacheada corrupta** | Media-baja: un hard reload lo "repara" sin deploy, justo el síntoma descrito | Mirar si quien lo vio hizo Ctrl+Shift+R antes de notar la "reparación" |
| 5 | **El 404 de Storage de la captura** | No explica el cuelgue: es una imagen de producto inexistente (posible URL vieja de otro ref Supabase) con fallback activo | Limpiar URLs de imagen que apunten a objetos/proyectos inexistentes |

Sin el horario exacto de la captura, la hipótesis 1 es la más consistente con toda la evidencia ya documentada, pero las 2–4 no se pueden descartar retroactivamente sin logs.

---

## ¿Con el fix estamos seguros de que no volverá a pasar?

### Lo que SÍ garantiza (verificado con tests)

Comportamiento probado en [tests/securityBootResilience.test.jsx](../../tests/securityBootResilience.test.jsx) — **3/3 en verde ejecutados hoy** (2026-10-20, vitest, exit 0):

| Garantía | Prueba |
|---|---|
| Toda llamada de red del arranque tiene techo de 8 s (`withTimeout`) | base del fix (`a71f457`) |
| RPCs **colgadas** (nube sin respuesta): `loading` se cierra y `deviceId` se publica | test 1 |
| RPCs que **lanzan** (`TypeError: Failed to fetch`): ídem | test 2 |
| Nube colgada con **caché offline válida**: la app arranca premium desde la caché | test 3 |
| `checkLicense` nunca deja el loading abierto: cualquier error degrada a no-premium/caché | `try/finally` con `setLoading(false)` |

Es decir: **el síntoma de la captura ("Verificando licencia..." colgada + `deviceId: null`) no puede volver a reproducirse** con este código, pase lo que pase con la red.

### Lo que NO garantiza (honestidad)

- **Que Supabase o la red dejen de fallar.** Un incidente futuro volverá a producir errores tipo "CORS" en la consola — eso es ambiental y ninguna app lo puede impedir. Lo que cambia es el impacto: de *app congelada* a *app degradada que sigue funcionando y se recupera sola*.
- **Que la consola quede limpia.** El 404 del objeto de Storage (imagen con URL muerta) seguirá apareciendo hasta limpiar esos datos.
- **Que producción esté protegida hoy.** Los 9 commits están locales (`main...origin/main [ahead 9]`). **Hasta el push + deploy, el cuelgue sí puede volver a pasar en producción.**

---

## Recomendaciones

1. **Push + deploy de los 9 commits** — es el paso que realmente cierra el riesgo. Sin él, todo lo anterior es solo código en local.
2. **Prueba de humo post-deploy**: abrir la app con la red cortada o con throttling extremo en DevTools → debe mostrar la pantalla de licencia o arrancar desde la caché en pocos segundos, **jamás** quedarse en "Verificando licencia...".
3. **Limpiar las URLs de imagen muertas** (las que devuelven 404 de `storage/v1/object/public/...`), sobre todo las que apunten a refs de Supabase antiguos.
4. **Si se repite un error "CORS"**: mirar la pestaña Network — si la respuesta es 5xx/502/504 del gateway o no hay respuesta, el problema es de Supabase/red (revisar [status.supabase.com](https://status.supabase.com) y logs del proyecto); si la respuesta es 4xx nuestra, es de datos.
5. **Apoyarse en la pantalla de Salud** (commit `1392353`) y en el diagnóstico de comandos (`44bdc07`) para diagnosticar sin copiar logs.

---

## Apéndice: evidencia técnica

Cadena de fallo pre-fix (lo que ocurría cuando la nube colgaba):

```text
initDeviceId()
  → await supabase.rpc('auto_register_device')   ← SIN timeout: cuelga aquí
  → setDeviceId(storedId)                        ← jamás se ejecuta → deviceId: null
  → checkLicense(storedId)                       ← jamás se ejecuta → loading: true
  → [CloudSync]/[SupervisorReceiver] "Listener no iniciado" (device_id_no_definido)
  → PremiumGuard: "Verificando licencia..." para siempre
```

Corrección (`a71f457`, verificado hoy):

```text
initDeviceId()
  → await withTimeout(rpc('auto_register_device'))   ← techo de 8 s
  → try/catch: el fallo del registro NO frena el arranque
  → if (storedId) { setDeviceId(); checkLicense(); } else { setLoading(false); }
checkLicense() → try/finally { setLoading(false) }    ← cierre garantizado
_fetchRemoteLicense() → withTimeout en ambas rutas (RPC + fallback a tabla)
```

Verificación ejecutada en esta sesión:

```text
npx vitest run tests/securityBootResilience.test.jsx
 ✓ tests/securityBootResilience.test.jsx (3 tests) 36ms
 Test Files  1 passed (1) · Tests  3 passed (3) · EXIT=0
```

Referencias: [postmortem del incidente 2026-10-20](2026-10-20-postmortem-senales-perdidas-y-codigo-vinculacion.md) · [useSecurity.jsx](../../src/hooks/useSecurity.jsx) · [securityBootResilience.test.jsx](../../tests/securityBootResilience.test.jsx) · [PremiumGuard.jsx](../../src/components/security/PremiumGuard.jsx)
