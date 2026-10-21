# Plan y ejecución — Alinear el modo Supervisor con producción

**Fecha:** 14 de octubre de 2026  
**Clon de trabajo:** `../preciosaldia-supervisor-production-alignment`  
**Referencia elegida:** último `origin/main` de GitHub, commit `c508b3360ff26919f001e167a4a806632bf04809` (`feat(registro): teléfono obligatorio del negocio + en solicitud de licencia`).  
**Estado:** runtime y pruebas centrales de Supervisor alineados en este clon. No se publicó ni desplegó.

## Objetivo

Usar en el clon el flujo funcional del modo Supervisor que existe en el commit exacto de GitHub señalado por el usuario. Mantener aislado el checkout original, sin aplicar migraciones ni hacer escrituras remotas.

## Alcance realizado

Se alinearon byte por byte con `c508b336` los componentes y servicios funcionales centrales del Supervisor, el receptor/sincronización de órdenes, la política remota, identidad de dispositivo y las pruebas correspondientes. Se verificaron **29 rutas** del runtime y pruebas centrales contra el commit base, incluyendo:

- `src/App.jsx`, `src/views/OwnerMonitorView.jsx`, pantalla de pairing, gestores de pairing/dispositivos y cliente cloud Supervisor (con el export de compatibilidad requerido por el cache local de imágenes).
- Componentes de Supervisor en `src/components/Monitor/`.
- Hooks de seguridad/licencia, sincronización del monitor, órdenes remotas y contratos.
- Servicios de reportes/finanzas/métricas, utilidades de identidad y pruebas del Supervisor.

Los cambios de staging locales no bloquean el uso del código Supervisor de c508; la carpeta `supabase/staging-migrations/` quedó preservada exactamente respecto al checkout original: los **29 archivos** se compararon byte por byte al finalizar. No se ejecutó ningún SQL ni hubo acceso de escritura a Supabase.

Se conservaron las modificaciones ajenas al alcance (por ejemplo Cashea, proveedores y vistas de dashboard). Las dependencias se instalaron en el clon usando `bun install --frozen-lockfile`; no se modificaron manifests ni lockfiles.

## Seguridad y límites

- El checkout original continúa en su rama `preview/all-changes-oct14`, sin cambios hechos por esta alineación.
- No se ejecutaron migraciones, pruebas E2E remotas ni escrituras de staging/producción.
- No hubo despliegue.
- Las migraciones existentes en el clon se copiaron/restauraron tal como estaban en el original. Si se observan diferencias de CRLF en el estado de Git, son representación de finales de línea de Windows; su contenido comparado como bytes frente al original coincide.

## Verificación realizada

- `git ls-remote https://github.com/luiggiberaldi/preciosaldia2026.git refs/heads/main` confirmó que el último `main` de GitHub era exactamente `c508b3360ff26919f001e167a4a806632bf04809`.
- Comparación `cmp` de 29 rutas centrales del runtime/pruebas frente a los blobs de c508: **pasa**. `src/config/supabaseCloud.js` se alineó al resolver de backend de c508 y conserva un export adicional `supabaseCloudUrl`, necesario por el cache de imágenes de esta rama; esta única diferencia local no altera el destino de Supabase.
- Comparación byte por byte de los 29 archivos de `supabase/staging-migrations/` frente al checkout original: **pasa**.
- `bun run lint:supervisor`: **pasa**, 0 errores y 170 advertencias preexistentes del código base.
- `bun run typecheck`: **pasa**.
- `bun run test:supervisor` con variables locales ficticias para Supabase: **pasa**, 14 archivos y 82 pruebas; 1 E2E de staging queda omitida por configuración, sin conectarse a staging.
- `bun run build`: **pasa** después de alinear el cliente cloud; Vite muestra advertencias de chunk grande y chunk Groq vacío.
- `tests/deviceIdentity.test.js`: **pasa**, 13 pruebas.

## Limitaciones

El test de Supervisor fue abortado una vez manualmente mientras todavía se estaba ejecutando; se repitió completo después de estabilizar el set de pruebas y finalizó correctamente. La verificación es local: no valida conectividad con el backend productivo ni implica cambios en la web desplegada. El clon usa un remote Git local para rastrear la copia de trabajo; la referencia GitHub se confirmó directamente por URL.

## Criterio de aceptación

El clon separado contiene el Supervisor runtime central de c508 exacto; staging no fue ejecutado y sus 29 archivos coinciden con el original; el checkout original permanece sin modificaciones causadas por este trabajo. Para habilitarlo en el sitio productivo haría falta un despliegue autorizado por separado.
