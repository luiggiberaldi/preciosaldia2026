// Vercel Serverless Function — Proxy seguro para el Chatbot del POS Precios al Día
// Realiza rotación aleatoria (óptima para entornos serverless sin estado) y oculta las API keys de Groq.
//
// Blindaje (feat/security):
// - Rate limit por IP vía Upstash Redis (10 req/min y 200 req/día), fail-open con log.
// - CORS con allowlist (preciosaldiaoficial.vercel.app + localhost, extensible con CHAT_ALLOWED_ORIGINS).
// - El cliente no puede inyectar mensajes "system": se descartan y el servidor siempre inyecta el suyo.
// - Guardas de entrada (máx. 20 mensajes, máx. 4.000 caracteres por mensaje).
// - Sin fugas de errores internos al cliente (los bodies de Groq solo van al log del servidor).
// - reasoning_effort "low" (los tokens de razonamiento de gpt-oss consumen max_tokens) y timeouts.

const CHAT_SYSTEM = `Eres un asistente inteligente y experto integrado en "Precios al Día", el sistema de punto de venta (POS) y gestión de inventario offline-first para bodegas, abastos y comercios en Venezuela.

## CONTEXTO OPERATIVO DE VENEZUELA:
- Tasas de cambio: Se manejan múltiples monedas. Principalmente Dólares (USD) como moneda de valor de referencia, y Bolívares (Bs) y Pesos Colombianos (COP) para pagos.
- La tasa de cambio oficial es fijada por el Banco Central de Venezuela (BCV). Los comercios actualizan esta tasa diariamente en Configuración -> Tasas.
- La tasa de Pesos Colombianos (COP) puede calcularse automáticamente usando la TRM diaria y brechas cambiarias o definirse de forma manual.
- El vuelto en efectivo es un problema común. El sistema ayuda a calcular vuelto mixto (ej. pagar con USD y dar cambio en Bs por pago móvil o efectivo).

## CARACTERÍSTICAS DEL POS (Precios al Día):
1. Offline-First: Funciona sin internet mediante IndexedDB. Las ventas se sincronizan automáticamente con Supabase (en la nube) cuando hay señal.
2. Seguridad de Acceso: Cada usuario entra con su PIN (6 dígitos para Admin, 4 para Cajero). Por razones de seguridad (SEC-002), los hashes de los PINs se almacenan estrictamente de forma local en IndexedDB y jamás se sincronizan a internet.
3. Gestión de Usuarios: Los administradores tienen acceso total (reportes, configuraciones, usuarios). Los cajeros tienen acceso restringido (solo ventas, clientes e inventario en modo de lectura).
4. Inventario (Módulo Productos): Permite registrar nombre, código de barras (opcional), precio de venta en USD y Bs (se calculan automáticamente entre sí), precio de costo (opcional), stock (opcional), unidad (Unidad, Caja/Bulto, Kilogramo, Litro), categoría y foto. Los ÚNICOS campos obligatorios para guardar un producto son: Nombre y Precio de venta (USD o Bs). Todos los demás son opcionales. Los productos tipo "Caja/Bulto" pueden configurar el número de unidades por caja y un "precio por unidad" dentro del MISMO producto — esto permite vender la caja completa (al mayor) Y vender unidades sueltas (al detal) sin necesidad de crear dos productos separados. Los precios se recalculan automáticamente según la tasa cambiaria del día. Los cajeros no pueden ver costos ni márgenes de ganancia.
5. Ventas (Módulo Ventas): Se buscan productos por nombre, categoría, código de barras (incluyendo escáner físico y balanza electrónica PLU) o por voz. Se agregan al carrito. Se pueden aplicar descuentos (monto fijo o porcentaje) antes de cobrar. En el checkout se selecciona el método de pago. Los métodos de pago disponibles por defecto son: Efectivo en Bolívares, Pago Móvil, Punto de Venta, Efectivo en Dólares, Efectivo en Pesos y Transferencia COP. Se pueden crear métodos de pago personalizados (ej. Zinli, Binance, etc.) en Configuración -> Ventas -> Métodos de Pago. El sistema calcula el vuelto mixto automáticamente (ej. paga con USD y el cambio en Bs).
6. Cierre de Caja: Al final del día, el administrador ejecuta el cierre de caja desde el módulo DASHBOARD (NO desde Ventas). El sistema calcula el dinero esperado y el cajero ingresa el dinero real contado. El sistema detecta sobrantes o faltantes. Se genera un reporte PDF. Al iniciar el día se realiza una "Apertura de Caja" (disponible en el Dashboard o en el módulo de Ventas) donde se declara el fondo inicial.
6. Auditoría Financiera e IA integrada: El módulo Dev Panel (Tester) realiza una auditoría 100% matemática y determinista sobre las transacciones del local. La IA evalúa este diagnóstico final y genera un informe narrativo detallando recomendaciones útiles para el negocio.
7. Módulo de Financiamiento Cashea (Registrar compras en cuotas):
   - Se puede activar o desactivar en "Configuración -> Ventas" (sección Financiamiento Cashea). Se puede configurar un monto mínimo en dólares para permitir su uso.
   - ¡IMPORTANTE!: Para que la opción de cobro con Cashea se active e ilustre en la pantalla de cobro (checkout), se debe seleccionar un cliente primero en la zona de cobro. El sistema activará el financiamiento si el cliente seleccionado tiene un Nivel de Cashea (del 1 al 6) y la venta cumple con el monto mínimo.
   - Al seleccionar Cashea en el checkout, el cliente paga una inicial (ej. 60% o 40%) en caja y la porción restante es financiada por Cashea.
   - Es obligatorio seleccionar un Cliente para cobros con Cashea, ya que el monto financiado se registra automáticamente como una deuda por cobrar (deuda de Cashea) en su perfil.
   - En el Dashboard y Cierre de Caja, el dinero financiado se registra bajo la categoría VENTA_CASHEA como cobro pendiente para no descuadrar el efectivo.
8. Modo Supervisor (Monitoreo Remoto en Vivo):
   - Permite enlazar un segundo dispositivo (teléfono, tablet o PC) como pantalla espejo para el dueño/supervisor.
   - Muestra las ventas en dólares, bolívares y ganancias del turno activo en vivo, además de un listado de transacciones recientes.
   - Al realizar un cierre de caja en la Caja principal, se actualizará y mostrará automáticamente una zona de resumen de cierre en la pantalla del Supervisor con los totales definitivos conciliados.
   - ¡IMPORTANTE!: A diferencia del POS principal que funciona 100% sin conexión (offline-first), la transmisión y recepción del Modo Supervisor requiere obligatoriamente que ambos dispositivos (la Caja principal y el celular del supervisor) estén conectados a internet (WiFi o Datos Móviles) para transmitir las actualizaciones.
   - Vinculación: En el dispositivo principal (Caja) como Admin, ir a Configuración (icono engranaje) -> pestaña 'Sistema' -> sección 'Celular del Supervisor' -> pulsar 'Vincular Monitor' para obtener el código QR o manual de 6 dígitos. En el dispositivo del supervisor, en la pantalla inicial de inicio de sesión, pulsar el botón 'Modo Supervisor (Ver Monitoreo)' e ingresar dicho código.

## REGLAS DE RESPUESTA:
- Sé amable, práctico, directo y habla en español de Venezuela ("tú", términos de comercio local como "bodega", "vuelto", "pago móvil", "fiado", "abasto").
- Si el usuario te envía un "CONTEXTO DE LA APLICACIÓN" o "CONTEXTO EN TIEMPO REAL DEL POS" en la consulta, utilízalo para responder de forma precisa a su negocio. No inventes datos que contradigan ese contexto.
- Usa formato Markdown simple (negritas, listas, saltos de línea).
`;

// ── Blindaje: constantes y helpers ──────────────────────────────────────────

const MAX_MESSAGES = 20;
const MAX_CHARS_PER_MESSAGE = 4000;
const GROQ_CONNECT_TIMEOUT_MS = 15000; // sin respuesta inicial → rotar a la siguiente key
const GROQ_STREAM_DEADLINE_MS = 60000; // tope global de la respuesta en streaming

// Orígenes permitidos: producción + desarrollo local. Ampliable con CHAT_ALLOWED_ORIGINS (separados por coma).
const BASE_ALLOWED_ORIGINS = [
    'https://preciosaldiaoficial.vercel.app',
    'http://localhost:5173',
    'http://localhost:4173',
    'http://localhost:3000',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:4173',
    'http://127.0.0.1:3000',
];

function getAllowedOrigins() {
    const extra = (process.env.CHAT_ALLOWED_ORIGINS || '')
        .split(',')
        .map(o => o.trim())
        .filter(Boolean);
    return [...new Set([...BASE_ALLOWED_ORIGINS, ...extra])];
}

// Devuelve los headers CORS solo si el origin es de la allowlist.
// Un origin ajeno recibe la respuesta SIN headers CORS → el navegador la bloquea.
function applyCorsHeaders(res, req) {
    const origin = req.headers.origin;
    if (origin && getAllowedOrigins().includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Access-Control-Max-Age', '86400');
    }
}

function getClientIp(req) {
    const fwd = req.headers['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd.length > 0) {
        return fwd.split(',')[0].trim();
    }
    return req.headers['x-real-ip'] || 'desconocida';
}

// ── Rate limit con Upstash Redis (REST puro, sin dependencias) ──────────────
// Ventana fija por IP: 10 req/min y 200 req/día.
// Fail-open: si Redis falla, se permite la request y se loguea (disponibilidad primero).

const RL_PER_MINUTE = 10;
const RL_PER_DAY = 200;
const memoryCounters = new Map(); // fallback en memoria (por instancia) si no hay Redis

function memoryIncrement(bucketKey, windowMs) {
    const now = Date.now();
    const entry = memoryCounters.get(bucketKey);
    if (!entry || now > entry.expiresAt) {
        memoryCounters.set(bucketKey, { count: 1, expiresAt: now + windowMs });
        return 1;
    }
    entry.count += 1;
    return entry.count;
}

// Limpieza oportunista del fallback en memoria para no crecer indefinidamente.
function pruneMemoryCounters() {
    if (memoryCounters.size < 500) return;
    const now = Date.now();
    for (const [k, v] of memoryCounters) {
        if (now > v.expiresAt) memoryCounters.delete(k);
    }
}

async function upstashCommand(command) {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) return null; // sin Redis configurado → usar fallback

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    try {
        const resp = await fetch(url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(command),
            signal: controller.signal,
        });
        if (!resp.ok) throw new Error(`Upstash HTTP ${resp.status}`);
        const data = await resp.json();
        return data.result;
    } finally {
        clearTimeout(timeout);
    }
}

// Retorna { allowed: true } o { allowed: false, retryAfterSeconds }.
async function checkRateLimit(ip) {
    const dayKey = `rl:chat:d:${new Date().toISOString().slice(0, 10)}:${ip}`;
    const minKey = `rl:chat:m:${Math.floor(Date.now() / 60000)}:${ip}`;

    try {
        const dayCount = await upstashCommand(['INCR', dayKey]);
        if (dayCount !== null) {
            if (dayCount === 1) await upstashCommand(['EXPIRE', dayKey, 86400]);
            if (dayCount > RL_PER_DAY) {
                return { allowed: false, retryAfterSeconds: 3600, reason: 'daily' };
            }
            const minCount = await upstashCommand(['INCR', minKey]);
            if (minCount === 1) await upstashCommand(['EXPIRE', minKey, 60]);
            if (minCount > RL_PER_MINUTE) {
                return { allowed: false, retryAfterSeconds: 60, reason: 'minute' };
            }
            return { allowed: true };
        }
    } catch (err) {
        console.error('[Chat API] Rate limit Redis no disponible (fail-open):', err?.message || err);
    }

    // Fallback en memoria (por instancia; protección parcial si no hay Redis)
    const minCount = memoryIncrement(`m:${Math.floor(Date.now() / 60000)}:${ip}`, 60000);
    const dayCount = memoryIncrement(`d:${new Date().toISOString().slice(0, 10)}:${ip}`, 86400000);
    pruneMemoryCounters();
    if (dayCount > RL_PER_DAY) return { allowed: false, retryAfterSeconds: 3600, reason: 'daily' };
    if (minCount > RL_PER_MINUTE) return { allowed: false, retryAfterSeconds: 60, reason: 'minute' };
    return { allowed: true };
}

// ── Handler ─────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
    applyCorsHeaders(res, req);

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        // 1) Rate limit por IP (antes de consumir cualquier recurso)
        const rl = await checkRateLimit(getClientIp(req));
        if (!rl.allowed) {
            res.setHeader('Retry-After', String(rl.retryAfterSeconds));
            return res.status(429).json({
                error: rl.reason === 'daily'
                    ? 'Alcanzaste el límite diario de consultas al asistente. Inténtalo de nuevo mañana.'
                    : 'Demasiadas consultas seguidas. Espera un momento e inténtalo de nuevo.',
            });
        }

        const { messages } = req.body;

        // 2) Guardas de entrada
        if (!messages || !Array.isArray(messages)) {
            return res.status(400).json({ error: "El cuerpo de la petición debe contener un arreglo de 'messages'." });
        }
        if (messages.length > MAX_MESSAGES) {
            return res.status(400).json({ error: `Demasiados mensajes (máximo ${MAX_MESSAGES}).` });
        }
        for (const m of messages) {
            if (!m || typeof m.content !== 'string' || m.content.length > MAX_CHARS_PER_MESSAGE) {
                return res.status(400).json({ error: `Cada mensaje debe ser texto de hasta ${MAX_CHARS_PER_MESSAGE} caracteres.` });
            }
        }

        const groqKeysStr = process.env.GROQ_KEYS || '';
        const allKeys = groqKeysStr.split(',').map(k => k.trim()).filter(Boolean);

        if (allKeys.length === 0) {
            return res.status(500).json({ error: 'No se encontraron claves de API configuradas en el servidor (GROQ_KEYS).' });
        }

        // 3) Anti-inyección: se descarta cualquier "system" proveniente del cliente.
        // El prompt del sistema especializado SIEMPRE lo inyecta el servidor.
        const userMessages = messages.filter(m => m.role === 'user' || m.role === 'assistant');
        const formattedMessages = [{ role: 'system', content: CHAT_SYSTEM }, ...userMessages];

        const requestBody = JSON.stringify({
            model: 'openai/gpt-oss-120b',
            messages: formattedMessages,
            temperature: 0.4,
            max_tokens: 4096,
            reasoning_effort: 'low', // los tokens de razonamiento de gpt-oss consumen max_tokens
            stream: true,
        });

        // Rotación secuencial con retry: si una key da 429 o error 5xx,
        // se pasa automáticamente a la siguiente hasta agotar todas.
        // Empezamos por una key aleatoria para distribuir la carga entre invocaciones.
        const startIndex = Math.floor(Math.random() * allKeys.length);
        let lastError = null;

        for (let attempt = 0; attempt < allKeys.length; attempt++) {
            const keyIndex = (startIndex + attempt) % allKeys.length;
            const apiKey = allKeys[keyIndex];

            let response;
            const groqController = new AbortController();
            const connectTimeout = setTimeout(() => groqController.abort(), GROQ_CONNECT_TIMEOUT_MS);
            try {
                response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json',
                    },
                    body: requestBody,
                    signal: groqController.signal,
                });
            } catch (fetchErr) {
                clearTimeout(connectTimeout);
                // Timeout sin respuesta inicial o error de red — intentar con la siguiente key
                lastError = `Key[${keyIndex}] ${fetchErr?.name === 'AbortError' ? 'timeout de conexión' : 'error de red'}: ${fetchErr?.message || fetchErr}`;
                continue;
            }
            clearTimeout(connectTimeout);

            // Si es rate limit (429), llave inválida/expirada (401/403) o error de servidor (5xx), rotar a la siguiente key
            if (response.status === 429 || response.status === 401 || response.status === 403 || response.status >= 500) {
                const errBody = await response.text().catch(() => '');
                lastError = `Key[${keyIndex}] HTTP ${response.status}: ${errBody.slice(0, 500)}`;
                continue; // siguiente key
            }

            // Cualquier otro error no recuperable (ej. 400 bad request) — falla con mensaje genérico (sin body crudo)
            if (!response.ok) {
                const errText = await response.text().catch(() => '');
                console.error(`[Chat API] Error no recuperable de Groq (HTTP ${response.status}):`, errText.slice(0, 500));
                return res.status(502).json({ error: 'El asistente no pudo procesar la consulta en este momento.' });
            }

            // ✅ Key funcionó — configurar streaming y devolver respuesta (con deadline global)
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');

            const streamDeadline = setTimeout(() => {
                try { response.body.cancel(); } catch {}
            }, GROQ_STREAM_DEADLINE_MS);

            try {
                const reader = response.body.getReader();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    res.write(value);
                }
                res.end();
            } catch (streamErr) {
                // Cliente desconectado o deadline: cortar limpio
                try { res.end(); } catch {}
            } finally {
                clearTimeout(streamDeadline);
            }
            return; // salir del handler
        }

        // Si llegamos aquí, todas las keys fallaron — sin detalles internos al cliente
        console.error('[Chat API] Todas las keys de Groq fallaron:', lastError);
        return res.status(503).json({
            error: 'El servicio de IA está temporalmente saturado. Por favor intenta en unos segundos.',
        });
    } catch (error) {
        console.error('[Chat API] Error inesperado:', error?.message || error);
        return res.status(500).json({ error: 'Error interno del servidor.' });
    }
}
