# Producción — owner-proof para generate_pairing_token (paquete de revisión)

Fecha: 2026-10-14. Estado: **no aplicado**. Solo lectura en producción (`sodgzkablshladvbtnes`).

## 1. Estado verificado en producción (solo lectura)

- `generate_pairing_token(text)`: versión vulnerable. Reclama cualquier caja con `owner_auth_id IS NULL` y también cajas revocadas (`revoked_at IS NOT NULL`) desde cualquier sesión autenticada.
- `device_pairings`: 19 filas. 13 sin dueño. 3 vínculos activos (`monitor_auth_id` presente, no revocados). Son datos reales de clientes.
- Columnas `claim_*`: ausentes. El borrador no está aplicado.
- Historial de migraciones: solo `001 device_own_row_rls`. No coincide con staging.

## 2. Decisiones tomadas

- Las 13 cajas sin dueño **se quedan sin dueño** hasta que su dueño real las reclame con el código de reclamo. No se les asigna dueño desde la base.

## 3. Riesgos antes de aplicar

1. Las 13 cajas sin dueño no podrán generar token hasta que se reclamen. Hay que avisar a los usuarios afectados o confirmar que no están en uso.
2. Los 3 vínculos activos: el borrador no los revoca. Hay que decidir si quedan vinculados o se revocan explícitamente.
3. La app (`PairingManager.jsx`) ya tiene la pantalla de reclamo, pero aún no hay flujo de reclamo probado de punta a punta contra producción.
4. Aplicar requiere respaldo completo de producción. No se ha hecho en esta sesión.

## 4. Pasos propuestos (solo tras aprobación explícita)

1. Respaldo completo verificado de producción (datos y definiciones), siguiendo el procedimiento del proyecto.
2. Confirmar con el dueño del negocio el manejo de los 3 vínculos activos.
3. Aplicar el borrador `supabase/production-drafts/20261013_prod_pairing_token_owner_proof.sql` en una transacción.
4. Verificar después: funciones y columnas presentes, `anon` sin EXECUTE, filas intactas, y que el dueño legítimo puede generar token.
5. Plan de reversión: restaurar la definición vieja de `generate_pairing_token` desde el respaldo.

## 5. Lo que no está verificado

- El borrador no se ha ensayado contra una base con datos reales; se ensayó en staging con sesiones simuladas.
- La pantalla de reclamo no se ha probado en navegador ni contra producción.
