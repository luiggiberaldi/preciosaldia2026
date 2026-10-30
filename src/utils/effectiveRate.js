/**
 * Tasa efectiva (Bs/USD) y tasa COP — fuente única, sin React.
 * La usa RateContext (UI) y el receptor de ventas remotas, que corre fuera
 * de React y debe cobrar con la MISMA tasa que el cajero ve en pantalla.
 */
export function resolveEffectiveRate({ rateMode = 'bcv', customRate = '', rates = {} } = {}) {
    if (rateMode === 'manual') {
        const parsed = parseFloat(customRate); // eslint-disable-line no-restricted-syntax -- lectura de configuración, no aritmética de dinero
        return (parsed && parsed > 0) ? parsed : (rates?.bcv?.price || 1);
    }
    if (rateMode === 'usdt') return rates?.usdt?.price || rates?.bcv?.price || 1;
    if (rateMode === 'euro') return rates?.euro?.price || rates?.bcv?.price || 1;
    return rates?.bcv?.price || 1;
}

export function resolveTasaCop({ copEnabled = false, autoCopEnabled = false, tasaCopManual = '', rates = {} } = {}) {
    if (!copEnabled) return 0;
    if (autoCopEnabled && rates?.cop?.price) return rates.cop.price;
    const manual = parseFloat(tasaCopManual); // eslint-disable-line no-restricted-syntax -- lectura de configuración, no aritmética de dinero
    return (manual && manual > 0) ? manual : (rates?.cop?.price || 0);
}

/** Lee la configuración de tasas guardada en este equipo (misma que RateContext). */
export function readStoredRateContext(storage = globalThis.localStorage) {
    const get = (key) => {
        try { return storage?.getItem(key) ?? null; } catch { return null; }
    };
    let rates = {};
    try { rates = JSON.parse(get('monitor_rates_v12') || '{}') || {}; } catch { rates = {}; }
    const savedMode = get('bodega_rate_mode');
    const rateMode = savedMode && ['bcv', 'euro', 'usdt', 'manual'].includes(savedMode)
        ? savedMode
        : (get('bodega_use_auto_rate') === 'false' ? 'manual' : 'bcv');
    const copEnabled = get('cop_enabled') === 'true';
    return {
        rateMode,
        useAutoRate: rateMode !== 'manual',
        effectiveRate: resolveEffectiveRate({ rateMode, customRate: get('bodega_custom_rate') || '', rates }),
        copEnabled,
        tasaCop: resolveTasaCop({
            copEnabled,
            autoCopEnabled: get('auto_cop_enabled') === 'true',
            tasaCopManual: get('tasa_cop') || '',
            rates,
        }),
    };
}
