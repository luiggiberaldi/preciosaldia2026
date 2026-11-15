// Barra lateral plegable — solo PC (lg+). En teléfono y tablet se usa BottomNav.
// Traída de Precios al Día Farmacia (src/app/shared.jsx) con los colores de Bodega.
import { useEffect } from 'react';
import { ChevronsLeft, ChevronsRight, LogOut } from 'lucide-react';
import { useCart } from '../context/CartContext';
import FullscreenButton from '../components/FullscreenButton';

const ITEM_BASE = 'flex items-center gap-3 rounded-xl px-3 text-sm font-bold transition-colors';
const ITEM_IDLE = 'text-slate-500 hover:text-slate-800 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-white dark:hover:bg-white/5';

export default function SideNav({ tabs, activeTab, setActiveTab, triggerHaptic, collapsed, onToggle, requireLogin, usuarioActivo, logout }) {
  const { cart } = useCart();
  // Cuenta artículos distintos de la cesta, no cantidades (igual que la barra inferior).
  const totalCartItems = Array.isArray(cart) ? cart.length : 0;

  // Atajos Alt+1..Alt+N para saltar entre pestañas (solo PC; Alt+número no choca con las F-teclas de Vender).
  useEffect(() => {
    const onKey = (e) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const idx = parseInt(e.key, 10) - 1;
      if (!(idx >= 0 && idx < tabs.length)) return;
      if (window.innerWidth < 1024) return;
      e.preventDefault();
      setActiveTab(tabs[idx].id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tabs, setActiveTab]);

  return (
    <aside
      className={`hidden lg:flex fixed left-0 top-0 bottom-0 z-30 flex-col bg-white dark:bg-surface-900 border-r border-slate-200 dark:border-white/10 transition-[width] duration-200 ${collapsed ? 'w-16' : 'w-56'}`}
      aria-label="Navegación principal"
    >
      <div className={`flex items-center gap-3 px-3 pt-4 pb-2 ${collapsed ? 'justify-center px-0' : ''}`}>
        {/* El pwa-splash de Bodega viene en blanco: se usa el ícono «D» de la app. Ruta relativa para Electron. */}
        <img src="./apple-touch-icon.png" alt="Precios Al Día" className="w-10 h-10 rounded-xl shrink-0 object-contain" />
        {!collapsed && (
          <div className="leading-tight min-w-0">
            <p className="text-sm font-black text-slate-800 dark:text-white truncate">Precios Al Día</p>
            <p className="text-[10px] font-bold tracking-widest text-brand uppercase">Bodega</p>
          </div>
        )}
      </div>
      <div className="mx-3 my-2 border-t border-slate-200 dark:border-white/15" aria-hidden="true" />
      <nav className="flex-1 flex flex-col gap-1 p-2 pt-0 overflow-y-auto">
        {tabs.map((tab, idx) => {
          const isActive = activeTab === tab.id;
          const badge = tab.id === 'ventas' ? totalCartItems : (tab.badge || 0);
          return (
            <button
              key={tab.id}
              data-tour={`tab-${tab.id}`}
              data-testid={`sidenav-${tab.id}`}
              title={collapsed ? `${tab.label} (Alt+${idx + 1})` : undefined}
              aria-current={isActive ? 'page' : undefined}
              onClick={() => { triggerHaptic(); setActiveTab(tab.id); }}
              className={`relative h-12 ${ITEM_BASE} ${
                isActive ? 'bg-brand/15 text-brand-dark dark:bg-white/10 dark:text-white' : ITEM_IDLE
              } ${collapsed ? 'justify-center px-0' : ''}`}
            >
              <tab.icon size={20} strokeWidth={isActive ? 2.5 : 2} className="shrink-0" />
              {!collapsed && <span className="truncate">{tab.label}</span>}
              {badge > 0 && (
                <span className={`min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-black flex items-center justify-center ${collapsed ? 'absolute top-1 right-1' : 'ml-auto'}`}>
                  {badge > 99 ? '99+' : badge}
                </span>
              )}
              {!collapsed && !badge && (
                <kbd className={`ml-auto text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border ${isActive ? 'border-brand/30 text-brand-dark dark:border-white/30 dark:text-white/80' : 'border-slate-200 text-slate-400 dark:border-white/10 dark:text-slate-500'}`}>Alt+{idx + 1}</kbd>
              )}
            </button>
          );
        })}
      </nav>

      <div className="p-2 flex flex-col gap-1 border-t border-slate-200 dark:border-white/10">
        {requireLogin && usuarioActivo && (
          <div className={`flex items-center gap-2.5 rounded-xl bg-slate-100/80 dark:bg-white/5 ${collapsed ? 'flex-col p-1.5' : 'p-2'}`}>
            <div
              className="w-9 h-9 rounded-full bg-brand/15 text-brand-dark dark:text-brand border border-brand/25 font-black text-xs flex items-center justify-center shrink-0"
              title={`${usuarioActivo.nombre} (${usuarioActivo.rol})`}
            >
              {(usuarioActivo.nombre || 'U').substring(0, 2).toUpperCase()}
            </div>
            {!collapsed && (
              <div className="min-w-0 flex-1 leading-tight">
                <p className="text-xs font-bold text-slate-800 dark:text-white truncate">{usuarioActivo.nombre}</p>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{usuarioActivo.rol}</p>
              </div>
            )}
            <button
              onClick={() => { triggerHaptic(); logout(); }}
              title="Cerrar sesión"
              aria-label="Cerrar sesión"
              className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-slate-500 hover:text-rose-600 hover:bg-rose-500/10 dark:text-slate-400 dark:hover:text-rose-400 transition-colors"
            >
              <LogOut size={17} />
            </button>
          </div>
        )}
        <FullscreenButton
          showLabel={!collapsed}
          iconSize={20}
          className={`h-11 ${ITEM_BASE} ${ITEM_IDLE} ${collapsed ? 'justify-center px-0' : ''}`}
        />
        <button
          onClick={onToggle}
          title={collapsed ? 'Expandir barra' : 'Plegar barra'}
          aria-label={collapsed ? 'Expandir barra lateral' : 'Plegar barra lateral'}
          data-testid="sidenav-toggle"
          className={`h-11 ${ITEM_BASE} ${ITEM_IDLE} ${collapsed ? 'justify-center px-0' : ''}`}
        >
          {collapsed ? <ChevronsRight size={20} className="shrink-0" /> : <><ChevronsLeft size={20} className="shrink-0" /><span>Plegar</span></>}
        </button>
      </div>
    </aside>
  );
}
