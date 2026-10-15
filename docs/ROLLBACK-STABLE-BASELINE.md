# Registro de Línea Base Estable en GitHub y Procedimiento de Rollback

> **Fecha de congelamiento de línea base:** 15 de Octubre de 2026  
> **Propósito:** Documentar los puntos de restauración exactos que residían en GitHub antes de la publicación de la versión 2.0.0, permitiendo un retorno inmediato y seguro en caso de contingencia.

---

## 1. Identificadores de Línea Base Estable en GitHub

Antes de empujar los cambios de la versión 2.0.0, el repositorio remoto en GitHub (`origin`: `https://github.com/luiggiberaldi/preciosaldia2026.git`) contenía los siguientes commits verificados como estables:

| Rama Remota | Commit Hash (SHA-1) | Tag de Respaldo Local | Mensaje del Commit | Fecha |
|---|---|---|---|---|
| `origin/main` | `c508b3360ff26919f001e167a4a806632bf04809` | `rollback-baseline-main-c508b33` | `feat(registro): teléfono obligatorio del negocio + en solicitud de licencia` | 30 Sep 2026 |
| `origin/preview/all-changes-oct14` | `5a59056b417d76e17509fda64fa955a674103606` | `rollback-baseline-preview-5a59056` | `chore(config): aislamiento de entorno staging/produccion y scripts de verificacion` | 14 Oct 2026 |

---

## 2. Garantía de Seguridad de Datos durante un Rollback

Si en algún momento se decide regresar a cualquiera de estos commits:

1. **Almacenamiento Local (IndexedDB):**
   - La base de datos local en las cajas sigue llamándose `'BodegaApp'` con el almacén `'bodega_app_data'`.
   - Tanto la versión actual como la versión previa leen y escriben en las mismas claves de persistencia (`bodega_sales_v1`, `bodega_products_v1`, `bodega_customers_v1`, `bodega_accounts_v2`).
   - El Disyuntor de Seguridad (`storageService.js`) permanece activo, impidiendo vaciados involuntarios del catálogo.

2. **Ventas y Transacciones:**
   - Las ventas generadas en la versión 2.0.0 incluyen propiedades opcionales (`granelUnitMode`, `baseUsd`, `ivaUsd`) que la versión previa simplemente ignora de manera segura al procesar totales o reportes históricos.

3. **Autenticación y Licencia:**
   - Las credenciales locales de sesión (`abasto-auth-storage`), la licencia permanente y el identificador de la caja (`pda_device_id`) permanecen intactos y no requieren reingreso tras un rollback.

---

## 3. Guía Paso a Paso para Ejecutar un Rollback

### Opción A: Rollback en Entorno Local / Desarrollo
Para regresar el árbol de trabajo local al punto estable de GitHub:

```bash
# Para volver a la línea base de origin/preview/all-changes-oct14:
git checkout rollback-baseline-preview-5a59056

# O para volver a la línea base previa de main:
git checkout rollback-baseline-main-c508b33
```

### Opción B: Rollback Seguro en GitHub (Recomendado sin reescribir historial)
Si los cambios ya fueron subidos a GitHub y se desea revertirlos en el servidor preservando la trazabilidad de auditoría:

```bash
# Revertir un rango de commits generando commits de compensación seguros:
git revert --no-commit 5a59056..HEAD
git commit -m "revert: rollback a linea base estable (5a59056)"
git push origin <rama>
```

### Opción C: Restauración de Puntero Directa en Rama
Si se requiere alinear una rama remota exactamente al commit congelado:

```bash
# Alinear localmente al commit base:
git checkout preview/all-changes-oct14
git reset --hard rollback-baseline-preview-5a59056

# Si se requiere actualizar el remoto de manera forzada controlada:
# git push origin preview/all-changes-oct14 --force-with-lease
```

---

## 4. Comandos de Verificación Posterior al Rollback

Tras ejecutar cualquier procedimiento de rollback, verificar la integridad del sistema con:

1. **Pruebas Automatizadas:**
   ```bash
   npx vitest run
   ```
2. **Construcción de Producción:**
   ```bash
   bun run build
   ```
3. **Comprobación de Almacenamiento Local:**
   Verificar en las herramientas de desarrollo del navegador (`DevTools > Application > Storage > IndexedDB > BodegaApp`) que los almacenes de ventas y productos conservan sus registros.
