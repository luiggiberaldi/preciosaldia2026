import { memo } from 'react';
import { Delete } from 'lucide-react';

const KEY_CLS = 'min-h-[48px] rounded-xl border-2 text-lg font-black transition-all active:scale-95 select-none bg-white dark:bg-slate-900';

/**
 * NumericKeypad — teclado numérico propio para pantallas táctiles (CASO-056 fase 3).
 * Escribe en el campo de pago activo, así Windows no abre su teclado en pantalla.
 * Dos filas para que quepa en 1366x768 sin desplazar.
 */
function NumericKeypad({ activeLabel, onKey, disabled = false }) {
    const press = (k) => (e) => {
        e.preventDefault(); // no robar el foco del campo activo
        if (!disabled) onKey(k);
    };
    const digit = (d) => (
        <button
            key={d}
            type="button"
            onPointerDown={press(d)}
            onClick={(e) => e.preventDefault()}
            className={`${KEY_CLS} border-slate-200 dark:border-slate-700 text-slate-800 dark:text-white`}
            aria-label={`Número ${d}`}
            tabIndex={-1}
        >{d}</button>
    );

    return (
        <div className="mt-3 p-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60" data-testid="pos-keypad">
            <p className="text-xs font-bold text-slate-600 dark:text-slate-300 mb-2">
                {disabled
                    ? 'Toca un método de pago para escribir el monto'
                    : <>Escribiendo en: <span className="font-black text-slate-900 dark:text-white">{activeLabel}</span></>}
            </p>
            <div className={`grid grid-cols-7 gap-2 ${disabled ? 'opacity-50' : ''}`}>
                {['1', '2', '3', '4', '5', '6'].map(digit)}
                <button
                    type="button"
                    onPointerDown={press('back')}
                    onClick={(e) => e.preventDefault()}
                    className={`${KEY_CLS} border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 inline-flex items-center justify-center`}
                    aria-label="Borrar un número"
                    tabIndex={-1}
                ><Delete size={22} /></button>
                {['7', '8', '9', '0'].map(digit)}
                <button
                    type="button"
                    onPointerDown={press('.')}
                    onClick={(e) => e.preventDefault()}
                    className={`${KEY_CLS} border-slate-200 dark:border-slate-700 text-slate-800 dark:text-white`}
                    aria-label="Coma decimal"
                    tabIndex={-1}
                >,</button>
                <button
                    type="button"
                    onPointerDown={press('clear')}
                    onClick={(e) => e.preventDefault()}
                    className={`${KEY_CLS} col-span-2 text-sm border-red-200 dark:border-red-900/50 text-red-700 dark:text-red-300`}
                    aria-label="Borrar el monto"
                    tabIndex={-1}
                >Borrar</button>
            </div>
        </div>
    );
}

export default memo(NumericKeypad);
