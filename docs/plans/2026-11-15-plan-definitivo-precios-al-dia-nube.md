# Plan definitivo: Precios al Día Nube (multicaja y multisede, estilo Fina Partner)

**Fecha:** 2026-11-15
**Estado:** Aprobado como rumbo por el dueño. No ha empezado: falta cumplir el prerrequisito (sección 3) y confirmar las decisiones marcadas «por confirmar» (sección 2).
**Reemplaza a:** [2026-11-13-plan-preciosaldia-multicaja.md](2026-11-13-plan-preciosaldia-multicaja.md) (nube) y [2026-11-14-plan-multicaja-lan.md](2026-11-14-plan-multicaja-lan.md) (red local). Los dos quedan como historia. De ellos se toman las barandas, los arneses y los escenarios.
**Pendiente asociado:** P-021 en [PENDIENTES.md](../../PENDIENTES.md).

---

## 0. En una frase

**El dueño entra a su cuenta desde cualquier equipo (PC, tablet o teléfono) y trabaja ahí, como en Fina Partner.** Los datos (inventario, clientes, fiados, ventas, turnos) viven en la nube y son de la cuenta, no de un equipo. Varias cajas y varias sedes trabajan a la vez sin descuadrar. Si se va internet, la caja sigue vendiendo un tiempo y luego sube todo. Y la versión nueva **sigue recibiendo los arreglos de Precios al Día actual**.

> **Analogía:** hoy cada caja tiene su propio cuaderno guardado en la gaveta (el navegador del equipo). Si la caja se daña, el cuaderno se pierde, y dos cajas no se enteran de lo que vende la otra. Con este plan **hay un solo cuaderno en la nube**, como una cuenta de banco: entras desde cualquier cajero con tu clave y ves el mismo saldo. Cada caja guarda una fotocopia para trabajar rápido y para cuando se cae internet.

**Glosario rápido**
- **Cuenta:** el negocio. Tiene dueño (correo y clave), empleados (nombre, rol y PIN), sedes y equipos.
- **Equipo:** cada PC, tablet o teléfono que entró a la cuenta. Se registra la primera vez con el correo y la clave del dueño. Después los cajeros entran con su PIN.
- **Libro de movimientos:** en vez de guardar «hay 10 harinas», se anota cada entrada y salida («+12 compra», «−1 venta caja A»). El stock es la suma. Si dos cajas venden a la vez, las dos líneas quedan escritas.
- **RPC (función del servidor):** una ventanilla del banco. La caja no escribe directo en el cuaderno: le pide a la ventanilla «anota esta venta» y la ventanilla revisa que todo esté en orden.
- **Upstream:** el repo de Precios al Día actual, del que la versión nueva trae sus arreglos.
- **Arnés:** prueba automática que atrapa un error antes de que llegue al cliente. **Baranda:** regla que el sistema obliga a cumplir.

---

## 1. Cómo está hoy (revisado en el código el 2026-11-15)

| Pieza | Hoy en Precios al Día Bodega | Archivo |
|---|---|---|
| Datos | Todo vive en el navegador de cada equipo (IndexedDB con `localforage`). Cada caja es una isla. | `src/utils/storageService.js` |
| Acceso | No hay cuenta con correo para trabajar: cada equipo tiene una identidad propia (`PDA-V2-…`) y una sesión anónima de Supabase. Usuarios y PIN viven en el equipo. | `src/hooks/store/useAuthStore.js`, `src/services/supervisorAuth.js` |
| Licencia | Por equipo (`ACTIV-XXXX-XXXX` atada al ID del equipo). | `src/hooks/useLicenseMonitoring.js`, tabla `licenses` |
| Nube | Solo respaldos, licencia y Modo Supervisor (`sync_documents`, `supervisor_commands`). | `src/hooks/useCloudSync.js`, `src/hooks/useMonitorSync.js` |
| Stock | Lo resta la propia caja al cobrar. | `src/utils/checkoutProcessor.js` |
| Fiados y billetera | Libro de clientes dentro del equipo. | `src/utils/customerLedger.js` |
| Turnos | Uno solo por equipo. | `src/utils/cashShift.js` |

**Lo que se reutiliza:** toda la interfaz pulida de Bodega (inicio, Vender, cobro, Ajustes, clientes, nómina), el libro de clientes, las reglas de vuelto y redondeo, y los arreglos de seguridad recientes. De Listo POS Lite: registro de equipos con límite, numeración de ventas por caja (`#A-00001`), turnos por caja. De `preciosaldia-multilocal`: el libro `stock_movements`, el permiso sin internet (`offline-lease`) y las decisiones D1–D10.

---

## 2. Decisiones

| # | Decisión | Elegido | Estado |
|---|---|---|---|
| D1 | ¿Nube o red local? | **Nube (estilo Fina Partner).** La red local ataba los datos a una PC del negocio y no permitía entrar desde cualquier lugar. | Decidido por el dueño (2026-11-15) |
| D2 | ¿Debe seguir recibiendo los arreglos de Precios al Día actual? | **Sí** (sección 8). | Decidido por el dueño (2026-11-15) |
| D3 | ¿Repo aparte o el mismo de Bodega? | **Repo privado aparte, conectado a Precios al Día como upstream.** Los clientes actuales tienen datos en sus equipos, licencias por ID y un Supabase propio; mezclar los dos modelos en el mismo repo obligaría a probar cada cambio dos veces y arriesga a los clientes reales. Con el repo aparte, los arreglos llegan igual por la sección 8. | Por confirmar |
| D4 | ¿Proyecto de Supabase aparte? | **Sí:** `nube-pruebas` y `nube-prod` en la organización `preciosaldiacloud`. La base de Precios al Día actual no se toca. | Por confirmar (costo, P7) |
| D5 | ¿Cómo se entra? | **Dueño con correo y clave. Empleados con PIN** en un equipo ya registrado. El dueño puede entrar desde su teléfono y ver todo: reemplaza al Modo Supervisor en esta versión. | Por confirmar |
| D6 | ¿Stock por sede o un solo total? | **Por sede**, con un total para el dueño (como decidió el multilocal). | Por confirmar con el cliente de dos sedes |
| D7 | ¿Licencia por equipo o por cuenta? | **Por cuenta**, con un número de cajas incluido. Los teléfonos de solo consulta (dueño) **no cuentan**. | Por confirmar (precio por caja extra: P3) |
| D8 | ¿Cuánto tiempo puede vender una caja sin internet? | **72 horas.** Pasado ese tiempo, pide conectarse. | Por confirmar |
| D9 | ¿Un cajero por turno o varios? | **Un turno por caja; varios cajeros pueden entrar con su PIN** y cada venta guarda quién la hizo. | Por confirmar con el cliente |
| D10 | ¿Se pueden pasar clientes de Precios al Día actual? | **Sí, de forma opcional**, importando su respaldo (el archivo de «Exportar respaldo» que ya existe). | Decidido en este plan |

**Decisiones de negocio (no frenan el arranque):** P1 nombre del producto (en este plan «Precios al Día Nube», repo `preciosaldia-nube`); P3 precio por caja extra; P7 plan y costo de Supabase (con varias cajas en tiempo real lo realista es el plan Pro, unos 25 US$ al mes más el uso; se confirma en F0 y en F8).

---

## 3. Prerrequisito: llevar lo pulido a `main` (1 día)

El repo nuevo se copia desde `main` en GitHub. Hoy lo pulido de Bodega (inicio, Vender, cobro, Ajustes, clientes, nómina, documentación) está en la rama `feat/inicio-estilo-farmacia`, sin publicar.

1. Revisar y guardar los cambios sueltos que queden en el árbol.
2. PR de `feat/inicio-estilo-farmacia` a `main`, con CI en verde y vista previa en Vercel.
3. Probar en una caja real (P-009) y publicar.

Sin esto, la versión nueva arrancaría con la Bodega vieja.

**Urgente y aparte:** cambiar la llave `service_role` expuesta en el repo público de Estación Maestra y cerrar `/api/delete-user` (lo hace el dueño en Supabase).

---

## 4. Barandas (reglas que valen para todo el proyecto)

| # | Baranda | Cómo se obliga |
|---|---|---|
| G1 | Repo privado y ninguna llave en el código. | `gitleaks` en `pre-commit` y en CI; protección contra subida de secretos de GitHub. |
| G2 | La llave `service_role` solo vive en el servidor. | Variables de entorno en Vercel; CI falla si encuentra `service_role` o `sb_secret_` en `src/` o `dist/`. |
| G3 | Dos Supabase: `nube-pruebas` y `nube-prod`. Todo se prueba primero en pruebas. | Las vistas previas de Vercel apuntan a pruebas; solo `main` apunta a prod; `schema:compare` igual antes de cada paso. |
| G4 | Migraciones numeradas, repetibles y con su vuelta atrás. Nunca se edita una ya aplicada. | `supabase/migrations/NNN_nombre.sql` con sección `-- ROLLBACK`; CI aplica todo dos veces sobre una base vacía. |
| G5 | Antes de tocar producción: respaldo y aprobación del dueño. | `backup:supabase` + lista de la sección 9. |
| G6 | Los libros son de solo agregar: las correcciones son un movimiento inverso. | `REVOKE UPDATE, DELETE` en las tablas de libros; prueba SQL que intenta borrar y debe fallar. |
| G7 | Todo se puede reintentar sin duplicar. Cada venta, movimiento y abono lleva un ID creado en el equipo. | `PRIMARY KEY`/`UNIQUE` sobre ese ID; el servidor responde «ya lo tengo». |
| G8 | El servidor no confía en el equipo: revisa quién es, de qué cuenta, sede y si el equipo está activo. | Toda escritura pasa por una RPC; RLS en todas las tablas. |
| G9 | Lo nuevo no rompe lo de Precios al Día que llega por upstream. | Lo nuevo vive en `src/nube/`; en los archivos heredados solo hay desvíos cortos (sección 8). |
| G10 | Nada se borra ni se resuelve a ciegas: la cola sin internet nunca se vacía sola; una sobreventa se marca para el dueño. | Prueba que desconecta, vende, reconecta con error y verifica que la cola sigue ahí. |
| G11 | Una rama por tarea, PR con CI en verde y vista previa antes de unir. | Protección de `main` en GitHub. |
| G12 | Cuidar el consumo de Supabase (Precios al Día ya tuvo problemas de egress). | Sincronización por registro y por cambios (`updated_at`), nunca documentos gigantes; `select` solo de columnas necesarias; arnés A9. |
| G13 | Datos de cada cuenta aislados. | RLS por `account_id` en todas las tablas; arnés A10 intenta leer otra cuenta y debe fallar. |

---

## 5. Arneses (pruebas y herramientas)

| # | Arnés | Qué demuestra | Cuándo corre |
|---|---|---|---|
| A1 | Pruebas unitarias (vitest; heredadas de Bodega) | Las funciones sueltas hacen lo que deben. | Cada commit y en CI |
| A2 | Pruebas de base de datos (`tests/sql/*` contra `supabase start`) | Las RPC, el RLS y las barandas G6–G8 y G13 funcionan de verdad. | CI en cada PR |
| A3 | Datos de prueba fijos (`scripts/seed-pruebas.mjs`) | Una cuenta con 2 sedes, 3 equipos (Caja A, Caja B, teléfono del dueño), 20 productos y 3 clientes con fiado. | Antes de A2, A4 y A5 |
| A4 | Banco multicaja (Playwright con dos navegadores a la vez) | Dos cajas vendiendo al mismo tiempo no descuadran (escenarios de la sección 7). | CI nocturno y antes de cada paso a producción |
| A5 | Simulador sin internet (`context.setOffline`) | Vender sin conexión, reconectar, sin duplicar ni perder. | Junto con A4 |
| A6 | Prueba de choque (`scripts/stress-checkout.mjs`) | 50 cobros simultáneos del mismo producto: el stock baja exactamente 50 o se rechazan los que no alcanzan. | Antes de cada paso de F3 |
| A7 | Revisor de cuadres (`scripts/verify-invariants.mjs`, solo lectura) | Stock = conteo inicial + movimientos; ningún ID repetido; todo fiado cuadra con su libro; ningún turno cerrado con diferencia sin explicar. | Diario en prod y en CI contra pruebas |
| A8 | Comparador de esquemas (`schema:compare`) | Pruebas y prod tienen la misma estructura. | Antes de cada paso a producción |
| A9 | Medidor de consumo | Cuántos KB baja y sube cada equipo por hora. | Semanal en pruebas |
| A10 | Revisor de seguridad (asesores de Supabase + «sin login no se lee nada» + «una cuenta no ve a otra») | No hay tablas sin RLS ni funciones abiertas. | Cada PR que toque `supabase/` |
| A11 | Entrar desde otro equipo | El dueño entra en un navegador limpio y ve exactamente los mismos datos que la caja. | Cada PR que toque sincronización |

**Regla de oro:** si A4, A6, A7 o A11 fallan, **no se avanza de fase**.

---

## 6. Fases

### F0 — Montar el proyecto (3 días)

**Objetivo:** un repo privado que arranca igual que Bodega, conectado a su propio Supabase de pruebas y a Precios al Día como upstream.

1. Crear el repo privado `preciosaldia-nube` copiando `main` de `preciosaldia2026` **desde GitHub**, con su historial (no desde la carpeta local).
2. Agregar `preciosaldia2026` como remoto `upstream` y probar la primera unión (sección 8).
3. Crear `nube-pruebas` en `preciosaldiacloud` (con aprobación del costo).
4. Proyecto nuevo en Vercel con sus variables de entorno.
5. Nombre visible, ícono y `manifest` distintos para que no se confunda con Precios al Día en el teléfono del cliente.
6. `gitleaks` en `pre-commit` y CI; protección de `main`.
7. Esqueletos de A2, A3, A7 y la carpeta `src/nube/`.

**Barandas:** G1–G4, G11. **Listo cuando:** la app abre en la vista previa contra pruebas, CI en verde, `gitleaks` limpio y la unión de prueba con upstream sin conflictos.

### F1 — Cuentas, empleados, equipos y licencia (1,5 semanas)

**Objetivo:** crear cuenta con correo, entrar desde cualquier equipo, registrar equipos con límite y que los empleados entren con PIN.

- **Tablas:** `accounts`, `account_members` (dueño, administrador, cajero; PIN guardado con hash en el servidor), `sedes`, `account_devices` (sede, letra de caja A/B…, rol `caja`/`consulta`, `last_seen`), `account_licenses` (`max_cajas`, `max_sedes`, vencimiento; **solo lectura** para el dueño).
- **RPC:** `create_account`, `register_device` (revisa el límite de la licencia), `assign_device`, `revoke_device`, `member_login_pin`.
- **Pantallas:** crear cuenta e iniciar sesión (correo y clave, recuperar clave); «Este equipo es…» (sede y caja) la primera vez; selector de empleado con PIN (el actual de Bodega, ahora leído de la nube); Ajustes › Equipos (renombrar, cambiar de sede, expulsar).
- **Seguridad:** el dueño siempre con clave; mismas reglas del PIN del Administrador que ya tiene Bodega (sin 000000).

**Arneses:** A2 (el equipo n.º 4 con límite 3 es rechazado; el dueño no puede subir su `max_cajas`; un cajero no puede registrar equipos), A10, A11 inicial. **Listo cuando:** se crea una cuenta, se registran 3 equipos con su letra, un 4.º es rechazado y el dueño entra desde un navegador limpio.

### F2 — Catálogo, clientes y ajustes en la nube (2 semanas)

**Objetivo:** productos, categorías, clientes, proveedores, métodos de pago y ajustes del negocio pasan a ser de la cuenta. Cualquier equipo los ve igual y al momento.

- **Tablas por registro** (nada de documentos gigantes, G12): `products`, `categories`, `customers`, `suppliers`, `payment_methods`, `business_settings`, con `updated_at` y borrado suave.
- **Fotocopia local:** cada equipo guarda una copia en IndexedDB para buscar rápido (con miles de productos) y para trabajar sin internet. Al abrir solo baja lo que cambió desde la última vez; los cambios de otras cajas llegan en tiempo real.
- **Desvío en `storageService`:** en la versión nueva, guardar un producto o un cliente va a la nube y actualiza la fotocopia.
- **Importar desde Precios al Día (D10):** subir el archivo de respaldo y pasar productos, clientes y ajustes a la cuenta.

**Arneses:** A11 (editar un precio en la Caja A aparece en la B y en el teléfono del dueño en segundos), A9 (consumo con 2.400 productos), A1 heredadas en verde. **Listo cuando:** dos equipos editan el catálogo y ambos quedan iguales sin recargar, y un respaldo real de Bodega se importa completo.

### F3 — Libro de stock y cobro en el servidor (3–4 semanas) 🔴 la más delicada

**Objetivo:** el stock lo calcula el servidor a partir de movimientos. Dos cajas vendiendo lo mismo a la vez nunca pierden una venta.

- **Tablas** (basadas en `007_stock_ledger.sql` del multilocal): `stock_movements` (ID único, cuenta, sede, producto, equipo, cantidad ±, motivo, referencia, fecha del equipo y del servidor; motivos `VENTA`, `ANULACION`, `COMPRA`, `AJUSTE`, `CONTEO`, `INICIAL`), `stock_levels` (lo actualiza solo el servidor en la misma transacción), `sales` y `sale_items`.
- **RPC:** `process_checkout` (venta, líneas, pagos y movimientos en **una sola transacción**, con bloqueo de fila; si el ID ya existe responde «ya registrada»), `process_void` (movimiento inverso, nunca borra), `process_purchase` (compras de mercancía), `process_adjustment` y `process_count`.
- **En la app:** `checkoutProcessor.js`, `voidSaleProcessor.js`, `merchandisePurchases.js` y los ajustes de inventario llaman a estas RPC. Numeración por caja `#A-00001`. Se mantiene la ventana «Procesar Pago» y las reglas de vuelto de Bodega.
- **Lista de «vías olvidadas»** (todas deben dejar movimiento): venta, anulación, compra, ajuste rápido, conteo, lote de inventario, edición de producto, devolución, Cashea, importación masiva, mercancía de empleado (nómina).

**Arneses:** A2, A4 (E1, E2, E7, E8, E11), A6, A7, prueba de vías olvidadas. **Parada:** un solo producto descuadrado en A7 detiene la fase. **Listo cuando:** A2, A4, A6 y A7 en verde 3 días seguidos en pruebas.

### F4 — Fiados, abonos y billetera en el servidor (1,5 semanas)

**Objetivo:** el saldo de cada cliente (deuda o saldo a favor) es la suma de su libro, en el servidor. Un fiado en la sede A y un abono en la B a la vez no se pisan.

- **Tabla:** `customer_movements` (ID único, sede de origen, cliente, tipo, monto en US$ y Bs, tasa, referencia, fechas). Tipos del `customerLedger.js` actual: venta fiada, abono, vuelto a billetera, compra con saldo a favor, anulación.
- `process_checkout` agrega el fiado o el uso de billetera en la misma transacción que la venta.
- Clientes compartidos entre sedes; cada movimiento guarda dónde se hizo.

**Arneses:** A2; A4 (E5); A7 (saldo = suma del libro); los escenarios de la verificación de clientes del 2026-11-14 ([informe](../reports/2026-11-14-verificacion-clientes-e2e.md)) en verde. **Listo cuando:** los saldos de los 3 clientes de prueba cuadran tras 100 operaciones mezcladas entre dos cajas.

### F5 — Turnos por caja, cierres, reportes, gastos y nómina (1,5 semanas)

**Objetivo:** cada caja abre y cierra su turno; el dueño ve el cierre de cada caja, de cada sede y el total, desde cualquier equipo.

- `cash_sessions` y `cash_movements` en el servidor, con caja, sede y cajero. Apertura con fondo como hoy en Bodega (CASO-002).
- Cierre del día consolidado por sede y total, con aviso si alguna caja sigue abierta.
- Anular en la caja B una venta de la A devuelve el dinero en el turno de B y anota la caja de origen.
- Gastos, aportes y nómina (CASO-005) como movimientos de caja en el servidor.
- Reportes con filtro por sede, caja y cajero.

**Arneses:** pruebas de cierre con dos cajas; A4 (E6); turno que cruza la medianoche. **Listo cuando:** cerrar A no cierra B y el consolidado coincide con la suma de los cierres.

### F6 — Trabajar sin internet (1 semana)

**Objetivo:** si se va internet, la caja sigue vendiendo; al volver sube todo sin duplicar ni perder.

- **Permiso sin internet:** el equipo guarda un permiso firmado por el servidor que vence a las 72 horas (D8). Un equipo expulsado no puede seguir vendiendo cuando vence.
- **Cola local** con el ID de cada venta, abono o movimiento; al reconectar se envía en orden y «ya registrada» cuenta como éxito.
- **Sobreventa:** la venta se guarda igual y se crea una diferencia pendiente para el dueño. No se rechaza ni se arregla sola.
- Aviso visible: «Sin internet · 5 ventas por subir».

**Arneses:** A5 (E3, E4, E10), reconectar con error a mitad (la cola sigue intacta). **Listo cuando:** A5 pasa 20 veces seguidas.

### F7 — Banco completo y teléfono del dueño (1 semana)

- Todos los escenarios de la sección 7 durante una semana de uso simulado en pruebas.
- **Teléfono del dueño:** entra con su correo y clave como equipo de consulta (no cuenta para la licencia). Ve ventas en vivo, cierres, inventario y clientes de todas las sedes. Esto reemplaza al Modo Supervisor: el código del Supervisor no se borra, solo queda apagado en esta versión.
- Medir el consumo con A9 y confirmar el plan de Supabase.

**Listo cuando:** una semana sin descuadres en A7 y todos los escenarios en verde.

### F8 — Producción y primer cliente (4 días)

1. Crear `nube-prod` (aprobación del costo), aplicar migraciones, `schema:compare` igual a pruebas, A10.
2. Crear la cuenta del cliente: sedes, cajas, licencia.
3. Importar sus datos desde su respaldo de Precios al Día (probado antes en pruebas con una copia): productos, clientes y saldos como `INICIAL`, conteo físico por sede como `CONTEO`.
4. Primera semana en vigilancia: A7 cada hora; conteo físico de 10 productos al cierre del día 1 y del día 3.
5. Vuelta atrás: si aparece un descuadre sin explicación, se apaga la caja B y se sigue con una sola mientras se corrige. El cliente conserva su Precios al Día actual hasta terminar la primera semana.

---

## 7. Escenarios del banco multicaja

| # | Escenario | Resultado esperado |
|---|---|---|
| E1 | Caja A y Caja B venden el mismo producto 10 veces cada una | Stock = inicial − 20 |
| E2 | Las dos intentan vender la última unidad al mismo tiempo | Una vende; la otra recibe «sin stock» |
| E3 | Caja B sin internet vende 5 y se reconecta | 5 ventas en el servidor, ninguna duplicada |
| E4 | Las dos sin internet venden la última unidad | Las dos ventas quedan; aparece una diferencia pendiente para el dueño |
| E5 | Cliente fía en A y abona en B al mismo tiempo | Saldo correcto; cada movimiento con su sede |
| E6 | A y B abren y cierran turno por separado | Cuadres independientes; el consolidado suma bien |
| E7 | Anular en B una venta de A | Stock devuelto; el dinero sale del turno de B; queda la caja de origen |
| E8 | Compra de mercancía en la sede A mientras B vende | Sube el stock de A; el de B no cambia |
| E9 | Reloj de una caja adelantado 10 minutos | Orden y cierres correctos (se ordena con la hora del servidor) |
| E10 | Equipo expulsado intenta vender | Rechazado con internet; sin internet solo hasta que vence su permiso |
| E11 | Reintentar la misma venta 3 veces por fallas de red | Una sola venta |
| E12 | El dueño entra desde un teléfono nuevo | Ve los mismos datos que las cajas, sin ocupar una caja de la licencia |
| E13 | Se edita un precio en A mientras B cobra ese producto | B cobra el precio que tenía al agregarlo a la cesta y ve el nuevo en la siguiente venta |
| E14 | Una cuenta intenta leer datos de otra | Rechazado (G13) |

---

## 8. Seguir recibiendo los arreglos de Precios al Día (decisión D2)

**Sí se puede.** El repo nuevo nace como copia de Precios al Día y lo mantiene conectado como upstream, como una sucursal que sigue recibiendo los manuales de la casa matriz.

- **Cada semana**, o cuando se publique algo importante en Precios al Día: rama `sync/upstream-AAAA-MM-DD`, `git fetch upstream`, `git merge upstream/main`, CI en verde y PR.
- **Lo que llega sin esfuerzo:** pantallas, diseño, textos, Vender, cobro, vueltos, Ajustes, tickets, impresoras, reportes, nómina y arreglos de errores que no tocan el lugar donde se guardan los datos.
- **Lo que hay que revisar a mano en cada unión** (donde la versión nueva se desvía): `checkoutProcessor.js`, `voidSaleProcessor.js`, `merchandisePurchases.js`, `cashShift.js`/cierres, `customerLedger.js`, `storageService.js`, `useCloudSync.js`, `useAuthStore.js`.
- **Para que choquen poco:** todo lo nuevo va en `src/nube/` y en los archivos heredados solo se agrega un desvío corto, por ejemplo `if (esNube) return nube.procesarVenta(venta)`.
- Si una unión trae un cambio que mueve stock o dinero, se agrega a la lista de «vías olvidadas» de F3 y se le escribe su prueba.
- **Lo que no llega:** el Modo Supervisor y la licencia por equipo siguen evolucionando solo en Precios al Día; en la versión nueva quedan apagados.
- **Al revés también:** si en la versión nueva se arregla algo de la interfaz, se lleva a Precios al Día con un PR allá, para que la próxima unión no choque.

---

## 9. Lista antes de cada paso a producción

- [ ] CI en verde (lint, typecheck, A1, A2, build, `gitleaks`).
- [ ] A4, A5, A6 y A11 en verde contra pruebas.
- [ ] A7 sin descuadres en pruebas los últimos 3 días.
- [ ] `schema:compare` igual entre pruebas y prod.
- [ ] Respaldo de prod hecho hoy.
- [ ] Migración con su `-- ROLLBACK` probado en pruebas.
- [ ] Aprobación escrita del dueño en el PR.

---

## 10. Calendario aproximado

| Fase | Duración | Acumulado |
|---|---|---|
| Prerrequisito: lo pulido a `main` | 1 día | — |
| F0 Montaje | 3 días | ~0,5 semanas |
| F1 Cuentas, empleados, equipos y licencia | 1,5 semanas | ~2 |
| F2 Catálogo, clientes y ajustes en la nube | 2 semanas | ~4 |
| F3 Libro de stock y cobro | 3–4 semanas | ~7,5 |
| F4 Fiados y billetera | 1,5 semanas | ~9 |
| F5 Turnos, cierres, reportes, gastos y nómina | 1,5 semanas | ~10,5 |
| F6 Sin internet | 1 semana | ~11,5 |
| F7 Banco completo y teléfono del dueño | 1 semana | ~12,5 |
| F8 Producción y primer cliente | 4 días | **~13 semanas (≈3 meses)** |

Es unas 2,5 semanas más que el plan del 13-11, porque aquel no incluía entrar con correo desde cualquier equipo (F1) ni subir el catálogo y los clientes a la nube (F2). Mientras tanto, el cliente puede usar Precios al Día actual y en F8 se pasan sus datos.

---

## 11. Riesgos principales

| Riesgo | Qué pasa | Cómo se reduce |
|---|---|---|
| Error en el cobro del servidor | Ventas o stock mal anotados en todas las cajas | F3 con A2, A4, A6 y A7; parada ante un solo descuadre |
| Internet malo en el local | Cajas lentas o sin vender | Fotocopia local para buscar; F6 con permiso de 72 h y cola |
| Costo de Supabase | Factura alta con muchas cajas en tiempo real | G12, A9 y plan confirmado en F7 antes de producción |
| Uniones con upstream que chocan | Arreglos que tardan en llegar o rompen algo | Código nuevo aislado en `src/nube/`, desvíos cortos, unión semanal pequeña |
| Fuga entre cuentas | Un negocio ve datos de otro | G8, G13 y A10 en cada PR |
| Clave del dueño robada | Alguien entra a la cuenta | Recuperación de clave por correo; expulsar equipos desde Ajustes; más adelante, segundo factor |

---

## 12. Qué sigue

1. El dueño confirma D3–D9 (o las cambia).
2. Prerrequisito: PR de `feat/inicio-estilo-farmacia` a `main` y publicar.
3. F0 con aprobación del costo de `nube-pruebas`.
