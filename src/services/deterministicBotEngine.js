// deterministicBotEngine.js — Motor de cálculo local determinista para modo offline sin internet.
// Responde instantáneamente preguntas de vuelto, stock, ventas y caja sin depender de IA ni conexión.

import { storageService } from '../utils/storageService';
import { formatLowStockAlert, isLowStockProduct } from '../utils/granel';
import { getCaracasISODate, getCaracasDayOf } from '../utils/dateHelpers';

/** Minúsculas y sin tildes: «Dólares» y «dolares» deben coincidir. */
export function normalizeBotQuery(text = '') {
    return String(text).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

/** Coincidencia por palabra completa (evita que «trabajo» active «bajo» o «hoyo» active «hoy»). */
export function matchesAnyWord(normalizedQuery, words) {
    const pattern = new RegExp(`\\b(?:${words.join('|')})\\b`);
    return pattern.test(normalizedQuery);
}

export async function processDeterministicOfflineQuery(userQuery, { effectiveRate, tasaCop, products, cart, usuarioActivo, offlineReason = 'no_internet' }) {
    const q = normalizeBotQuery(userQuery);
    const timestampStr = new Date().toLocaleString('es-VE', { timeZone: 'America/Caracas' });
    const isCajero = (usuarioActivo?.rol || 'CAJERO') === 'CAJERO';

    // 1. CONSULTA DE VUELTO CAMBIARIO / CALCULADORA
    if (matchesAnyWord(q, ['vuelto', 'vueltos', 'cambio', 'tasa', 'dolar', 'dolares', 'bs'])) {
        const rateBcv = effectiveRate || 0;
        const rateCopVal = tasaCop || 0;

        // Extraer montos en dólares del texto (ej: "vuelto de 20$" o "20 dolares")
        const numberMatch = q.match(/(\d+([.,]\d+)?)/);
        const amountUsd = numberMatch ? parseFloat(numberMatch[1].replace(',', '.')) : 0;

        let responseMd = `## Estado actual (Modo Local Offline)

- **Tasa BCV Oficial**: Bs. ${rateBcv.toFixed(2)} / USD
- **Tasa COP**: ${rateCopVal > 0 ? `${rateCopVal.toFixed(2)} COP / USD` : 'No configurada'}`;

        if (amountUsd > 0 && rateBcv > 0) {
            const equivBs = amountUsd * rateBcv;
            const equivCop = amountUsd * rateCopVal;
            // Paridad con el POS: los Bs se redondean hacia arriba al entero (CurrencyService).
            const equivBsCeil = Math.ceil(equivBs);
            responseMd += `\n\n### 💵 Equivalente de $${amountUsd.toFixed(2)} USD:\n- **En Bolívares (BCV)**: Bs. ${equivBsCeil.toLocaleString('es-VE')} (el POS redondea los Bs hacia arriba al entero)\n`;
            if (rateCopVal > 0) {
                responseMd += `- **En Pesos Colombianos (COP)**: ${equivCop.toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} COP\n`;
            }
            responseMd += `\n**Para el vuelto real**: ingresa los billetes recibidos en la pantalla de cobro y el POS calcula y reparte el cambio por ti.`;
        }

        responseMd += `\n## Recomendación\nUsa la pantalla de cobro para registrar el pago exacto; ahí se calcula el vuelto automáticamente.\n\nFuente: Datos locales del POS (Modo Offline) · ${timestampStr}`;
        return responseMd;
    }

    // 2. CONSULTA DE INVENTARIO / STOCK CRITICO
    if (matchesAnyWord(q, ['stock', 'inventario', 'agotado', 'agotados', 'bajo', 'bajos'])) {
        const lowStockItems = products ? products.filter(isLowStockProduct) : [];
        const outOfStockItems = products ? products.filter(p => (p.stock ?? 0) <= 0) : [];

        const criticalList = lowStockItems.slice(0, 5).map(p => `- **${p.name}**: quedan ${p.stock ?? 0}; umbral ${formatLowStockAlert(p)}`).join('\n') || '- Todos los productos tienen stock suficiente.';

        return `## Estado actual (Modo Local Offline)

- **Total Productos**: ${products?.length || 0} registrados.
- **Agotados**: ${outOfStockItems.length} productos sin stock.
- **Stock Bajo**: ${lowStockItems.length} productos con alerta.

### Productos Críticos:
${criticalList}

## Recomendación
${lowStockItems.length > 0 || outOfStockItems.length > 0
    ? 'Planifica un pedido a proveedores para reponer los productos agotados o con stock bajo.'
    : 'No hay reposiciones urgentes.'}

Fuente: Datos locales del POS (Modo Offline) · ${timestampStr}`;
    }

    // 3. CONSULTA DE VENTAS Y CAJA HOY
    if (matchesAnyWord(q, ['venta', 'ventas', 'caja', 'cajas', 'cuadre', 'hoy', 'ganancia', 'ganancias'])) {
        // Filtro financiero ampliado: misma política que el modo online (systemConsciousnessService).
        const asksFinancial = matchesAnyWord(q, ['ganancia', 'ganancias', 'gane', 'costo', 'costos', 'margen', 'deuda', 'deudas', 'deudor', 'utilidad', 'beneficio', 'fiado']);
        if (isCajero && asksFinancial) {
            return `## Estado actual (Modo Local Offline)

- **Acceso Restringido**: El rol Cajero no tiene permiso para consultar métricas financieras o deudas globales.

## Recomendación
Solicita a un Administrador o Supervisor que consulte el módulo de Reportes o Cierre de Caja.

Fuente: Datos locales del POS (Modo Offline) · ${timestampStr}`;
        }

        let salesCount = 0;
        let totalSalesUsd = 0;
        let totalSalesBs = 0;
        try {
            const sales = await storageService.getItem('bodega_sales_v1', []);
            // «Hoy» en la zona de Caracas: las ventas se guardan en ISO UTC.
            const todayStr = getCaracasISODate();
            const todaySales = sales.filter(s => getCaracasDayOf(s.timestamp) === todayStr && s.status !== 'ANULADA');
            salesCount = todaySales.length;
            totalSalesUsd = todaySales.reduce((acc, s) => acc + (s.totalUsd || 0), 0);
            totalSalesBs = todaySales.reduce((acc, s) => acc + (s.totalBs || 0), 0);
        } catch {}

        // Paridad de roles con el modo online (systemConsciousnessService):
        // el Cajero solo ve el conteo del día, nunca los montos totales.
        if (isCajero) {
            return `## Estado actual (Modo Local Offline)

- **Ventas procesadas hoy**: ${salesCount} transacciones (todas las cajas del día).

## Recomendación
Para montos totales y desglose por método de pago, consulta a un Administrador o Supervisor.

Fuente: Datos locales del POS (Modo Offline) · ${timestampStr}`;
        }

        return `## Estado actual (Modo Local Offline)

- **Ventas Completadas Hoy**: ${salesCount} transacciones.
- **Monto Total USD**: $${totalSalesUsd.toFixed(2)} USD
- **Monto Total Bs**: Bs. ${totalSalesBs.toFixed(2)}

## Recomendación
Al finalizar la jornada, realiza la declaración de efectivo contado en el panel de Cierre de Caja.

Fuente: Datos locales del POS (Modo Offline) · ${timestampStr}`;
    }

    // 4. RESPUESTA POR DEFECTO MODO LOCAL
    // El encabezado debe reflejar la causa real: no es lo mismo "sin internet"
    // (offline de verdad) que "el servicio de IA no respondió" (hay internet,
    // pero el proveedor falla — 403/429/500, saturación, etc.).
    const headerLine = offlineReason === 'ai_service_error'
        ? '- **Conexión**: A internet ✅ — el asistente de IA no está disponible en este momento.'
        : '- **Conexión**: Sin conexión a internet.';
    const aiNote = offlineReason === 'ai_service_error'
        ? 'El asistente responde con datos locales mientras el servicio de IA no está disponible. Reintenta más tarde.'
        : 'Conéctate a internet si deseas realizar preguntas complejas a la Inteligencia Artificial.';
    return `## Estado actual (Modo Local Offline)

${headerLine}
- **Asistente en Modo Local**: El bot está procesando tus consultas directamente con los datos locales del dispositivo.

## Recomendación
Puedes consultar sobre vuelto cambiario, inventario bajo de stock o resumen de ventas del día. ${aiNote}

Fuente: Datos locales del POS (Modo Offline) · ${timestampStr}`;
}
