# Precios al Día — comparativo de esquema Supabase

Generado: 2026-10-14T18:42:14.642Z

> Comparación de metadatos de esquema únicamente. No consulta filas de negocio ni incluye cuerpos de funciones o valores secretos. Literales SQL en definiciones/defaults se redactan en este reporte.

## Proyectos

| Entorno | Proyecto | Ref | PostgreSQL | Relaciones | Rutinas | Políticas RLS | Triggers | Extensiones instaladas | Tablas Realtime | Grants | Tipos enum |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Producción | preciosaldia rebranding | `sodgzkablshladvbtnes` | 17.6 | 15 | 15 | 28 | 1 | 4 | 3 | 276 | 0 |
| Staging | precios-al-dia-staging | `tdfcpwctvumbdjmifypd` | 17.6 | 15 | 28 | 11 | 1 | 4 | 2 | 130 | 0 |

## Resultado

Se detectaron **236 diferencias**. Cada ruta es una ubicación del snapshot; «—» indica ausencia en ese entorno.

| Ruta | Producción | Staging |
|---|---|---|
| `grants[account_devices.anon.DELETE]` | `{"grantee":"anon","privilege_type":"DELETE","table_name":"account_devices"}` | `—` |
| `grants[account_devices.anon.INSERT]` | `{"grantee":"anon","privilege_type":"INSERT","table_name":"account_devices"}` | `—` |
| `grants[account_devices.anon.MAINTAIN]` | `{"grantee":"anon","privilege_type":"MAINTAIN","table_name":"account_devices"}` | `—` |
| `grants[account_devices.anon.REFERENCES]` | `{"grantee":"anon","privilege_type":"REFERENCES","table_name":"account_devices"}` | `—` |
| `grants[account_devices.anon.SELECT]` | `{"grantee":"anon","privilege_type":"SELECT","table_name":"account_devices"}` | `—` |
| `grants[account_devices.anon.TRIGGER]` | `{"grantee":"anon","privilege_type":"TRIGGER","table_name":"account_devices"}` | `—` |
| `grants[account_devices.anon.TRUNCATE]` | `{"grantee":"anon","privilege_type":"TRUNCATE","table_name":"account_devices"}` | `—` |
| `grants[account_devices.anon.UPDATE]` | `{"grantee":"anon","privilege_type":"UPDATE","table_name":"account_devices"}` | `—` |
| `grants[account_devices.authenticated.DELETE]` | `{"grantee":"authenticated","privilege_type":"DELETE","table_name":"account_devices"}` | `—` |
| `grants[account_devices.authenticated.INSERT]` | `{"grantee":"authenticated","privilege_type":"INSERT","table_name":"account_devices"}` | `—` |
| `grants[account_devices.authenticated.MAINTAIN]` | `{"grantee":"authenticated","privilege_type":"MAINTAIN","table_name":"account_devices"}` | `—` |
| `grants[account_devices.authenticated.REFERENCES]` | `{"grantee":"authenticated","privilege_type":"REFERENCES","table_name":"account_devices"}` | `—` |
| `grants[account_devices.authenticated.SELECT]` | `{"grantee":"authenticated","privilege_type":"SELECT","table_name":"account_devices"}` | `—` |
| `grants[account_devices.authenticated.TRIGGER]` | `{"grantee":"authenticated","privilege_type":"TRIGGER","table_name":"account_devices"}` | `—` |
| `grants[account_devices.authenticated.TRUNCATE]` | `{"grantee":"authenticated","privilege_type":"TRUNCATE","table_name":"account_devices"}` | `—` |
| `grants[account_devices.authenticated.UPDATE]` | `{"grantee":"authenticated","privilege_type":"UPDATE","table_name":"account_devices"}` | `—` |
| `grants[backup_requests.anon.DELETE]` | `{"grantee":"anon","privilege_type":"DELETE","table_name":"backup_requests"}` | `—` |
| `grants[backup_requests.anon.INSERT]` | `{"grantee":"anon","privilege_type":"INSERT","table_name":"backup_requests"}` | `—` |
| `grants[backup_requests.anon.MAINTAIN]` | `{"grantee":"anon","privilege_type":"MAINTAIN","table_name":"backup_requests"}` | `—` |
| `grants[backup_requests.anon.REFERENCES]` | `{"grantee":"anon","privilege_type":"REFERENCES","table_name":"backup_requests"}` | `—` |
| `grants[backup_requests.anon.SELECT]` | `{"grantee":"anon","privilege_type":"SELECT","table_name":"backup_requests"}` | `—` |
| `grants[backup_requests.anon.TRIGGER]` | `{"grantee":"anon","privilege_type":"TRIGGER","table_name":"backup_requests"}` | `—` |
| `grants[backup_requests.anon.TRUNCATE]` | `{"grantee":"anon","privilege_type":"TRUNCATE","table_name":"backup_requests"}` | `—` |
| `grants[backup_requests.anon.UPDATE]` | `{"grantee":"anon","privilege_type":"UPDATE","table_name":"backup_requests"}` | `—` |
| `grants[backup_requests.authenticated.DELETE]` | `{"grantee":"authenticated","privilege_type":"DELETE","table_name":"backup_requests"}` | `—` |
| `grants[backup_requests.authenticated.INSERT]` | `{"grantee":"authenticated","privilege_type":"INSERT","table_name":"backup_requests"}` | `—` |
| `grants[backup_requests.authenticated.MAINTAIN]` | `{"grantee":"authenticated","privilege_type":"MAINTAIN","table_name":"backup_requests"}` | `—` |
| `grants[backup_requests.authenticated.REFERENCES]` | `{"grantee":"authenticated","privilege_type":"REFERENCES","table_name":"backup_requests"}` | `—` |
| `grants[backup_requests.authenticated.SELECT]` | `{"grantee":"authenticated","privilege_type":"SELECT","table_name":"backup_requests"}` | `—` |
| `grants[backup_requests.authenticated.TRIGGER]` | `{"grantee":"authenticated","privilege_type":"TRIGGER","table_name":"backup_requests"}` | `—` |
| `grants[backup_requests.authenticated.TRUNCATE]` | `{"grantee":"authenticated","privilege_type":"TRUNCATE","table_name":"backup_requests"}` | `—` |
| `grants[backup_requests.authenticated.UPDATE]` | `{"grantee":"authenticated","privilege_type":"UPDATE","table_name":"backup_requests"}` | `—` |
| `grants[cloud_backups.authenticated.MAINTAIN]` | `{"grantee":"authenticated","privilege_type":"MAINTAIN","table_name":"cloud_backups"}` | `—` |
| `grants[cloud_licenses.anon.DELETE]` | `{"grantee":"anon","privilege_type":"DELETE","table_name":"cloud_licenses"}` | `—` |
| `grants[cloud_licenses.anon.INSERT]` | `{"grantee":"anon","privilege_type":"INSERT","table_name":"cloud_licenses"}` | `—` |
| `grants[cloud_licenses.anon.MAINTAIN]` | `{"grantee":"anon","privilege_type":"MAINTAIN","table_name":"cloud_licenses"}` | `—` |
| `grants[cloud_licenses.anon.REFERENCES]` | `{"grantee":"anon","privilege_type":"REFERENCES","table_name":"cloud_licenses"}` | `—` |
| `grants[cloud_licenses.anon.SELECT]` | `{"grantee":"anon","privilege_type":"SELECT","table_name":"cloud_licenses"}` | `—` |
| `grants[cloud_licenses.anon.TRIGGER]` | `{"grantee":"anon","privilege_type":"TRIGGER","table_name":"cloud_licenses"}` | `—` |
| `grants[cloud_licenses.anon.TRUNCATE]` | `{"grantee":"anon","privilege_type":"TRUNCATE","table_name":"cloud_licenses"}` | `—` |
| `grants[cloud_licenses.anon.UPDATE]` | `{"grantee":"anon","privilege_type":"UPDATE","table_name":"cloud_licenses"}` | `—` |
| `grants[cloud_licenses.authenticated.DELETE]` | `{"grantee":"authenticated","privilege_type":"DELETE","table_name":"cloud_licenses"}` | `—` |
| `grants[cloud_licenses.authenticated.INSERT]` | `{"grantee":"authenticated","privilege_type":"INSERT","table_name":"cloud_licenses"}` | `—` |
| `grants[cloud_licenses.authenticated.MAINTAIN]` | `{"grantee":"authenticated","privilege_type":"MAINTAIN","table_name":"cloud_licenses"}` | `—` |
| `grants[cloud_licenses.authenticated.REFERENCES]` | `{"grantee":"authenticated","privilege_type":"REFERENCES","table_name":"cloud_licenses"}` | `—` |
| `grants[cloud_licenses.authenticated.SELECT]` | `{"grantee":"authenticated","privilege_type":"SELECT","table_name":"cloud_licenses"}` | `—` |
| `grants[cloud_licenses.authenticated.TRIGGER]` | `{"grantee":"authenticated","privilege_type":"TRIGGER","table_name":"cloud_licenses"}` | `—` |
| `grants[cloud_licenses.authenticated.TRUNCATE]` | `{"grantee":"authenticated","privilege_type":"TRUNCATE","table_name":"cloud_licenses"}` | `—` |
| `grants[cloud_licenses.authenticated.UPDATE]` | `{"grantee":"authenticated","privilege_type":"UPDATE","table_name":"cloud_licenses"}` | `—` |
| `grants[customer_projects.anon.DELETE]` | `{"grantee":"anon","privilege_type":"DELETE","table_name":"customer_projects"}` | `—` |
| `grants[customer_projects.anon.INSERT]` | `{"grantee":"anon","privilege_type":"INSERT","table_name":"customer_projects"}` | `—` |
| `grants[customer_projects.anon.MAINTAIN]` | `{"grantee":"anon","privilege_type":"MAINTAIN","table_name":"customer_projects"}` | `—` |
| `grants[customer_projects.anon.REFERENCES]` | `{"grantee":"anon","privilege_type":"REFERENCES","table_name":"customer_projects"}` | `—` |
| `grants[customer_projects.anon.SELECT]` | `{"grantee":"anon","privilege_type":"SELECT","table_name":"customer_projects"}` | `—` |
| `grants[customer_projects.anon.TRIGGER]` | `{"grantee":"anon","privilege_type":"TRIGGER","table_name":"customer_projects"}` | `—` |
| `grants[customer_projects.anon.TRUNCATE]` | `{"grantee":"anon","privilege_type":"TRUNCATE","table_name":"customer_projects"}` | `—` |
| `grants[customer_projects.anon.UPDATE]` | `{"grantee":"anon","privilege_type":"UPDATE","table_name":"customer_projects"}` | `—` |
| `grants[customer_projects.authenticated.DELETE]` | `{"grantee":"authenticated","privilege_type":"DELETE","table_name":"customer_projects"}` | `—` |
| `grants[customer_projects.authenticated.INSERT]` | `{"grantee":"authenticated","privilege_type":"INSERT","table_name":"customer_projects"}` | `—` |
| `grants[customer_projects.authenticated.MAINTAIN]` | `{"grantee":"authenticated","privilege_type":"MAINTAIN","table_name":"customer_projects"}` | `—` |
| `grants[customer_projects.authenticated.REFERENCES]` | `{"grantee":"authenticated","privilege_type":"REFERENCES","table_name":"customer_projects"}` | `—` |
| `grants[customer_projects.authenticated.SELECT]` | `{"grantee":"authenticated","privilege_type":"SELECT","table_name":"customer_projects"}` | `—` |
| `grants[customer_projects.authenticated.TRIGGER]` | `{"grantee":"authenticated","privilege_type":"TRIGGER","table_name":"customer_projects"}` | `—` |
| `grants[customer_projects.authenticated.TRUNCATE]` | `{"grantee":"authenticated","privilege_type":"TRUNCATE","table_name":"customer_projects"}` | `—` |
| `grants[customer_projects.authenticated.UPDATE]` | `{"grantee":"authenticated","privilege_type":"UPDATE","table_name":"customer_projects"}` | `—` |
| `grants[device_pairings.authenticated.SELECT]` | `{"grantee":"authenticated","privilege_type":"SELECT","table_name":"device_pairings"}` | `—` |
| `grants[device_sessions.anon.DELETE]` | `{"grantee":"anon","privilege_type":"DELETE","table_name":"device_sessions"}` | `—` |
| `grants[device_sessions.anon.INSERT]` | `{"grantee":"anon","privilege_type":"INSERT","table_name":"device_sessions"}` | `—` |
| `grants[device_sessions.anon.MAINTAIN]` | `{"grantee":"anon","privilege_type":"MAINTAIN","table_name":"device_sessions"}` | `—` |
| `grants[device_sessions.anon.REFERENCES]` | `{"grantee":"anon","privilege_type":"REFERENCES","table_name":"device_sessions"}` | `—` |
| `grants[device_sessions.anon.SELECT]` | `{"grantee":"anon","privilege_type":"SELECT","table_name":"device_sessions"}` | `—` |
| `grants[device_sessions.anon.TRIGGER]` | `{"grantee":"anon","privilege_type":"TRIGGER","table_name":"device_sessions"}` | `—` |
| `grants[device_sessions.anon.TRUNCATE]` | `{"grantee":"anon","privilege_type":"TRUNCATE","table_name":"device_sessions"}` | `—` |
| `grants[device_sessions.anon.UPDATE]` | `{"grantee":"anon","privilege_type":"UPDATE","table_name":"device_sessions"}` | `—` |
| `grants[device_sessions.authenticated.DELETE]` | `{"grantee":"authenticated","privilege_type":"DELETE","table_name":"device_sessions"}` | `—` |
| `grants[device_sessions.authenticated.INSERT]` | `{"grantee":"authenticated","privilege_type":"INSERT","table_name":"device_sessions"}` | `—` |
| `grants[device_sessions.authenticated.MAINTAIN]` | `{"grantee":"authenticated","privilege_type":"MAINTAIN","table_name":"device_sessions"}` | `—` |
| `grants[device_sessions.authenticated.REFERENCES]` | `{"grantee":"authenticated","privilege_type":"REFERENCES","table_name":"device_sessions"}` | `—` |
| `grants[device_sessions.authenticated.TRIGGER]` | `{"grantee":"authenticated","privilege_type":"TRIGGER","table_name":"device_sessions"}` | `—` |
| `grants[device_sessions.authenticated.TRUNCATE]` | `{"grantee":"authenticated","privilege_type":"TRUNCATE","table_name":"device_sessions"}` | `—` |
| `grants[device_sessions.authenticated.UPDATE]` | `{"grantee":"authenticated","privilege_type":"UPDATE","table_name":"device_sessions"}` | `—` |
| `grants[licenses.anon.DELETE]` | `{"grantee":"anon","privilege_type":"DELETE","table_name":"licenses"}` | `—` |
| `grants[licenses.anon.INSERT]` | `{"grantee":"anon","privilege_type":"INSERT","table_name":"licenses"}` | `—` |
| `grants[licenses.anon.MAINTAIN]` | `{"grantee":"anon","privilege_type":"MAINTAIN","table_name":"licenses"}` | `—` |
| `grants[licenses.anon.REFERENCES]` | `{"grantee":"anon","privilege_type":"REFERENCES","table_name":"licenses"}` | `—` |
| `grants[licenses.anon.SELECT]` | `{"grantee":"anon","privilege_type":"SELECT","table_name":"licenses"}` | `—` |
| `grants[licenses.anon.TRIGGER]` | `{"grantee":"anon","privilege_type":"TRIGGER","table_name":"licenses"}` | `—` |
| `grants[licenses.anon.TRUNCATE]` | `{"grantee":"anon","privilege_type":"TRUNCATE","table_name":"licenses"}` | `—` |
| `grants[licenses.anon.UPDATE]` | `{"grantee":"anon","privilege_type":"UPDATE","table_name":"licenses"}` | `—` |
| `grants[licenses.authenticated.DELETE]` | `{"grantee":"authenticated","privilege_type":"DELETE","table_name":"licenses"}` | `—` |
| `grants[licenses.authenticated.INSERT]` | `{"grantee":"authenticated","privilege_type":"INSERT","table_name":"licenses"}` | `—` |
| `grants[licenses.authenticated.MAINTAIN]` | `{"grantee":"authenticated","privilege_type":"MAINTAIN","table_name":"licenses"}` | `—` |
| `grants[licenses.authenticated.REFERENCES]` | `{"grantee":"authenticated","privilege_type":"REFERENCES","table_name":"licenses"}` | `—` |
| `grants[licenses.authenticated.SELECT]` | `{"grantee":"authenticated","privilege_type":"SELECT","table_name":"licenses"}` | `—` |
| `grants[licenses.authenticated.TRIGGER]` | `{"grantee":"authenticated","privilege_type":"TRIGGER","table_name":"licenses"}` | `—` |
| `grants[licenses.authenticated.TRUNCATE]` | `{"grantee":"authenticated","privilege_type":"TRUNCATE","table_name":"licenses"}` | `—` |
| `grants[licenses.authenticated.UPDATE]` | `{"grantee":"authenticated","privilege_type":"UPDATE","table_name":"licenses"}` | `—` |
| `grants[notifications.anon.DELETE]` | `{"grantee":"anon","privilege_type":"DELETE","table_name":"notifications"}` | `—` |
| `grants[notifications.anon.INSERT]` | `{"grantee":"anon","privilege_type":"INSERT","table_name":"notifications"}` | `—` |
| `grants[notifications.anon.MAINTAIN]` | `{"grantee":"anon","privilege_type":"MAINTAIN","table_name":"notifications"}` | `—` |
| `grants[notifications.anon.REFERENCES]` | `{"grantee":"anon","privilege_type":"REFERENCES","table_name":"notifications"}` | `—` |
| `grants[notifications.anon.SELECT]` | `{"grantee":"anon","privilege_type":"SELECT","table_name":"notifications"}` | `—` |
| `grants[notifications.anon.TRIGGER]` | `{"grantee":"anon","privilege_type":"TRIGGER","table_name":"notifications"}` | `—` |
| `grants[notifications.anon.TRUNCATE]` | `{"grantee":"anon","privilege_type":"TRUNCATE","table_name":"notifications"}` | `—` |
| `grants[notifications.anon.UPDATE]` | `{"grantee":"anon","privilege_type":"UPDATE","table_name":"notifications"}` | `—` |
| `grants[notifications.authenticated.DELETE]` | `{"grantee":"authenticated","privilege_type":"DELETE","table_name":"notifications"}` | `—` |
| `grants[notifications.authenticated.INSERT]` | `{"grantee":"authenticated","privilege_type":"INSERT","table_name":"notifications"}` | `—` |
| `grants[notifications.authenticated.MAINTAIN]` | `{"grantee":"authenticated","privilege_type":"MAINTAIN","table_name":"notifications"}` | `—` |
| `grants[notifications.authenticated.REFERENCES]` | `{"grantee":"authenticated","privilege_type":"REFERENCES","table_name":"notifications"}` | `—` |
| `grants[notifications.authenticated.SELECT]` | `{"grantee":"authenticated","privilege_type":"SELECT","table_name":"notifications"}` | `—` |
| `grants[notifications.authenticated.TRIGGER]` | `{"grantee":"authenticated","privilege_type":"TRIGGER","table_name":"notifications"}` | `—` |
| `grants[notifications.authenticated.TRUNCATE]` | `{"grantee":"authenticated","privilege_type":"TRUNCATE","table_name":"notifications"}` | `—` |
| `grants[notifications.authenticated.UPDATE]` | `{"grantee":"authenticated","privilege_type":"UPDATE","table_name":"notifications"}` | `—` |
| `grants[product_images_catalog.anon.DELETE]` | `{"grantee":"anon","privilege_type":"DELETE","table_name":"product_images_catalog"}` | `—` |
| `grants[product_images_catalog.anon.INSERT]` | `{"grantee":"anon","privilege_type":"INSERT","table_name":"product_images_catalog"}` | `—` |
| `grants[product_images_catalog.anon.MAINTAIN]` | `{"grantee":"anon","privilege_type":"MAINTAIN","table_name":"product_images_catalog"}` | `—` |
| `grants[product_images_catalog.anon.REFERENCES]` | `{"grantee":"anon","privilege_type":"REFERENCES","table_name":"product_images_catalog"}` | `—` |
| `grants[product_images_catalog.anon.SELECT]` | `{"grantee":"anon","privilege_type":"SELECT","table_name":"product_images_catalog"}` | `—` |
| `grants[product_images_catalog.anon.TRIGGER]` | `{"grantee":"anon","privilege_type":"TRIGGER","table_name":"product_images_catalog"}` | `—` |
| `grants[product_images_catalog.anon.TRUNCATE]` | `{"grantee":"anon","privilege_type":"TRUNCATE","table_name":"product_images_catalog"}` | `—` |
| `grants[product_images_catalog.anon.UPDATE]` | `{"grantee":"anon","privilege_type":"UPDATE","table_name":"product_images_catalog"}` | `—` |
| `grants[product_images_catalog.authenticated.DELETE]` | `{"grantee":"authenticated","privilege_type":"DELETE","table_name":"product_images_catalog"}` | `—` |
| `grants[product_images_catalog.authenticated.INSERT]` | `{"grantee":"authenticated","privilege_type":"INSERT","table_name":"product_images_catalog"}` | `—` |
| `grants[product_images_catalog.authenticated.MAINTAIN]` | `{"grantee":"authenticated","privilege_type":"MAINTAIN","table_name":"product_images_catalog"}` | `—` |
| `grants[product_images_catalog.authenticated.REFERENCES]` | `{"grantee":"authenticated","privilege_type":"REFERENCES","table_name":"product_images_catalog"}` | `—` |
| `grants[product_images_catalog.authenticated.SELECT]` | `{"grantee":"authenticated","privilege_type":"SELECT","table_name":"product_images_catalog"}` | `—` |
| `grants[product_images_catalog.authenticated.TRIGGER]` | `{"grantee":"authenticated","privilege_type":"TRIGGER","table_name":"product_images_catalog"}` | `—` |
| `grants[product_images_catalog.authenticated.TRUNCATE]` | `{"grantee":"authenticated","privilege_type":"TRUNCATE","table_name":"product_images_catalog"}` | `—` |
| `grants[product_images_catalog.authenticated.UPDATE]` | `{"grantee":"authenticated","privilege_type":"UPDATE","table_name":"product_images_catalog"}` | `—` |
| `grants[sync_documents.authenticated.MAINTAIN]` | `{"grantee":"authenticated","privilege_type":"MAINTAIN","table_name":"sync_documents"}` | `—` |
| `grants[visits.anon.DELETE]` | `{"grantee":"anon","privilege_type":"DELETE","table_name":"visits"}` | `—` |
| `grants[visits.anon.INSERT]` | `{"grantee":"anon","privilege_type":"INSERT","table_name":"visits"}` | `—` |
| `grants[visits.anon.MAINTAIN]` | `{"grantee":"anon","privilege_type":"MAINTAIN","table_name":"visits"}` | `—` |
| `grants[visits.anon.REFERENCES]` | `{"grantee":"anon","privilege_type":"REFERENCES","table_name":"visits"}` | `—` |
| `grants[visits.anon.SELECT]` | `{"grantee":"anon","privilege_type":"SELECT","table_name":"visits"}` | `—` |
| `grants[visits.anon.TRIGGER]` | `{"grantee":"anon","privilege_type":"TRIGGER","table_name":"visits"}` | `—` |
| `grants[visits.anon.TRUNCATE]` | `{"grantee":"anon","privilege_type":"TRUNCATE","table_name":"visits"}` | `—` |
| `grants[visits.anon.UPDATE]` | `{"grantee":"anon","privilege_type":"UPDATE","table_name":"visits"}` | `—` |
| `grants[visits.authenticated.DELETE]` | `{"grantee":"authenticated","privilege_type":"DELETE","table_name":"visits"}` | `—` |
| `grants[visits.authenticated.INSERT]` | `{"grantee":"authenticated","privilege_type":"INSERT","table_name":"visits"}` | `—` |
| `grants[visits.authenticated.MAINTAIN]` | `{"grantee":"authenticated","privilege_type":"MAINTAIN","table_name":"visits"}` | `—` |
| `grants[visits.authenticated.REFERENCES]` | `{"grantee":"authenticated","privilege_type":"REFERENCES","table_name":"visits"}` | `—` |
| `grants[visits.authenticated.SELECT]` | `{"grantee":"authenticated","privilege_type":"SELECT","table_name":"visits"}` | `—` |
| `grants[visits.authenticated.TRIGGER]` | `{"grantee":"authenticated","privilege_type":"TRIGGER","table_name":"visits"}` | `—` |
| `grants[visits.authenticated.TRUNCATE]` | `{"grantee":"authenticated","privilege_type":"TRUNCATE","table_name":"visits"}` | `—` |
| `grants[visits.authenticated.UPDATE]` | `{"grantee":"authenticated","privilege_type":"UPDATE","table_name":"visits"}` | `—` |
| `policies[account_devices.account_devices_admin_write]` | `{"command":"ALL","name":"account_devices_admin_write","permissive":"PERMISSIVE","qual":"true","roles":["service_role"],"table_name":"account_devices","with_check":"true"}` | `—` |
| `policies[account_devices.account_devices_device_isolation]` | `{"command":"ALL","name":"account_devices_device_isolation","permissive":"PERMISSIVE","qual":"((auth.uid())::text = device_id)","roles":["authenticated"],"table_name":"account_devices","with_check":"((auth.uid())::text = device_id)"}` | `—` |
| `policies[backup_requests.backup_requests_admin_write]` | `{"command":"ALL","name":"backup_requests_admin_write","permissive":"PERMISSIVE","qual":"true","roles":["service_role"],"table_name":"backup_requests","with_check":"true"}` | `—` |
| `policies[backup_requests.backup_requests_anon_access]` | `{"command":"ALL","name":"backup_requests_anon_access","permissive":"PERMISSIVE","qual":"(EXISTS ( SELECT 1\n   FROM cloud_licenses\n  WHERE (cloud_licenses.device_id = backup_requests.device_id)))","roles":["anon"],"table_name":"backup_requests","with_check":"(EXISTS ( SELECT 1\n   FROM cloud_licenses\n  WHERE (cloud_licenses.device_id = backup_requests.device_id)))"}` | `—` |
| `policies[backup_requests.backup_requests_device_isolation]` | `{"command":"ALL","name":"backup_requests_device_isolation","permissive":"PERMISSIVE","qual":"((auth.uid())::text = device_id)","roles":["authenticated"],"table_name":"backup_requests","with_check":"((auth.uid())::text = device_id)"}` | `—` |
| `policies[backup_requests.backup_requests_owner_select]` | `—` | `{"command":"SELECT","name":"backup_requests_owner_select","permissive":"PERMISSIVE","qual":"owns_backup_device(device_id)","roles":["authenticated"],"table_name":"backup_requests","with_check":null}` |
| `policies[backup_requests.backup_requests_owner_update]` | `—` | `{"command":"UPDATE","name":"backup_requests_owner_update","permissive":"PERMISSIVE","qual":"owns_backup_device(device_id)","roles":["authenticated"],"table_name":"backup_requests","with_check":"owns_backup_device(device_id)"}` |
| `policies[backup_requests.Permitir borrado de backup_requests]` | `{"command":"DELETE","name":"Permitir borrado de backup_requests","permissive":"PERMISSIVE","qual":"true","roles":["anon","authenticated"],"table_name":"backup_requests","with_check":null}` | `—` |
| `policies[backup_requests.Permitir insercion de backup_requests]` | `{"command":"INSERT","name":"Permitir insercion de backup_requests","permissive":"PERMISSIVE","qual":null,"roles":["anon","authenticated"],"table_name":"backup_requests","with_check":"true"}` | `—` |
| `policies[backup_requests.Permitir lectura de backup_requests]` | `{"command":"SELECT","name":"Permitir lectura de backup_requests","permissive":"PERMISSIVE","qual":"true","roles":["anon","authenticated"],"table_name":"backup_requests","with_check":null}` | `—` |
| `policies[cloud_backups.cloud_backups_device_isolation]` | `{"command":"ALL","name":"cloud_backups_device_isolation","permissive":"PERMISSIVE","qual":"((auth.uid())::text = device_id)","roles":["authenticated"],"table_name":"cloud_backups","with_check":"((auth.uid())::text = device_id)"}` | `—` |
| `policies[cloud_backups.cloud_backups_owner_all]` | `—` | `{"command":"ALL","name":"cloud_backups_owner_all","permissive":"PERMISSIVE","qual":"is_own_device_row(device_id)","roles":["authenticated"],"table_name":"cloud_backups","with_check":"is_own_device_row(device_id)"}` |
| `policies[cloud_backups.device_read_own_backup]` | `{"command":"SELECT","name":"device_read_own_backup","permissive":"PERMISSIVE","qual":"(is_own_device_row(device_id) OR (EXISTS ( SELECT 1\n   FROM device_pairings dp\n  WHERE ((dp.monitor_device_id = current_device_id()) AND (dp.primary_device_id = cloud_backups.device_id)))))","roles":["anon","authenticated"],"table_name":"cloud_backups","with_check":null}` | `—` |
| `policies[cloud_backups.device_update_own_backup]` | `{"command":"UPDATE","name":"device_update_own_backup","permissive":"PERMISSIVE","qual":"is_own_device_row(device_id)","roles":["anon","authenticated"],"table_name":"cloud_backups","with_check":"is_own_device_row(device_id)"}` | `—` |
| `policies[cloud_backups.device_upsert_own_backup]` | `{"command":"INSERT","name":"device_upsert_own_backup","permissive":"PERMISSIVE","qual":null,"roles":["anon","authenticated"],"table_name":"cloud_backups","with_check":"is_own_device_row(device_id)"}` | `—` |
| `policies[cloud_licenses.cloud_licenses_admin_write]` | `{"command":"ALL","name":"cloud_licenses_admin_write","permissive":"PERMISSIVE","qual":"true","roles":["service_role"],"table_name":"cloud_licenses","with_check":"true"}` | `—` |
| `policies[cloud_licenses.cloud_licenses_device_read]` | `{"command":"SELECT","name":"cloud_licenses_device_read","permissive":"PERMISSIVE","qual":"((auth.uid())::text = device_id)","roles":["authenticated"],"table_name":"cloud_licenses","with_check":null}` | `—` |
| `policies[device_pairings.device_pairings_authenticated_read]` | `{"command":"SELECT","name":"device_pairings_authenticated_read","permissive":"PERMISSIVE","qual":"((auth.uid() = owner_auth_id) OR (auth.uid() = monitor_auth_id))","roles":["authenticated"],"table_name":"device_pairings","with_check":null}` | `—` |
| `policies[device_pairings.staging_authenticated_pairing_read]` | `—` | `{"command":"SELECT","name":"staging_authenticated_pairing_read","permissive":"PERMISSIVE","qual":"(primary_device_id ~~ '[redacted literal]'::text)","roles":["authenticated"],"table_name":"device_pairings","with_check":null}` |
| `policies[device_pairings.staging_definer_pairing_access]` | `—` | `{"command":"ALL","name":"staging_definer_pairing_access","permissive":"PERMISSIVE","qual":"(primary_device_id ~~ '[redacted literal]'::text)","roles":["postgres"],"table_name":"device_pairings","with_check":"(primary_device_id ~~ '[redacted literal]'::text)"}` |
| `policies[device_sessions.device_sessions_insert_own]` | `{"command":"INSERT","name":"device_sessions_insert_own","permissive":"PERMISSIVE","qual":null,"roles":["anon","authenticated"],"table_name":"device_sessions","with_check":"(auth.uid() = user_id)"}` | `—` |
| `policies[device_sessions.device_sessions_owner_select]` | `—` | `{"command":"SELECT","name":"device_sessions_owner_select","permissive":"PERMISSIVE","qual":"(user_id = auth.uid())","roles":["authenticated"],"table_name":"device_sessions","with_check":null}` |
| `policies[device_sessions.device_sessions_reclaim]` | `{"command":"UPDATE","name":"device_sessions_reclaim","permissive":"PERMISSIVE","qual":"true","roles":["anon","authenticated"],"table_name":"device_sessions","with_check":"(auth.uid() = user_id)"}` | `—` |
| `policies[device_sessions.device_sessions_select_own]` | `{"command":"SELECT","name":"device_sessions_select_own","permissive":"PERMISSIVE","qual":"(auth.uid() = user_id)","roles":["anon","authenticated"],"table_name":"device_sessions","with_check":null}` | `—` |
| `policies[device_sessions.device_sessions_update_own]` | `{"command":"UPDATE","name":"device_sessions_update_own","permissive":"PERMISSIVE","qual":"(auth.uid() = user_id)","roles":["anon","authenticated"],"table_name":"device_sessions","with_check":"(auth.uid() = user_id)"}` | `—` |
| `policies[licenses.licenses_device_read]` | `{"command":"SELECT","name":"licenses_device_read","permissive":"PERMISSIVE","qual":"true","roles":["anon","authenticated"],"table_name":"licenses","with_check":null}` | `—` |
| `policies[product_images_catalog.Permitir lectura pública en catálogo de imágenes]` | `{"command":"SELECT","name":"Permitir lectura pública en catálogo de imágenes","permissive":"PERMISSIVE","qual":"true","roles":["public"],"table_name":"product_images_catalog","with_check":null}` | `—` |
| `policies[supervisor_canary_allowlist.staging_canary_allowlist_definer_read]` | `—` | `{"command":"SELECT","name":"staging_canary_allowlist_definer_read","permissive":"PERMISSIVE","qual":"(primary_device_id ~~ '[redacted literal]'::text)","roles":["postgres"],"table_name":"supervisor_canary_allowlist","with_check":null}` |
| `policies[supervisor_canary_allowlist.supervisor_canary_allowlist_definer_read]` | `{"command":"SELECT","name":"supervisor_canary_allowlist_definer_read","permissive":"PERMISSIVE","qual":"true","roles":["postgres"],"table_name":"supervisor_canary_allowlist","with_check":null}` | `—` |
| `policies[supervisor_commands.staging_definer_command_access]` | `—` | `{"command":"ALL","name":"staging_definer_command_access","permissive":"PERMISSIVE","qual":"(target_device_id ~~ '[redacted literal]'::text)","roles":["postgres"],"table_name":"supervisor_commands","with_check":"(target_device_id ~~ '[redacted literal]'::text)"}` |
| `policies[supervisor_commands.staging_read_revoked_command_outcome]` | `—` | `{"command":"SELECT","name":"staging_read_revoked_command_outcome","permissive":"PERMISSIVE","qual":"((target_device_id ~~ '[redacted literal]'::text) AND (status = '[redacted literal]'::text) AND (error_message = '[redacted literal]'::text) AND (EXISTS ( SELECT 1\n   FROM device_pairings dp\n  WHERE ((dp.primary_device_id = supervisor_commands.target_device_id) AND ((dp.owner_auth_id = auth.uid()) OR (dp.monitor_auth_id = auth.uid()))))))","roles":["authenticated"],"table_name":"supervisor_commands","with_check":null}` |
| `policies[sync_documents.device_read_own_sync_doc]` | `{"command":"SELECT","name":"device_read_own_sync_doc","permissive":"PERMISSIVE","qual":"(is_own_device_row(device_id) OR (EXISTS ( SELECT 1\n   FROM device_pairings dp\n  WHERE ((dp.monitor_device_id = current_device_id()) AND (dp.primary_device_id = sync_documents.device_id)))))","roles":["anon","authenticated"],"table_name":"sync_documents","with_check":null}` | `—` |
| `policies[sync_documents.device_update_own_sync_doc]` | `{"command":"UPDATE","name":"device_update_own_sync_doc","permissive":"PERMISSIVE","qual":"is_own_device_row(device_id)","roles":["anon","authenticated"],"table_name":"sync_documents","with_check":"is_own_device_row(device_id)"}` | `—` |
| `policies[sync_documents.device_write_own_sync_doc]` | `{"command":"INSERT","name":"device_write_own_sync_doc","permissive":"PERMISSIVE","qual":null,"roles":["anon","authenticated"],"table_name":"sync_documents","with_check":"is_own_device_row(device_id)"}` | `—` |
| `policies[sync_documents.sync_documents_owner_all]` | `—` | `{"command":"ALL","name":"sync_documents_owner_all","permissive":"PERMISSIVE","qual":"is_own_device_row(device_id)","roles":["authenticated"],"table_name":"sync_documents","with_check":"is_own_device_row(device_id)"}` |
| `policies[sync_documents.sync_documents_primary_write]` | `{"command":"ALL","name":"sync_documents_primary_write","permissive":"PERMISSIVE","qual":"(EXISTS ( SELECT 1\n   FROM device_pairings dp\n  WHERE ((dp.primary_device_id = sync_documents.device_id) AND (dp.revoked_at IS NULL) AND (dp.monitor_auth_id IS NOT NULL) AND (dp.owner_auth_id = auth.uid()))))","roles":["authenticated"],"table_name":"sync_documents","with_check":"(EXISTS ( SELECT 1\n   FROM device_pairings dp\n  WHERE ((dp.primary_device_id = sync_documents.device_id) AND (dp.revoked_at IS NULL) AND (dp.monitor_auth_id IS NOT NULL) AND (dp.owner_auth_id = auth.uid()))))"}` | `—` |
| `policies[sync_documents.sync_documents_supervisor_read]` | `{"command":"SELECT","name":"sync_documents_supervisor_read","permissive":"PERMISSIVE","qual":"(EXISTS ( SELECT 1\n   FROM device_pairings dp\n  WHERE ((dp.primary_device_id = sync_documents.device_id) AND (dp.revoked_at IS NULL) AND (dp.monitor_auth_id IS NOT NULL) AND ((dp.owner_auth_id = auth.uid()) OR (dp.monitor_auth_id = auth.uid())))))","roles":["authenticated"],"table_name":"sync_documents","with_check":null}` | `—` |
| `publication[public.device_pairings]` | `{"schema_name":"public","table_name":"device_pairings"}` | `—` |
| `relations[account_devices].rls_forced` | `false` | `true` |
| `relations[backup_requests].rls_forced` | `false` | `true` |
| `relations[cloud_backups].indexes[idx_cloud_backups_email]` | `{"index_definition":"CREATE INDEX idx_cloud_backups_email ON public.cloud_backups USING btree (email)","name":"idx_cloud_backups_email"}` | `—` |
| `relations[cloud_backups].rls_forced` | `false` | `true` |
| `relations[cloud_licenses].indexes[idx_cloud_licenses_device_id]` | `{"index_definition":"CREATE INDEX idx_cloud_licenses_device_id ON public.cloud_licenses USING btree (device_id)","name":"idx_cloud_licenses_device_id"}` | `—` |
| `relations[cloud_licenses].rls_forced` | `false` | `true` |
| `relations[customer_projects].rls_forced` | `false` | `true` |
| `relations[device_pairings].columns[claim_code_expires_at]` | `—` | `{"default":null,"generated":"","identity":"","name":"claim_code_expires_at","nullable":true,"type":"timestamp with time zone"}` |
| `relations[device_pairings].columns[claim_code_hash]` | `—` | `{"default":null,"generated":"","identity":"","name":"claim_code_hash","nullable":true,"type":"text"}` |
| `relations[device_pairings].columns[claim_failed_attempts]` | `—` | `{"default":"0","generated":"","identity":"","name":"claim_failed_attempts","nullable":false,"type":"integer"}` |
| `relations[device_pairings].columns[created_at].nullable` | `true` | `false` |
| `relations[device_pairings].columns[monitor_secret_hash]` | `—` | `{"default":null,"generated":"","identity":"","name":"monitor_secret_hash","nullable":true,"type":"text"}` |
| `relations[device_pairings].constraints[device_pairings_monitor_device_id_key]` | `{"definition":"UNIQUE (monitor_device_id)","name":"device_pairings_monitor_device_id_key","type":"u"}` | `—` |
| `relations[device_pairings].indexes[device_pairings_monitor_device_active_idx]` | `—` | `{"index_definition":"CREATE INDEX device_pairings_monitor_device_active_idx ON public.device_pairings USING btree (monitor_device_id) WHERE (revoked_at IS NULL)","name":"device_pairings_monitor_device_active_idx"}` |
| `relations[device_pairings].indexes[device_pairings_monitor_device_id_key]` | `{"index_definition":"CREATE UNIQUE INDEX device_pairings_monitor_device_id_key ON public.device_pairings USING btree (monitor_device_id)","name":"device_pairings_monitor_device_id_key"}` | `—` |
| `relations[device_pairings].indexes[device_pairings_monitor_idx]` | `{"index_definition":"CREATE INDEX device_pairings_monitor_idx ON public.device_pairings USING btree (monitor_device_id, primary_device_id)","name":"device_pairings_monitor_idx"}` | `—` |
| `relations[device_pairings].indexes[idx_device_pairings_last_seen]` | `—` | `{"index_definition":"CREATE INDEX idx_device_pairings_last_seen ON public.device_pairings USING btree (last_seen_at DESC) WHERE (last_seen_at IS NOT NULL)","name":"idx_device_pairings_last_seen"}` |
| `relations[device_pairings].indexes[idx_device_pairings_monitor]` | `—` | `{"index_definition":"CREATE INDEX idx_device_pairings_monitor ON public.device_pairings USING btree (monitor_device_id, primary_device_id)","name":"idx_device_pairings_monitor"}` |
| `relations[device_pairings].rls_forced` | `false` | `true` |
| `relations[device_sessions].rls_forced` | `false` | `true` |
| `relations[licenses].rls_forced` | `false` | `true` |
| `relations[notifications].indexes[notifications_created_at_idx]` | `{"index_definition":"CREATE INDEX notifications_created_at_idx ON public.notifications USING btree (created_at DESC)","name":"notifications_created_at_idx"}` | `—` |
| `relations[notifications].rls_forced` | `false` | `true` |
| `relations[product_images_catalog].rls_forced` | `false` | `true` |
| `relations[supervisor_canary_allowlist].columns[purpose].default` | `"'[redacted literal]'::text [different]"` | `"'[redacted literal]'::text [different]"` |
| `relations[supervisor_commands].constraints[supervisor_commands_schema_version_check]` | `—` | `{"definition":"CHECK (schema_version = 1)","name":"supervisor_commands_schema_version_check","type":"c"}` |
| `relations[supervisor_commands].rls_forced` | `false` | `true` |
| `relations[sync_documents].columns[data].default` | `"'[redacted literal]'::jsonb [different]"` | `"null [different]"` |
| `relations[sync_documents].columns[id].default` | `"nextval('[redacted literal]'::regclass) [different]"` | `"gen_random_uuid() [different]"` |
| `relations[sync_documents].columns[id].type` | `"bigint"` | `"uuid"` |
| `relations[sync_documents].columns[payload]` | `{"default":"'[redacted literal]'::jsonb","generated":"","identity":"","name":"payload","nullable":false,"type":"jsonb"}` | `—` |
| `relations[sync_documents].constraints[sync_documents_device_id_collection_doc_id_key]` | `{"definition":"UNIQUE (device_id, collection, doc_id)","name":"sync_documents_device_id_collection_doc_id_key","type":"u"}` | `—` |
| `relations[sync_documents].constraints[sync_documents_device_id_doc_id_key]` | `—` | `{"definition":"UNIQUE (device_id, doc_id)","name":"sync_documents_device_id_doc_id_key","type":"u"}` |
| `relations[sync_documents].indexes[idx_sync_documents_device_id]` | `{"index_definition":"CREATE INDEX idx_sync_documents_device_id ON public.sync_documents USING btree (device_id)","name":"idx_sync_documents_device_id"}` | `—` |
| `relations[sync_documents].indexes[sync_documents_device_id_collection_doc_id_key]` | `{"index_definition":"CREATE UNIQUE INDEX sync_documents_device_id_collection_doc_id_key ON public.sync_documents USING btree (device_id, collection, doc_id)","name":"sync_documents_device_id_collection_doc_id_key"}` | `—` |
| `relations[sync_documents].indexes[sync_documents_device_id_doc_id_key]` | `—` | `{"index_definition":"CREATE UNIQUE INDEX sync_documents_device_id_doc_id_key ON public.sync_documents USING btree (device_id, doc_id)","name":"sync_documents_device_id_doc_id_key"}` |
| `relations[sync_documents].rls_forced` | `false` | `true` |
| `relations[visits].indexes[visits_created_at_idx]` | `{"index_definition":"CREATE INDEX visits_created_at_idx ON public.visits USING btree (created_at DESC)","name":"visits_created_at_idx"}` | `—` |
| `relations[visits].rls_forced` | `false` | `true` |
| `routines[claim_owner_device(p_device_id text, p_code text)]` | `—` | `{"language":"plpgsql","returns":"json","search_path":["search_path=public, extensions"],"security_definer":true,"signature":"claim_owner_device(p_device_id text, p_code text)","volatility":"v"}` |
| `routines[create_owner_claim_code(p_device_id text)]` | `—` | `{"language":"plpgsql","returns":"text","search_path":["search_path=public, extensions"],"security_definer":true,"signature":"create_owner_claim_code(p_device_id text)","volatility":"v"}` |
| `routines[e2e_cleanup_commands(p_command_prefix text, p_device_id text)]` | `—` | `{"language":"plpgsql","returns":"void","search_path":["search_path=public, extensions"],"security_definer":true,"signature":"e2e_cleanup_commands(p_command_prefix text, p_device_id text)","volatility":"v"}` |
| `routines[e2e_delete_pairing(p_device_id text)]` | `—` | `{"language":"plpgsql","returns":"boolean","search_path":["search_path=public, extensions"],"security_definer":true,"signature":"e2e_delete_pairing(p_device_id text)","volatility":"v"}` |
| `routines[e2e_delete_unowned_synthetic()]` | `—` | `{"language":"plpgsql","returns":"integer","search_path":["search_path=public"],"security_definer":true,"signature":"e2e_delete_unowned_synthetic()","volatility":"v"}` |
| `routines[e2e_set_canary_allowlist(p_device_id text, p_enabled boolean)]` | `—` | `{"language":"plpgsql","returns":"void","search_path":["search_path=public, extensions"],"security_definer":true,"signature":"e2e_set_canary_allowlist(p_device_id text, p_enabled boolean)","volatility":"v"}` |
| `routines[e2e_set_pairing_link(p_device_id text, p_owner_auth_id uuid, p_monitor_auth_id uuid)]` | `—` | `{"language":"plpgsql","returns":"void","search_path":["search_path=public, extensions"],"security_definer":true,"signature":"e2e_set_pairing_link(p_device_id text, p_owner_auth_id uuid, p_monitor_auth_id uuid)","volatility":"v"}` |
| `routines[is_active_permanent_device(p_device_id text)]` | `—` | `{"language":"sql","returns":"boolean","search_path":["search_path=public"],"security_definer":true,"signature":"is_active_permanent_device(p_device_id text)","volatility":"s"}` |
| `routines[owns_backup_device(p_device_id text)]` | `—` | `{"language":"sql","returns":"boolean","search_path":["search_path=public"],"security_definer":true,"signature":"owns_backup_device(p_device_id text)","volatility":"s"}` |
| `routines[pair_monitor_device_with_secret(p_token text, p_monitor_device_id text, p_secret text)]` | `—` | `{"language":"plpgsql","returns":"json","search_path":["search_path=public, extensions"],"security_definer":true,"signature":"pair_monitor_device_with_secret(p_token text, p_monitor_device_id text, p_secret text)","volatility":"v"}` |
| `routines[register_device_pairing(p_device_id text)]` | `—` | `{"language":"plpgsql","returns":"boolean","search_path":["search_path=public, extensions"],"security_definer":true,"signature":"register_device_pairing(p_device_id text)","volatility":"v"}` |
| `routines[register_device_session(p_device_id text)]` | `—` | `{"language":"plpgsql","returns":"json","search_path":["search_path=public"],"security_definer":true,"signature":"register_device_session(p_device_id text)","volatility":"v"}` |
| `routines[unpair_monitor_with_secret(p_device_id text, p_secret text)]` | `—` | `{"language":"plpgsql","returns":"boolean","search_path":["search_path=public, extensions"],"security_definer":true,"signature":"unpair_monitor_with_secret(p_device_id text, p_secret text)","volatility":"v"}` |

## Alcance y limitaciones

- La consulta lee catálogos de PostgreSQL (`pg_catalog`, `information_schema` y metadatos de publicación); no selecciona registros de las tablas de la aplicación.
- Se compara `public`: relaciones/columnas, defaults y restricciones (literales ocultos), índices, RLS y políticas, firmas/seguridad de rutinas (sin source), triggers, extensiones instaladas, grants a roles cliente, tipos enum y membresía de Realtime.
- No compara Auth/Storage gestionados, configuración de proveedores, objetos Storage, secretos, datos, propietarios completos ni cuerpos de funciones.
- Los literales SQL se redactan antes de guardar. El script usa refs fijas y un token de Management API leído del entorno o `.env`, que nunca se imprime ni escribe en el reporte.
- Revisar manualmente el diff antes de usar staging. Este artefacto no aplica migraciones ni modifica Supabase.

## Reproducción

```bash
bun run schema:compare
```

