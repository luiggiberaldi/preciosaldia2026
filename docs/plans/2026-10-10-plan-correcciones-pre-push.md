# Plan de correcciones antes del push — granel POS

**Fecha:** 10 de octubre de 2026  
**Alcance:** commits locales `d280ead` (ticketera) y `0578a1c` (unidades duales de granel), contra el `origin/main` observado durante la auditoría.  
**Estado:** plan solamente; todavía no se modificó código ni se publicó nada.

## Objetivo

Corregir los riesgos confirmados que podrían confundir a cajeros o clientes en ventas por peso/volumen, integrar los commits remotos que faltan y dejar evidencia reproducible antes de considerar un push. Como hay usuarios activos, el stock y los importes canónicos no deben cambiar por una corrección de presentación.

## Límites de seguridad y alcance

- No ejecutar `git push`, deploy, migración ni escritura sobre Supabase o datos reales como parte del trabajo de corrección local.
- No sobrescribir, limpiar, guardar en stash ni incluir en commits el trabajo local ajeno. El checkout contiene modificaciones y archivos sin seguimiento en otros temas; inventariarlos antes de cualquier operación Git.
- **Dejar el instalador como está**, según la instrucción del usuario. Este plan no cambia, copia, vuelve a generar ni ejecuta el `.exe` o el `.bat`.
- Tratar el fallo de la suite completa como no atribuido hasta comparar con una base limpia. No debilitar el test ni sus expectativas.
- Este plan no autoriza automáticamente un despliegue. Si el push pudiera alcanzar a usuarios activos, pedir autorización explícita antes de publicar cuando se llegue a ese paso.

## Hallazgos que guían el trabajo

1. `processSaleTransaction` guarda `qty` e `isWeight`, pero descarta `unit`, `granelUnit` y `packagingType`. Después, el formato dual intenta determinar líquido/sólido a partir de esos metadatos. Una venta de un producto líquido puede perder su unidad en el snapshot persistido y mostrarse como gramos/kg.
2. Los recibos térmico y PDF y el helper de WhatsApp usan el formato dual nuevo; algunas salidas de cierre y de historial/compartición todavía formatean el peso como `kg` fijo. Esto deja documentos de una misma venta con unidades inconsistentes.
3. `lowStockAlert` se guarda como valor canónico mediante `parseStockInput`, mientras los formularios muestran la modalidad g/ml. En modo gramos, una alerta que se introduzca como gramos puede compararse luego como si fueran kg; fijar una unidad explícita y convertir correctamente antes de guardar.
4. `populateForm(product, effectiveRate)` no pasa el modo como argumento, pero `prepareProductFormState` tiene un default que lee `getGranelUnitMode()`. No se confirmó un defecto ahí. Añadir cobertura para edición/cambio de modo antes de modificar este flujo.
5. `main` está 2 commits adelante y 2 detrás de `origin/main`. Las ramas divergen y un push directo no incluiría los cambios remotos pendientes.
6. Checks observados: 129 pruebas dirigidas, typecheck, build y 12 E2E del checkout pasaron; la suite completa tuvo un fallo en `tests/receivablesDeterministic.test.js` (esperado `43.59`, recibido `0`); ESLint tuvo 0 errores y 296 warnings; `git diff --check` encontró whitespace en dos formularios y una línea final extra en el test nuevo.

## Secuencia de trabajo

### Fase 0 — Aislar el trabajo y fijar baseline

1. Registrar `git status`, rama, commits y diffs; identificar explícitamente qué archivos son parte de los dos commits y cuáles son trabajo local ajeno. No usar `git add -A`.
2. Crear un worktree/branch local limpio desde `origin/main` para integrar y probar, sin cambiar el checkout actual ni tocar el trabajo sin commit. Si eso no es viable, detenerse y acordar cómo preservar los cambios locales antes de integrar.
3. Reproducir `bun run test -- tests/receivablesDeterministic.test.js` en el checkout actual y en una copia limpia de `origin/main`. Si también falla en la base, documentarlo como baseline existente; si solo falla tras integrar, investigar el cambio causante. Revisar injector, report processor, fechas y fixture; no cambiar expectativas para forzar verde.
4. Mantener los commits del instalador y granel como unidades revisables; cualquier integración de `origin/main` debe resolver conflictos manualmente y preservar el resultado de ambos commits.

**Gate:** árbol original intacto; atribución del fallo de cartera establecida o declarada pendiente; commits y conflictos de integración revisados.

### Fase 1 — Persistir metadatos de unidad en el snapshot de venta

1. En `src/utils/checkoutProcessor.js`, copiar al snapshot de cada línea los metadatos de producto disponibles que necesita el formateador (unidad canónica y tipo de empaque/granel); mantener `qty` en kg/L canónicos y no multiplicar ni convertir precios/stock.
2. Revisar rutas especiales (producto de balanza, venta libre, anticipo, producto legacy) para no inferir que todo `isWeight` es líquido o sólido cuando falte el catálogo.
3. Definir fallback retrocompatible para ventas históricas sin metadatos: usar catálogo solo cuando haya una asociación inequívoca; en caso contrario conservar el comportamiento legacy sin inventar unidad.
4. Añadir pruebas a checkout/recibo: venta nueva de producto por kg y producto líquido por litros; confirmar snapshot persistido y visualización `g` vs `ml` en modo dual, y `kg` vs `L` en modo estándar.

**Gate:** importes, cantidades canónicas, stock deducido/anulado y compatibilidad con ventas históricas permanecen iguales; solo se completa la información semántica del snapshot.

### Fase 2 — Unificar recibos, reportes y alertas

1. Buscar todos los renderizadores de cantidades de venta (`dailyCloseGenerator`, historial/compartición de clientes, dashboard, tickets HTML/PDF, recibo modal y WhatsApp). Centralizar la presentación en el helper existente o en un wrapper que reciba la unidad correcta y modo explícito.
2. No depender de `item.isWeight` únicamente si ya se dispone de metadatos confiables. Preservar el formato legacy para registros antiguos sin unidad.
3. Acordar y documentar si tickets/historial muestran el modo de la caja que generó la venta o el modo de visualización del dispositivo actual. Probar la decisión con dos preferencias distintas; no alterar la cantidad canónica.
4. En alta/edición rápida y wizard, etiquetar `lowStockAlert` explícitamente en la unidad visible (g/ml o kg/L), convertirla al umbral canónico antes de persistir, y comprobar que las comparaciones de bajo stock siguen comparando unidades iguales.
5. Añadir pruebas para ambas unidades y modos, umbrales de alerta, nulos/legacy y reportes de cierre/compartición.

**Gate:** una misma venta nunca confunde masa y volumen ni mezcla escalas en pantalla/ticket/reporte; alerta y stock se comparan en la misma unidad canónica.

### Fase 3 — Completar cobertura y limpiar defectos de forma

1. Añadir regresión para edición de producto existente en ambos modos (kg/L a g/ml y vuelta), producto líquido legacy, cambiar modo mientras el formulario está abierto, y guardar sin alterar stock por error.
2. Añadir casos de extremo a extremo desde captura de peso hasta checkout, anulación y recibo para sólido y líquido; confirmar que el instalador no se toca.
3. Quitar únicamente el whitespace reportado por `git diff --check` en los dos formularios y la línea final extra en `tests/granelUnits.test.js`; no reescribir archivos completos.
4. No limpiar warnings ESLint ajenos al cambio ni añadir supresiones. Si el lint modificado produce warnings nuevos, corregir los introducidos; registrar los heredados.

**Gate:** regresiones que reproducen los hallazgos pasan y el diff queda sin errores de whitespace.

### Fase 4 — Validación tras integrar

Ejecutar en el worktree limpio/integrado, en este orden y guardar resultado/exit code:

1. Tests dirigidos de granel, checkout, anulación, recibos, cierre e historial.
2. `bun run typecheck`.
3. ESLint dirigido a todos los archivos modificados, reportando errores y warnings separadamente.
4. `bun run test` completo; resolver el fallo de cartera si es causado por la integración. Si se confirma que ya falla en `origin/main`, reportarlo como bloqueo preexistente y no afirmar que la suite global pasa.
5. `bun run build` y E2E relevantes para los cambios de granel/recibos además de la suite móvil ya existente.
6. `git diff --check`, revisión manual del diff final, confirmación de archivos staged y `git status`.
7. Revisar `wrangler.jsonc`, configuración de hosting, rama vinculada y proceso de release para determinar si el push dispara deploy automático. No desplegar para averiguarlo.

**Gate final de push:** divergencia resuelta; bugs confirmados corregidos; gates de cambio pasan; fallo global atribuido y aceptado explícitamente si es de baseline; ningún artefacto o cambio local ajeno incluido; efecto de push/deploy entendido. Con usuarios activos, si un push puede publicar automáticamente, solicitar confirmación informada antes de hacerlo.

## Fuera de alcance

- El instalador POS, su script `.bat`, instrucciones y ejecutable permanecen intactos.
- Cambios remotos de configuración, migraciones, datos, despliegue, promoción a producción o push.
- Cambios de precios, cantidades canónicas, stock de productos existentes o contrato financiero que no sean indispensables para corregir la representación.

## Referencias de código a revisar

- `src/utils/checkoutProcessor.js` — snapshot de la venta.
- `src/utils/granel.js` — clasificación y formato canónico.
- `src/utils/dailyCloseGenerator.js` y `src/views/CustomersView.jsx` — formatos que aún usan kg fijo.
- `src/components/Products/ProductFormQuick.jsx`, `src/components/Products/ProductFormWizard.jsx` y `src/utils/productProcessor.js` — unidad y guardado de alerta de stock.
- `src/hooks/useProductForm.js` y `src/views/ProductsView.jsx` — prueba de edición en modo dual.
- `tests/receivablesDeterministic.test.js` — fallo observado de baseline, pendiente de atribución.
