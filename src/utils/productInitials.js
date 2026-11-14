/** Iniciales para la ficha sin foto: «Mayonesa Kraft» → «MK». Copiado de Farmacia (hotProducts.js). */
export function productInitials(name) {
    const words = String(name || '').trim().split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
    if (words.length === 0) return '?';
    const first = [...words[0]][0];
    const second = words.length > 1 ? [...words[1]][0] : ([...words[0]][1] || '');
    return (first + second).toUpperCase();
}
