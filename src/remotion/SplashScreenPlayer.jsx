import React from 'react';
import { StandaloneLogoAnimation } from './StandaloneLogoAnimation';

/**
 * SplashScreenPlayer — Componente Reutilizable de Splash Screen
 * 
 * Renderiza la animación del logo de Precios al Día a 60 FPS
 * en tiempo real para web, PWA o Electron.
 */
export default function SplashScreenPlayer({
    onComplete,
    loop = true,
}) {
    return (
        <div className="w-full h-full flex items-center justify-center bg-white overflow-hidden rounded-3xl relative shadow-inner">
            <StandaloneLogoAnimation onComplete={onComplete} loop={loop} />
        </div>
    );
}
