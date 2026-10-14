import localforage from 'localforage';
import { storageService } from '../utils/storageService';
import { supabaseCloudUrl } from '../config/supabaseCloud';

const IMG_BLOB_PREFIX = 'img_blob_';

const memoryCache = new Map();

/**
 * Devuelve el host de Supabase de una URL, o null si no es una URL de Supabase.
 */
function supabaseHostOf(url) {
    try {
        const { hostname } = new URL(url);
        return hostname.endsWith('.supabase.co') ? hostname : null;
    } catch {
        return null;
    }
}

/**
 * Borra las imágenes cacheadas que apuntan a un proyecto Supabase distinto al
 * configurado. Sin esto, una caché vieja con URLs de otro proyecto sigue
 * sirviendo imágenes rotas aunque la base actual ya esté bien.
 * @returns {Promise<number>} Número de entradas eliminadas.
 */
export async function purgeForeignImageCache() {
    const currentHost = supabaseHostOf(supabaseCloudUrl);
    if (!currentHost) return 0;

    let removed = 0;
    // Las claves pueden llevar prefijo de contingencia (bodega_storage_fallback_v1:...).
    const isForeign = (key) => {
        const at = key.indexOf(IMG_BLOB_PREFIX);
        if (at === -1) return false;
        const host = supabaseHostOf(key.slice(at + IMG_BLOB_PREFIX.length));
        return host !== null && host !== currentHost;
    };

    try {
        const keys = await localforage.keys();
        for (const key of keys.filter(isForeign)) {
            await localforage.removeItem(key);
            removed++;
        }
    } catch {
        // IndexedDB no disponible: nada que purgar
    }

    try {
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const key = localStorage.key(i);
            if (key && isForeign(key)) {
                localStorage.removeItem(key);
                removed++;
            }
        }
    } catch {
        // localStorage no disponible
    }

    for (const url of [...memoryCache.keys()]) {
        const host = supabaseHostOf(url);
        if (host !== null && host !== currentHost) memoryCache.delete(url);
    }

    return removed;
}

/**
 * Obtiene la URL cifrada/almacenada en IndexedDB para una imagen.
 * @param {string} url - URL remota o relativa de la imagen.
 * @returns {Promise<string|null>} Data URI guardado localmente o null.
 */
export async function getCachedImage(url) {
    if (!url || typeof url !== 'string') return null;
    if (url.startsWith('data:')) return url;
    if (memoryCache.has(url)) return memoryCache.get(url);

    try {
        const key = `img_blob_${url}`;
        const storedData = await storageService.getItem(key, null);
        if (storedData) {
            memoryCache.set(url, storedData);
            return storedData;
        }
    } catch {
        // Fallback silencioso en contexto sin IndexedDB
    }
    return null;
}

/**
 * Descarga y guarda en IndexedDB el blob de la imagen para disponibilidad 100% offline.
 * @param {string} url - URL de la imagen a guardar.
 */
export async function saveImageToCache(url) {
    if (!url || typeof url !== 'string') return;
    if (url.startsWith('data:')) return;

    try {
        const key = `img_blob_${url}`;
        const existing = await storageService.getItem(key, null);
        if (existing) {
            memoryCache.set(url, existing);
            return;
        }

        let blob = null;
        try {
            const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
            if (res.ok) blob = await res.blob();
        } catch {
            // Intentar con mode no-cors si fallan las cabeceras CORS
            try {
                const resNoCors = await fetch(url, { mode: 'no-cors' });
                if (resNoCors) blob = await resNoCors.blob();
            } catch {
                /* Error de red */
            }
        }

        if (blob && blob.size > 0) {
            const reader = new FileReader();
            reader.readAsDataURL(blob);
            await new Promise((resolve) => {
                reader.onloadend = async () => {
                    const dataUrl = reader.result;
                    if (dataUrl && dataUrl.startsWith('data:')) {
                        await storageService.setItem(key, dataUrl);
                        memoryCache.set(url, dataUrl);
                    }
                    resolve();
                };
            });
        }
    } catch {
        // Ignorar fallos de red individuales
    }
}
