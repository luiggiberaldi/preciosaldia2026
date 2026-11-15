# CASO-001 — Documentación estilo Farmacia

**Fecha:** 2026-11-13
**Estado:** Aplicado (sin commit al escribir esto)

## Qué pidió el dueño
Copiar a Bodega el modelo de documentación de Farmacia, empezando por una auditoría ([AUDITORIA-DOCUMENTACION-FARMACIA-2026-11-13.md](../auditorias/AUDITORIA-DOCUMENTACION-FARMACIA-2026-11-13.md)) y luego «aplicarlas todas fase por fase».

## Qué se hizo
- **Fase 1:** [ley](../LEY-DOCUMENTACION.md), [ERRORES.md](../ERRORES.md), [índice de casos](INDICE.md), [PENDIENTES.md](../../PENDIENTES.md), sección en `AGENT.md` y entradas en la bitácora.
- **Fase 2:** `scripts/docs-check.mjs` (solo avisa), su prueba `tests/docsCheck.test.js`, `bun run docs:check`, llamada en el hook y en CI sin frenar.
- **Fase 3:** manual corto en `docs/sistema/` (inicio, glosario, mantenimiento y 5 módulos) con su mapa código → documento.
- **Fase 4:** las 10 auditorías de la raíz y la de `docs/` movidas a `docs/auditorias/`, con los enlaces arreglados (quedan 10 enlaces rotos que ya venían rotos: rutas absolutas de otro equipo y una prueba que no existe). Los `PLAN-*` y reportes de la raíz **no se movieron** (P-006).

## Qué no cambió
- No se copiaron los 63 casos de Farmacia ni nada de lotes, recetas o vencimientos.
- No se exige versión en la bitácora ni se frenan commits (ver P-002 y P-004 en `PENDIENTES.md`).
- No se trajeron `check-max-lines` ni `check-imports` (P-003).

## Pruebas
Ver la bitácora del 2026-11-13.

## Errores
Ninguno.
