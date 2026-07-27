import React, { useState, useEffect } from 'react';

/**
 * UpdateBanner Component (A-001/B-003)
 * Muestra un banner discreto cuando hay una actualización de PWA disponible.
 * Permite al cajero decidir cuándo aplicar la actualización sin perder transacciones activas.
 */
export function UpdateBanner() {
    const [showBanner, setShowBanner] = useState(false);

    useEffect(() => {
        const handleUpdateAvailable = () => {
            setShowBanner(true);
        };

        window.addEventListener('sw-update-available', handleUpdateAvailable);
        return () => window.removeEventListener('sw-update-available', handleUpdateAvailable);
    }, []);

    const applyUpdate = () => {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistration().then(reg => {
                if (reg && reg.waiting) {
                    reg.waiting.postMessage({ type: 'SKIP_WAITING' });
                }
                window.location.reload();
            });
        } else {
            window.location.reload();
        }
    };

    if (!showBanner) return null;

    return (
        <div className="fixed top-0 inset-x-0 z-[100] bg-emerald-600 text-white px-4 py-2 flex items-center justify-between text-sm font-medium shadow-md">
            <div className="flex items-center gap-2">
                <span className="text-base">🚀</span>
                <span>Nueva versión disponible de Precios Al Día</span>
            </div>
            <div className="flex items-center gap-2">
                <button
                    onClick={() => setShowBanner(false)}
                    className="px-3 py-1 rounded bg-black/20 hover:bg-black/30 text-white text-xs transition"
                >
                    Ahora no
                </button>
                <button
                    onClick={applyUpdate}
                    className="px-3 py-1 rounded bg-white text-emerald-800 hover:bg-emerald-50 text-xs font-bold transition shadow-sm"
                >
                    Actualizar ahora
                </button>
            </div>
        </div>
    );
}

export default UpdateBanner;
