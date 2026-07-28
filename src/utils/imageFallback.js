/**
 * imageFallback.js — Utilidad de resolución de imágenes con fallback local de catálogo.
 *
 * Resuelve las rutas de imagen de productos para garantizar que se vean OFFLINE
 * incluso si el registro de base de datos apunta a una URL remota de Supabase Storage.
 */

/**
 * Devuelve la lista ordenada de candidatos a probar para una imagen de producto.
 * @param {string|object} imageOrProduct — URL de la imagen o el objeto de producto.
 * @returns {string[]} Array de URLs candidatas a probar secuencialmente.
 */
export function getProductImageCandidates(imageOrProduct) {
    const rawImage = typeof imageOrProduct === 'object' && imageOrProduct !== null
        ? imageOrProduct.image
        : imageOrProduct;

    if (!rawImage || typeof rawImage !== 'string') return [];

    // Si es data: URI base64, no requiere fallback (ya está incrustada)
    if (rawImage.startsWith('data:')) return [rawImage];

    const candidates = [rawImage];

    // Extraer el slug del archivo
    const filename = rawImage.split('/').pop();
    if (filename) {
        const slug = filename.replace(/\.(webp|jpg|jpeg|png|gif|svg)(\?.*)?$/i, '');
        if (slug) {
            const localJpg = `/images/catalog/${slug}.jpg`;
            const localPng = `/images/catalog/${slug}.png`;
            const localWebp = `/images/catalog/${slug}.webp`;

            if (!candidates.includes(localJpg)) candidates.push(localJpg);
            if (!candidates.includes(localPng)) candidates.push(localPng);
            if (!candidates.includes(localWebp)) candidates.push(localWebp);
        }
    }

    return candidates;
}
