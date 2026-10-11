# Checklist de canary — auto-registro y heartbeat

**Cambio bajo prueba:** `auto_register_device` al inicializar el dispositivo; `heartbeat_device` al iniciar el monitor y cada 3 minutos. La verificación de licencia sigue en su ciclo existente.

**Alcance:** medir el Paso 2 del [roadmap de optimización Supabase](2026-10-10-supabase-free-optimization-roadmap.md). Esta guía no autoriza ni ejecuta un despliegue o cambios en Supabase.

## 1. Acciones inmediatas (locales, sin publicar)

- [x] Revisar el cambio y el estado del checkout; conservar cualquier trabajo ajeno a este canary.
- [x] Correr las pruebas enfocadas de heartbeat, device identity y licencias.
- [x] Correr typecheck y lint dirigido de los archivos del cambio; registrar warnings existentes por separado de errores.
- [x] Correr build de producción; anotar resultado y warnings.
- [x] Confirmar que ningún comando modificó la base remota ni publicó artefactos.

## 2. Antes de publicar (requiere autorización)

- [ ] Obtener autorización explícita para publicar la versión en el entorno elegido.
- [ ] Confirmar que hay una forma operativa de limitar el canary a pocos dispositivos (por ejemplo, 1–3 instalaciones representativas); si no existe, no improvisar un mecanismo de rollout.
- [ ] Anotar proyecto/entorno, versión anterior y versión candidata, zona horaria, fechas y persona que observa.
- [ ] Elegir dispositivos de prueba: al menos uno ya registrado/licenciado y, si es posible, una instalación nueva o de prueba. No revocar licencias de clientes; activación/revocación solo en dispositivo y licencia de prueba previamente autorizados.
- [ ] Capturar una línea base de al menos 24 h con tráfico representativo. Si el uso es irregular, extender la ventana o comparar días equivalentes.
- [ ] En la ventana base, guardar conteos y errores de `auto_register_device`, `heartbeat_device` y `get_license_status`, junto con dispositivos activos, arranques/reinicios conocidos y horas de actividad. Guardar también Usage de egress e ingesta de logs.
- [ ] Registrar el método/filtros con que se obtuvieron los datos. Los conteos históricos de 714 registros y 688 heartbeats en 24 h son solo contexto; no son una línea base comparable ni un umbral de éxito.

## 3. Comprobación funcional del canary

En cada dispositivo canary, registrar hora, resultado y evidencia sin copiar tokens, datos personales ni secretos.

- [ ] Arranque: el dispositivo obtiene/recupera su `deviceId`, intenta el auto-registro y aparece correctamente en las filas de registro/presencia previstas.
- [ ] Presencia: observar al menos dos ciclos. `last_seen` debe avanzar mientras la app está activa, con intervalo nominal de 3 minutos (permitir hasta 4 minutos por latencia/reintento); no exigir pulsos mientras el dispositivo está apagado o sin conectividad.
- [ ] Reinicio: reiniciar la app y confirmar un nuevo intento de auto-registro, seguido de heartbeats. El registro no debe repetirse en cada pulso.
- [ ] Reconexión: probar una desconexión y recuperación controladas; confirmar que el heartbeat vuelve a actualizar presencia y que la app no queda bloqueada.
- [ ] Licencia vigente: confirmar el estado esperado al iniciar y durante la ventana; comparar las verificaciones `get_license_status` con la línea base normalizada por tiempo activo.
- [ ] Activación y revocación, solo en un dispositivo/licencia de prueba autorizado: comprobar que cada cambio llega por el mecanismo vigente (Realtime o verificación periódica) y produce el estado esperado, sin esperar más que el intervalo operativo ya existente.
- [ ] Revisar errores de RPC y de cliente en logs/telemetría, además de la UI. No considerar una respuesta HTTP o una pantalla inicial como prueba suficiente.

## 4. Medición después de publicar

Mantener la observación al menos 24 h y anotar la misma información y filtros que en la línea base. Comparar ventanas equivalentes y normalizar por dispositivo-horas activas; separar instalaciones, arranques/reinicios y períodos offline.

| Indicador | Resultado esperado | Resultado observado |
|---|---|---|
| `auto_register_device` | Baja desde el patrón anterior y se concentra en inicios/reinicios; no se espera cero | |
| `heartbeat_device` | Continúa proporcional a las horas activas; nominalmente un pulso cada 3 min | |
| `get_license_status` | Sin degradación funcional ni aumento inesperado tras normalizar por actividad/visibilidad | |
| Registros nuevos y `last_seen` | Nuevos dispositivos quedan registrados; presencia avanza en los dispositivos activos | |
| Errores/timeout de las tres RPC | Sin regresión atribuible al canary | |
| Egress e ingesta de logs (Usage) | Anotar GB y período; interpretar tendencias, no atribuirlas solo a este cambio | |
| Incidencias funcionales | Ninguna en licencia, presencia, arranque o reconexión | |

El ahorro de hasta 480 llamadas de registro por dispositivo continuamente activo durante 24 h es una **estimación teórica**, no un criterio aislado de aprobación. Una llamada por arranque/reinicio es esperada. No convertir número de RPC en GB: Usage es el medidor agregado de egress.

## 5. Decisión

**Continuar gradualmente** solo si:

- [ ] presencia y `last_seen` siguen dentro de la cadencia acordada;
- [ ] no hay dispositivos nuevos que queden sin las filas necesarias ni fallos de heartbeat;
- [ ] activación, revocación, vencimiento y recuperación de licencia conservan el comportamiento esperado;
- [ ] el registro periódico cae claramente al compararlo de forma normalizada y el heartbeat no desaparece;
- [ ] no aparecen errores funcionales o de RPC atribuibles a la versión.

**Detener expansión y revertir** si falla cualquiera de los controles funcionales, se pierden heartbeats mientras la app está activa, no se registra una instalación nueva, o cambia el comportamiento de licencias. Documentar hora, versión, dispositivo afectado y evidencia antes de actuar.

## 6. Rollback y cierre

1. [ ] Detener la expansión del canary.
2. [ ] Con autorización y usando el procedimiento normal de release, volver la app al build anterior.
3. [ ] Confirmar en los dispositivos afectados que el arranque, la presencia y la licencia se recuperaron.
4. [ ] Seguir observando errores/RPC hasta confirmar estabilidad; conservar resultados antes/después.
5. [ ] No borrar ni editar filas para revertir: este cambio no requiere migración SQL. Si se sospecha un problema de datos, detenerse y escalar para revisión explícita.
6. [ ] Registrar decisión, limitaciones de medición y si se autoriza pasar al siguiente grupo.

## Limitación conocida de observabilidad

La inicialización comprueba el campo `{ error }` devuelto por `auto_register_device` y el helper de heartbeat lanza los errores RPC para que el monitor los registre. Aun así, para aprobar instalaciones nuevas hay que verificar los registros/presencia resultantes y los errores server-side; no depender únicamente de que la UI no muestre errores. Si no se puede observar esa evidencia, el resultado del canary es **inconcluso**, no aprobado.

## Registro de validación local (10 de octubre de 2026)

- Pruebas dirigidas: 5 archivos, 56 pasaron y 10 quedaron omitidas por las suites existentes; comando terminó correctamente.
- Typecheck: pasó.
- ESLint dirigido: terminó sin errores; informó 39 warnings en los hooks (incluidos warnings previos de hooks, storage y variables no usadas).
- Build de producción: pasó; Vite generó los artefactos y el service worker. Se emitió una advertencia por chunk mayor a 500 kB y otra de chunk vacío `groq`.
- No se desplegó ni se modificó Supabase.

## 7. Pruebas que requieren tiempo (hacer al final)

1. Medir una línea base de 24 horas antes de publicar, siguiendo la sección 2.
2. Después de publicación autorizada, observar el canary un mínimo de 24 horas; extender si el uso es irregular.
3. Repetir escenarios de arranque, heartbeat, reconexión y licencia en instalaciones canary; las pruebas de activación/revocación solo con licencia de prueba autorizada.
4. Comparar conteos normalizados, errores y Usage con la línea base; decidir expandir, mantener, revertir o declarar resultado inconcluso.

Estas pruebas largas no se han ejecutado todavía. La checklist no autoriza publicar; cualquier despliegue requiere autorización explícita.
