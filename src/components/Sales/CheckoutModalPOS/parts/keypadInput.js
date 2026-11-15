/**
 * applyKey — calcula el nuevo texto del monto al tocar una tecla del teclado
 * numérico propio (CASO-056 fase 3).
 * Reglas: solo dígitos y un punto decimal, máximo 2 decimales y 9 enteros.
 * La coma se escribe como punto (el campo usa punto, igual que al teclear).
 */
export function applyKey(current, key) {
    const cur = current == null ? '' : String(current);
    if (key === 'clear') return '';
    if (key === 'back') return cur.slice(0, -1);
    let next;
    if (key === '.') {
        if (cur.includes('.')) return cur;
        next = cur === '' ? '0.' : `${cur}.`;
    } else if (/^\d$/.test(key)) {
        next = cur === '0' ? key : cur + key;
    } else {
        return cur;
    }
    if (!/^\d{0,9}(\.\d{0,2})?$/.test(next)) return cur;
    return next;
}
