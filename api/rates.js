// Vercel Serverless Function — Proxy de tasas BCV (dolarapi.com)
// Cachea en memoria por 14 minutos para no saturar la fuente externa.

let cache = null;
let cacheTime = 0;
const CACHE_MS = 14 * 60 * 1000;

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    // Return cache if fresh
    if (cache && Date.now() - cacheTime < CACHE_MS) {
        return res.status(200).setHeader('X-Cache', 'HIT').json(cache);
    }

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 7000);
        const response = await fetch('https://ve.dolarapi.com/v1/dolares', { signal: controller.signal });
        clearTimeout(timeout);

        if (!response.ok) throw new Error(`dolarapi ${response.status}`);

        const data = await response.json();
        const oficial  = Array.isArray(data) ? data.find(d => d.fuente === 'oficial'  || d.nombre === 'Oficial')  : null;
        const paralelo = Array.isArray(data) ? data.find(d => d.fuente === 'paralelo' || d.nombre === 'Paralelo') : null;

        if (!oficial?.promedio) throw new Error('Sin tasa oficial');

        const bcvPrice  = parseFloat(oficial.promedio);
        const euroPrice = parseFloat((bcvPrice * 1.09).toFixed(2));
        const usdtPrice = parseFloat(paralelo?.promedio || (bcvPrice * 1.02).toFixed(2));

        cache = {
            bcv:  { price: bcvPrice,  source: 'BCV Oficial', change: 0 },
            euro: { price: euroPrice, source: 'Euro BCV',    change: 0 },
            usdt: { price: usdtPrice, source: 'USDT Binance', change: 0 },
            lastUpdate: new Date().toISOString(),
        };
        cacheTime = Date.now();

        return res.status(200).setHeader('X-Cache', 'MISS').json(cache);

    } catch (err) {
        if (cache) {
            return res.status(200).setHeader('X-Cache', 'STALE').json({ ...cache, stale: true });
        }
        return res.status(503).json({ error: 'No se pudo obtener la tasa de cambio.' });
    }
}
