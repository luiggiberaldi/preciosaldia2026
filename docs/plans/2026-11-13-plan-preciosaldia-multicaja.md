# Plan detallado: Precios al Día Multicaja

**Fecha:** 13 de noviembre de 2026
**Nombre del producto y del repo:** por definir (en este plan: `preciosaldia-multicaja`)
**Base:** Precios al Día Bodega, rama `main` de `luiggiberaldi/preciosaldia2026`
**Piezas que se reutilizan:** Listo POS Lite (servidor, equipos, licencia, turnos) y `preciosaldia-multilocal` (libro de stock, sedes, decisiones D1–D10)
**Supabase:** organización `preciosaldiacloud` (hoy sin proyectos)

---

## 0. En una frase

Copiar Precios al Día a un repo privado que siga recibiendo sus arreglos, y cambiar quién manda: **el servidor pasa a ser el dueño del stock, los fiados y los turnos**, y todas las cajas son iguales. Cada paso se hace con **arneses** (pruebas que demuestran que funciona) y **barandas** (reglas que impiden romper algo).

**Glosario rápido**
- **Arnés:** una prueba automática o herramienta de verificación. Es como el arnés de un albañil: no hace el trabajo, pero si algo falla te atrapa antes de caer.
- **Baranda:** una regla que el sistema obliga a cumplir (no queda a la memoria de nadie). Ejemplo: "nadie puede borrar un movimiento de stock".
- **Libro de movimientos:** en vez de guardar "hay 10 harinas", se guarda cada entrada y salida ("+12 compra", "−1 venta caja A", "−1 venta caja B"). El stock es la suma. Si dos cajas venden a la vez, las dos líneas quedan escritas.
- **Interruptor:** un ajuste por cuenta que enciende o apaga el motor nuevo.

---

## 1. Reglas que valen para todo el proyecto (barandas generales)

| # | Baranda | Cómo se obliga |
|---|---|---|
| G1 | **Repo privado y ninguna llave en el código.** | Repo privado en GitHub; `gitleaks` en el gancho `pre-commit` y en CI; protección contra subida de secretos de GitHub activada. |
| G2 | **La llave `service_role` solo vive en el servidor** (funciones de Vercel o de Supabase), nunca en el navegador ni en archivos como `wrangler.jsonc`. | Variables de entorno en Vercel; prueba de CI que falla si encuentra `service_role` o `sb_secret_` en `src/` o en el build (`dist/`). |
| G3 | **Dos proyectos de Supabase: `pruebas` y `prod`.** Todo se prueba primero en `pruebas`. | Las vistas previas de Vercel apuntan a `pruebas`; solo `main` apunta a `prod`. `schema:compare` debe salir igual antes de cada paso a producción. |
| G4 | **Migraciones numeradas, que se pueden repetir sin daño y con su vuelta atrás escrita.** Nunca se edita una migración ya aplicada. | Carpeta `supabase/migrations/NNN_nombre.sql`; cada archivo termina con una sección `-- ROLLBACK`; prueba de CI que aplica todas las migraciones dos veces seguidas sobre una base vacía. |
| G5 | **Antes de tocar producción: respaldo y aprobación tuya.** | `bun run backup:supabase` (ya existe en Precios al Día) + lista de verificación del capítulo 13. Nunca se aplica a `prod` en el mismo paso en que se escribe la migración. |
| G6 | **Los libros son de solo agregar.** Nadie puede editar ni borrar un movimiento; las correcciones son un movimiento inverso. | `REVOKE UPDATE, DELETE` en las tablas de libros, incluso para `authenticated`; prueba SQL que intenta borrar y debe fallar. |
| G7 | **Todo se puede reintentar sin duplicar.** Cada venta, movimiento y abono lleva un ID creado en el equipo. | `PRIMARY KEY` o `UNIQUE` sobre ese ID; el servidor responde "ya lo tengo" en vez de crear otro. |
| G8 | **El servidor no confía en lo que manda el equipo.** Verifica quién es, de qué cuenta, de qué sede y si el equipo está activo. | Toda escritura pasa por una función (RPC) que revisa `auth.uid()`, el equipo y la sede; RLS en todas las tablas. |
| G9 | **Las cuentas sin el interruptor encendido se comportan exactamente como Precios al Día hoy.** | Toda la lógica nueva va detrás de `account_settings.engine = 'v2'`; la batería de pruebas actual de Precios al Día (217 archivos) debe pasar intacta con el interruptor apagado. |
| G10 | **Nada se borra ni se resuelve a ciegas.** La cola sin internet nunca se vacía sola; una sobreventa se marca para que el dueño la revise. | Prueba que desconecta, vende, reconecta con error y verifica que la cola sigue ahí. |
| G11 | **Una rama por tarea, PR con CI en verde, vista previa en Vercel antes de unir.** | Protección de la rama `main` en GitHub: no se puede unir sin CI en verde. |
| G12 | **Cuidar el consumo de Supabase.** Precios al Día ya tuvo problemas por documentos grandes. | Sincronización por registro (no un documento gigante); `select` solo de las columnas necesarias; arnés A9 mide el tamaño de lo que se transmite. |

---

## 2. Arneses (las pruebas y herramientas que se construyen)

| # | Arnés | Qué demuestra | Cuándo corre |
|---|---|---|---|
| A1 | **Pruebas unitarias** (vitest; Precios al Día ya tiene 217 archivos) | Las funciones sueltas hacen lo que deben. | Cada commit (gancho) y en CI |
| A2 | **Pruebas de la base de datos** (`tests/sql/*.test.js` contra Supabase local con `supabase start`) | Las funciones del servidor, el RLS y las barandas G6–G8 funcionan de verdad. | En CI, en cada PR |
| A3 | **Datos de prueba fijos** (`scripts/seed-pruebas.mjs`) | Siempre la misma cuenta de prueba: 2 sedes, 3 equipos (Caja A, Caja B, Solo consulta), 20 productos, 3 clientes con fiado. | Antes de A2, A4, A5 |
| A4 | **Banco multicaja** (Playwright con dos navegadores a la vez, basado en `sync-multidispositivo.e2e.spec.js` del multilocal) | Dos cajas reales vendiendo al mismo tiempo no descuadran nada. Escenarios en el capítulo 11. | En CI (nocturno) y antes de cada paso a producción |
| A5 | **Simulador sin internet** (Playwright `context.setOffline`) | Vender sin conexión, reconectar, no duplicar ni perder. | Junto con A4 |
| A6 | **Prueba de choque** (`scripts/stress-checkout.mjs`) | 50 cobros simultáneos del mismo producto → el stock baja exactamente 50, o se rechazan los que no alcanzan. | Antes de cada paso a producción de F2 |
| A7 | **Revisor de cuadres** (`scripts/verify-invariants.mjs`, solo lectura) | Revisa en `pruebas` o `prod`: stock guardado = conteo inicial + movimientos; ningún ID repetido; toda venta tiene sus movimientos; todo fiado cuadra con su libro; ningún turno cerrado con diferencia sin explicar. | Diario en `prod` (tarea programada) y en CI contra `pruebas` |
| A8 | **Comparador de esquemas** (`bun run schema:compare`, ya existe) | `pruebas` y `prod` tienen la misma estructura. | Antes de cada paso a producción |
| A9 | **Medidor de consumo** | Cuántos KB baja y sube cada equipo por hora. | Semanal en `pruebas` |
| A10 | **Revisor de seguridad** (asesores de Supabase + prueba "sin login no se lee nada") | No hay tablas sin RLS ni funciones abiertas. | En cada PR que toque `supabase/` |

**Regla de oro:** si A4, A6 o A7 fallan, **no se avanza de fase**. Se arregla primero.

---

## 3. Fase F0 — Montar el proyecto (2–3 días)

**Objetivo:** un repo privado que arranca igual que Precios al Día, conectado a su propio Supabase de pruebas.

**Tareas**
1. Crear el repo privado `preciosaldia-multicaja` copiando `main` de `preciosaldia2026` **desde GitHub**, con todo su historial. No desde la carpeta local, que está en otra rama y tiene cambios sin guardar.
2. Dejar `preciosaldia2026` como remoto `upstream` para traer sus arreglos con `git fetch upstream && git merge upstream/main`.
3. Crear el proyecto de Supabase `multicaja-pruebas` en `preciosaldiacloud` (con tu aprobación del costo). `multicaja-prod` se crea en la F7.
4. Aplicar el esquema base de Precios al Día en `pruebas` y comprobar con `schema:compare`.
5. Proyecto nuevo en Vercel con sus variables de entorno (sin llaves en el código).
6. Cambiar el nombre visible de la app, el ícono y el `manifest` para que no se confunda con Precios al Día en el teléfono del cliente.
7. Agregar `gitleaks` al gancho `pre-commit` y a `ci.yml`; activar la protección de `main`.
8. Crear `scripts/seed-pruebas.mjs` (A3) y el esqueleto de A2 y A7.

**Arneses:** A1 (las 217 pruebas pasan), A3, A8, A10.
**Barandas que se activan:** G1, G2, G3, G4, G11.
**Listo cuando:** la app abre en la vista previa de Vercel contra `pruebas`, CI está en verde, `gitleaks` no encuentra nada y `schema:compare` sale igual.

---

## 4. Fase F1 — Sedes, equipos y licencia en el servidor (1 semana)

**Objetivo:** la cuenta sabe cuántas sedes tiene, qué equipos hay en cada una y qué puede hacer cada equipo. Solo el servidor maneja la licencia.

**Tablas nuevas** (migración `001_sedes_equipos_licencia.sql`)
- `sedes` (id, cuenta, nombre, activa).
- `account_devices` (como en Listo) + `sede_id`, `register_code` (A, B…), `device_role` (`caja` / `consulta`), `last_seen`.
- `cloud_licenses` con `max_cajas` y `max_sedes`; **solo lectura** para el dueño (lección de la migración 015 de Listo).
- `account_settings.engine` (`v1` / `v2`): el interruptor.

**Funciones del servidor**
- `register_and_check_device(...)`: registra el equipo, le asigna letra y revisa el límite (adaptada de Listo).
- `assign_device_to_sede(...)`: solo el dueño.

**En la app**
- Pantalla de Configuración → Equipos: letra, sede, rol, renombrar, expulsar (de `SettingsTabLicencia.jsx` de Listo).
- Numeración de ventas por caja `#A-00001` (`saleNumbering.js` de Listo).
- Al abrir la app con `engine = v2`, el equipo debe tener sede y rol, o se le pide al dueño asignarlos.

**Arneses:** A2 (un equipo no puede cambiarse de sede solo; el dueño no puede cambiar su `max_cajas`; el equipo número 4 con límite 3 es rechazado), A10.
**Barandas:** G6 sobre la licencia, G8, G9.
**Listo cuando:** en `pruebas`, la cuenta de A3 tiene 2 sedes y 3 equipos con letras correctas; un 4.º equipo es rechazado; las cuentas `v1` no ven nada distinto.

---

## 5. Fase F2 — Libro de stock y cobro en el servidor (3–4 semanas) 🔴 la más delicada

**Objetivo:** el stock lo calcula el servidor a partir de movimientos. Dos cajas vendiendo lo mismo a la vez nunca pierden una venta.

**Tablas** (migración `002_libro_stock.sql`, basada en `007_stock_ledger.sql` del multilocal)
- `stock_movements` (movement_id único, cuenta, **sede**, producto, equipo, cantidad ±, motivo, referencia, fecha en el equipo, fecha en el servidor). Motivos: `VENTA`, `ANULACION`, `COMPRA`, `AJUSTE`, `CONTEO`, `INICIAL`.
- `stock_baselines` (conteo físico por producto y sede).
- `stock_levels` (stock actual por producto y sede, **lo actualiza solo el servidor** dentro de la misma transacción que agrega el movimiento).

**Funciones del servidor**
- `process_checkout(venta)`: en **una sola transacción** guarda la venta, sus líneas y sus movimientos, y descuenta `stock_levels` con bloqueo de fila (`SELECT … FOR UPDATE`). Si la venta ya existe (mismo ID), responde "ya registrada". Adaptada de `api/checkout.js` de Listo.
- `process_void(venta_id)`: movimiento inverso, nunca borra.
- `process_purchase(compra)`: compras de mercancía → movimientos `COMPRA`. **Esto no lo tiene ni el multilocal ni Listo**; viene de `merchandisePurchases.js` de Precios al Día.
- `process_adjustment(...)` y `process_count(...)`: ajustes y conteos físicos.

**En la app** (solo con `engine = v2`)
- `checkoutProcessor.js`, `voidSaleProcessor.js`, `merchandisePurchases.js` y los ajustes de inventario llaman a estas funciones en lugar de restar el stock en el equipo.
- El inventario en pantalla se lee de `stock_levels` (por sede, y un total informativo para el dueño).
- Se aplican **todas** las vías que mueven stock. Lista a revisar una por una: venta, anulación, compra, ajuste rápido, conteo, lote de inventario, edición de producto, devolución, Cashea, importación masiva.

**Arneses**
- A2: cada función del servidor, incluidos reintentos (mismo ID dos veces = una sola venta).
- A4: dos cajas venden el mismo producto 10 veces cada una → stock final = inicial − 20.
- A6: 50 cobros simultáneos.
- A7: stock guardado = conteo inicial + movimientos para todos los productos de la cuenta de prueba.
- Prueba de "vías olvidadas": recorre la lista de arriba y comprueba que cada una deja un movimiento.

**Barandas:** G6, G7, G8, G9.
**Condición de parada:** si A7 encuentra un solo producto descuadrado en `pruebas`, se detiene la fase hasta encontrar la causa.
**Listo cuando:** A2, A4, A6 y A7 en verde durante 3 días seguidos en `pruebas`, con uso real simulado.

---

## 6. Fase F3 — Fiados en el servidor (1–1,5 semanas)

**Objetivo:** el saldo de cada cliente es la suma de su libro, en el servidor. Un fiado en la sede A y un abono en la sede B a la vez no se pisan.

Precios al Día ya tiene un libro de clientes **en el equipo** (`src/utils/customerLedger.js`, con tipos como `VENTA_FIADA`, `ABONO_DEUDA`, `ANULACION`). Se lleva ese mismo modelo al servidor.

**Tabla** (migración `003_libro_clientes.sql`): `customer_movements` (id único, cuenta, **sede de origen**, cliente, tipo, monto en USD y en Bs, tasa, referencia, fechas).
**Funciones:** `process_customer_movement(...)`; `process_checkout` agrega el `VENTA_FIADA` en la misma transacción que la venta.
**Decisión D3 del multilocal:** clientes y fiados compartidos entre sedes; cada movimiento guarda dónde se hizo; el dueño ve el total y el desglose por sede.

**Arneses:** A2; A4 con fiado en A y abono en B al mismo tiempo; A7 (saldo = suma del libro); pruebas actuales `test:fiado` de Precios al Día en verde con `v1`.
**Listo cuando:** los saldos de los 3 clientes de prueba cuadran tras 100 operaciones mezcladas entre las dos cajas.

---

## 7. Fase F4 — Turnos por caja, cierres y reportes (1–1,5 semanas)

**Objetivo:** cada caja abre y cierra su turno; el dueño ve el cierre del día de cada sede y el total.

Basado en el plan M1 de Listo (`docs/plans/2026-10-28-plan-multicaja.md`):
- La apertura, el cierre y cada movimiento de caja guardan `register_code` y `sede_id`.
- `getOpenCashSession` filtra por caja (archivo `closureLogic.js` en Precios al Día).
- Cuadre de efectivo, fondo y diferencias por caja.
- **Cierre del día consolidado** por sede y total, con aviso si alguna caja sigue abierta.
- Anular en la caja B una venta de la caja A devuelve el dinero en el turno de B y anota la caja de origen.
- Los turnos se guardan en el servidor (`cash_sessions`), no solo en el equipo.
- Reportes con filtro por sede y por caja.

**Arneses:** pruebas de `closureLogic` ampliadas con dos cajas (de `tests/closureLogic.test.mjs` de Listo); A4: A y B abren y cierran por separado y el consolidado suma bien; turno que cruza la medianoche.
**Listo cuando:** cerrar A no cierra B, y el consolidado coincide con la suma de los dos cierres.

---

## 8. Fase F5 — Trabajar sin internet (1 semana)

**Objetivo:** si se va el internet, la caja sigue vendiendo; al volver se sube todo sin duplicar ni perder.

Basado en la decisión D1 y en la función `offline-lease` del multilocal:
- **Permiso sin internet:** el equipo guarda un permiso firmado por el servidor con fecha de vencimiento (por ejemplo, 72 horas). Sin permiso vigente no puede vender sin internet, así un equipo expulsado no sigue vendiendo.
- **Cola local:** cada venta, abono o movimiento sin internet queda en la cola con su ID.
- **Al reconectar:** se envía en orden; las respuestas "ya registrada" se toman como éxito.
- **Sobreventa:** si al subir no había stock suficiente, la venta **se guarda igual** y se crea una **diferencia pendiente** para que el dueño la revise y la corrija con un ajuste. No se rechaza ni se arregla sola.
- Aviso visible en la caja: "Sin internet · 5 ventas pendientes de subir".

**Arneses:** A5 (vender 5 sin internet, reconectar, nada duplicado); reconectar con error del servidor a la mitad (la cola sigue intacta); sobreventa en las dos cajas sin internet → aparece la diferencia pendiente.
**Barandas:** G7, G10.
**Listo cuando:** A5 pasa 20 veces seguidas sin fallar.

---

## 9. Fase F6 — Banco de pruebas completo y Modo Supervisor (1 semana)

**Objetivo:** confirmar todo junto y ordenar el papel del Modo Supervisor.

- Correr todos los escenarios del capítulo 11 (A4 + A5 + A6 + A7) en `pruebas` durante una semana de uso simulado.
- **Modo Supervisor con `engine = v2`:** el teléfono del dueño pasa a ser un equipo `consulta` que lee directo del servidor. Las órdenes a distancia (ventas, ajustes y compras desde el monitor) se desactivan en las cuentas `v2`, porque ya no hacen falta. **En las cuentas `v1` no se toca nada** (G9). El código del Supervisor no se borra en esta fase.
- Medir el consumo con A9.

**Listo cuando:** una semana sin descuadres en A7 y todos los escenarios en verde.

---

## 10. Fase F7 — Producción y cliente (3–4 días)

1. Crear `multicaja-prod` (tu aprobación del costo).
2. Aplicar las migraciones; `schema:compare` igual a `pruebas`; correr A10.
3. Crear la cuenta del cliente: 2 sedes, sus cajas, licencia, `engine = v2`.
4. **Pasar sus datos** desde Precios al Día (si ya empezó a usarlo en un local): productos, clientes y saldos como `INICIAL`, conteo físico por sede como `CONTEO`. Script `scripts/migrar-cliente.mjs` probado primero en `pruebas` con una copia de sus datos.
5. **Primer día en vigilancia:** A7 cada hora durante la primera semana; tú y el cliente hacen un conteo físico de 10 productos al cierre del día 1 y del día 3.
6. Plan de vuelta atrás: si aparece un descuadre que no se explica, se apaga la caja B y se sigue con una sola mientras se corrige.

---

## 11. Escenarios del banco multicaja (A4–A6)

| # | Escenario | Resultado esperado |
|---|---|---|
| E1 | Caja A y Caja B venden el mismo producto 10 veces cada una | Stock = inicial − 20 |
| E2 | Las dos intentan vender la última unidad al mismo tiempo | Una vende; la otra recibe "sin stock" |
| E3 | Caja B sin internet vende 5 y se reconecta | 5 ventas en el servidor, ninguna duplicada |
| E4 | Las dos sin internet venden la última unidad | Las dos ventas quedan; aparece una diferencia pendiente para el dueño |
| E5 | Cliente fía en A y abona en B al mismo tiempo | Saldo correcto; cada movimiento con su sede |
| E6 | A y B abren y cierran turno por separado | Cuadres independientes; el consolidado suma bien |
| E7 | Anular en B una venta de A | Stock devuelto; dinero sale del turno de B; constancia de la caja de origen |
| E8 | Compra de mercancía en la sede A mientras B vende | Stock de A sube, el de B no cambia (stock por sede) |
| E9 | Reloj de una caja adelantado 10 minutos | Orden y cierres correctos (se usa la hora del servidor para ordenar) |
| E10 | Equipo expulsado intenta vender | Rechazado con internet; sin internet solo hasta que venza su permiso |
| E11 | Reintentar la misma venta 3 veces por fallas de red | Una sola venta |
| E12 | Cuenta con `engine = v1` | Se comporta exactamente como Precios al Día hoy |

---

## 12. Traer los arreglos de Precios al Día (sin quedarse atrás)

- **Cada semana**, o cuando se publique algo importante en Precios al Día: `git fetch upstream`, rama `sync/upstream-AAAA-MM-DD`, `git merge upstream/main`, CI en verde, PR.
- **Zonas donde chocarán los cambios** (revisarlas a mano en cada unión): `checkoutProcessor.js`, `voidSaleProcessor.js`, `merchandisePurchases.js`, `closureLogic.js`, `useCloudSync.js`, `storageService.js`.
- **Para que choquen poco:** lo nuevo va en archivos nuevos (`src/engine-v2/…`), y en los archivos de Precios al Día solo se agrega un desvío corto: `if (engine === 'v2') return v2.procesarVenta(...)`.
- Si una unión trae un cambio que mueve stock o dinero, se agrega su caso a la lista de "vías olvidadas" de F2.

---

## 13. Lista antes de cada paso a producción

- [ ] CI en verde (lint, typecheck, A1, A2, build, `gitleaks`).
- [ ] A4, A5 y A6 en verde contra `pruebas`.
- [ ] A7 sin descuadres en `pruebas` en los últimos 3 días.
- [ ] `schema:compare` igual entre `pruebas` y `prod`.
- [ ] Respaldo de `prod` hecho hoy (`backup:supabase`).
- [ ] Migración con su `-- ROLLBACK` probado en `pruebas`.
- [ ] Tu aprobación escrita en el PR.

---

## 14. Calendario aproximado

| Fase | Duración | Acumulado |
|---|---|---|
| F0 Montaje | 2–3 días | ~0,5 semanas |
| F1 Sedes, equipos, licencia | 1 semana | ~1,5 |
| F2 Libro de stock y cobro | 3–4 semanas | ~5 |
| F3 Fiados en el servidor | 1–1,5 semanas | ~6,5 |
| F4 Turnos y reportes | 1–1,5 semanas | ~8 |
| F5 Sin internet | 1 semana | ~9 |
| F6 Banco completo y Supervisor | 1 semana | ~10 |
| F7 Producción y cliente | 3–4 días | **~10,5 semanas (≈2,5 meses)** |

Mientras tanto, el cliente puede usar Precios al Día normal en un solo local, y en la F7 se pasan sus datos.

---

## 15. Decisiones pendientes

| # | Decisión | Quién | Afecta a |
|---|---|---|---|
| P1 | Nombre del producto y del repo | Tú | F0 |
| P2 | ¿Stock por sede o un solo total? (el multilocal eligió por sede) | El cliente | F2 |
| P3 | ¿Los equipos de solo consulta cuentan para el límite de la licencia? | Tú | F1 |
| P4 | ¿Un cajero por turno o varios? | El cliente | F4 |
| P5 | Horas que dura el permiso sin internet (propuesta: 72) | Tú | F5 |
| P6 | ¿Se archiva `preciosaldia-multilocal`? (propuesta: sí, después de sacar sus piezas) | Tú | F0 |
| P7 | Plan de Supabase y costo de los dos proyectos | Tú | F0 y F7 |

---

## 16. Antes de empezar (no es de este proyecto, pero es urgente)

El repo público `estaci-n-listo-pos-lite` tiene escrita la llave `service_role` de la base de producción de Listo, y `/api/delete-user` borra cuentas sin login. Hay que cambiar esa llave en Supabase y cerrar ese endpoint.
