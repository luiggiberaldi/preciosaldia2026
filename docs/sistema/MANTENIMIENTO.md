# Cómo se mantiene al día la documentación

> Revisado 2026-11-13. Funciona con `scripts/docs-check.mjs`, el mapa `MAPA-CODIGO-DOCS.json` y el hook de git. **Modo suave:** solo avisa, no frena nada.

## La idea

Como el cuaderno de una tienda: el guardia no escribe por ti, solo te avisa si falta una anotación o si un enlace quedó roto. El mapa conecta cada archivo de código con el documento que lo explica; cuando cambias código, te dice qué documento revisar.

## Las piezas

| Pieza | Qué hace |
|---|---|
| [LEY-DOCUMENTACION.md](../LEY-DOCUMENTACION.md) | Las reglas |
| [MAPA-CODIGO-DOCS.json](MAPA-CODIGO-DOCS.json) | Qué archivos de código describe cada documento |
| `scripts/docs-check.mjs` | La revisión automática |
| `githooks/pre-commit` | La corre antes de cada commit, **sin frenar** |
| `.github/workflows/ci.yml` | La corre también en GitHub, **sin frenar** (`continue-on-error`) |
| `tests/docsCheck.test.js` | Prueba que la revisión funciona |

## Qué revisa

- Enlaces rotos entre los documentos vivos (README, AGENT, bitácora, PENDIENTES, ley, errores, casos y esta carpeta).
- `ERR-NNN` o `CASO-NNN` nombrado que no existe.
- Ficha de error resuelta sin **Solución**, o abierta sin **Solución pendiente**.
- Tabla-resumen de errores o de casos que no coincide con las fichas.
- Documento de módulo sin regla en el mapa.
- Siempre solo aviso: código cambiado sin entrada nueva en la bitácora, y qué documentos revisar.

**No revisa** (son históricos): `docs/plans/`, `docs/reports/`, `docs/auditorias/`, `docs/migrations/`.

## Cómo se usa

```bash
bun run docs:check
```

Revisa el trabajo actual y avisa. Termina bien aunque haya problemas.

```bash
node scripts/docs-check.mjs --strict
```

Igual, pero falla si hay problemas. Es lo que se usaría si se decide frenar commits (ver P-002 en [PENDIENTES.md](../../PENDIENTES.md)).

## Cuando agregas algo nuevo

- **Un módulo nuevo:** documento en `docs/sistema/modulos/` y una regla en el mapa.
- **Archivos nuevos de un módulo:** agrégalos a su regla del mapa.
- **Un error nuevo:** ficha en `ERRORES.md` con el siguiente número y fila en su tabla.
- **Un caso nuevo:** archivo `CASO-NNN-nombre.md` y fila en el índice.

## Límites honestos

- La revisión comprueba **consistencia, no verdad**: no sabe si un documento dice algo correcto.
- Los avisos de "revisa este documento" dependen del mapa; si el mapa está incompleto, no avisa.
- **Dos sesiones a la vez pueden elegir el mismo número** de `ERR`/`CASO`; la revisión lo detecta como "ID repetido". Antes de escribir un ID, vuelve a leer el último.
- Los módulos Clientes, Reportes y Ajustes aún no tienen documento.
