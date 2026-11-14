// Imagen que nunca se ve rota: si no carga (sin internet, archivo borrado, logo dañado)
// muestra el respaldo que se le pase. Ver docs/plans/2026-11-14-plan-logos-offline.md (F2).
import { useState } from 'react';

export const APP_ICON_SRC = './apple-touch-icon.png'; // ícono «D»: siempre está en el precache

/**
 * @param fallback          Lo que se muestra si la imagen falla (o no hay src).
 * @param wrapperClassName  Si se da, la imagen va dentro de un <div> con esas clases; el
 *                          respaldo NO lleva ese contenedor (útil cuando el contenedor recorta).
 */
export default function SafeImg({ src, fallback = null, wrapperClassName, onError, ...props }) {
    const [failedSrc, setFailedSrc] = useState(null);
    if (!src || failedSrc === src) return fallback;
    const img = (
        <img
            src={src}
            onError={(e) => {
                setFailedSrc(src);
                onError?.(e);
            }}
            {...props}
        />
    );
    return wrapperClassName ? <div className={wrapperClassName}>{img}</div> : img;
}
