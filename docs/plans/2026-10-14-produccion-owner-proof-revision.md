# Producción — owner-proof para generate_pairing_token (paquete de revisión)

Actualizado: 2026-10-14. Estado: **no aplicado**. Inventario consultado en solo lectura en producción (`sodgzkablshladvbtnes`).

## 1. Alcance decidido

El usuario pidió preparar el cambio para **todas las licencias permanentes activas**, incluida Tuconyo. No es un piloto limitado a cinco equipos. Esta decisión amplía el alcance: cada dispositivo con licencia permanente activa debe quedar cubierto, no solo los IDs que se han mencionado por imagen.

## 2. Estado verificado en producción (solo lectura; instantánea)

`generate_pairing_token(text)` sigue con el comportamiento previo que permite a cualquier sesión autenticada reclamar filas sin dueño y filas revocadas. Las columnas `claim_*` no existen y el borrador no está aplicado. Historial de migraciones observado: solo `001 device_own_row_rls`.

El cruce reciente de `cloud_licenses` activas de tipo `permanent` con `account_devices` y `device_pairings` dio **6 dispositivos**:

| Alias de licencia | Device ID | Fila pairing | Dueño registrado | Monitor activo | Tratamiento previsto |
|---|---|---:|---:|---:|---|
| Bodega mani | `PDA-V2-F5D31FEFD7FC6C7DBE6632438C6D760A` | No | No | No | Habilitar reclamo inicial |
| bueno y sano | `PDA-V2-2B4238451E9320FE70D676A649603680` | Sí | Sí | No | Conservar dueño; probar pairing normal |
| Cosméticos | `PDA-V2-333D310EA8EFAB0B2261EF0BCB675980` | Sí | Sí | No | Conservar dueño; probar pairing normal |
| MILY BEAUTY STORE | `PDA-V2-A8F41C55B358445D301CDECA8F3E5B98` | No | No | No | Habilitar reclamo inicial |
| prueba | `PDA-V2-6ED140C490CA1D1CA553622078E16225` | Sí | Sí | Sí | Incluir en política global; preservar monitor activo |
| Tuconyo | `PDA-V2-627A7208E9D53F8CF76AF1184941F9FB` | Sí | No | No | Habilitar reclamo inicial; revisar fila existente sin dueño |

Los estados anteriores son instantáneas, no garantías. Reconsultar todos los IDs y el conjunto completo de licencias permanentes activas inmediatamente antes de cualquier cambio.

## 3. Consecuencias y riesgos del alcance global

1. El borrador existente no basta: crea códigos solo para filas existentes sin dueño. Tuconyo ya tiene una fila sin dueño, así que podría reclamarla si ese estado sigue igual al aplicar. No crea las filas faltantes para Bodega mani y MILY; el borrador global debe contemplar esos equipos elegibles sin habilitar IDs desconocidos o licencias no permanentes.
2. Al ser global, también alcanza licencias permanentes activas que aparezcan después o que no estén en esta lista; la implementación debe resolver el conjunto de dispositivos licenciados y su estado, no basarse en cinco IDs codificados.
3. `generate_pairing_token` actualmente puede reiniciar los campos de monitor al generar token. En el equipo `prueba` hay monitor activo: preservar ese vínculo y no regenerar token durante el rollout.
4. Dos equipos tienen dueños registrados (bueno y sano, Cosméticos). El cambio debe conservarlos; no reasignar ni borrar `owner_auth_id`.
5. El mecanismo de claim actual devuelve el código a una sesión autenticada que conoce el ID. Para la beta se acepta este riesgo acotado, pero comunicar los IDs solo a testers y vigilar reasignaciones.
6. El historial de migraciones de producción no coincide con staging: revisar la definición viva y permisos nuevamente antes de aplicar.

## 4. Decisiones tomadas

- El alcance objetivo es todas las licencias permanentes activas, incluida Tuconyo.
- Conservar los dueños registrados de bueno y sano y Cosméticos.
- Preservar el vínculo activo de `prueba`; no resetear ni generar un token nuevo en ese equipo durante la preparación.
- No asignar dueños desde la base. Los equipos sin dueño los reclamarán sus usuarios mediante el flujo acordado.

## 5. Pasos requeridos antes de aplicar (solo tras aprobación explícita)

1. Adaptar el borrador para el alcance global: filas faltantes para dispositivos elegibles, sin reclamar licencias no permanentes, sin cambiar dueños existentes y sin interrumpir vínculos activos.
2. Reconsultar inventario global y revisar el SQL contra el estado vivo de producción.
3. Ensayar la versión exacta en staging para cada caso: permanent activo sin fila, permanent activo con fila sin dueño, dueño existente, monitor activo, licencia no permanente y dispositivo desconocido; verificar negativos y ausencia de efectos cruzados.
4. Obtener y verificar un respaldo completo de producción (datos y definiciones) según el procedimiento del proyecto, con restauración/reversión comprobable.
5. Aplicar solo después de revisión y aprobación explícita del usuario.
6. Verificar después: definición, columnas, permisos, filas intactas, dueños preservados y monitor de `prueba` aún activo. Confirmar que solo permanentes activos quedan elegibles.
7. Reversión: restaurar la función previa desde el respaldo y retirar solamente columnas/objetos añadidos si se demuestra que es seguro; no borrar datos de pairing existentes.

## 6. Lo no verificado

- No se ha consultado el universo global de licencias en el mismo momento de un eventual rollout; los seis IDs son el cruce observado en esta instantánea.
- No se ha ensayado la versión global adaptada en staging.
- No existe respaldo completo de producción verificado en esta sesión.
- La pantalla de reclamo no se ha probado contra producción.
- Producción no se ha modificado.
"