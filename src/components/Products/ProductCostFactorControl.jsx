import React, { useState } from 'react';
import {
    costFactorFromMarginPercent,
    formatCostFactorAsMarginPercent,
    getCostFactorMode,
    setCostFactorMode,
    COST_FACTOR_MODE_FACTOR,
    COST_FACTOR_MODE_PERCENT,
} from '../../utils/productCostFactor';

export default function ProductCostFactorControl({ costFactor, onChange }) {
    // Preferencia persistida: de fábrica '%' (margen); si el usuario elige '0.7' (factor),
    // se recuerda para las próximas aperturas del formulario.
    const [mode, setMode] = useState(() => getCostFactorMode());
    const [inputValue, setInputValue] = useState(null);
    const selectMode = (nextMode) => setMode(setCostFactorMode(nextMode));
    const displayValue = inputValue !== null
        ? inputValue
        : (mode === 'percent' ? formatCostFactorAsMarginPercent(costFactor) : (costFactor || ''));

    return (
        <div className="mt-2.5 pt-2.5 border-t border-slate-200/60 dark:border-slate-700/40">
            <div className="flex items-center justify-between mb-1.5">
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Factor costo</span>
                <div className="flex bg-slate-200 dark:bg-slate-700 rounded-lg p-0.5">
                    <button
                        type="button"
                        onClick={() => { selectMode(COST_FACTOR_MODE_PERCENT); setInputValue(null); }}
                        className={`px-2 py-0.5 text-[10px] font-black rounded-md transition-colors ${mode === 'percent' ? 'bg-white dark:bg-slate-800 text-slate-700 dark:text-white shadow' : 'text-slate-500'}`}
                    >
                        %
                    </button>
                    <button
                        type="button"
                        onClick={() => { selectMode(COST_FACTOR_MODE_FACTOR); setInputValue(null); }}
                        className={`px-2 py-0.5 text-[10px] font-black rounded-md transition-colors ${mode === 'factor' ? 'bg-white dark:bg-slate-800 text-slate-700 dark:text-white shadow' : 'text-slate-500'}`}
                    >
                        0.7
                    </button>
                </div>
            </div>
            <div className="relative">
                <input
                    autoComplete="off"
                    type="number"
                    inputMode="decimal"
                    step="any"
                    aria-label="Factor costo"
                    value={displayValue}
                    onChange={event => {
                        const value = event.target.value;
                        setInputValue(value);
                        if (value === '') {
                            onChange('');
                            return;
                        }
                        if (value === '.' || value === '-') return;
                        if (mode === 'percent') {
                            const factor = costFactorFromMarginPercent(value);
                            if (factor !== '') onChange(factor);
                        } else {
                            onChange(value);
                        }
                    }}
                    onBlur={() => setInputValue(null)}
                    placeholder={mode === 'percent' ? '30' : '0.7'}
                    className="w-full bg-white dark:bg-slate-900 p-2.5 pr-10 rounded-xl font-bold text-slate-700 dark:text-white outline-none border border-slate-200/60 dark:border-slate-800/40 focus:ring-2 focus:ring-slate-500/40 transition-all text-xs"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-black text-slate-400">
                    {mode === 'percent' ? '%' : '×'}
                </span>
            </div>
            <p className="text-[9px] text-slate-400 mt-1 ml-1">
                {mode === 'percent' ? 'Margen de ganancia en %' : 'Costo = Precio × factor'} • El costo se respeta: el % recalcula el precio y el precio recalcula el %
            </p>
        </div>
    );
}
