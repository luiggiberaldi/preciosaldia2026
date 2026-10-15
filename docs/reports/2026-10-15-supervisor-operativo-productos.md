# Implementación inicial del Supervisor operativo

**Fecha:** 2026-10-15  
**Alcance:** habilitar crear y editar productos desde el modo Supervisor.

## Resultado

Se habilitaron únicamente las acciones de crear y editar productos. No se activaron eliminación, usuarios, turnos, egresos ni cambios generales de tasas.

La pantalla y el receptor de órdenes ya existían; el bloqueo principal era que todas las acciones remotas estaban detrás de una única bandera apagada. Ahora productos tiene su propio permiso de funcionamiento.

## Cambios realizados

- Se agregó una política independiente para productos en src/config/supervisorPolicy.js.
- supervisorCommandService.js permite enviar órdenes de crear y editar productos.
- RemoteProductFormModal.jsx usa la política de productos.
- OwnerMonitorView.jsx deshabilita crear/editar cuando la caja no está conectada.
- Se creó supervisorProductCommand.js para aplicar las órdenes de forma comprobable.
- La caja ahora:
  - crea productos nuevos;
  - edita productos existentes;
  - rechaza editar un producto que no existe;
  - evita duplicar una creación repetida con el mismo ID;
  - revierte el cambio local si la sincronización falla;
  - devuelve una confirmación de éxito al Supervisor.
- Se agregaron pruebas en supervisorProductCommand.test.js.
- Se agregaron pruebas de política y habilitación selectiva en supervisorPolicy.test.js y supervisorCommands.test.js.

## Verificaciones ejecutadas

| Verificación | Resultado |
|---|---|
| Pruebas específicas de Supervisor antes del cambio | 17 pasan |
| Pruebas nuevas de producto y regresión | 22 pasan |
| Suite completa de Supervisor | 15 archivos, 88 pruebas pasan |
| Typecheck | Pasa |
| Build | Pasa |
| Lint Supervisor | 0 errores, 174 advertencias preexistentes |
| git diff --check | Pasa |

## Comprobación visual

En la aplicación local se verificó:

- Entrada al modo Supervisor.
- Panel de Supervisor.
- Pestaña Inventario.
- Botón Nuevo Producto.
- Formulario Nuevo Producto Remoto.
- Campos de nombre, código, precios, stock y presentación.
- Botón Guardar en Caja.
- Validación de nombre vacío sin error JavaScript.

Evidencias:

- [Panel Supervisor](../../dogfood-output/supervisor-product-20261015/screenshots/04-supervisor-panel.png)
- [Inventario y acciones](../../dogfood-output/supervisor-product-20261015/screenshots/05-inventory-actions.png)
- [Formulario de nuevo producto](../../dogfood-output/supervisor-product-20261015/screenshots/06-new-product-form.png)
- [Validación de formulario vacío](../../dogfood-output/supervisor-product-20261015/screenshots/07-empty-product-validation.png)

## Limitación pendiente

No se envió una orden real a una caja vinculada porque el navegador local usó una sesión sintética y no había una caja de prueba activa. Por eso todavía falta confirmar físicamente el recorrido:

1. Crear desde el celular.
2. Recibir en la caja.
3. Ver el producto creado.
4. Editar desde el celular.
5. Confirmar el cambio en la caja.

La implementación y las pruebas internas están listas para esa prueba funcional con una caja controlada.

## Próximo paso

Probar con una caja y un celular reales vinculados. Después de confirmar crear/editar, se puede activar la siguiente función: entrada de mercancía y ajuste de inventario.

