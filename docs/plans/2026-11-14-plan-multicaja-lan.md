# Plan: Multicaja por red local (LAN) para Precios al Día Bodega

**Fecha:** 14-11-2026
**Estado:** Pendiente (P-013). No se ha empezado; falta que el dueño decida los puntos de la sección 12.
**Rama base sugerida:** `preview/all-changes-oct14`, que es la principal
**Relación con otros planes:** es una alternativa a [2026-11-13-plan-preciosaldia-multicaja.md](2026-11-13-plan-preciosaldia-multicaja.md) (multicaja por la nube). Reutiliza de ese plan las barandas G6–G10, los arneses A4–A7 y los escenarios E1–E12. Lo que cambia es **quién manda**: aquí no manda Supabase, sino una PC del propio local.

---

## 0. En una frase

Una PC del local hace de **servidor**: guarda el stock, los fiados y los turnos de todas las cajas en una base propia. Las demás cajas le piden todo por la red del local (cable o wifi), así se puede vender aunque se caiga internet. La nube queda solo para respaldos y para el Modo Supervisor.

> **Analogía:** hoy cada caja tiene su propio cuaderno, y si dos cajas venden la última harina, cada una anota que la vendió. Con este plan hay **un solo cuaderno en la oficina** (la PC servidor). Las cajas solo le dicen "anota esta venta" y esperan el "listo". Si el mensajero se pierde un rato (se cae la red), la caja apunta en una libreta y lo pasa al cuaderno cuando vuelve.

**Glosario rápido**
- **LAN:** la red del local (el router y lo que está conectado a él). No necesita internet.
- **Servidor local:** un programa dentro de la app de escritorio de la PC principal que atiende a las demás cajas.
- **SQLite:** una base de datos que vive en un solo archivo dentro de la PC. Es como una hoja de cálculo muy rápida y segura.
- **WebSocket:** una línea abierta entre la caja y el servidor por donde el servidor avisa al instante "cambió el stock de X".
- **Interruptor:** un ajuste por cuenta (`modo = 'lan'`) que enciende todo lo nuevo. Apagado, la app es exactamente la de hoy.

---

## 1. Cómo está hoy (punto de partida, revisado en el código el 14-11-2026)

| Pieza | Hoy | Archivo |
|---|---|---|
| Datos | Cada equipo guarda todo en su navegador (IndexedDB con `localforage`). Cada caja es una isla. | `src/utils/storageService.js` |
| Stock | Lo resta la propia caja al cobrar. | `src/utils/checkoutProcessor.js` |
| Comunicación | Solo por internet (Supabase): respaldos, licencia y Modo Supervisor. | `src/hooks/useCloudSync.js`, `src/hooks/useMonitorSync.js` |
| Turnos | Uno solo; no se sabe de qué caja es cada turno. | `src/utils/cashShift.js` (`findOpenCashShift`) |
| App de escritorio | Electron que solo abre una ventana con la app; no tiene servidor ni base. | `desktop/main.js`, `desktop/preload.js` |
| Android | Capacitor, configurado en `capacitor.config.json`. | — |

---

## 2. Por qué no se hace como PWA pura

La PWA vive en una dirección segura (HTTPS, en Vercel), y el navegador pone tres trabas:

1. **No deja que una página HTTPS le pida datos a `http://192.168.x.x`** (lo bloquea por "contenido mixto").
2. **El modo sin internet (service worker) solo funciona en HTTPS.** Una app servida por `http://IP-del-local` no se instala ni abre sin red.
3. **Chrome está restringiendo el acceso a la red local** desde páginas de internet (permiso nuevo, distinto en cada navegador).

Las salidas que existen tienen problemas: un certificado HTTPS real para un dominio que apunte a la IP local necesita DNS por cliente, renovarse con internet, y algunos routers lo bloquean. Un certificado propio hay que instalarlo a mano en cada equipo, y en Android es muy engorroso. La conexión directa entre navegadores (WebRTC) necesita internet para que se encuentren.

**Decisión propuesta:** mismo código React, empaquetado de otra forma:

| Equipo | Cómo corre | Por qué |
|---|---|---|
| PC principal (servidor) | App de escritorio (Electron) con servidor + SQLite | Electron puede abrir puertos y guardar archivos |
| Otras cajas en PC | App de escritorio en modo "caja" | Electron no tiene las trabas del navegador |
| Cajas o teléfonos Android | App Android (Capacitor) con permiso de tráfico HTTP en la red local | Capacitor lo permite con configuración |
| Negocio de una sola caja | **PWA, como hoy** | No cambia nada |
| Teléfono del dueño (Supervisor) | PWA, como hoy, a través de la nube | Ver capítulo 9 |

---

## 3. Reglas (barandas)

Valen las barandas G1–G12 del plan de la nube, adaptadas. Las nuevas o cambiadas:

| # | Baranda | Cómo se obliga |
|---|---|---|
| L1 | **Los usuarios actuales en PWA no notan nada.** Todo lo nuevo va detrás de `modo = 'lan'`. | La batería de pruebas actual pasa intacta con el interruptor apagado; prueba que compara el resultado de cobrar con y sin el código nuevo cargado. |
| L2 | **Lo nuevo va en archivos nuevos** (`src/engine-lan/…` y `desktop/server/…`). En los archivos actuales solo se agrega un desvío corto: `if (modo === 'lan') return lan.procesarVenta(...)`. | Revisión del PR: si un archivo de cobro, anulación, compra o cierre cambia más que el desvío, se justifica por escrito. |
| L3 | **Los libros son de solo agregar** (stock, clientes, caja). Las correcciones son un movimiento inverso. | En SQLite: disparadores (`TRIGGER`) que rechazan `UPDATE` y `DELETE` en esas tablas; prueba que intenta borrar y debe fallar. |
| L4 | **Todo se puede reintentar sin duplicar.** Cada venta y movimiento lleva un ID creado en la caja. | `PRIMARY KEY` sobre ese ID; el servidor responde "ya lo tengo". |
| L5 | **El servidor no atiende a desconocidos.** Solo cajas vinculadas, con su token. | Toda petición sin token válido responde 401; prueba desde un equipo sin vincular. |
| L6 | **Caja y servidor deben tener la misma versión del protocolo.** | La caja manda su versión al conectarse; si no coincide, el servidor la rechaza con el aviso "Actualiza esta caja". |
| L7 | **La cola sin conexión nunca se vacía sola**, y una sobreventa se marca para que el dueño la revise. | Igual que G10 del plan de la nube. |
| L8 | **El archivo de la base del servidor se respalda solo**, local y en la nube. | Respaldo automático diario más uno al cerrar el día; prueba de restauración en F7. |

---

## 4. Fase F0 — Preparar la app de escritorio (1 semana)

**Objetivo:** que la app de escritorio pueda trabajar como servidor o como caja, y que se actualice sola.

1. Elegir el papel en el primer arranque: **"Este equipo es el servidor"** o **"Este equipo es una caja"**. Se guarda en la configuración del equipo.
2. Actualizaciones automáticas (`electron-updater`), con canal de pruebas y de producción.
3. Firma del instalador con certificado de firma de código, para que Windows y el antivirus no lo marquen como "no reconocido". **Tiene costo anual.**
4. El instalador agrega la regla del firewall de Windows para el puerto del servidor (solo en el papel servidor).
5. El servidor arranca solo al prender la PC (inicio de Windows) y queda en la bandeja del sistema.
6. Puente seguro entre la ventana y el proceso de Electron (`preload.js`) con solo las funciones necesarias.

**Arneses:** se instala en una PC limpia; se actualiza de una versión a la siguiente sin perder datos.
**Listo cuando:** la misma app se instala como servidor en una PC y como caja en otra, y las dos se actualizan solas.

---

## 5. Fase F1 — Servidor local y vinculación de cajas (1–1,5 semanas)

**Objetivo:** que las cajas encuentren al servidor y se vinculen de forma segura.

**Servidor** (dentro de `desktop/server/`):
- Servidor HTTP + WebSocket en un puerto fijo (por definir, por ejemplo 47800).
- Base SQLite (`better-sqlite3`) en la carpeta de datos del usuario, con migraciones numeradas.
- Tablas: `cajas` (letra A, B…, nombre, rol `caja`/`consulta`, token, última conexión, activa).

**Vinculación:**
- El servidor muestra un **QR con su IP, puerto y un código de un solo uso**. La caja lo escanea o escribe el código.
- Búsqueda automática en la red (mDNS) como ayuda; el QR es el método seguro.
- La caja recibe un token propio. El dueño puede renombrar o **expulsar** una caja desde el servidor.
- Límite de cajas según la licencia (sección 12, P-L2).

**Arneses:** una caja sin token es rechazada; una caja expulsada deja de poder vender; la caja vuelve a encontrar al servidor si cambia la IP (por mDNS) o avisa claramente si no lo encuentra.
**Listo cuando:** dos cajas se vinculan por QR y el servidor las muestra como A y B.

---

## 6. Fase F2 — Libro de stock y cobro en el servidor (3 semanas) 🔴 la más delicada

**Objetivo:** el stock lo lleva el servidor por movimientos. Dos cajas vendiendo lo mismo a la vez nunca pierden una venta.

Mismo modelo que la F2 del plan de la nube, pero en SQLite:
- `stock_movements` (solo agregar): ID, producto, caja, cantidad ±, motivo (`VENTA`, `ANULACION`, `COMPRA`, `AJUSTE`, `CONTEO`, `INICIAL`), referencia, hora de la caja y hora del servidor.
- `stock_levels`: stock actual, actualizado en la **misma transacción** que el movimiento.
- `sales` y `sale_items`, con número por caja `#A-00001`.

**Funciones del servidor** (una transacción cada una; SQLite atiende una escritura a la vez, así que dos cobros nunca se pisan):
- `cobrar(venta)`: guarda venta, líneas y movimientos; si el ID ya existe, responde "ya registrada".
- `anular(venta_id)`: movimiento inverso.
- `comprar(compra)`, `ajustar(...)`, `contar(...)`.

**En la caja** (solo con `modo = 'lan'`):
- `checkoutProcessor.js`, `voidSaleProcessor.js`, `merchandisePurchases.js` y los ajustes llaman al servidor.
- Catálogo y stock se leen del servidor y se guardan en la caja como copia. El WebSocket avisa los cambios al instante a todas las cajas.
- **Lista de "vías que mueven stock", revisar una por una:** venta, anulación, compra, ajuste rápido, conteo, lote de inventario, edición de producto, devolución, Cashea, importación masiva, órdenes del Supervisor.

**Arneses:** A4 (dos cajas venden el mismo producto 10 veces cada una → stock = inicial − 20), A6 (50 cobros simultáneos), A7 (stock = conteo inicial + movimientos), prueba de vías olvidadas.
**Condición de parada:** un solo producto descuadrado en A7 detiene la fase.
**Listo cuando:** A4, A6 y A7 en verde tres días seguidos con uso simulado.

---

## 7. Fase F3 — Fiados y turnos por caja (2 semanas)

**Fiados:** el libro de clientes que hoy vive en el equipo (`src/utils/customerLedger.js`) pasa al servidor (`customer_movements`). `cobrar` agrega el `VENTA_FIADA` en la misma transacción. Fiar en A y abonar en B a la vez da el saldo correcto.

**Turnos:**
- Cada caja abre y cierra su turno; cada movimiento de caja guarda su letra. `findOpenCashShift` filtra por caja.
- Cuadre de efectivo, fondo y diferencias por caja.
- **Cierre del día consolidado** (A + B + total), con aviso si alguna caja sigue abierta.
- Anular en B una venta de A: el stock vuelve, el dinero sale del turno de B y queda anotada la caja de origen.
- Reportes con filtro por caja.

**Arneses:** escenarios E5, E6 y E7; las pruebas actuales `test:fiado` en verde con el interruptor apagado.
**Listo cuando:** cerrar A no cierra B y el consolidado es la suma exacta de los dos cierres.

---

## 8. Fase F4 — Si se cae la red o el servidor (1 semana)

**Objetivo:** la caja sigue vendiendo aunque no vea al servidor un rato.

- **Cola local:** cada venta o abono sin servidor queda en la caja con su ID.
- **Permiso para vender sin servidor:** la caja guarda un permiso firmado por el servidor con vencimiento (por ejemplo 12 horas; P-L4). Una caja expulsada no sigue vendiendo indefinidamente.
- **Al volver:** se envía en orden; "ya registrada" cuenta como éxito.
- **Sobreventa:** si no había stock, la venta se guarda igual y se crea una **diferencia pendiente** para el dueño.
- Aviso visible: "Sin conexión con el servidor · 5 ventas por subir".
- Mientras no hay servidor, la caja **no ve el stock real de las otras cajas**; se le muestra el último conocido con la hora.

**Arneses:** A5 adaptado (apagar el servidor, vender 5, encenderlo, nada duplicado); apagar el servidor **en medio de un cobro**; E3, E4, E10, E11.
**Listo cuando:** A5 pasa 20 veces seguidas.

---

## 9. Fase F5 — Nube y Modo Supervisor (1–1,5 semanas)

**Objetivo:** el Modo Supervisor sigue funcionando, ahora con el local entero.

- **La PC servidor ocupa el lugar que hoy tiene la caja ante la nube.** Es la única que habla con Supabase: sube los datos de todas las cajas y recibe las órdenes del Supervisor.
- **El teléfono se vincula una sola vez, con el servidor**, no con cada caja.
- **Las órdenes a distancia se mantienen** (ventas, ajustes, compras, usuarios). El servidor las ejecuta como un movimiento más, a nombre de la "caja Supervisor". (El plan de la nube las apagaba; aquí hacen falta, porque el dueño fuera del local no tiene otro camino.) Se reutiliza la lógica actual de `supervisorSaleReceiver.js` y los demás receptores.
- **El monitor muestra el desglose por caja:** ventas y turno de A, de B y el total.
- **Formato de lo que sube:** se agrega a qué caja pertenece cada venta y cada turno, sin romper el formato actual que usan los clientes de una sola caja (L1).
- **Si el servidor no tiene internet:** las cajas siguen vendiendo por la red del local; el Supervisor ve los datos atrasados y sus órdenes quedan en espera. El monitor avisa: "El local está sin internet desde las 3:10 pm".
- **Consumo de Supabase:** baja, porque solo un equipo por local habla con la nube. Se mide con A9.

**Arneses:** pruebas actuales `test:supervisor` en verde con el interruptor apagado; con LAN, una venta desde el teléfono descuenta el stock en el servidor y las dos cajas la ven.
**Listo cuando:** el dueño ve el cierre consolidado desde el teléfono y una orden suya llega a las dos cajas.

---

## 10. Fase F6 — Pasar un cliente actual a multicaja (3–4 días)

Los datos del cliente viven dentro del navegador de su equipo, y la app de escritorio no los puede leer directo.

1. Exportar el respaldo desde la PWA (función que ya existe).
2. El servidor lo importa: productos, clientes y saldos como movimientos `INICIAL`.
3. Conteo físico de los productos que más se venden, registrado como `CONTEO`.
4. Vincular las cajas y el teléfono del Supervisor.
5. La PWA vieja queda en solo consulta, para que nadie siga vendiendo ahí por error.

**Arneses:** la importación se prueba primero con una copia de los datos reales; A7 debe salir cuadrado justo después de importar.

---

## 11. Fase F7 — Banco completo y primer local (1 semana)

- Todos los escenarios E1–E12 del plan de la nube, más: apagar la PC servidor en un cobro, cambiar la IP del router, caja con versión vieja (L6), restaurar el respaldo de la base (L8).
- Primera semana en el local: A7 cada hora; conteo físico de 10 productos al cierre del día 1 y del día 3.
- **Vuelta atrás:** si aparece un descuadre sin explicación, se apaga la caja B y se sigue con una sola mientras se corrige.

---

## 12. Decisiones pendientes del dueño

| # | Decisión | Afecta a |
|---|---|---|
| P-L1 | ¿Solo LAN, solo nube (plan del 13-11) o LAN para cobrar + nube para respaldo y Supervisor? **Propuesta: la tercera.** | Todo el plan |
| P-L2 | Precio por caja adicional. ¿Los teléfonos de solo consulta cuentan para el límite? | F1, licencia |
| P-L3 | ¿Mismo repo con interruptor o repo aparte? **Propuesta: mismo repo**, porque la app de escritorio ya vive aquí y los arreglos llegan a los dos modos sin unir ramas. | F0 |
| P-L4 | Horas que una caja puede vender sin ver al servidor (propuesta: 12). | F4 |
| P-L5 | ¿Comprar el certificado de firma de código? (costo anual) | F0 |
| P-L6 | ¿Un cajero por turno o varios por caja? | F3 |
| P-L7 | ¿Cajas Android en la red del local o solo PCs al principio? (Android agrega pruebas en otro equipo) | F1, F2 |

---

## 13. Lo que necesita el cliente en el local

- La PC servidor **prendida mientras se vende**; ideal con UPS (batería) para los cortes de luz.
- Router decente, con **IP fija** para la PC servidor. Si las cajas van por wifi, señal estable; si no, cable.
- Una impresora por caja (ya se maneja por equipo).
- Internet solo para el Supervisor, los respaldos en la nube y la licencia.
- **Soporte:** instalar en LAN pide más que mandar un enlace. Los primeros locales probablemente los configure el dueño de Precios al Día en persona.

---

## 14. Calendario aproximado

| Fase | Duración | Acumulado |
|---|---|---|
| F0 App de escritorio (papel, actualizaciones, firma) | 1 semana | 1 |
| F1 Servidor y vinculación | 1–1,5 semanas | ~2,5 |
| F2 Libro de stock y cobro | 3 semanas | ~5,5 |
| F3 Fiados y turnos | 2 semanas | ~7,5 |
| F4 Sin red o sin servidor | 1 semana | ~8,5 |
| F5 Nube y Supervisor | 1–1,5 semanas | ~10 |
| F6 Pasar un cliente | 3–4 días | ~10,5 |
| F7 Banco completo y primer local | 1 semana | **~11,5 semanas (≈2,5–3 meses)** |

---

## 15. Riesgos principales

| Riesgo | Qué pasa | Cómo se reduce |
|---|---|---|
| Un error en el desvío del cobro afecta a todos los clientes | Los usuarios PWA actuales podrían cobrar mal | L1 y L2: desvío mínimo y batería completa con el interruptor apagado |
| La PC servidor se apaga o se daña | Las cajas venden a ciegas un rato; se puede perder la base | F4 (cola y permiso) y L8 (respaldo automático local y en la nube) |
| Cajas con versiones distintas | Datos mal interpretados | L6: el servidor rechaza versiones distintas |
| Alguien en el wifi del local intenta vender o leer datos | Fuga o ventas falsas | L5: token por caja, vinculación por QR con código de un solo uso |
| Antivirus o Windows bloquean la app sin firma | El cliente no puede instalar | P-L5: firmar el instalador |
