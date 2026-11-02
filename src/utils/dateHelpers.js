export function getLocalISODate(d = new Date()) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/** Fecha YYYY-MM-DD en la zona de Caracas (las ventas se guardan en ISO UTC). */
export function getCaracasISODate(d = new Date()) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Caracas',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(d);
}

/** Día (Caracas) de un timestamp ISO; '' si no es válido. */
export function getCaracasDayOf(timestamp) {
    const d = new Date(timestamp);
    return Number.isNaN(d.getTime()) ? '' : getCaracasISODate(d);
}

export function getDateRange(rangeId) {
    const now = new Date();
    const todayStr = getLocalISODate(now);

    switch (rangeId) {
        case 'today': {
            return { from: todayStr, to: todayStr };
        }
        case 'yesterday': {
            const d = new Date(now);
            d.setDate(d.getDate() - 1);
            const yesterdayStr = getLocalISODate(d);
            return { from: yesterdayStr, to: yesterdayStr };
        }
        case 'week': {
            const d = new Date(now);
            d.setDate(d.getDate() - d.getDay()); // domingo
            return { from: getLocalISODate(d), to: todayStr };
        }
        case 'month': {
            const d = new Date(now.getFullYear(), now.getMonth(), 1);
            return { from: getLocalISODate(d), to: todayStr };
        }
        case 'lastMonth': {
            const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            const end = new Date(now.getFullYear(), now.getMonth(), 0);
            return { from: getLocalISODate(d), to: getLocalISODate(end) };
        }
        default:
            return { from: todayStr, to: todayStr };
    }
}
