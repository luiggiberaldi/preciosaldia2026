# Auditoría: cómo documenta Farmacia y qué llevarse a Bodega — 2026-11-13

**Solo lectura.** No se tocó nada en Farmacia (rama `pruebas`) ni en Bodega (rama `feat/inicio-estilo-farmacia`). Sin commit ni push.

---

## 1. Resumen en dos minutos

Imagina que Farmacia tiene **una oficina con archivadores etiquetados y un guardia en la puerta**:

- Los archivadores son: la **bitácora** (diario de cambios), los **casos** (una carpeta por cada trabajo grande), los **errores** (una ficha por cada fallo, con su solución) y el **manual del sistema** (un documento por módulo).
- El guardia es un script (`docs-check`) que corre solo antes de cada commit y **no te deja guardar** si algo no cuadra (enlace roto, error sin solución, código cambiado sin nota en la bitácora…).

Bodega tiene muchos papeles (planes, auditorías, reportes), pero **sin archivadores ni guardia**: cada documento está donde cayó y nada obliga a mantenerlos al día.

**Recomendación corta:** llevar a Bodega la **versión ligera** del modelo (ley corta + bitácora al día + errores + casos solo para trabajos grandes + `PENDIENTES.md`), con el guardia **en modo aviso** al principio. **No** copiar el manual por módulos completo ni los 63 casos. Detalle en la sección 6.

---

## 2. Cómo documenta Farmacia (inventario)

| Pieza | Dónde | Tamaño hoy | Para qué sirve |
|---|---|---|---|
| Ley de documentación | `docs/LEY-DOCUMENTACION.md` | 96 líneas | Reglas: qué se escribe, dónde, cuándo, plantillas, versiones |
| Guía técnica + perfil del dueño | `AGENT.md` (raíz) | 740 líneas | Guía para agentes; incluye el aviso de "Luigi no lee código" y un resumen de la ley |
| Bitácora | `bitacora.md` (raíz) | 2.419 líneas | Diario: una entrada por cambio, la más nueva arriba, con **Versión / Contexto / Cambios / Casos y errores / Verificación** |
| Casos | `docs/casos/CASO-NNN-slug.md` + `INDICE.md` | 63 casos | Una carpeta por trabajo con varios archivos, visible al usuario, o que toca dinero/inventario/licencias |
| Errores | `docs/ERRORES.md` | 1.401 líneas, 118 fichas (ERR-NNN) | Cada error con **causa y solución** (o "Abierto" con qué falta) |
| Manual del sistema | `docs/sistema/` (INICIO, FLUJOS, GLOSARIO, MANTENIMIENTO + 14 módulos) | ~1.700 líneas | Explica cómo funciona cada pantalla, leyendo el código |
| Mapa código → documento | `docs/sistema/MAPA-CODIGO-DOCS.json` | 1 archivo | Dice "si cambia este archivo de código, revisa este documento" |
| Auditorías y planes | `docs/AUDITORIA-*.md`, `docs/PLAN-*.md`, `PLAN-REFACTOR-600-LINEAS.md` | 7 archivos | Informes puntuales (no tienen reglas propias) |
| Pendientes | `PENDIENTES.md` (raíz) | 104 líneas | Lista de cosas por hacer, con ID `P-NNN`, estado y pasos exactos (la dejó otra sesión) |
| **El guardia** | `scripts/docs-check.mjs` + `tests/docsCheck.test.js` | 299 + 214 líneas | Revisa la ley automáticamente |
| Hooks | `githooks/pre-commit` (docs-check → imports → 600 líneas → eslint → tsc) y `pre-push` (e2e del cobro) | — | Hacen cumplir todo; se activan solos con `bun install` (`prepare`) |
| CI | `.github/workflows/ci.yml` | 1 paso | Corre `docs-check --ci` en GitHub |

### Reglas clave de la ley

| Regla | Qué dice |
|---|---|
| "Si no está escrito, no pasó" | Todo cambio de código, configuración o base de datos → entrada en la bitácora. Siempre |
| Casos | Solo cambios grandes (varios archivos, visibles, dinero/inventario/licencias) |
| Errores | Todo error encontrado, **con su solución**. Si no hay solución: `Abierto` + qué se intentó |
| IDs | Correlativos, nunca se reutilizan, nunca se borran (se corrigen con nota) |
| Mismo commit | La documentación entra junto con el cambio, no "después" |
| Resultado real | Si algo no se probó, se escribe "no verificado" |
| Lenguaje sencillo | Término técnico = explicado con comparación cotidiana |
| **Regla 7 (proponer)** | Si ves algo mejorable (incluidas las leyes), lo propones en 4 líneas (qué, por qué, costo, qué pasa si no); máximo 3 por tarea; el dueño decide; lo no decidido va a `PENDIENTES.md` |
| Versiones | Cada **entrega** lleva versión (2.1.0 → 2.1.1 arreglos, 2.2.0 función nueva, 3.0.0 migración). Bitácora y `package.json` deben coincidir |

### Plantillas (dos, cortas)

- **Bitácora:** `## AAAA-MM-DD — Título (rama X)` + Versión, Contexto, Cambios, Casos y errores, Verificación.
- **Error:** `## ERR-NNN — Síntoma` + Fecha, Estado (Resuelto / Abierto / Descartado), Dónde, Síntoma, Causa, Solución, Cómo comprobarlo, Relacionados.
- **Caso:** se ve por ejemplo en CASO-062: Fecha, Estado, Qué pidió el dueño, Qué se hizo, Qué no cambió, Pruebas, Errores, Versión.

### Convenciones de nombres y fechas

- Casos: `CASO-NNN-slug-corto.md` (3 dígitos). Estados: Propuesto · En curso · Aplicado · Verificado · Revertido · Descartado.
- Errores: `ERR-NNN`. Pendientes: `P-NNN`.
- Fechas siempre `AAAA-MM-DD`. Lo anterior a la ley se marca "(reconstruido)".
- Auditorías: `AUDITORIA-TEMA-AAAA-MM-DD.md`.

### Lo que revisa el guardia

| Frena el commit (error) | Solo avisa |
|---|---|
| Enlaces rotos entre documentos | Qué documentos revisar porque cambió el código que describen |
| `ERR`/`CASO` citado que no existe | Archivos citados en documentos que ya no existen |
| Error resuelto sin solución; abierto sin plan | |
| Tablas-resumen (errores y casos) que no coinciden con las fichas | |
| Documento de módulo sin regla en el mapa | |
| Versión de `package.json` ≠ última de la bitácora | |
| **Código cambiado en el commit sin tocar `bitacora.md`** | |

Se puede saltar con `git commit --no-verify` (y se documenta después). Límite honesto que la propia Farmacia admite: el guardia comprueba **consistencia, no verdad**; y dos sesiones a la vez pueden elegir el mismo número (ya pasó con ERR-023/024).

---

## 3. Qué funciona bien y qué es excesivo

### Funciona bien (copiar)

| Pieza | Por qué vale |
|---|---|
| Ley corta con "qué se escribe y dónde" | Una sola página que cualquier sesión de IA lee y obedece |
| Bitácora con plantilla fija | Responde "¿qué cambió y por qué?" en segundos; lo agradecen las sesiones nuevas que no tienen memoria |
| Errores con **causa + solución** | Evita arreglar dos veces el mismo fallo (Bodega ya sufrió esto: incidentes de señales, egress, stock de bultos) |
| `PENDIENTES.md` con IDs y pasos exactos | Es lo que permitió pasar trabajo entre Bodega y Farmacia sin perderlo |
| Regla 7 (proponer, no callar ni cambiar solo) | Encaja con el perfil del dueño: él decide, informado |
| Regla "resultado real / no verificado" | Evita la falsa tranquilidad |
| Casos solo para trabajos grandes | La carpeta del trabajo con "qué pidió el dueño / qué no cambió" |
| El guardia en **dos niveles** (error vs. aviso) | Buen diseño: lo grave frena, lo dudoso orienta |

### Excesivo o riesgoso (no copiar tal cual)

| Pieza | Problema |
|---|---|
| **63 casos en 7 días** (07 → 13 nov) | Ritmo de burocracia: hay casos de un ajuste visual o de un solo botón. En Bodega bastaría la bitácora para eso |
| **Manual completo por módulos (14 documentos + mapa JSON)** | Es el trabajo más caro de mantener y el que más rápido se desactualiza. El guardia solo avisa "revisa esto", no garantiza que sea verdad. Para Bodega, un manual de **3 a 5 módulos clave** (Venta, Caja/Cierre, Inventario, Supervisor, Reglas del dinero) rinde más |
| **Bitácora de 2.419 líneas y ERRORES de 1.401** | Ya cuesta leerlos completos. Conviene partirlos por mes (`docs/bitacora/2026-11.md`) desde el inicio |
| **Frenar el commit si no hay entrada en la bitácora** | Con varias sesiones trabajando a la vez en una misma carpeta (como hoy en Bodega), frena commits legítimos y empuja a `--no-verify`, que anula todo el sistema. En Bodega arrancaría como **aviso** |
| **Versión obligatoria igual en bitácora y `package.json`** | Bodega está en `2.0.5`, con la bitácora sin versiones (solo 1 mención). Activarla de golpe daría error en cada commit |
| Hook con 5 controles encadenados (docs, imports, 600 líneas, eslint, tsc) | Solo `docs-check` pertenece a este tema. Los otros controles son otra decisión (ver abajo) |
| Perfil del dueño duplicado en `AGENT.md` | Bodega **ya lo tiene** igual (sección "Perfil del dueño"); no hace falta nada |
| Raíz llena de PDF de cierres (30 archivos) en Farmacia | No es documentación; es suciedad. No copiar la costumbre |

### Específico de farmacia (no copiar)

| Qué | Dónde aparece |
|---|---|
| Lotes, vencimientos, baja de vencidos, blíster/caja, variantes por talla, "recipe", notificaciones de vencimiento | `INVENTARIO.md`, `FLUJOS.md`, `INICIO.md`, ~25 de los 63 casos (CASO-005, 026, 030, 031, 036, 037, 039, 048, 049, 035…) |
| "Producto `farmacia`" de licencias, "Cashea", "Recipe" | `LICENCIAS.md`, `CARTERA.md`, `GLOSARIO.md` |
| Frase "es la caja registradora de una farmacia" | `INICIO.md` |
| Documentación de Pagos fijos / Servicios | Farmacia la tiene; verificar si Bodega tiene esa pantalla antes de copiar |

Regla de oro para copiar: **la estructura y las reglas, sí; el contenido, no** (cada documento de módulo se vuelve a escribir leyendo el código de Bodega).

---

## 4. Comparación con Bodega

| Tema | Farmacia | Bodega (hoy) | Diferencia |
|---|---|---|---|
| Ley de documentación | `docs/LEY-DOCUMENTACION.md` (96 líneas) | **No existe** | Falta |
| `CLAUDE.md` | No existe (usa `AGENT.md`) | No existe (usa `AGENT.md`, 704 líneas) | Igual: el archivo de reglas es `AGENT.md` |
| Perfil del dueño en `AGENT.md` | Sí | Sí (idéntico) | Nada que hacer |
| Bitácora | 2.419 líneas, plantilla fija, al día (13-nov) | 214 líneas, sin plantilla, **última edición 31-oct** | Bodega lleva ~2 semanas sin bitácora aunque hubo mucho trabajo (supervisor, caja, ventas por día, auth) |
| Registro de errores | `ERRORES.md` con 118 fichas causa+solución | `ISSUES.md` (653 líneas, auditoría del 30-mar con 84 issues, cerrados) + `CHANGES.md` (236) | Bodega tiene la foto de **una** auditoría vieja; no hay registro vivo de errores nuevos. Postmortems sueltos en `docs/reports/` |
| Casos | `docs/casos/` (63) con índice | **No existe.** Hay ~20 `PLAN-*.md` en la raíz y 46 planes fechados en `docs/plans/` + 11 reportes en `docs/reports/` | Bodega documenta bien los **planes** (antes de hacer) pero casi no el **resultado** (después de hacer) |
| Pendientes | `PENDIENTES.md` (P-001…) | **No existe** | Falta |
| Auditorías | `docs/AUDITORIA-*.md` (2) | **11 `AUDITORIA-*.md` en la raíz** + 1 en `docs/` | Bodega tiene más, pero sueltos en la raíz (desorden) |
| Manual del sistema | `docs/sistema/` (4 + 14 módulos) | **No existe** (solo `AGENT.md`) | Falta; es lo más grande |
| Mapa código→doc | JSON | No | Falta |
| Guardia automático | `docs-check.mjs` + test + hook + CI | No (hook solo con eslint/tsc, CI solo lint/typecheck/test/build) | Falta |
| Versiones | 2.7.0 con bitácora alineada | `2.0.5` sin versión en bitácora | Falta |
| Convención de nombres | `CASO-NNN-slug`, `AUDITORIA-TEMA-FECHA` | Planes: `AAAA-MM-DD-slug` (bien, ordenado); raíz: nombres libres (`PLAN-FIXEO-*`, `REPORTE-*`, `M5-*`) | Bodega ya usa fecha en `docs/plans/`; la raíz está desordenada |
| Raíz del repo | 1 PDF por cierre (ruido) | Muchos `.md` sueltos, `.mp4`, `.json`, `.pdf`, scripts `.py` de scraping | Ambos desordenados; en Bodega es mucho más |
| Árbol de trabajo | limpio | **~20+ archivos modificados sin commit** (caja, ajustes, auth) | Ojo: cualquier plan que toque hooks debe esperar a que eso se guarde |

**Lo bueno de Bodega que se debe conservar:** `docs/plans/` con fecha en el nombre (mejor que los `PLAN-*` de Farmacia), `docs/reports/` para postmortems, y el perfil del dueño.

---

## 5. Riesgos al copiar

| Riesgo | Gravedad | Cómo se evita |
|---|---|---|
| **El guardia frena commits** y la gente usa `--no-verify` | Alto | Arrancar en modo aviso; subir a "frena" solo tras 2 semanas de uso limpio |
| Versión `2.0.5` vs bitácora sin versiones → error en cada commit | Medio | Dejar la regla de versión **fuera** de la primera fase |
| Ahora mismo hay ~20 archivos de Bodega sin commit; tocar hooks o `package.json` ahora mezcla temas | Medio | Hacer la documentación en un commit aparte, **después** de guardar lo de caja |
| Dos sesiones eligiendo el mismo `CASO-NNN`/`ERR-NNN` | Medio | Ya conocido en Farmacia: releer el último número antes de escribir; el guardia lo detecta como "ID repetido" |
| Copiar contenido de farmacia por error (lotes, recipe, Cashea…) | Medio | Copiar solo estructura; revisar con `grep -i "lote\|receta\|recipe\|vencim\|farmacia"` al terminar |
| Manual de módulos que nace desactualizado | Medio | Pocos módulos, cada uno con fecha de revisión; no prometer que está 100% al día |
| Retroactividad: querer documentar las 2 semanas pasadas de Bodega | Bajo-medio | Reconstruir solo lo importante en **una** entrada de bitácora "(reconstruido)" apoyada en `git log` |
| Los hooks de Farmacia llaman a `check-imports`, `check-max-lines` y `bunx eslint` | Bajo | No traerlos en esta fase; son otra decisión |
| Conflicto de nombres: Bodega ya tiene `CHANGES.md`/`ISSUES.md` | Bajo | No borrarlos; quedan como "historia de la auditoría de marzo" y se menciona en la ley |

---

## 6. Plan propuesto para Bodega (no se aplicó nada)

Idea: **empezar pequeño, comprobar que se usa, y recién después endurecer.** Como abrir un negocio con un cuaderno antes de comprar la caja registradora.

### Fase 1 — Lo mínimo útil (tamaño: pequeño, ~1 sesión, solo archivos nuevos)

| # | Archivo | Acción | Tamaño |
|---|---|---|---|
| 1 | `docs/LEY-DOCUMENTACION.md` | **Adaptar** la de Farmacia: quitar la regla de versión y las menciones a módulos y al guardia; añadir "qué hacer con `CHANGES.md`/`ISSUES.md`/`docs/plans/`" | ~60 líneas |
| 2 | `bitacora.md` | Añadir plantilla arriba y **una entrada reconstruida** (31-oct → 13-nov) hecha desde `git log`, sin inventar | ~40 líneas |
| 3 | `docs/ERRORES.md` | Archivo nuevo con plantilla y tabla-resumen; empezar con 3–5 errores recientes **reales** (cajas duplicadas, "Efectivo esperado −2.159,35 Bs", sync de ida y vuelta, etc.) con causa y solución ya conocidas | ~80 líneas |
| 4 | `docs/casos/INDICE.md` | Solo el índice con la convención; el primer caso real: **"CASO-001 · Documentación estilo Farmacia"** | ~30 líneas |
| 5 | `PENDIENTES.md` (raíz) | Plantilla con `P-NNN`; mover aquí lo pendiente de Bodega que hoy vive repartido | ~30 líneas |
| 6 | `AGENT.md` | Añadir una sección corta "Ley de documentación" (como la de Farmacia) y cambiar la sección 14 para mencionar ERRORES | ~15 líneas |

### Fase 2 — Un guardia suave (tamaño: mediano, ~1 sesión)

| # | Archivo | Acción |
|---|---|---|
| 7 | `scripts/docs-check.mjs` | Copiar y simplificar: **sin** mapa ni versión; revisa enlaces rotos, errores resueltos sin solución e índices desactualizados. Todo como **aviso** al principio |
| 8 | `tests/docsCheck.test.js` | Adaptar (la suite actual del guardia) |
| 9 | `package.json` | Añadir `docs:check` (sin tocar la versión) |
| 10 | `githooks/pre-commit` | Añadir la llamada **solo en modo aviso** (sin `exit 1`); `.github/workflows/ci.yml` igual |

### Fase 3 — Manual corto (tamaño: grande, varias sesiones, **opcional**)

| # | Archivo | Acción |
|---|---|---|
| 11 | `docs/sistema/INICIO.md`, `GLOSARIO.md`, `FLUJOS.md` | Escribir para Bodega leyendo su código (frase "caja registradora de una bodega") |
| 12 | `docs/sistema/modulos/` | Solo Venta, Cierre de caja, Inventario, Supervisor, Reglas del dinero |
| 13 | `MAPA-CODIGO-DOCS.json` | Mapa mínimo para esos módulos |

### Fase 4 — Orden y endurecer (después de 2 semanas)

- Pasar el guardia a "frena" solo en lo grave (enlaces rotos, error sin solución).
- Mover las 11 `AUDITORIA-*.md` y los `PLAN-*.md` de la raíz a `docs/auditorias/` y `docs/plans/` (con enlaces arreglados). **Esto es lo más arriesgado de ordenar**; hacerlo en un commit aparte.
- Decidir si se agrega el límite de 600 líneas y la revisión de imports (otra conversación, no es documentación).
- Alinear versión (`2.0.5`) con la bitácora solo si el dueño quiere versionar entregas.

### Orden recomendado y dependencias

`1 → 2 → 3 → 4 → 5 → 6` (Fase 1, en un solo commit) → esperar → `7–10` → decidir Fase 3 → Fase 4. La Fase 2 depende de la 1 porque el guardia revisa esos archivos.

### Tamaño total

| Fase | Archivos | Líneas aprox. | Riesgo |
|---|---|---|---|
| 1 | 6 (4 nuevos, 2 editados) | ~250 | Bajo (solo texto) |
| 2 | 4 | ~350 | Medio (toca hook y CI) |
| 3 | ~9 | ~700 | Bajo, pero lleva tiempo y se desactualiza |
| 4 | muchos movimientos | — | Medio (enlaces) |

---

## 7. Recomendación

1. **Sí llevar el modelo a Bodega, pero en versión ligera:** ley corta + bitácora al día + `ERRORES.md` + casos solo para trabajos grandes + `PENDIENTES.md`. Con eso Bodega recupera lo que hoy más le falta: saber **qué se hizo y por qué** (lleva 2 semanas sin bitácora).
2. **No copiar** los 63 casos, el manual de 14 módulos ni nada de lotes/recipe/vencimientos. El manual, si se hace, se escribe de nuevo y más corto.
3. **El guardia automático, en modo aviso.** Frenar commits desde el primer día empuja a usar `--no-verify` y deja el sistema sin efecto.
4. **Antes de empezar:** guardar (commit) lo que hay pendiente de caja en Bodega, para no mezclar temas ni chocar con hooks.
5. **Siguiente paso concreto para el dueño:** decir "Aplica la Fase 1" y se hace en un solo commit separado, con la ley adaptada como primera pieza. Las demás fases se deciden después de ver cómo se usa.

---

*Nota de método:* todo lo anterior sale de leer los archivos de ambos repositorios (conteos de líneas, `git`, lista de carpetas y los documentos de la ley, mantenimiento, plantillas e índice de casos). No se ejecutó `docs-check` ni las pruebas; los conteos de casos y errores son los del día de hoy y cambian a diario.
