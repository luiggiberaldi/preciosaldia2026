// QR con los datos de cobro, generado en el propio equipo con la librería `qrcode`.
// Antes se pedía a api.qrserver.com: sin internet salía roto y además mandaba los datos
// de la cuenta a un servicio externo (plan docs/plans/2026-11-14-plan-logos-offline.md, F5).
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

export default function PaymentQr({ text, size = 200, className = '' }) {
    const [state, setState] = useState({ text: null, url: null, failed: false });

    useEffect(() => {
        let alive = true;
        QRCode.toDataURL(text || '', { width: size, margin: 1, color: { dark: '#0f172a', light: '#ffffff' } })
            .then((url) => { if (alive) setState({ text, url, failed: false }); })
            .catch(() => { if (alive) setState({ text, url: null, failed: true }); });
        return () => { alive = false; };
    }, [text, size]);

    const ready = state.text === text;
    if (ready && state.failed) {
        return <p className={`${className} flex items-center justify-center text-xs text-center text-slate-500`}>No se pudo crear el QR</p>;
    }
    if (!ready || !state.url) {
        return <div className={`${className} rounded-xl bg-slate-100 animate-pulse`} aria-label="Creando código QR" />;
    }
    return <img src={state.url} alt="Código QR de Pago" className={className} />;
}
