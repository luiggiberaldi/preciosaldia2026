import { useRef, useState } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import { showToast } from '../Toast';
import { clearCustomLogo, processLogoFile, setCustomLogo, useBrandLogo } from '../../utils/brandLogo';

/**
 * Logo del negocio: se elige una imagen, se reduce y pasa a mostrarse en TODA la app
 * (cabeceras, bloqueo, tickets, cierres y PDFs). Se aplica al instante, sin «Guardar».
 */
export default function BrandLogoSettings() {
    const { logoSrc, isCustom } = useBrandLogo();
    const inputRef = useRef(null);
    const [busy, setBusy] = useState(false);

    const onPick = async (event) => {
        const file = event.target.files?.[0];
        event.target.value = ''; // permite volver a elegir el mismo archivo
        if (!file) return;
        setBusy(true);
        const result = await processLogoFile(file);
        setBusy(false);
        if (!result.ok) {
            showToast(result.error, 'error');
            return;
        }
        if (!setCustomLogo(result.dataUrl)) {
            showToast('No se pudo guardar el logo (almacenamiento lleno).', 'error');
            return;
        }
        showToast('Logo actualizado en todo el sistema', 'success');
    };

    const onRemove = () => {
        clearCustomLogo();
        showToast('Se restauró el logo de fábrica', 'success');
    };

    return (
        <div>
            <label className="text-[11px] uppercase tracking-wider font-extrabold text-slate-500 dark:text-slate-400 block mb-1.5">
                Logo del negocio
            </label>
            <div className="flex flex-wrap items-center gap-3">
                <div className="flex h-20 w-44 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white p-2 dark:border-slate-600">
                    <img src={logoSrc} alt="Logo actual" className="max-h-full max-w-full object-contain" />
                </div>
                <div className="flex flex-col gap-2">
                    <input
                        ref={inputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={onPick}
                        className="hidden"
                        aria-label="Elegir logo"
                    />
                    <button
                        type="button"
                        disabled={busy}
                        onClick={() => inputRef.current?.click()}
                        className="flex items-center gap-2 rounded-xl bg-brand-light px-3 py-2 text-xs font-bold uppercase tracking-wider text-brand-dark transition-colors hover:opacity-90 active:scale-[0.98] disabled:opacity-50 dark:bg-surface-800/20 dark:text-brand"
                    >
                        <ImagePlus size={15} /> {isCustom ? 'Cambiar logo' : 'Subir logo'}
                    </button>
                    {isCustom && (
                        <button
                            type="button"
                            onClick={onRemove}
                            className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold uppercase tracking-wider text-rose-600 transition-colors hover:bg-rose-50 active:scale-[0.98] dark:text-rose-400 dark:hover:bg-rose-950/30"
                        >
                            <Trash2 size={15} /> Quitar logo
                        </button>
                    )}
                </div>
            </div>
            <p className="mt-1.5 text-[10px] text-slate-400">
                PNG, JPG o WEBP de hasta 5 MB. Mejor con fondo transparente o blanco. Se usa en pantalla,
                tickets, cierres de caja y reportes en PDF.
            </p>
        </div>
    );
}
