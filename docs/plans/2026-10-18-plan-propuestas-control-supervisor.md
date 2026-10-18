# Propuestas: confirmación de cambios y panel de Control (inspirado en Donde Juancho)

**Fecha:** 2026-10-18
**Fuente:** auditoría del proyecto Donde Juancho (panel Monitor/Cambios, cola de cambios y flujo de confirmación) frente a PreciosAlDía (supervisor).
**Idioma:** deliberadamente llano. El detalle técnico está al final, en un anexo separado.

---

## Qué encontramos en Donde Juancho (la auditoría)

Donde Juancho resuelve exactamente la pregunta central: **el supervisor sabe siempre si su cambio hizo efecto o no**. Lo logra con cuatro ideas simples:

1. **Confirmar no es esperar.** Al pulsar Aceptar o Eliminar, el modal se cierra al instante. El cambio queda "en cola" con una etiqueta visible en el producto ("EN COLA LOCAL (SIN SUBIR)") y un aviso abajo: "1 cambio en cola — Aún no se han enviado a la caja — DESCARTAR / SUBIR AL SISTEMA". Nada se congela esperando respuesta.

2. **El camino del cambio se ve en todo momento.** Un cambio pasa por tres etapas visibles:
   - **En cola local** — guardado en el navegador, todavía no se envió.
   - **En espera de la caja** — ya subido a la nube, esperando que la caja lo tome ("Se aplicarán automáticamente apenas la caja principal se conecte. Puedes anularlos si lo deseas").
   - **Aplicado por la caja** — la caja lo confirmó de verdad.
   Además existen los finales tristes: **anulado** (me arrepentí) y **rechazado** (la caja no pudo aplicarlo, con el motivo escrito en palabras).

3. **El éxito SIEMPRE se avisa.** Cuando la caja confirma, salta un aviso verde ("✅ Caja principal confirmó..."); si aplicó con reservas, un aviso amarillo; si falló, un aviso rojo con el motivo. También avisan cuando **otro supervisor** hace un cambio ("Otro supervisor actualizó el inventario"). Nunca hay silencio: siempre se sabe qué pasó.

4. **"Aplicado" significa probado, no solo "recibido".** Donde Juancho no se conforma con que la caja diga "ok": comprueba que el cambio se refleje realmente en el inventario que la caja devuelve (una traza o recibo del movimiento). Su regla interna dice literalmente que "la igualdad de stock no basta". Recibido y aplicado-son-cosas-distintas, y la interfaz lo muestra así.

Además, su **panel de Control** (la pestaña que se ve en las capturas) es un libro de registro completo:
- Cuatro contadores grandes: **Cola local (sin subir)** · **En espera en nube** · **Aplicados por la caja** · **Anulados/cancelados**.
- Filtros: Todos / Pendientes / Aplicados / Anulados / Rechazados.
- Una ficha por cada cambio, como un recibo: producto ("Champu Papeleta"), qué se pidió ("AJUSTE DE STOCK (+8)"), el detalle ("Stock: +8 unidades"), quién lo pidió ("Por: Supervisor"), la hora de envío ("Enviado: 07:04"), la hora de aplicación ("Aplicado a las 07:04"), la fecha ("APLICADO EN CAJA EL 18/10/2026") y el sello final **"Aplicado por la caja"**.
- Y se puede **anular**: "ANULAR TODOS" en el banner, o cancelar un cambio suelto mientras la caja no lo haya tomado (con un aviso honesto si el envío ya podría estar en camino).

---

## Propuestas para PreciosAlDía (en lenguaje llano)

### Propuesta 1 — "Confirma y sigue": cerrar el modal de inmediato
Al pulsar Aceptar / Eliminar / Guardar, el modal se cierra al instante y aparece un aviso claro: **"Cambio enviado a la caja ✈️ — esperando confirmación"**. El supervisor sigue trabajando; nunca se queda mirando una pantalla congelada esperando a que algo pase.

### Propuesta 2 — El éxito se celebra SIEMPRE
Cuando la caja confirma un cambio, aviso verde explícito: **"✅ La caja aplicó tu cambio — la Mayonesa quedó en 30"**. Si algo sale mal, aviso rojo con el motivo en palabras simples ("la caja rechazó el cambio porque el producto ya no existe"). Si la caja tarda o no responde, aviso amarillo: **"Sigue esperando a la caja"**. Nunca silencio: todo cambio termina en un aviso de éxito o de error.

### Propuesta 3 — Panel "Control" con el detalle de un recibo
Igual que en Donde Juancho:
- Cuatro contadores: **En cola local** · **Esperando a la caja** · **Aplicados** · **Anulados o rechazados**.
- Filtros: Todos / Pendientes / Aplicados / Anulados / Rechazados.
- Una ficha por cambio con: producto, qué se pidió (por ejemplo "Ajuste de stock +8 unidades"), quién lo pidió, hora de envío, hora de aplicación, fecha, y el sello **"Aplicado por la caja"**.
Cada cambio deja constancia: qué, quién, cuándo se pidió y cuándo se hizo realidad.

### Propuesta 4 — Etiqueta de estado en cada producto
En la tarjeta de cada artículo, una etiqueta con su estado: **"EN COLA"** (aún no se envía), **"ESPERANDO A LA CAJA"** (enviado, sin confirmar), **"APLICADO"** (confirmado). De un vistazo se ve qué está pendiente sin abrir ningún menú.

### Propuesta 5 — Cola local con mando del usuario
Aviso abajo: **"N cambios en cola — SUBIR AL SISTEMA / DESCARTAR"**. Si no hay internet, los cambios esperan guardados y se suben solos cuando vuelve la conexión. El usuario puede subirlos antes o descartarlos.

### Propuesta 6 — Poder arrepentirse
Botón **"ANULAR TODOS"** cuando hay cambios esperando a la caja, y anular un cambio suelto mientras la caja no lo haya tomado. Con aviso honesto si el envío ya podría estar en camino ("el cambio puede haber llegado ya a la caja; verifica su estado").

### Propuesta 7 — "¿Hizo efecto de verdad?": el sello de confirmación real
Dos niveles, como en Donde Juancho:
- **"Recibido por la caja"** — la caja recibió la orden (respuesta inmediata).
- **"Aplicado y verificado"** — se comprobó que el cambio quedó reflejado en el inventario que la caja devuelve.
El sello del panel es siempre el segundo. Esto ya existe por dentro en PreciosAlDía (la verificación por "eco"); se trata de **mostrarlo** en la interfaz.

### Propuesta 8 — Avisos de equipo
Cuando otro supervisor hace un cambio, aviso: **"Otro supervisor actualizó el inventario"**, para que el equipo sepa que el negocio cambió mientras miraba a otro lado.

---

## Orden sugerido

1. **Propuestas 1 y 2** (confirmar sin esperar + éxito siempre visible) — es la necesidad fundamental.
2. **Propuestas 3 y 7** (panel Control detallado + sello "aplicado de verdad").
3. **Propuestas 4, 5 y 6** (etiquetas por producto, cola con mando, arrepentimiento).
4. **Propuesta 8** (avisos de equipo).

## Qué NO se debe perder de PreciosAlDía

PreciosAlDía tiene un motor más riguroso que Donde Juancho y hay que conservarlo: el registro previo de cada movimiento (para recuperarse de cortes), la confirmación temprana a la caja (la orden no espera por la nube), la protección contra cambios viejos que llegan tarde, y las pruebas automáticas que respaldan todo. La propuesta es **poner la claridad de Donde Juancho encima del motor de PreciosAlDía**, no sustituir uno por el otro.

## Riesgos y límites a tener presentes

- Anular solo es seguro **antes** de que la caja tome el cambio; después hay que usar un cambio contrario (por ejemplo, devolver el stock). Donde Juancho ya avisa de esto con honestidad; nuestra propuesta también.
- "Aplicado y verificado" puede tardar unos segundos más que "recibido". Por eso son dos niveles distintos: respuesta rápida + confirmación real.
- Los contadores del panel requieren conservar un historial de cambios; PreciosAlDía ya guarda los comandos, así que es cuestión de mostrarlos.

---

## Anexo técnico (breve)

| Propuesta | Base existente en PreciosAlDía | Qué falta |
|---|---|---|
| 1. Modal no bloqueante | `sendSupervisorCommand` ya separa envío (`result`) de confirmación (`ackPromise`) | Dejar de `await` el ACK dentro del handler del modal (p. ej. `handleConfirmDeleteProductRemote`); cerrar modal tras el envío y seguir el ACK por evento |
| 2. Avisos de resultado | `useMonitorSync` ya recibe el UPDATE del comando (ACK) | Notificar en cada transición de estado: aplicado (verde), aplicado con reservas (ámbar), fallido/rechazado (rojo con `error_message`) |
| 3. Panel Control | `useSupervisorControl` + `supervisorControlService` (poll 45 s) + `supervisor_commands` con `ack_payload`/`error_message` | Vista con 4 contadores, filtros por estado y ficha por comando (emitido/aplicado, actor, delta); etiquetas legibles tipo `monitorCommandDetails.js` de DJ |
| 4. Etiquetas por producto | `stockOpStatus` (`beginStockAdjust`/`applyStockOpOutcome`) ya modela creído/pendiente | Exponerlo como badge en `SupervisorInventoryCatalog` |
| 5. Cola local | El journal (`published_pending`) y el flag de productos pendientes ya existen | Superficie de usuario: contador + "subir ahora" (el barrido de 30 s es el modo automático) |
| 6. Anulación | `supervisor_commands.status` admite `cancelled` (migraciones) | RPC/UI para cancelar comandos `pending` propios, con el mismo guard de "puede haber sido tomado" |
| 7. Sello verificado | El eco (`isNewerSyncDocument` + watermark) y el journal ya prueban el efecto real | Estado visible "aplicado y verificado" distinto de "recibido" |
| 8. Avisos de equipo | Realtime de `supervisor_commands` con `actor_auth_id` | Toast cuando otro actor inserta un comando |

Referencia de Donde Juancho: `useSupervisorCommandQueue.js` (cola durable + resolución de cambios), `useDurableSupervisorQueue.js`, `supervisorCommandModel.js`, `monitorCommandDetails.js` (fichas legibles), `MonitorCambiosTab.jsx` (panel Control), `constants/commandStatus.js` (estados: pending / applied / applied_with_warnings / failed / cancelled) y `supervisorStockProjection.js` (stock "creído" mientras espera).
