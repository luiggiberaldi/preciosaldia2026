/**
 * Logo del negocio (marca blanca). Un solo punto de verdad para TODA la app:
 * cabeceras, pantalla de bloqueo, onboarding, tickets, cierres y PDFs.
 *
 * El logo personalizado vive en localStorage como data URL PNG (clave `business_logo`),
 * ya reducido al subirlo. Sin logo personalizado se usan los logos de fábrica.
 * Cambiarlo emite el evento `brand-logo-changed` para que las pantallas abiertas se
 * actualicen sin recargar.
 */
import { useEffect, useState } from 'react';
import { round0, round2, floorR, ceilR } from './dinero.js';

export const BRAND_LOGO_KEY = 'business_logo';
export const BRAND_LOGO_EVENT = 'brand-logo-changed';
export const DEFAULT_LOGO_LIGHT = './logo.png';
export const DEFAULT_LOGO_DARK = './logodark.png';

// Límites del archivo subido y del resultado guardado.
export const LOGO_LIMITS = Object.freeze({
    MAX_INPUT_BYTES: 5 * 1024 * 1024, // archivo original
    MAX_WIDTH: 600,                   // px tras reducir
    MAX_HEIGHT: 300,
    MAX_STORED_CHARS: 400_000,        // ~300 KB de data URL
});
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

const isLogoDataUrl = (value) => typeof value === 'string'
    && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value)
    && value.length <= LOGO_LIMITS.MAX_STORED_CHARS;

const storageOf = (storage) => storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);

/** Logo personalizado guardado o null. Ignora valores corruptos o sospechosos. */
export function getCustomLogo(storage) {
    try {
        const value = storageOf(storage)?.getItem(BRAND_LOGO_KEY);
        return isLogoDataUrl(value) ? value : null;
    } catch {
        return null;
    }
}

/** URL del logo a mostrar: el personalizado o el de fábrica (claro/oscuro). */
export function getLogoSrc({ dark = false, storage } = {}) {
    return getCustomLogo(storage) || (dark ? DEFAULT_LOGO_DARK : DEFAULT_LOGO_LIGHT);
}

const notify = () => {
    try {
        globalThis.dispatchEvent?.(new Event(BRAND_LOGO_EVENT));
    } catch { /* sin window (tests de utilidades) */ }
};

/** Guarda un logo ya procesado. Devuelve false si no es un data URL de imagen válido. */
export function setCustomLogo(dataUrl, storage) {
    if (!isLogoDataUrl(dataUrl)) return false;
    try {
        storageOf(storage)?.setItem(BRAND_LOGO_KEY, dataUrl);
    } catch {
        return false; // cuota llena
    }
    notify();
    return true;
}

export function clearCustomLogo(storage) {
    try {
        storageOf(storage)?.removeItem(BRAND_LOGO_KEY);
    } catch { /* nada que limpiar */ }
    notify();
}

/** Mayor tamaño que cabe en maxW × maxH conservando la proporción (los PDFs no deforman el logo). */
export function fitInside(naturalW, naturalH, maxW, maxH) {
    const w = Number(naturalW);
    const h = Number(naturalH);
    if (!(w > 0) || !(h > 0)) return { w: maxW, h: maxH };
    const scale = Math.min(maxW / w, maxH / h);
    return { w: round2(w * scale), h: round2(h * scale) };
}

/**
 * Como fitInside, pero un logo casi cuadrado (ancho/alto < 1,6) puede ocupar hasta 1,9 veces
 * el alto de la caja (sin pasar del ancho): en tickets y reportes las cajas son anchas y bajas
 * y un logo cuadrado salía diminuto.
 */
export function fitLogo(naturalW, naturalH, maxW, maxH) {
    const w = Number(naturalW);
    const h = Number(naturalH);
    const squareish = w > 0 && h > 0 && w / h < 1.6;
    return fitInside(naturalW, naturalH, maxW, squareish ? maxH * 1.9 : maxH);
}

/**
 * Recuadro (en px) que contiene todo lo que no es transparente. `data` es el RGBA de
 * ImageData. Devuelve null si la imagen es toda transparente.
 */
export function alphaBounds(data, width, height, threshold = 10) {
    let minX = width; let minY = height; let maxX = -1; let maxY = -1;
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            if (data[(y * width + x) * 4 + 3] > threshold) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
    }
    if (maxX < 0) return null;
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** Zona del logo con contenido, en píxeles de la imagen original (recorta márgenes transparentes). */
function contentCrop(img) {
    try {
        const SAMPLE = 200;
        const k = Math.min(1, SAMPLE / Math.max(img.naturalWidth, img.naturalHeight));
        const sw = Math.max(1, round0(img.naturalWidth * k));
        const sh = Math.max(1, round0(img.naturalHeight * k));
        const c = document.createElement('canvas');
        c.width = sw; c.height = sh;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, sw, sh);
        const b = alphaBounds(ctx.getImageData(0, 0, sw, sh).data, sw, sh);
        if (!b || (b.w >= sw * 0.97 && b.h >= sh * 0.97)) return null; // nada que recortar
        const pad = 2; // px de la muestra
        const x = Math.max(0, b.x - pad); const y = Math.max(0, b.y - pad);
        const w = Math.min(sw - x, b.w + pad * 2); const h = Math.min(sh - y, b.h + pad * 2);
        return {
            sx: floorR(x / k), sy: floorR(y / k),
            sw: Math.min(img.naturalWidth, ceilR(w / k)), sh: Math.min(img.naturalHeight, ceilR(h / k)),
        };
    } catch {
        return null; // sin canvas o imagen contaminada: se usa la imagen completa
    }
}

/** Carga una imagen (para jsPDF) y devuelve el elemento ya listo. */
export function loadLogoImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });
}

/**
 * Valida y reduce el archivo elegido por el usuario. Devuelve { ok, dataUrl } o { ok:false, error }.
 * Acepta PNG, JPG y WEBP (SVG no: no se puede incrustar en los PDF). Se reduce a 600×300 como
 * máximo y se guarda como PNG para conservar transparencia.
 */
export async function processLogoFile(file) {
    if (!file) return { ok: false, error: 'No se eligió ningún archivo.' };
    if (!ALLOWED_TYPES.includes(file.type)) {
        return { ok: false, error: 'Usa una imagen PNG, JPG o WEBP.' };
    }
    if (file.size > LOGO_LIMITS.MAX_INPUT_BYTES) {
        return { ok: false, error: 'La imagen pesa más de 5 MB. Elige una más liviana.' };
    }
    try {
        const url = URL.createObjectURL(file);
        let img;
        try {
            img = await loadLogoImage(url);
        } finally {
            URL.revokeObjectURL(url);
        }
        // Se recortan los márgenes transparentes para que el logo llene su espacio.
        const crop = contentCrop(img) || { sx: 0, sy: 0, sw: img.naturalWidth, sh: img.naturalHeight };
        let { w, h } = fitInside(crop.sw, crop.sh, LOGO_LIMITS.MAX_WIDTH, LOGO_LIMITS.MAX_HEIGHT);
        // Nunca se agranda un logo pequeño.
        if (crop.sw < w) { w = crop.sw; h = crop.sh; }
        for (let attempt = 0; attempt < 4; attempt += 1) {
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Number.parseInt(String(round2(w)), 10) || 1);
            canvas.height = Math.max(1, Number.parseInt(String(round2(h)), 10) || 1);
            canvas.getContext('2d').drawImage(img, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL('image/png');
            if (isLogoDataUrl(dataUrl)) return { ok: true, dataUrl };
            w *= 0.75; h *= 0.75; // sigue pesando mucho: se reduce más
        }
        return { ok: false, error: 'La imagen es demasiado compleja. Prueba con un logo más simple.' };
    } catch {
        return { ok: false, error: 'No se pudo leer la imagen. Prueba con otro archivo.' };
    }
}

/**
 * Hook: logo vigente y reactivo. `dark` elige el logo de fábrica oscuro solo cuando NO hay
 * logo personalizado (el personalizado se usa igual en claro y oscuro).
 */
export function useBrandLogo({ dark = false } = {}) {
    const [custom, setCustom] = useState(() => getCustomLogo());
    useEffect(() => {
        const refresh = () => setCustom(getCustomLogo());
        globalThis.addEventListener?.(BRAND_LOGO_EVENT, refresh);
        globalThis.addEventListener?.('storage', refresh);
        return () => {
            globalThis.removeEventListener?.(BRAND_LOGO_EVENT, refresh);
            globalThis.removeEventListener?.('storage', refresh);
        };
    }, []);
    return { logoSrc: custom || (dark ? DEFAULT_LOGO_DARK : DEFAULT_LOGO_LIGHT), isCustom: Boolean(custom) };
}
