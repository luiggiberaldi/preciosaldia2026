/**
 * Nombres parecidos: avisar (sin bloquear) cuando se va a crear un artículo cuyo nombre ya existe.
 *
 * Dos nombres "se parecen" si son iguales al ignorar mayúsculas, acentos, espacios y signos:
 * «Harina P.A.N. 1 Kg» = «harina pan 1kg». No se bloquea porque hay artículos legítimos con el
 * mismo nombre; solo se pregunta antes de crear el segundo.
 */

/** Clave comparable de un texto: sin acentos, sin mayúsculas, solo letras y números. */
export function nameKey(text) {
    return String(text ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
}

/** Clave del producto: nombre + campos extra (p. ej. concentración en farmacia). */
export function productNameKey(product, fields = []) {
    const base = nameKey(product?.name);
    if (!base) return '';
    return fields.length ? [base, ...fields.map((f) => nameKey(product?.[f]))].join('|') : base;
}

/**
 * Otro producto con un nombre que se parece al del candidato, sin contar `exceptId` ni los
 * ids de `ignoreIds`. `fields` agrega campos que también deben coincidir.
 */
export function findSimilarNameProduct(products = [], candidate, { exceptId = null, ignoreIds = [], fields = [] } = {}) {
    const key = productNameKey(candidate, fields);
    if (!key) return null;
    const ignored = new Set(ignoreIds.map(String));
    if (exceptId != null) ignored.add(String(exceptId));
    const list = Array.isArray(products) ? products : [];
    return list.find((p) => p && !ignored.has(String(p.id)) && productNameKey(p, fields) === key) || null;
}

/**
 * ¿Hay que revisar el nombre? Siempre al crear; al editar, solo si el nombre (o los campos
 * extra) cambió, para no molestar al actualizar precio o stock de un repetido heredado.
 */
export function shouldCheckName(candidate, savedProduct, fields = []) {
    if (!savedProduct) return true;
    return productNameKey(candidate, fields) !== productNameKey(savedProduct, fields);
}

/** Palabras comparables de un texto (sin acentos ni mayúsculas, solo letras y números). */
function nameWords(text) {
    return String(text ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean);
}

/**
 * Aviso en vivo mientras se escribe el nombre: artículos cuyo nombre se parece al escrito.
 * Cuenta como parecido si es igual (ignorando mayúsculas, acentos, espacios y signos) o si
 * todas las palabras escritas aparecen al inicio de alguna palabra del otro nombre
 * («Harina Pan» → «Harina P.A.N. 1 Kg»). Los iguales van primero. Pide 3+ letras.
 */
export function findSimilarNames(products = [], name, { exceptId = null, limit = 3 } = {}) {
    const key = nameKey(name);
    if (key.length < 3) return [];
    const typed = nameWords(name);
    const list = Array.isArray(products) ? products : [];
    const exact = [];
    const similar = [];
    for (const p of list) {
        if (!p || (exceptId != null && String(p.id) === String(exceptId))) continue;
        const otherKey = nameKey(p.name);
        if (!otherKey) continue;
        if (otherKey === key) { exact.push(p); continue; }
        const words = nameWords(p.name);
        const joined = words.join('');
        const allWords = typed.every((w) => words.some((o) => o.startsWith(w)) || (w.length >= 3 && joined.includes(w)));
        if (allWords) similar.push(p);
    }
    return [...exact.map((p) => ({ product: p, exact: true })), ...similar.map((p) => ({ product: p, exact: false }))].slice(0, limit);
}
