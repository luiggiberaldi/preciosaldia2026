# Ley de documentación — Precios al Día Bodega

> Vigente desde 2026-11-13. Adaptada de la de Farmacia, en versión ligera. Obligatoria para cualquier persona o agente que trabaje en este repositorio.

## El principio

Si no está escrito, no pasó. Es como el cuaderno de una tienda: si no se anota lo que entra y sale, a la semana nadie sabe qué pasó. Todo cambio y todo error queda anotado para saber **qué se hizo, por qué y cómo se arregló**.

## Qué se escribe y dónde

| Qué ocurrió | Dónde | Obligatorio |
|---|---|---|
| Cualquier cambio de código, configuración o base de datos | Entrada en [bitacora.md](../bitacora.md) | Sí |
| Trabajo grande: varios archivos, visible para el usuario, o que toca dinero, inventario o licencias | Caso `CASO-NNN` en [docs/casos/](casos/INDICE.md) | Sí |
| Error encontrado (bug, build roto, test caído, error de consola que afecte al usuario) | Ficha `ERR-NNN` en [docs/ERRORES.md](ERRORES.md), **con su solución** | Sí |
| Decisión del dueño (diseño o producto) | Bitácora o caso, con la razón | Sí |
| Algo por hacer que no se hizo ahora | [PENDIENTES.md](../PENDIENTES.md) (`P-NNN`) | Sí |
| Plan antes de hacer algo grande | `docs/plans/AAAA-MM-DD-slug.md` | Recomendado |
| Auditoría | `docs/auditorias/AUDITORIA-TEMA.md` | Recomendado |
| Informe o postmortem | `docs/reports/AAAA-MM-DD-slug.md` | Recomendado |
| Propuesta (idea o diagnóstico antes de un plan) | `docs/propuestas/AAAA-MM-DD-slug.md` | Recomendado |
| Mockup (maqueta de pantalla en HTML) | `docs/mockups/AAAA-MM-DD-slug.html` | Recomendado |

Un cambio pequeño (un texto, un color) solo lleva bitácora. No hace falta un caso por cada botón.

## Reglas

1. **Cada error tiene su solución.** Se escribe qué lo causó y cómo se arregló. Si aún no hay solución, estado `Abierto` y qué se intentó.
2. **Los IDs son correlativos y no se reutilizan.** `CASO-001`, `ERR-001`, `P-001`… Si algo está mal, se corrige con una nota; nunca se borra. **Antes de crear uno, vuelve a leer cuál es el último**: dos sesiones a la vez pueden elegir el mismo número.
3. **La documentación entra en el mismo commit que el cambio.**
4. **Antes de cerrar una tarea,** se revisa que bitácora, caso (si aplica) y errores (si hubo) reflejen lo que realmente quedó.
5. **Se escribe el resultado real.** Si un test no se corrió, se escribe "no verificado".
6. **Lenguaje sencillo.** Todo término técnico se explica en la misma frase con una comparación cotidiana (ver "Perfil del dueño" en [AGENT.md](../AGENT.md)).
7. **Lo que no cuadra o se puede mejorar se propone, aunque sea una ley.** Quien vea algo inconsistente, riesgoso o mejorable lo dice con una propuesta de cuatro líneas: qué vio y dónde; por qué importa; qué propone y cuánto cuesta; qué pasa si no se hace. Máximo tres por tarea. Decide el dueño, ya informado. Si no se decide en el momento, va a `PENDIENTES.md`. Si lo que pide el dueño llevaría a un resultado peor, se le dice con evidencia y se propone la alternativa; no se obedece en silencio.

## Orden en los archivos

- **`bitacora.md`:** las entradas se **agregan al final** (la más nueva abajo), como ya estaba. Fecha siempre `AAAA-MM-DD`.
- **`ERRORES.md`, índice de casos y `PENDIENTES.md`:** la fila nueva va al final de la tabla.

## Archivos históricos que se conservan

- `CHANGES.md` e `ISSUES.md` (raíz): foto de la auditoría de marzo 2026 (130 issues, todos cerrados). No se editan; los errores nuevos van a `ERRORES.md`.
- `docs/plans/` y `docs/reports/`: se mantienen con su nombre `AAAA-MM-DD-slug.md`.
- `docs/propuestas/` y `docs/mockups/`: creadas el 2026-11-14 para guardar dentro del repo las propuestas y maquetas que antes quedaban sueltas en el Escritorio.
- `docs/auditorias/`: las auditorías anteriores a esta ley y las nuevas (`AUDITORIA-TEMA-AAAA-MM-DD.md`). **Ningún informe, plan, propuesta o mockup de Bodega se deja en el Escritorio:** se guarda aquí desde el principio. Los `PLAN-*` y reportes que siguen en la raíz se ordenarán después (P-006).

## Versiones

En esta etapa **no es obligatorio** poner versión en cada entrada de bitácora. Cuando haya una entrega a producción, la entrada lo dice en el título (por ejemplo "release 2.0.6"), como ya se venía haciendo.

## Revisión automática

`bun run docs:check` revisa enlaces rotos, fichas de error sin solución y tablas-resumen desactualizadas. **Por ahora solo avisa, no frena commits.** Detalle en [docs/sistema/MANTENIMIENTO.md](sistema/MANTENIMIENTO.md).

## Plantillas

### Entrada de bitácora

```markdown
## AAAA-MM-DD — Título corto

**Contexto:** por qué se hizo.
**Cambios:** qué cambió y en qué archivo.
**Casos y errores:** CASO-NNN, ERR-NNN (si aplica).
**Verificación:** tests o prueba manual, con resultado ("no verificado" si no se probó).
```

### Ficha de error

```markdown
## ERR-NNN — Título del síntoma

- **Fecha:** AAAA-MM-DD
- **Estado:** Resuelto | Abierto | Descartado
- **Dónde:** pantalla, archivo o comando
- **Síntoma:** qué se vio.
- **Causa:** por qué pasó.
- **Solución:** qué se hizo (obligatorio si está resuelto).
- **Cómo comprobarlo:** cómo saber que ya no pasa.
- **Relacionados:** CASO-NNN, informe, archivo.
```

### Caso

```markdown
# CASO-NNN — Título

**Fecha:** AAAA-MM-DD
**Estado:** Propuesto | En curso | Aplicado | Verificado | Revertido | Descartado

## Qué pidió el dueño
## Qué se hizo
## Qué no cambió
## Pruebas
## Errores
```

## Dónde está cada cosa

- [bitacora.md](../bitacora.md) · [docs/casos/INDICE.md](casos/INDICE.md) · [docs/ERRORES.md](ERRORES.md) · [PENDIENTES.md](../PENDIENTES.md)
- [docs/sistema/INICIO.md](sistema/INICIO.md): cómo funciona el sistema.
- [AGENT.md](../AGENT.md): guía técnica completa.
