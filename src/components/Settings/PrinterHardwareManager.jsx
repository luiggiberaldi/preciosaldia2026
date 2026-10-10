/**
 * Sección de configuración de impresora térmica para el panel de Ajustes.
 *
 * Props:
 *  - paperWidth   {'58'|'80'}  Ancho actual del papel (controlado por SettingsView).
 *  - setPaperWidth (width: string) => void  Setter que actualiza localStorage y re-renderiza SettingsView.
 *  - showToast    (msg: string, type: string) => void
 *  - triggerHaptic () => void
 */
import React from 'react';
import { Printer, Download, HelpCircle, Check } from 'lucide-react';
import { imprimirTicketPrueba } from '../../utils/printerTestUtils';

export default function PrinterHardwareManager({ paperWidth, setPaperWidth, showToast, triggerHaptic }) {

    const handlePaperWidthChange = (width) => {
        setPaperWidth(width);
        localStorage.setItem('printer_paper_width', width);
        triggerHaptic?.();
        showToast?.(`Formato de ticket configurado en ${width} mm`, 'success');
    };

    const handlePrintTest = () => {
        triggerHaptic?.();
        imprimirTicketPrueba(paperWidth);
        showToast?.('Enviando ticket de prueba a la impresora…', 'info');
    };

    return (
        <div className="space-y-4">

            {/* ── Selector de ancho de papel ── */}
            <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">
                    Ancho de papel de tu ticketera
                </label>
                <div className="grid grid-cols-2 gap-2">
                    {[
                        { value: '58', label: '58 mm (Angosto)', sub: 'Impresoras portátiles o compactas' },
                        { value: '80', label: '80 mm (Estándar)', sub: 'Impresoras de caja con guillotina' },
                    ].map(({ value, label, sub }) => (
                        <button
                            key={value}
                            type="button"
                            onClick={() => handlePaperWidthChange(value)}
                            className={`p-3 rounded-xl border text-left transition-all flex items-start gap-2.5 active:scale-[0.98] ${
                                paperWidth === value
                                    ? 'border-brand bg-brand/5 dark:bg-brand/10 ring-2 ring-brand/20'
                                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700'
                            }`}
                        >
                            <div className={`w-4 h-4 rounded-full mt-0.5 border flex items-center justify-center shrink-0 ${
                                paperWidth === value
                                    ? 'border-brand bg-brand text-white'
                                    : 'border-slate-300 dark:border-slate-600'
                            }`}>
                                {paperWidth === value && <Check size={10} />}
                            </div>
                            <div>
                                <div className="text-xs font-black text-slate-800 dark:text-white">{label}</div>
                                <div className="text-[10px] text-slate-400 dark:text-slate-500">{sub}</div>
                            </div>
                        </button>
                    ))}
                </div>
            </div>

            {/* ── Acciones: descarga e impresión de prueba ── */}
            <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-slate-100 dark:border-slate-800/80">
                <a
                    href="/drivers/Instalador_Impresora_POS.exe"
                    download="Instalador_Impresora_POS.exe"
                    className="flex-1 py-2.5 px-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-black text-xs flex items-center justify-center gap-2 shadow-sm transition-all active:scale-[0.98]"
                >
                    <Download size={14} /> Descargar Driver (.exe)
                </a>

                <button
                    type="button"
                    onClick={handlePrintTest}
                    className="flex-1 py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs flex items-center justify-center gap-2 shadow-sm transition-all active:scale-[0.98]"
                >
                    <Printer size={14} /> Imprimir Ticket de Prueba
                </button>
            </div>

            {/* ── Instrucción contextual ── */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400 flex items-start gap-2">
                <HelpCircle size={15} className="text-blue-500 shrink-0 mt-0.5" />
                <span>
                    <strong>¿Primera vez instalando?</strong> Conecta la ticketera por USB, descarga e instala el driver seleccionando <em>POS-{paperWidth}</em> · puerto USB001. Luego pulsa <em>Imprimir Ticket de Prueba</em> para verificar márgenes.
                </span>
            </div>
        </div>
    );
}
