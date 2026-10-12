import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';

export default function CustomSelect({
    value,
    onChange,
    options,
    className = '',
    buttonClassName = '',
    placeholder = 'Seleccionar...',
    openUp = false
}) {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef(null);

    const selectedOption = options.find(opt => opt.value === value);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (containerRef.current && !containerRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    return (
        <div ref={containerRef} className={`relative ${className}`}>
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className={`w-full bg-slate-50 dark:bg-slate-800 p-3.5 rounded-xl font-bold text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm flex items-center justify-between text-left border border-transparent shadow-sm transition-all ${buttonClassName}`}
            >
                <span className="flex items-center gap-2.5 truncate">
                    {selectedOption?.icon && <span className="flex items-center justify-center shrink-0">{selectedOption.icon}</span>}
                    <span className="truncate">{selectedOption ? selectedOption.label : placeholder}</span>
                </span>
                <ChevronDown size={16} className={`text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>
            {isOpen && (
                <div className={`absolute left-0 right-0 max-h-60 overflow-y-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl z-50 p-1.5 space-y-0.5 scrollbar-hide animate-in fade-in zoom-in-95 duration-100 ${
                    openUp ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
                }`}>
                    {options.map((opt) => (
                        <button
                            key={opt.value}
                            type="button"
                            onClick={() => {
                                onChange(opt.value);
                                setIsOpen(false);
                            }}
                            className={`w-full px-3 py-2 text-xs sm:text-sm font-bold text-left rounded-xl transition-colors flex items-center justify-between cursor-pointer ${
                                opt.value === value 
                                    ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 font-black' 
                                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                            }`}
                        >
                            <span className="flex items-center gap-2.5 truncate">
                                {opt.icon && <span className="flex items-center justify-center shrink-0">{opt.icon}</span>}
                                <span className="truncate">{opt.label}</span>
                            </span>
                            {opt.value === value && (
                                <Check size={14} className="text-emerald-600 dark:text-emerald-400 shrink-0 ml-2" />
                            )}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
