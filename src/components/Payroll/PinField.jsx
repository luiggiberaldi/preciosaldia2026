/** Campo de PIN del Administrador (lo piden todas las operaciones de nómina). */
export default function PinField({ value, onChange, autoFocus = false }) {
    return (
        <label className="block">
            <span className="block text-xs font-bold text-slate-500 dark:text-slate-400 mb-1">PIN del Administrador</span>
            <input
                type="password"
                inputMode="numeric"
                autoComplete="off"
                maxLength={12}
                autoFocus={autoFocus}
                data-testid="payroll-pin"
                value={value}
                onChange={e => onChange(e.target.value.replace(/\D/g, ''))}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-white font-black tracking-[0.4em] text-center"
                placeholder="••••••"
            />
        </label>
    );
}
