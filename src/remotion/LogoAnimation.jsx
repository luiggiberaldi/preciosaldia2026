import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { loadFont } from '@remotion/google-fonts/Outfit';

const { fontFamily } = loadFont('normal', {
    weights: ['800', '900'],
    subsets: ['latin'],
});

/**
 * LogoAnimation — Composición Remotion Auditada con Tipografía Outfit
 */
export const LogoAnimation = ({
    primaryColor = '#01696f',
    backgroundColor = '#FFFFFF',
    title = 'PRECIOS AL DÍA',
    subtitle = 'PUNTO DE VENTA & INVENTARIO',
}) => {
    const frame = useCurrentFrame();

    // ── 1. ANIMACIÓN CAPA EXTERNA ("D") ──
    const strokeDashoffset = interpolate(frame, [0, 24], [1400, 0], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
    });

    const outerOpacity = interpolate(frame, [0, 24], [0.4, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
    });

    const outerScale = interpolate(frame, [0, 24], [0.95, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
    });

    // ── 2. ANIMACIÓN BARRAS INTERNAS ──
    const bar1ScaleY = interpolate(frame, [24, 46], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
    });

    const bar2ScaleY = interpolate(frame, [34, 56], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
    });

    // ── 3. ANIMACIÓN FLECHA PRINCIPAL ──
    const arrowScaleY = interpolate(frame, [44, 68], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
    });

    const arrowOpacity = interpolate(frame, [44, 60], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
    });

    // ── 4. APARICIÓN DE TEXTO INSTITUCIONAL ──
    const titleOpacity = interpolate(frame, [62, 86], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
    });

    const titleTranslateY = interpolate(frame, [62, 86], [18, 0], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
    });

    const titleBlur = (1 - titleOpacity) * 8;
    const titleTracking = 0.14 + (1 - titleOpacity) * 0.08;

    const subOpacity = interpolate(frame, [76, 98], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
    });

    const subTranslateY = interpolate(frame, [76, 98], [12, 0], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
    });

    const subBlur = (1 - subOpacity) * 5;
    const subTracking = 0.28 + (1 - subOpacity) * 0.1;

    // ── 5. PULSO FINAL DE MARCA ──
    const pulseScale = interpolate(frame, [100, 120, 140], [1, 1.025, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
    });

    const glowOpacity = interpolate(frame, [100, 120, 140], [0, 0.18, 0], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
    });

    return (
        <AbsoluteFill
            style={{
                backgroundColor,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: fontFamily || "'Outfit', 'Plus Jakarta Sans', system-ui, sans-serif",
                position: 'relative',
                overflow: 'hidden',
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
        </AbsoluteFill>
    );
};
