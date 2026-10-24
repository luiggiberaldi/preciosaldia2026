# PLAN-FIXEO-EMPAQUE-GRANEL.md — Que el empaque decida, no la adivinanza

> **Fecha:** 2026-10-23 · **Versión:** 1.0 (plan listo para ejecutar)
> **Problema:** los artículos sin tipo de empaque elegido se toman como "granel"
> (se venden por peso) y el formulario no marca ningún tipo de empaque.
> **Regla de este plan:** se prueba primero en staging (entorno de pruebas) y
> **nunca se dañan los datos de los usuarios** que ya tienen artículos agregados.
>
> **Regla de lectura (AGENT.md):** lenguaje sencillo, primero el porqué y el
> negocio, cada fase termina con cómo se verifica y cómo se revierte.

---

## 1. Por qué pasa (resumen del diagnóstico)

El sistema no guarda una decisión clara de "cómo se vende este producto"; cuando
falta el tipo de empaque, **adivina**. Tres cosas se encadenan:

1. **El detector de granel es un adivinador** ([granel.js:101](src/utils/granel.js#L101)):
   si el empaque no es exactamente `suelto` ni `lote`, cuenta como granel con
   CUALQUIER pista débil: unidad con nombre de peso (`kg`, `g`, `litro`, `ml`, `l`...),
   banderas `isWeight`/`soldByWeight`, o el solo hecho de existir el campo `granelUnit`.
2. **El formulario siempre deja `granelUnit = 'kg'`** ([useProductForm.js:139](src/hooks/useProductForm.js#L139)),
   incluso en productos que no son granel. Al guardar, [productProcessor.js:97](src/utils/productProcessor.js#L97)
   vuelve a adivinar con ese `kg` y **congela el producto como granel para siempre**.
3. **Las importaciones traen vocabulario ajeno**: productos como "SAL DEL MAR 1 KG"
   llegan con tipo de empaque que no es `suelto`/`lote`/`granel` (ej. "Unidad",
   "Bulto") o con unidad `kg` por el nombre. Resultado: ningún botón se marca en el
   formulario y el detector lo manda a granel.

**Impacto en el negocio:** la sal se vende "por kilos" (permite 0.350 de cantidad),
el stock acepta decimales, y ticket e inventario la muestran como peso.

## 2. Principio rector: los datos del usuario son intocables

Este fix toca **solo metadatos de presentación** (cómo se etiqueta y se cuenta un
producto), **nunca** los valores del negocio.

| Campo | ¿Se toca? | Por qué |
|---|---|---|
| `packagingType` | ✅ Sí (normalizar) | Es el origen del bug |
| `granelUnit` | ✅ Sí (limpiar en no-granel) | Es la pista venenosa |
| `unit` (etiqueta legacy) | ✅ Sí (traducir) | Solo cambia rótulos ("kg" → "unidad") |
| `stock` (cantidad) | ❌ NUNCA | Inventario real del usuario |
| `priceUsdt`, `costUsd`, `priceCop`... | ❌ NUNCA | Precios y costos |
| Ventas, fiado, clientes, cierres | ❌ NUNCA | Historial del negocio |
| Licencias y configuración | ❌ NUNCA | Operación |

Además, todo cambio de catálogo se hace así:

1. **Respaldo primero** (obligatorio antes de tocar nada).
2. **Modo diagnóstico (dry-run):** primero se imprime la lista de lo que SE
   CAMBIARÍA, sin escribir nada. El dueño la revisa. Solo después se aplica.
3. **Bitácora de reversión:** al aplicar, se guarda el valor anterior de cada
   producto en un archivo con fecha. Si algo sale mal, esos valores se devuelven.
4. **Los productos con stock decimal heredado NO se redondean solos** (ver §7).

---

## 3. Fase 0 — Blindar los datos (antes de cualquier cambio)

- [ ] **Exportar Backup completo**: Ajustes → Sistema → Datos y Respaldo →
  **Exportar Backup**. Guardar el archivo con fecha (ej. `backup-2026-10-23.json`).
- [ ] Guardar **una copia en otro lado** (USB, nube personal, otro equipo).
- [ ] ⚠️ **NO usar** el botón que dice "publicar un respaldo vacío en la nube":
  eso BORRA productos, ventas y clientes. Este plan jamás lo necesita.
- [ ] Exportar el **informe de productos previo** (lo genera el modo diagnóstico
  del §5): será la foto "antes" para comparar después.

**Cómo se verifica:** el archivo `backup-2026-10-23.json` existe y pesa más de 0 KB.
**Cómo se revierte:** Importar Backup desde ese archivo devuelve todo al estado previo.

## 4. Fase 1 — El código con seguro (en el repositorio, sin desplegar)

Cambios pequeños y encadenados:

1. **Traductor de empaque** (`normalizePackagingType` en `src/utils/granel.js`):
   cualquier valor ajeno se traduce a los 3 válidos.
   - `suelto`, `unidad`, `individual`, `unit` → **suelto**
   - `lote`, `bulto`, `paquete`, `caja`, `box` → **lote**
   - `granel`, `peso`, `por_kg`, `kg`, `litro` → **granel**
   - vacío o desconocido → se deriva: si su unidad es de peso/volumen o tiene
     banderas de peso → **granel**; si no → **suelto** (lo más seguro).
2. **Regla clara en el detector**: un producto es granel **solo si** su
   `packagingType` es `granel`. La adivinanza por unidad/flags queda SOLO para
   productos viejos que no tienen ningún empaque guardado, y deja de usar
   `granelUnit` como pista (ese campo se rellena solo).
3. **Al guardar productos** (`productProcessor.js`): si el empaque viene vacío o
   desconocido, se normaliza antes de decidir nada (ya no se "congela" granel),
   y `granelUnit` se guarda `null` en todo lo que no sea granel.
4. **Formularios** (`useProductForm.js`, Quick y Wizard): el campo `granelUnit`
   solo se usa si el usuario elige Granel; si el empaque queda sin elegir, se ve
   el aviso **"Sin empaque = se vende por unidad"** en vez de fallar en silencio.
5. **Modo diagnóstico (dry-run)**: función `planCatalogPackagingFix(productos)`
   que devuelve la lista de cambios propuestos SIN escribir nada:
   ```
   SAL DEL MAR 1 KG   empaque: (vacío) → suelto   unidad: kg → unidad   granelUnit: kg → (limpio)
   QUESO FRESCO       empaque: granel (sin cambio)
   ```
   Se muestra en pantalla y se puede exportar como archivo para revisión.

**Cómo se verifica:** las pruebas de la Fase 2 pasan en verde.
**Cómo se revierte:** `git revert` del commit de esta fase (no toca datos).

## 5. Fase 2 — Pruebas automáticas (nada avanza en rojo)

- [ ] **Actualizar** las pruebas que hoy confirman la adivinanza vieja
  (`tests/granelGuardrails.test.js`, `tests/granelUnits.test.js`): ahora
  `isGranelProduct({ unit: 'kg' })` sin empaque ya NO es granel si el empaque
  dice `suelto`; la adivinanza solo aplica con empaque vacío.
- [ ] **Nuevas pruebas**:
  - traductor de empaque (cada sinónimo de la tabla del §4.1);
  - regla clara (solo `packagingType === 'granel'`);
  - dry-run: propone bien y **no escribe** nada;
  - **garantía anti-daño**: simular un catálogo con precios, stock entero y
    decimal + una venta guardada → aplicar el fix → comprobar que precios,
    stock y venta quedan **idénticos byte a byte**;
  - producto con stock decimal heredado (ej. sal con 2.5): se marca en el
    reporte para revisión, NO se redondea solo.
- [ ] Suite completa en verde (`bun run test`) + lint sin errores.
- [ ] El gancho pre-push ya corre la E2E del checkout móvil; debe pasar.

**Cómo se verifica:** 100% de pruebas en verde antes de abrir staging.
**Cómo se revierte:** no aplica (solo pruebas).

## 6. Fase 3 — Staging: probar sin tocar a ningún usuario

Staging es el entorno de pruebas del proyecto Supabase del supervisor
(`wapczmlwljkrjtfhmqko`), separado de producción. Nada de lo que pase aquí
llega a las cajas reales. Guía completa: [docs/SUPERVISOR-E2E-STAGING.md](docs/SUPERVISOR-E2E-STAGING.md).

- [ ] Levantar el dev server apuntando a staging:
  `VITE_SUPERVISOR_E2E_STAGING=true bun run dev -- --host 127.0.0.1 --port 4173`
- [ ] Usar **solo cajas de prueba** con `device_id` sintético (prefijo `e2e-test-`).
  Nunca el ID de una caja real.
- [ ] **Sembrar en staging una copia de los casos difíciles** del catálogo real
  (no los datos completos del usuario; basta una réplica de los casos límite):
  - "SAL DEL MAR 1 KG" con empaque ajeno ("Unidad") y unidad `kg`;
  - un producto con empaque vacío y `granelUnit: 'kg'`;
  - un queso granel de verdad (debe seguir siendo granel, sin cambios);
  - un producto de bulto (`lote` con 12 uds) que debe quedar intacto.
- [ ] **Correr los E2E existentes** contra staging:
  - productos: `tests/e2e/supervisor-product-actions.e2e.spec.js`
  - recuperación de inventario: `bun run test:e2e:inventario-recovery`
  - checkout móvil: `bun run test:e2e:checkout`
- [ ] **Checklist manual en staging**:
  - [ ] La sal se vende por **unidad entera** (ya no acepta 0.350).
  - [ ] El formulario de la sal marca **Suelto** al abrirla.
  - [ ] El queso granel sigue aceptando decimales y mostrando kg.
  - [ ] El bulto de 12 uds no cambió nada.
  - [ ] El ticket imprime "1 UND" de sal y "0.350 kg" de queso, según corresponda.
  - [ ] El modo diagnóstico lista los cambios esperados y nada más.
  - [ ] **Comparación antes/después**: del informe exportado, todos los campos
        son idénticos EXCEPTO `packagingType`/`granelUnit`/`unit`.
  - [ ] Con dos cajas de prueba pareadas: el cambio se propaga por sincronización
        y la caja secundaria lo ve igual.

**Cómo se verifica:** checklist completo + E2E en verde contra staging.
**Cómo se revierte:** borrar los datos sintéticos de staging; producción jamás se tocó.

## 7. Decisión pendiente del dueño (bloquea la Fase 4)

Un producto mal marcado como granel puede tener **stock con decimales heredados**
(ej. la sal podría tener `2.5` porque se contaba "como kilos"). El inventario NO
se redondea solo jamás. Antes del barrido real, elegir una opción:

- **A (recomendada):** el reporte lista esos productos y tú decides cantidad por
  cantidad (2.5 → tú dices 2 o 3). Tarda un minuto y manda tu inventario.
- **B:** dejar los decimales como están y corregirlos con un conteo físico luego.
- **C:** redondeo automático al entero más cercano (no recomendado: inventario
  es dinero).

## 8. Fase 4 — Producción, con el freno puesto

Solo después de Fase 2 verde, Fase 3 verde y decisión del §7 tomada.

1. **Respaldo nuevo** en la caja principal (Ajustes → Sistema → Exportar Backup).
2. **Informe diagnóstico (dry-run)** en la caja real → revisarlo juntos.
3. **Aplicar el barrido**: solo campos `packagingType`/`granelUnit`/`unit`, con
   **bitácora de reversión** (valor anterior por producto, archivo con fecha).
4. **Verificación post-barrido** (10 minutos):
   - la sal y otros 4 productos de la lista se abren y venden bien;
   - un ticket de prueba sale correcto;
   - el monitor/nube recibió los cambios sin errores de sincronización;
   - comparar informe antes/después: cero cambios fuera de los 3 campos.
5. **Sello**: marcar el plan como CERRADO con fecha.

**Cómo se revierte (3 niveles):**
- Nivel 1 — un producto: editarlo y elegir su empaque correcto (30 segundos).
- Nivel 2 — todo el barrido: ejecutar la restauración desde la bitácora de
  reversión (devuelve los valores anteriores de empaque).
- Nivel 3 — catálogo completo: Importar Backup de la Fase 0 (estado previo exacto).
- El código se revierte aparte con `git revert`, sin tocar los datos.

## 9. Riesgos y cómo se mitigan

| Riesgo | Probabilidad | Mitigación |
|---|---|---|
| Redondear stock sin querer | Media | Regla dura: el fix nunca escribe `stock`. Prueba anti-daño del §5 |
| Un granel de verdad deja de serlo | Baja | La traducción solo cambia empaque vacío/ajeno; `granel` explícito no se toca. Prueba con queso en staging |
| Sincronización reparte un cambio malo | Baja | Todo pasa primero en staging con 2 cajas; en producción se revisa el dry-run antes de escribir |
| El usuario pierde datos | Muy baja | Respaldo doble + bitácora + Importar Backup como último recurso |

## 10. Archivos que se tocan (nada más)

- `src/utils/granel.js` — traductor + regla clara del detector.
- `src/utils/productProcessor.js` — normalizar al guardar, `granelUnit: null` en no-granel.
- `src/hooks/useProductForm.js` — quitar el `kg` por defecto; aviso "sin empaque".
- `src/components/Products/ProductFormQuick.jsx` / `ProductFormWizard.jsx` — aviso visible.
- `tests/granelGuardrails.test.js`, `tests/granelUnits.test.js` + archivos de prueba nuevos.

## 11. Checklist de verificación del plan (comandos de comprobación)

```bash
# 1. La regla clara quedó escrita (regresa 1):
grep -c "pkgType === 'granel'" src/utils/granel.js

# 2. El detector ya no usa granelUnit como pista suelta (regresa 0):
grep -c "Boolean(p.granelUnit)" src/utils/granel.js

# 3. productProcessor ya no congela granel con el kg del formulario (regresa 0):
grep -c ": isGranelProduct({ packagingType, granelUnit" src/utils/productProcessor.js

# 4. Pruebas verdes y lint sin errores:
bun run test && bun run lint
```

---

## Tu siguiente paso concreto

Respóndeme **"ejecuta la Fase 0 y la Fase 1"** y arranco: genero el modo
diagnóstico (dry-run) para que veas la lista de tus productos afectados sin que
se escriba nada, y dejo las pruebas nuevas listas. Recuerda elegir la opción
A, B o C del §7 para el stock con decimales antes de la Fase 4.
