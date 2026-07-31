import React, { useState, useEffect, useRef } from 'react';

/**
 * StandaloneLogoAnimation — Animación de Alta Gama con Tipografía 'Outfit' / 'Plus Jakarta Sans'
 *
 * Mejoras de marca y tipografía:
 * 1. Tipografía moderna geométrica ('Outfit' / 'Plus Jakarta Sans').
 * 2. Degradado metálico en el título institucional con sombra Teal.
 * 3. Revelado cinematográfico con enfoque progresivo (blur to sharp), escalado y tracking expansivo.
 * 4. Animación secuencial de título y subtítulo.
 */
export const StandaloneLogoAnimation = ({
    primaryColor = '#01696f',
    backgroundColor = '#FFFFFF',
    title = 'PRECIOS AL DÍA',
    subtitle = 'PUNTO DE VENTA & INVENTARIO',
    onComplete,
    loop = true,
    mode = 'full', // 'full' (5.0s) | 'express' (1.5s)
}) => {
    const [frame, setFrame] = useState(0);
    const animRef = useRef(null);
    const startTimeRef = useRef(null);

    const isExpress = mode === 'express';
    const DURATION_FRAMES = isExpress ? 45 : 150;
    const FPS = 30;

    useEffect(() => {
        const animate = (timestamp) => {
            if (!startTimeRef.current) startTimeRef.current = timestamp;
            const elapsedSeconds = (timestamp - startTimeRef.current) / 1000;
            let currentFrame = Math.floor(elapsedSeconds * FPS);

            if (currentFrame >= DURATION_FRAMES) {
                if (loop) {
                    startTimeRef.current = timestamp;
                    currentFrame = 0;
                } else {
                    currentFrame = DURATION_FRAMES;
                    if (onComplete) onComplete();
                }
            }

            setFrame(currentFrame);
            animRef.current = requestAnimationFrame(animate);
        };

        animRef.current = requestAnimationFrame(animate);
        return () => {
            if (animRef.current) cancelAnimationFrame(animRef.current);
        };
    }, [loop, onComplete, DURATION_FRAMES]);

    // ── CURVAS DE ANIMACIÓN ──
    const clamp = (val, min = 0, max = 1) => Math.min(max, Math.max(min, val));
    const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
    const easeOutQuart = (t) => 1 - Math.pow(1 - t, 4);

    // Capa 1: Revelado de la "D"
    const progressD = clamp(frame / (isExpress ? 10 : 24));
    const strokeDashoffset = (1 - easeOutCubic(progressD)) * 1400;
    const outerOpacity = clamp(0.4 + progressD * 0.6);
    const outerScale = clamp(0.95 + easeOutCubic(progressD) * 0.05);

    // Capa 2: Barra 1
    const progressBar1 = clamp((frame - (isExpress ? 6 : 24)) / (isExpress ? 12 : 22));
    const bar1ScaleY = easeOutQuart(progressBar1);

    // Capa 3: Barra 2
    const progressBar2 = clamp((frame - (isExpress ? 10 : 34)) / (isExpress ? 12 : 22));
    const bar2ScaleY = easeOutQuart(progressBar2);

    // Capa 4: Flecha Principal
    const progressArrow = clamp((frame - (isExpress ? 14 : 44)) / (isExpress ? 12 : 24));
    const arrowScaleY = easeOutQuart(progressArrow);
    const arrowOpacity = easeOutCubic(clamp((frame - (isExpress ? 14 : 44)) / (isExpress ? 8 : 16)));

    // Capa 5: Título "PRECIOS AL DÍA"
    const progressTitle = clamp((frame - (isExpress ? 18 : 62)) / (isExpress ? 14 : 24));
    const titleOpacity = easeOutCubic(progressTitle);
    const titleTranslateY = (1 - easeOutCubic(progressTitle)) * 18;
    const titleBlur = (1 - titleOpacity) * 8;
    const titleTracking = 0.14 + (1 - titleOpacity) * 0.08;

    // Capa 6: Subtítulo "PUNTO DE VENTA & INVENTARIO"
    const progressSub = clamp((frame - (isExpress ? 22 : 76)) / (isExpress ? 14 : 22));
    const subOpacity = easeOutCubic(progressSub);
    const subTranslateY = (1 - easeOutCubic(progressSub)) * 12;
    const subBlur = (1 - subOpacity) * 5;
    const subTracking = 0.28 + (1 - subOpacity) * 0.1;

    // Pulso suave de marca
    const progressPulse = clamp((frame - (isExpress ? 28 : 100)) / (isExpress ? 15 : 35));
    const pulseScale = 1 + Math.sin(progressPulse * Math.PI) * 0.025;
    const glowOpacity = Math.sin(progressPulse * Math.PI) * 0.18;

    return (
        <div
            style={{
                backgroundColor,
                width: '100%',
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: "'Outfit', 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif",
                position: 'relative',
                overflow: 'hidden',
                borderRadius: '1.5rem',
            }}
        >
            {/* Resplandor Teal */}
            <div
                style={{
                    position: 'absolute',
                    width: '75%',
                    height: '75%',
                    borderRadius: '50%',
                    background: `radial-gradient(circle, ${primaryColor} 0%, transparent 70%)`,
                    opacity: glowOpacity,
                    transform: `scale(${pulseScale})`,
                    pointerEvents: 'none',
                }}
            />

            {/* Logo Vectorial */}
            <div
                style={{
                    transform: `scale(${outerScale * pulseScale})`,
                    filter: 'drop-shadow(0px 8px 16px rgba(1, 105, 113, 0.15))',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                }}
            >
                <svg
                    width="320"
                    height="320"
                    viewBox="0 0 500 500"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                >
                    <defs>
                        <linearGradient id="cleanTeal" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stopColor="#01696f" />
                            <stop offset="100%" stopColor="#004D53" />
                        </linearGradient>

                        <mask id="cleanDMask">
                            <path
                                d="M 90 70 H 250 A 180 180 0 0 1 250 430 H 90 V 70 Z"
                                fill="none"
                                stroke="#FFFFFF"
                                strokeWidth="450"
                                strokeDasharray="1400"
                                strokeDashoffset={strokeDashoffset}
                            />
                        </mask>
                    </defs>

                    {/* CAPA 1: Silueta "D" */}
                    <g opacity={outerOpacity}>
                        <path
                            d="M 90 70
                               H 250
                               A 180 180 0 0 1 250 430
                               H 90
                               V 70 Z
                               M 250 390
                               A 140 140 0 1 0 250 110
                               A 140 140 0 0 0 250 390 Z"
                            fill="url(#cleanTeal)"
                            fillRule="evenodd"
                            mask="url(#cleanDMask)"
                        />
                    </g>

                    {/* CAPA 2: Barra 1 (Izquierda) */}
                    <g
                        style={{
                            transformOrigin: '186px 390px',
                            transform: `scaleY(${bar1ScaleY})`,
                        }}
                    >
                        <rect x="168" y="305" width="36" height="85" rx="3" fill="url(#cleanTeal)" />
                    </g>

                    {/* CAPA 3: Barra 2 (Centro) */}
                    <g
                        style={{
                            transformOrigin: '246px 390px',
                            transform: `scaleY(${bar2ScaleY})`,
                        }}
                    >
                        <rect x="228" y="225" width="36" height="165" rx="3" fill="url(#cleanTeal)" />
                    </g>

                    {/* CAPA 4: Flecha Principal (Derecha) */}
                    <g
                        style={{
                            transformOrigin: '306px 390px',
                            transform: `scaleY(${arrowScaleY})`,
                            opacity: arrowOpacity,
                        }}
                    >
                        <rect x="288" y="195" width="36" height="195" rx="3" fill="url(#cleanTeal)" />
                        <path d="M 306 128 L 352 205 H 260 Z" fill="url(#cleanTeal)" />
                    </g>
                </svg>
            </div>

            {/* Texto Institucional de Alta Gama */}
            <div
                style={{
                    marginTop: 24,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '8px',
                    width: '100%',
                    textAlign: 'center',
                }}
            >
                <h1
                    style={{
                        margin: 0,
                        fontSize: 36,
                        fontWeight: 900,
                        letterSpacing: `${titleTracking}em`,
                        background: 'linear-gradient(135deg, #01696f 0%, #004D53 100%)',
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                        textTransform: 'uppercase',
                        opacity: titleOpacity,
                        transform: `translateY(${titleTranslateY}px) scale(${0.93 + titleOpacity * 0.07})`,
                        filter: `blur(${titleBlur}px) drop-shadow(0px 3px 10px rgba(1, 105, 113, 0.22))`,
                        lineHeight: 1.1,
                    }}
                >
                    {title}
                </h1>
                <p
                    style={{
                        margin: 0,
                        fontSize: 13,
                        fontWeight: 800,
                        letterSpacing: `${subTracking}em`,
                        color: '#475569',
                        textTransform: 'uppercase',
                        opacity: subOpacity,
                        transform: `translateY(${subTranslateY}px)`,
                        filter: `blur(${subBlur}px)`,
                    }}
                >
                    {subtitle}
                </p>
            </div>
        </div>
    );
};
