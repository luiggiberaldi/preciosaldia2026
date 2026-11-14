import { AlertTriangle, PlusCircle, Wallet } from 'lucide-react';
import { evaluarFondoParaVuelto } from '../../utils/fondoGaveta';

const fmtBs = n => Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtUsd = n => `$${Number(n || 0).toFixed(2)}`;

/**
 * Aviso de que el vuelto pide más efectivo del que hay en la gaveta (CAJA-FONDO-002).
 *
 * - variant="compact": recuadro legible dentro de los paneles de vuelto.
 * - variant="full": recuadro grande para la confirmación final, con opciones:
 *   registrar un aporte, dejar el resto como saldo a favor o confirmar igual.
 *
 * No bloquea el cobro: el dinero puede salir de otro lado (decisión del dueño).
 */
export default function AvisoFondoGaveta({
    usdGiven,
    bsGiven,
    floatUsd,
    floatBs,
    variant = 'compact',
    onOpenAporte = null,
    onCreditShortfall = null,
}) {
    const fondo = evaluarFondoParaVuelto({ usdGiven, bsGiven, floatUsd, floatBs });
    if (!fondo.evaluado || fondo.alcanza) return null;

    const lineas = [];
    if (fondo.faltaBs > 0) {
        lineas.push(`El vuelto pide Bs ${fmtBs(fondo.pideBs)} y en la gaveta hay Bs ${fmtBs(fondo.hayBs)} (faltan Bs ${fmtBs(fondo.faltaBs)}).`);
    }
    if (fondo.faltaUsd > 0) {
        lineas.push(`El vuelto pide ${fmtUsd(fondo.pideUsd)} y en la gaveta hay ${fmtUsd(fondo.hayUsd)} (faltan ${fmtUsd(fondo.faltaUsd)}).`);
    }

    if (variant !== 'full') {
        return (
            <div role="alert" data-testid="aviso-fondo-gaveta" className="w-full mt-2 p-2 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-300 dark:border-red-800 flex items-start gap-1.5">
                <AlertTriangle size={14} className="text-red-500 shrink-0 mt-0.5" />
                <div className="text-xs font-bold text-red-700 dark:text-red-300 leading-snug">
                    <p>No hay suficiente efectivo en la gaveta.</p>
                    {lineas.map(l => <p key={l} className="font-medium">{l}</p>)}
                </div>
            </div>
        );
    }

    return (
        <div role="alert" data-testid="aviso-fondo-gaveta-full" className="mx-4 sm:mx-5 mt-3 rounded-xl border-2 border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-3 py-3">
            <div className="flex items-start gap-2">
                <AlertTriangle size={18} className="text-red-500 shrink-0 mt-0.5" />
                <div className="text-sm text-red-700 dark:text-red-300 leading-snug">
                    <p className="font-black">No hay suficiente efectivo en la gaveta</p>
                    {lineas.map(l => <p key={l} className="mt-1 text-xs font-semibold">{l}</p>)}
                    <p className="mt-1.5 text-[11px] font-medium text-red-600/90 dark:text-red-300/80">
                        Si confirmas igual, el «Efectivo esperado» quedará en negativo.
                    </p>
                </div>
            </div>
            {(onOpenAporte || onCreditShortfall) && (
                <div className="mt-3 flex flex-col sm:flex-row gap-2">
                    {onOpenAporte && (
                        <button
                            type="button"
                            onClick={onOpenAporte}
                            className="min-h-[44px] flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-white dark:bg-slate-900 border border-red-300 dark:border-red-700 px-3 text-xs font-black text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/30"
                        >
                            <PlusCircle size={15} /> Registrar aporte
                        </button>
                    )}
                    {onCreditShortfall && (
                        <button
                            type="button"
                            onClick={onCreditShortfall}
                            className="min-h-[44px] flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-white dark:bg-slate-900 border border-red-300 dark:border-red-700 px-3 text-xs font-black text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/30"
                        >
                            <Wallet size={15} /> Dejar en saldo a favor
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}
