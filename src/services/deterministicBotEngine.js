// deterministicBotEngine.js — Motor de cálculo local determinista para modo offline sin internet.
// Responde instantáneamente preguntas de vuelto, stock, ventas y caja sin depender de IA ni conexión.

import { storageService } from '../utils/storageService';

export async function processDeterministicOfflineQuery(userQuery, { effectiveRate, tasaCop, products, cart, usuarioActivo }) {
    const q = userQuery.toLowerCase().trim();
    const timestampStr = new Date().toLocaleString('es-VE', { timeZone: 'America/Caracas' });
    const isCajero = (usuarioActivo?.rol || 'CAJERO') === 'CAJERO';

    // 1. CONSULTA DE VUELTO CAMBIARIO / CALCULADORA
    if (q.includes('vuelto') || q.includes('cambio') || q.includes('tasa') || q.includes('dolar') || q.includes('bs')) {
        const rateBcv = effectiveRate || 0;
        const rateCopVal = tasaCop || 0;

        // Extraer montos en dólares del texto (ej: "vuelto de 20$" o "20 dolares")
        const numberMatch = q.match(/(\d+([\.,]\d+)?)/);
        const amountUsd = numberMatch ? parseFloat(numberMatch[1].replace(',', '.')) : 0;

        let responseMd = `## Estado actual (Modo Local Offline)

- **Tasa BCV Oficial**: Bs. ${rateBcv.toFixed(2)} / USD
- **Tasa COP**: ${rateCopVal > 0 ? `${rateCopVal.toFixed(2)} COP / USD` : 'No configurada'}`;

        if (amountUsd > 0 && rateBcv > 0) {
            const equivBs = amountUsd * rateBcv;
            const equivCop = amountUsd * rateCopVal;
            responseMd += `\n\n### 💵 Vuelto para $${amountUsd.toFixed(2)} USD:\n- **En Bolívares (BCV)**: Bs. ${equivBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n`;
            if (rateCopVal > 0) {
                responseMd += `- **En Pesos Colombianos (COP)**: $${equivCop.toLocaleString('es-CO', { minimumFractionDigits: 0 })} COP\n`;
            }
        }

        responseMd += `\n## Recomendación\nUsa la pantalla de cobro del carrito para ingresar exactamente los billetes recibidos y registrar el método de pago.\n\nFuente: Datos locales del POS (Modo Offline) · ${timestampStr}`;
        return responseMd;
    }

    // 2. CONSULTA DE INVENTARIO / STOCK CRITICO
    if (q.includes('stock') || q.includes('inventario') || q.includes('agotado') || q.includes('bajo')) {
        const lowStockItems = products ? products.filter(p => (p.stock ?? 0) <= (p.lowStockAlert ?? 5)) : [];
        const outOfStockItems = products ? products.filter(p => (p.stock ?? 0) <= 0) : [];

        const criticalList = lowStockItems.slice(0, 5).map(p => `- **${p.name}**: ${p.stock ?? 0} unidades restantes`).join('\n') || '- Todos los productos tienen stock suficiente.';

        return `## Estado actual (Modo Local Offline)

- **Total Productos**: ${products?.length || 0} registrados.
- **Agotados**: ${outOfStockItems.length} productos sin stock.
- **Stock Bajo**: ${lowStockItems.length} productos con alerta.

### Productos Críticos:
${criticalList}

## Recomendación
Planifica un pedido a proveedores para reponer los productos agotados antes del fin de semana.

Fuente: Datos locales del POS (Modo Offline) · ${timestampStr}`;
    }

    // 3. CONSULTA DE VENTAS Y CAJA HOY
    if (q.includes('venta') || q.includes('caja') || q.includes('cuadre') || q.includes('hoy') || q.includes('ganancia')) {
        if (isCajero && (q.includes('ganancia') || q.includes('costo') || q.includes('deuda'))) {
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
            const todayStr = new Date().toISOString().split('T')[0];
            const todaySales = sales.filter(s => s.timestamp?.startsWith(todayStr) && s.status !== 'ANULADA');
            salesCount = todaySales.length;
            totalSalesUsd = todaySales.reduce((acc, s) => acc + (s.totalUsd || 0), 0);
            totalSalesBs = todaySales.reduce((acc, s) => acc + (s.totalBs || 0), 0);
        } catch {}

        return `## Estado actual (Modo Local Offline)

- **Ventas Completadas Hoy**: ${salesCount} transacciones.
- **Monto Total USD**: $${totalSalesUsd.toFixed(2)} USD
- **Monto Total Bs**: Bs. ${totalSalesBs.toFixed(2)}

## Recomendación
Al finalizar la jornada, realiza la declaración de efectivo contado en el panel de Cierre de Caja.

Fuente: Datos locales del POS (Modo Offline) · ${timestampStr}`;
    }

    // 4. RESPUESTA POR DEFECTO MODO LOCAL
    return `## Estado actual (Modo Local Offline)

- **Conexión**: Sin conexión a internet.
- **Asistente en Modo Local**: El bot está procesando tus consultas directamente con los datos locales del dispositivo.

## Recomendación
Puedes consultar sobre vuelto cambiario, inventario bajo de stock o resumen de ventas del turno. Conéctate a internet si deseas realizar preguntas complejas a la Inteligencia Artificial.

Fuente: Datos locales del POS (Modo Offline) · ${timestampStr}`;
}
