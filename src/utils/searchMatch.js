// Motor de búsqueda compartido por los inputs de filtrado de la app.
// Reglas: ignora mayúsculas, tildes y espacios repetidos; cada palabra de la
// consulta debe aparecer en algún campo (en cualquier orden).

export function normalizeSearchText(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

export function matchesSearch(fields, query) {
    const tokens = normalizeSearchText(query).split(' ').filter(Boolean);
    if (tokens.length === 0) return true;
    const haystack = (Array.isArray(fields) ? fields : [fields])
        .map(normalizeSearchText)
        .join(' ');
    return tokens.every(token => haystack.includes(token));
}
