// Vercel Serverless Function — Proxy seguro para el Chatbot del POS Precios al Día
// Realiza rotación aleatoria (óptima para entornos serverless sin estado) y oculta las API keys de Groq.

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

## REGLAS DE RESPUESTA:
- Sé amable, práctico, directo y habla en español de Venezuela ("tú", términos de comercio local como "bodega", "vuelto", "pago móvil", "fiado", "abasto").
- Si el usuario te envía un "CONTEXTO DE LA APLICACIÓN" o "CONTEXTO EN TIEMPO REAL DEL POS" en la consulta, utilízalo para responder de forma precisa a su negocio. No inventes datos que contradigan ese contexto.
- Usa formato Markdown simple (negritas, listas, saltos de línea).
`;

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { messages } = req.body;

        if (!messages || !Array.isArray(messages)) {
            return res.status(400).json({ error: "El cuerpo de la petición debe contener un arreglo de 'messages'." });
        }

        const groqKeysStr = process.env.GROQ_KEYS || "";
        const allKeys = groqKeysStr.split(",").map(k => k.trim()).filter(Boolean);

        if (allKeys.length === 0) {
            return res.status(500).json({ error: "No se encontraron claves de API configuradas en el servidor (GROQ_KEYS)." });
        }

        // Aseguramos que el prompt del sistema especializado sea el primer mensaje
        const formattedMessages = [...messages];
        if (formattedMessages[0]?.role !== 'system') {
            formattedMessages.unshift({ role: 'system', content: CHAT_SYSTEM });
        } else {
            formattedMessages[0].content = CHAT_SYSTEM + "\n\n" + formattedMessages[0].content;
        }

        const requestBody = JSON.stringify({
            model: "llama-3.3-70b-versatile",
            messages: formattedMessages,
            temperature: 0.7,
            max_tokens: 2048,
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
            try {
                response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${apiKey}`,
                        "Content-Type": "application/json",
                    },
                    body: requestBody,
                });
            } catch (fetchErr) {
                // Error de red — intentar con la siguiente key
                lastError = fetchErr.message;
                continue;
            }

            // Si es rate limit (429) o error de servidor (5xx), rotar a la siguiente key
            if (response.status === 429 || response.status >= 500) {
                const errBody = await response.text();
                lastError = `Key[${keyIndex}] HTTP ${response.status}: ${errBody}`;
                continue; // <-- aquí está la magia: siguiente key
            }

            // Cualquier otro error no recuperable (ej. 400, 401) — falla inmediatamente
            if (!response.ok) {
                const errText = await response.text();
                return res.status(response.status).json({ error: `Error de la API de Groq: ${errText}` });
            }

            // ✅ Key funcionó — configurar streaming y devolver respuesta
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');

            const reader = response.body.getReader();
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                res.write(value);
            }
            res.end();
            return; // salir del handler
        }

        // Si llegamos aquí, todas las keys fallaron
        console.error("[Chat API] Todas las keys de Groq fallaron:", lastError);
        return res.status(503).json({
            error: "El servicio de IA está temporalmente saturado. Por favor intenta en unos segundos.",
            detail: lastError,
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
