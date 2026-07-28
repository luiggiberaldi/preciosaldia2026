import React, { useState, useEffect } from 'react';
import { getProductImageCandidates } from '../utils/imageFallback';
import { getCachedImage, saveImageToCache } from '../services/imageBlobCache';

/**
 * SmartImage — Componente de imagen resiliente con doble capa de caché (IndexedDB + SW + Fallbacks).
 *
 * Flujo de Resiliencia Offline:
 *  1. Revisa si la imagen ya existe en IndexedDB (`getCachedImage`). Si existe, la muestra de inmediato.
 *  2. Si no, prueba la URL original (vía SW o Red).
 *  3. Si falla, prueba secuencialmente los candidatos de catálogo local (.jpg, .png, .webp).
 *  4. Al cargar exitosamente estando online, la guarda en IndexedDB (`saveImageToCache`).
 *  5. Si todo falla, muestra `fallbackIcon`.
 */
export default function SmartImage({
    src,
    alt = '',
    className = 'w-full h-full object-contain',
    fallbackIcon = null,
    product = null
}) {
    const rawSrc = src || product?.image;
    const candidates = getProductImageCandidates(rawSrc);

    const [cachedUrl, setCachedUrl] = useState(null);
    const [candidateIndex, setCandidateIndex] = useState(0);
    const [failed, setFailed] = useState(false);

    // 1. Intentar cargar desde la caché local de IndexedDB
    useEffect(() => {
        let isMounted = true;
        setCandidateIndex(0);
        setFailed(false);

        if (rawSrc) {
            getCachedImage(rawSrc).then(localDataUrl => {
                if (isMounted && localDataUrl) {
                    setCachedUrl(localDataUrl);
                }
            });
        }

        return () => { isMounted = false; };
    }, [rawSrc]);

    const handleLoadSuccess = (e) => {
        // Al cargar con éxito estando online, persistir en IndexedDB para disponibilidad offline permanente
        if (navigator.onLine && rawSrc && !rawSrc.startsWith('data:')) {
            saveImageToCache(rawSrc);
        }
    };

    const handleError = () => {
        if (cachedUrl) {
            // Si falló el cachedUrl, limpiar y probar candidatos
            setCachedUrl(null);
        } else if (candidateIndex + 1 < candidates.length) {
            setCandidateIndex(prev => prev + 1);
        } else {
            setFailed(true);
        }
    };

    if (failed || candidates.length === 0) {
        return fallbackIcon;
    }

    const currentSource = cachedUrl || candidates[candidateIndex];

    return (
        <img
            src={currentSource}
            alt=""
            className={className}
            onLoad={handleLoadSuccess}
            onError={handleError}
            loading="lazy"
        />
    );
}
