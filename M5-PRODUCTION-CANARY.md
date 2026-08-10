# M5 — Preflight de producción y canary del Supervisor

**Fecha:** 2026-08-10
**Proyecto:** `sodgzkablshladvbtnes`
**Alcance:** solo lectura y preparación. No activar mutaciones automáticamente.

## Resultado del preflight

Consultas ejecutadas mediante Management API en producción. No se insertaron, actualizaron ni eliminaron filas.

| Control | Resultado |
|---|---|
| `device_pairings` existe | ✅ |
| `sync_documents` existe | ✅ |
| `supervisor_commands` existe | ✅ |
| RLS en las tres tablas | ✅ habilitada |
| RLS forzada | ⚠️ no forzada; no se modifica en este preflight |
| Permisos directos para `anon` | ✅ ninguno en las tres tablas |
| RPC críticas con `SECURITY DEFINER` | ✅ |
| RPC críticas con `search_path` fijo | ✅ `public, extensions` |
| RPC críticas ejecutables por `anon` | ✅ bloqueadas |
| Comandos pendientes | ✅ 0 |
| Pairings totales | 15 |
| Pairings activos | 12 |
| Realtime | ✅ `device_pairings`, `sync_documents`, `supervisor_commands` |

## Bloqueo crítico encontrado y resuelto server-side

En el primer preflight la RPC de producción no permitía:

```text
supervisor.inventory.batch.adjust
```

Con la autorización explícita recibida, se aplicó únicamente en producción la migración income-only:

```text
supabase_supervisor_inventory_income_production.sql
```

La migración permite únicamente `direction=ingreso`. El egreso sigue fuera de la allowlist productiva.

Verificación posterior:

- `supervisor.inventory.batch.adjust` aparece en el `CHECK`;
- la RPC valida `direction=ingreso`;
- `SECURITY DEFINER` conservado;
- `search_path=public, extensions` conservado;
- `anon` sin `EXECUTE`;
- `authenticated` con `EXECUTE`;
- comandos pendientes: 0.

No se creó ningún comando de producción ni se modificaron movimientos de stock.

## Estado del canary

```text
Backend income-only: PREPARADO
Canary de cliente: NO ACTIVADO
SUPERVISOR_REMOTE_MUTATIONS_ENABLED: false
SUPERVISOR_REMOTE_INCOME_ENABLED: false por defecto
SUPERVISOR_REMOTE_EGRESS_ENABLED: false
```

El cliente necesita un build/deploy con esta variable explícita para iniciar el canary:

```env
VITE_SUPERVISOR_REMOTE_INCOME_ENABLED=true
```

Esa variable habilita únicamente el ingreso por lote; no habilita tasa, productos, turnos ni egresos.

Se verificó localmente que el build canary compila con esa variable. Como la aplicación real está desplegada en Vercel, el canary debe publicarse en Vercel; no requiere Cloudflare Workers.

El canary solo podrá comenzar después de una migración server-side revisada que:

1. agregue `supervisor.inventory.batch.adjust` al `CHECK`;
2. actualice la RPC con validación de ingreso/egreso;
3. conserve `SECURITY DEFINER` y `search_path` fijo;
4. mantenga `anon` sin permisos y sin `EXECUTE`;
5. pase una consulta de verificación posterior;
6. tenga rollback probado en staging.

## Procedimiento de activación futura

### A. Preparación

- backup/checksum de la migración;
- aplicar primero en staging;
- ejecutar M2/M4;
- confirmar 0 comandos pendientes;
- confirmar pairing único y dispositivo objetivo;
- mantener ambos flags apagados.

### B. Canary de ingreso

- activar únicamente el ingreso;
- utilizar una caja autorizada;
- probar una entrada pequeña y reversible;
- esperar ACK real;
- comprobar stock anterior, delta, stock posterior y movimiento auditado;
- comprobar que no cambian ventas, precios, usuarios ni cierres;
- observar errores y timeouts.

### C. Rollback inmediato

1. Apagar el flag de ingreso.
2. Impedir nuevos comandos.
3. Confirmar que no quedan comandos `pending`.
4. Revisar el último ACK y el movimiento generado.
5. Si el movimiento fue aplicado incorrectamente, usar movimiento inverso auditado; nunca borrar filas.
6. Volver el Supervisor a solo lectura.

### D. Egreso

El egreso requiere una aprobación separada. No se activa junto con el ingreso. Debe conservar:

- categoría obligatoria;
- `expectedStock`;
- rechazo de stock insuficiente;
- ACK/NACK;
- replay idempotente;
- rollback auditable.

## Allowlist del canary — completada con bloqueo por defecto

Se aplicó únicamente en producción:

```text
supabase_supervisor_canary_allowlist.sql
```

Resultado:

```text
RLS: activa y forzada
Dispositivos autorizados: 0
Comandos pending: 0
Trigger canary: activo
anon SELECT sobre allowlist: bloqueado
authenticated SELECT sobre allowlist: bloqueado
anon EXECUTE sobre guard: bloqueado
```

La tabla permanece vacía. Por tanto, aunque alguien activara accidentalmente el flag del frontend, ningún ingreso podría crearse hasta autorizar explícitamente el par caja/Supervisor.

Para autorizar el canary se necesita primero elegir el dispositivo real y ejecutar manualmente, con IDs verificados:

```sql
INSERT INTO public.supervisor_canary_allowlist
    (primary_device_id, monitor_device_id, purpose, enabled, expires_at)
VALUES
    ('ID-CAJA-CANARY', 'ID-MONITOR-CANARY', 'M5 income canary', true, now() + interval '24 hours')
ON CONFLICT (primary_device_id) DO UPDATE SET
    monitor_device_id = EXCLUDED.monitor_device_id,
    purpose = EXCLUDED.purpose,
    enabled = EXCLUDED.enabled,
    expires_at = EXCLUDED.expires_at,
    updated_at = now();
```

No se insertó ningún dispositivo real. El egreso continúa bloqueado.

## Decisión actual

M5 queda **lista para producción con doble bloqueo**:

1. el frontend de producción mantiene el ingreso apagado;
2. la allowlist server-side está vacía;
3. el trigger productivo rechaza cualquier comando que no sea ingreso canary autorizado;
4. el egreso sigue rechazado.

El Preview de Vercel de `m5-supervisor-canary` tiene el ingreso habilitado únicamente para pruebas y los 14 E2E pasan. La promoción a producción requiere seleccionar un único dispositivo, autorizarlo por 24 horas y ejecutar el smoke test controlado.

`VITE_SUPERVISOR_REMOTE_EGRESS_ENABLED` no debe configurarse como `true`.
