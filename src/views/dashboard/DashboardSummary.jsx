// Encabezado del inicio, traído de Precios al Día Farmacia (src/views/dashboard/DashboardSummary.jsx).
// Diferencias con Farmacia: usa el logo de Bodega (claro/oscuro) y todavía no tiene la campana
// de avisos (ver docs/plans/2026-11-13-plan-inicio-estilo-farmacia.md). El logo propio del negocio
// (Ajustes › Negocio) reemplaza al logo ancho; en el teléfono sigue el ícono «D».
import { formatBs } from '../../utils/calculatorUtils';
import { ShoppingCart, LogOut } from 'lucide-react';
import SyncStatus from '../../components/SyncStatus';
import SafeImg, { APP_ICON_SRC } from '../../components/SafeImg';

// El logo de fábrica (600x130) trae el lema «Actualizado donde vayas» abajo: el contenedor
// mide ~64 % del alto de la imagen y así solo se ve «Precios Al Día».
// Si el logo no carga (sin internet, archivo dañado) va el ícono «D», que siempre está guardado.
// El logo propio del negocio se muestra completo (sin recorte), con la misma altura de la caja.
function BrandLogo({ src, box, img, isCustom }) {
    return (
        <SafeImg
            src={src}
            alt={isCustom ? 'Logo del negocio' : 'Precios Al Día'}
            wrapperClassName={isCustom ? `shrink-0 flex items-center ${box}` : `overflow-hidden shrink-0 flex items-start ${box}`}
            className={isCustom ? 'h-full w-auto max-w-[240px] object-contain drop-shadow-sm' : `w-auto object-contain drop-shadow-sm ${img}`}
            fallback={<img src={APP_ICON_SRC} alt="Precios Al Día" className="h-10 w-10 rounded-xl object-contain shrink-0" />}
        />
    );
}

export default function DashboardSummary({
    isScrolled, logoSrc, logoIsCustom, triggerHaptic, setShowMonitor, bcvRate, onNavigate,
    requireLogin, usuarioActivo, logout, timeString, formattedDate, copEnabled, tasaCop
}) {
    const goSell = () => { if (onNavigate) { triggerHaptic && triggerHaptic(); onNavigate('ventas'); } };
    const openRates = () => { triggerHaptic && triggerHaptic(); setShowMonitor(true); };
    const doLogout = () => { triggerHaptic && triggerHaptic(); logout(); };

    return (
        <div data-testid="dashboard-header" className={`dash-header sticky top-0 z-30 w-full transition-all duration-200 -mx-3 sm:-mx-5 lg:-mx-6 xl:-mx-8 px-2.5 sm:px-4 md:px-5 lg:px-6 xl:px-8 py-1.5 sm:py-2 md:py-2.5 mb-3 sm:mb-4 bg-surface-50/95 dark:bg-surface-950/95 backdrop-blur-md border-b-2 ${isScrolled ? 'border-brand/50 shadow-sm' : 'border-brand/30'}`}>

            {/* ─── Teléfono (< 768px): una sola fila, sin desbordar ─── */}
            <div className="flex md:hidden items-center justify-between gap-1.5 sm:gap-2 w-full min-w-0">
                <div className="flex items-center shrink min-w-0">
                    {/* En el teléfono el logo ancho no cabe junto a la tasa y los botones: va el ícono «D». */}
                    <img src="./apple-touch-icon.png" alt="Precios Al Día" className="h-9 w-9 sm:h-10 sm:w-10 rounded-xl object-contain shrink-0" />
                </div>

                {/* Chip de tasa BCV: abre el Monitor de tasas */}
                <button
                    type="button"
                    onClick={openRates}
                    className="flex items-center gap-1 px-1.5 min-[400px]:px-2 py-1 bg-white dark:bg-surface-900 border border-slate-200/90 dark:border-slate-800 rounded-lg shadow-sm active:scale-95 shrink-0"
                    title="Ver Monitor de Tasas"
                >
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                    <span className="text-[9px] font-extrabold uppercase text-slate-400 dark:text-slate-500 hidden min-[400px]:inline">BCV</span>
                    <span className="text-[11px] min-[400px]:text-xs font-black text-emerald-600 dark:text-emerald-400 font-outfit whitespace-nowrap">
                        {formatBs(bcvRate)}
                    </span>
                </button>

                <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
                    <button
                        type="button"
                        onClick={goSell}
                        className="flex items-center gap-1 px-2 min-[400px]:px-2.5 py-1.5 bg-brand hover:bg-brand-dark text-white rounded-xl font-extrabold text-xs shadow-sm active:scale-95 transition-all shrink-0"
                        title="Ir a Punto de Venta"
                    >
                        <ShoppingCart size={14} className="shrink-0" />
                        <span className="font-bold hidden min-[400px]:inline">Vender</span>
                    </button>

                    <SyncStatus />

                    {requireLogin && usuarioActivo && (
                        <button
                            type="button"
                            onClick={doLogout}
                            className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 border border-rose-200/60 dark:border-rose-900/50 flex items-center justify-center active:scale-95 shrink-0"
                            title={`Cerrar sesión (${usuarioActivo.nombre})`}
                            aria-label="Cerrar sesión"
                        >
                            <LogOut size={13} className="text-rose-500" />
                        </button>
                    )}
                </div>
            </div>

            {/* ─── Tablet y PC (≥ 768px): 3 columnas con el logo al centro ─── */}
            <div className="hidden md:grid md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center justify-between gap-2 lg:gap-4 xl:gap-6 w-full min-w-0">
                {/* Izquierda: hora, fecha y chip de tasa BCV (+ COP) */}
                <div className="flex items-center gap-2 lg:gap-3 justify-self-start min-w-0">
                    <div className="flex flex-col items-start leading-none gap-0.5 shrink-0">
                        <span className="text-xs lg:text-sm font-bold text-slate-800 dark:text-slate-100 font-mono tracking-tight">
                            {timeString}
                        </span>
                        <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider hidden lg:inline-block truncate max-w-[140px] xl:max-w-none">
                            {formattedDate}
                        </span>
                    </div>

                    <div className="h-5 lg:h-6 w-px bg-slate-200 dark:bg-slate-800 shrink-0" />

                    <button
                        type="button"
                        onClick={openRates}
                        data-testid="header-bcv-chip"
                        className="flex items-center gap-1.5 px-2 lg:px-3 py-1.5 bg-white dark:bg-surface-900 border border-slate-200/90 dark:border-slate-800 rounded-xl shadow-sm hover:border-emerald-500/50 hover:bg-emerald-50/40 dark:hover:bg-emerald-950/20 transition-all active:scale-95 group shrink-0"
                        title="Ver Monitor de Tasas y Divisas"
                    >
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                        <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 dark:text-slate-500 group-hover:text-emerald-600 transition-colors">
                            BCV
                        </span>
                        <span className="text-xs lg:text-sm font-black text-emerald-600 dark:text-emerald-400 font-outfit whitespace-nowrap">
                            {formatBs(bcvRate)} Bs
                        </span>
                        {copEnabled && tasaCop > 0 && (
                            <div className="hidden xl:flex items-center gap-1.5">
                                <span className="text-slate-300 dark:text-slate-700 font-light">|</span>
                                <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                                    COP
                                </span>
                                <span className="text-xs lg:text-sm font-black text-amber-600 dark:text-amber-400 font-outfit whitespace-nowrap">
                                    {Math.round(tasaCop).toLocaleString('es-CO')}
                                </span>
                            </div>
                        )}
                    </button>
                </div>

                {/* Centro: logo. Se decide por el ancho REAL del encabezado (consulta de contenedor en
                    index.css), no por el de la ventana: con la barra lateral abierta queda mucho menos
                    espacio. Si no cabe el logo ancho, va el ícono «D». */}
                <div className="flex items-center justify-center justify-self-center px-1 lg:px-2 shrink min-w-0">
                    <img src="./apple-touch-icon.png" alt="Precios Al Día" className="dash-logo-icon h-10 w-10 rounded-xl object-contain shrink-0" />
                    <div className="dash-logo-word">
                        <BrandLogo src={logoSrc} isCustom={logoIsCustom} box="dash-logo-box" img="dash-logo-img" />
                    </div>
                </div>

                {/* Derecha: Vender (F1), conexión y usuario */}
                <div className="flex items-center justify-end justify-self-end gap-1.5 lg:gap-2 shrink-0">
                    <button
                        type="button"
                        onClick={goSell}
                        data-testid="header-vender"
                        className="flex items-center gap-1.5 px-2.5 lg:px-3.5 py-1.5 lg:py-2 bg-brand hover:bg-brand-dark text-white rounded-xl font-extrabold text-xs shadow-sm shadow-brand/20 transition-all active:scale-95 shrink-0"
                        title="Nueva Venta (Presiona F1)"
                    >
                        <ShoppingCart size={15} className="shrink-0" />
                        <span className="font-bold">Vender</span>
                        <kbd className="hidden lg:inline-block px-1.5 py-0.5 text-[9px] bg-white/20 text-white rounded border border-white/25 font-mono font-bold leading-none">
                            F1
                        </kbd>
                    </button>

                    <SyncStatus />

                    {requireLogin && usuarioActivo && (
                        <div className="flex items-center gap-1.5 pl-1.5 lg:pl-2 border-l border-slate-200 dark:border-slate-800 shrink-0">
                            <div
                                className="w-7 h-7 lg:w-8 lg:h-8 rounded-full bg-brand/15 text-brand-dark dark:text-brand border border-brand/25 font-black text-[11px] lg:text-xs flex items-center justify-center shrink-0 shadow-sm"
                                title={`Sesión activa: ${usuarioActivo.nombre} (${usuarioActivo.rol})`}
                            >
                                {(usuarioActivo.nombre || 'U').substring(0, 2).toUpperCase()}
                            </div>
                            <div className="hidden 2xl:flex flex-col text-left leading-tight">
                                <span className="text-xs font-bold text-slate-800 dark:text-white truncate max-w-[85px]">
                                    {usuarioActivo.nombre}
                                </span>
                                <span className="text-[9px] text-slate-400 uppercase font-semibold">
                                    {usuarioActivo.rol}
                                </span>
                            </div>
                            {/* En PC (lg+) el cierre de sesión vive en la barra lateral */}
                            <button
                                type="button"
                                onClick={doLogout}
                                className="lg:hidden h-8 min-h-[32px] px-2 bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-900/60 border border-rose-200/60 dark:border-rose-900/50 rounded-xl text-xs font-bold flex items-center justify-center gap-1 transition-all active:scale-95 shadow-sm shrink-0"
                                title={`Cerrar sesión (${usuarioActivo.nombre})`}
                                aria-label="Cerrar sesión"
                            >
                                <LogOut size={14} className="text-rose-500 shrink-0" />
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
