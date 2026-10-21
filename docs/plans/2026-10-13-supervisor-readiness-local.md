# Modo Supervisor — cierre local y gates restantes

**Fecha:** 13 de octubre de 2026  
**Alcance de esta ejecución:** revisión local, consulta de metadatos de staging, cambios defensivos/test locales. No se aplicó SQL, no se escribieron datos remotos y no se tocó producción.

## Estado observado de staging

- `precios-al-dia-staging` (`tdfcpwctvumbdjmifypd`) reporta `ACTIVE_HEALTHY`.
- `list_migrations` muestra instaladas `staging_supervisor_pairing_auth` y las fases P1–P4 de pairing, harness E2E, más `staging_missing_objects_fail_closed` (`20261012_003`).
- `list_tables` confirma las tablas `device_pairings`, `supervisor_commands`, `sync_documents` y `device_sessions`; `supervisor_commands` tiene una fila a la hora de inspección. Este metadato no revela su estado/actor/payload ni certifica el flujo funcional.
- Los dos reportes del Security Advisor enumeran: diez tablas nuevas con RLS y sin policies (intencionalmente fail-closed); `heartbeat_device`/`auto_register_device` con search_path mutable y ejecutables por anon/authenticated; RPC de otros flujos con SECURITY DEFINER para roles cliente; políticas sintéticas de staging mencionadas por el Advisor. Requiere revisión contra uso real antes de modificar permisos.
- El Performance Advisor señaló policy `supervisor_commands_authorized_read` evaluando Auth por fila y varios índices aún no usados. No se cambiaron.

## Cambios locales hechos

- El receptor vuelve a comprobar justo antes de aplicar que la orden siga `pending`, coincida con caja/monitor Auth, y que el pairing no esté revocado. Si lectura/permisos/estado son ambiguos, falla cerrado y no manda ACK ni aplica.
- Se invirtió el orden final: persistir el resultado/idempotencia antes del ACK terminal. Si no se puede guardar el resultado, no se ACKea; se libera el guard en memoria para permitir reintento.
- Se creó un borrador productivo, **NOT APPLIED**, que valida formato de ID monitor, basado en PDA fingerprints y `mon-` IDs de la app. El hallazgo auditado sobre reclamación de `primary_device_id` no queda resuelto por este filtro de formato: el backend aún necesita una prueba server-side de que el caller posee una caja registrada.

## Gates que siguen abiertos antes de afirmar “listo”

1. Implementar y validar autorización server-side real del dueño al generar el token. Un formato validado no equivale a probar propiedad de la caja.
2. La comprobación command/pairing del cliente reduce la ventana de órdenes tras revocar, pero no es atómica con la mutación local. El cierre fuerte requiere revocar/expirar comandos pendientes en la misma transacción server-side y/o un protocolo de lease/autorización atómico en el punto de commit. No aplicar un arreglo SQL sin ensayarlo y aprobarlo.
3. Corregir e2e grant/policies/security-definer y search_path detectados por Advisor en staging según los contratos funcionales de Auth, pairing y sync; no revocar permisos “a ciegas”.
4. Ejecutar unit tests, SQL guardrails, typecheck, lint dirigido, build y luego E2E opt-in con identidades `e2e-*`. La suite remota escribe fixtures sintéticos; necesita aprobación explícita antes de ejecutarse.
5. Mantener todos los flags de mutación existentes según decisión vigente; egreso y tasa siguen bloqueados en esta build si no están configurados. La producción real no se inspeccionó en esta ejecución.

## Límites

`execute_sql` del conector Supabase se presenta como operación destructiva y no hay herramienta read-only de SQL disponible. Por decisión del usuario no se consultó producción ni se usó `execute_sql` en modo lectura. No aplicar esta nota como evidencia de configuración productiva.
