import React, { useState, useEffect, useRef, useMemo, Suspense, lazy } from 'react';
import { Home, ShoppingCart, Store, Users, Download, FlaskConical, Moon, Sun, BarChart3, WifiOff, X, Settings, Clock } from 'lucide-react';

import DashboardView from './views/DashboardView';
import AIAssistantWidget from './components/AIAssistantWidget';

// Lazy-loaded views
const SalesView = lazy(() => import('./views/SalesView'));
const ProductsView = lazy(() => import('./views/ProductsView'));
const SettingsView = lazy(() => import('./views/SettingsView'));
const CustomersView = lazy(() => import('./views/CustomersView'));
const ReportsView = lazy(() => import('./views/ReportsView'));
const TesterView = lazy(() => import('./views/TesterView').then(m => ({ default: m.TesterView })));

import { useRates } from './hooks/useRates';
import { useSecurity } from './hooks/useSecurity';
import { ProductProvider } from './context/ProductContext';
import { CartProvider } from './context/CartContext';
import PremiumGuard from './components/security/PremiumGuard';
import TermsOverlay from './components/TermsOverlay';
import ErrorBoundary from './components/ErrorBoundary';
import { useOfflineQueue } from './hooks/useOfflineQueue';
import { useAutoBackup } from './hooks/useAutoBackup';
import CommandPalette from './components/CommandPalette';
import LockScreen from './components/security/LockScreen';
import { useAutoLock } from './hooks/useAutoLock';
import { useAuthStore } from './hooks/store/useAuthStore';
import { LogOut } from 'lucide-react';
import { purgeOldEntries } from './services/auditService';
import { useCloudSync } from './hooks/useCloudSync';

import OwnerMonitorView from './views/OwnerMonitorView';
import PairingScanScreen from './components/PairingScanScreen';

export default function App() {
  const [activeTab, setActiveTab] = useState('inicio');
  const [installPrompt, setInstallPrompt] = useState(null);
  const [showIOSInstall, setShowIOSInstall] = useState(false);
  const [mountedViews, setMountedViews] = useState({});
  const [showPairingScan, setShowPairingScan] = useState(false);
  const isMonitorMode = localStorage.getItem('pda_pairing_mode') === 'monitor';

  useEffect(() => {
    setMountedViews(prev => ({...prev, [activeTab]: true}));
  }, [activeTab]);

  const { isPremium, isDemo, demoTimeLeft, demoExpiredMsg, dismissExpiredMsg, deviceId, isMonthlyGracePeriod, monthlyGraceDaysLeft, forceHeartbeat } = useSecurity();
  const { isOnline, cacheRates } = useOfflineQueue();
  useAutoBackup(isPremium, isDemo, deviceId);

  const { usuarioActivo, requireLogin } = useAuthStore();
  const { logout } = useAuthStore();
  useAutoLock();

  // Al recargar la página, cerrar sesión si el login está activado
  useEffect(() => {
    if (requireLogin) logout();
  }, []);



  // Inicializar Sincronización Realtime con Supabase (device_id como clave)
  useCloudSync(isMonitorMode ? null : deviceId);

  // Detectar iOS Safari (no standalone) para mostrar instrucciones manuales
  const isIOS = useMemo(() => /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream, []);
  const isStandalone = useMemo(() => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone, []);
  const showIOSButton = isIOS && !isStandalone && !localStorage.getItem('ios_install_dismissed');

  // Admin Panel States
  const [adminClicks, setAdminClicks] = useState(0);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [showTester, setShowTester] = useState(false);

  
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);

  const lastClickTimeRef = useRef(0);

  const { rates } = useRates();

  // Purge old audit log entries on startup
  useEffect(() => { purgeOldEntries(); }, []);

  // Cache rates whenever they update
  useEffect(() => { if (rates) cacheRates(rates); }, [rates, cacheRates]);

  useEffect(() => {
    const handler = (e) => { e.preventDefault(); setInstallPrompt(e); };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === 'accepted') setInstallPrompt(null);
  };


  // Theme
  const [theme, setTheme] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('theme');
      if (saved) return saved;
      return 'light'; // Forced light mode by default for Bodega
    }
    return 'light';
  });

  useEffect(() => {
    const root = window.document.documentElement;
    // v1.2.0: actualizar AMBOS class (.dark) y data-theme attribute para compat
    // con Tailwind darkMode y con CSS del styleguide ([data-theme="dark"]).
    if (theme === 'dark') {
      root.classList.add('dark');
      root.setAttribute('data-theme', 'dark');
    } else {
      root.classList.remove('dark');
      root.setAttribute('data-theme', 'light');
    }
    localStorage.setItem('theme', theme);

    // Apply saved UI scale
    const savedScale = parseInt(localStorage.getItem('ui_scale'));
    if (savedScale >= 60 && savedScale <= 140) {
      root.style.zoom = `${savedScale}%`;
    }

    // Update theme-color meta: cian #01696f (light) / carbón #1a1917 (dark)
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#1a1917' : '#01696f');
  }, [theme]);

  const toggleTheme = () => setTheme(prev => prev === 'light' ? 'dark' : 'light');

  // Haptic
  const triggerHaptic = () => {
    if (typeof window !== 'undefined' && window.navigator && window.navigator.vibrate) {
      window.navigator.vibrate(10);
    }
  };

  // Admin Panel Logic (Hidden — 10 clicks on top-left corner)
  const handleLogoClick = () => {
    const now = Date.now();
    if (lastClickTimeRef.current && (now - lastClickTimeRef.current > 1000)) {
      setAdminClicks(1);
    } else {
      setAdminClicks(prev => prev + 1);
    }
    lastClickTimeRef.current = now;

    if (adminClicks + 1 >= 10) {
      setShowAdminPanel(true);
      setAdminClicks(0);
      triggerHaptic();
    }
  };

  // Keyboard detection
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);
  const baseHeight = useRef(0);

  useEffect(() => {
    if (!window.visualViewport) return;
    if (!baseHeight.current) baseHeight.current = window.visualViewport.height;

    const handleViewport = () => {
      setIsKeyboardOpen(window.visualViewport.height < baseHeight.current - 100);
    };
    const handleFocusBack = () => setTimeout(handleViewport, 300);

    window.visualViewport.addEventListener('resize', handleViewport);
    window.visualViewport.addEventListener('scroll', handleViewport);
    window.addEventListener('focusin', handleFocusBack);
    window.addEventListener('focusout', handleFocusBack);

    return () => {
      window.visualViewport?.removeEventListener('resize', handleViewport);
      window.visualViewport?.removeEventListener('scroll', handleViewport);
      window.removeEventListener('focusin', handleFocusBack);
      window.removeEventListener('focusout', handleFocusBack);
    };
  }, []);

  const isCajero = requireLogin && usuarioActivo?.rol === 'CAJERO';

  const ALL_TABS = [
    { id: 'inicio', label: 'Inicio', icon: Home },
    { id: 'ventas', label: 'Vender', icon: ShoppingCart },
    { id: 'catalogo', label: 'Inventario', icon: Store, premiumOnly: true },
    { id: 'clientes', label: 'Contactos', icon: Users },
    { id: 'reportes', label: 'Reportes', icon: BarChart3, adminOnly: true },
    { id: 'ajustes', label: 'Ajustes', icon: Settings, adminOnly: true },
  ];
  const TABS = ALL_TABS.filter(tab =>
    (!tab.premiumOnly || isPremium) && (!tab.adminOnly || !isCajero)
  );

  if (isMonitorMode) {
    return (
      <ErrorBoundary>
        <ProductProvider rates={rates}>
          <OwnerMonitorView theme={theme} toggleTheme={toggleTheme} triggerHaptic={triggerHaptic} />
        </ProductProvider>
      </ErrorBoundary>
    );
  }

  return (
    <div className="font-sans antialiased bg-slate-50 dark:bg-black h-[100dvh] flex flex-col overflow-clip transition-colors duration-300">

      {/* Terms and Conditions Overlay (First Use) */}
      <TermsOverlay onAccept={forceHeartbeat} />


      {/* Lock Screen — solo si login está activado y no hay sesión activa */}
      {requireLogin && !usuarioActivo && <LockScreen onOpenPairing={() => setShowPairingScan(true)} />}

      {showPairingScan && (
        <PairingScanScreen onCancel={() => setShowPairingScan(false)} triggerHaptic={triggerHaptic} />
      )}


      {/* Offline Banner */}
      {!isOnline && (
        <div className="fixed top-0 left-0 right-0 z-[200] flex justify-center pt-[env(safe-area-inset-top)]">
          <div className="mt-2 px-4 py-2 bg-slate-900/95 backdrop-blur-md rounded-full border border-red-500/30 shadow-xl flex items-center gap-2 animate-in slide-in-from-top-4">
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <WifiOff size={14} className="text-red-400" />
            <span className="text-xs font-bold text-white">Sin conexión · Modo offline</span>
          </div>
        </div>
      )}

      {/* Monthly License Grace Period Warning Banner */}
      {isMonthlyGracePeriod && (
        <div className={`fixed left-0 right-0 z-[200] flex justify-center pt-[env(safe-area-inset-top)] transition-all ${!isOnline ? 'top-12' : 'top-0'}`}>
          <div className="mt-2 mx-4 px-4 py-2.5 bg-amber-500 text-white rounded-xl border border-amber-600/30 shadow-xl flex items-center justify-between gap-3 animate-in slide-in-from-top-4 max-w-md w-[calc(100%-2rem)]">
            <div className="flex items-center gap-2">
              <Clock size={16} className="text-white animate-pulse shrink-0" />
              <div className="text-left">
                <p className="text-[11px] font-black leading-tight">Suscripción por pagar</p>
                <p className="text-[9px] text-white/90 leading-tight">Le quedan {monthlyGraceDaysLeft} {monthlyGraceDaysLeft === 1 ? 'día' : 'días'} de gracia antes de la suspensión.</p>
              </div>
            </div>
            <button
              onClick={() => {
                const msg = `Hola! Necesito registrar el pago de mi mensualidad de PreciosAlDía Bodega. ID: ${deviceId}`;
                window.open(`https://wa.me/584124051793?text=${encodeURIComponent(msg)}`, '_blank');
              }}
              className="px-2.5 py-1 bg-white text-amber-600 font-bold rounded-lg text-[9px] active:scale-95 transition-transform whitespace-nowrap shadow-sm hover:bg-slate-50"
            >
              Registrar Pago
            </button>
          </div>
        </div>
      )}




      {/* Demo Expired Modal */}
      {demoExpiredMsg && (
        <div className="fixed inset-0 z-[9999] bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-5 animate-in fade-in duration-300">
          <div className="bg-white dark:bg-slate-900 rounded-[2rem] p-8 max-w-sm shadow-2xl border border-slate-100 dark:border-slate-800 text-center animate-in zoom-in-95 duration-300">
            <div className="w-16 h-16 bg-amber-100 dark:bg-amber-900/30 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <span className="text-3xl">⏳</span>
            </div>
            <h2 className="text-xl font-black text-slate-900 dark:text-white mb-2">Prueba finalizada</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-5 leading-relaxed">
              {demoExpiredMsg}
            </p>
            <button
              onClick={() => {
                const msg = `Hola! Quiero adquirir la licencia Premium de PreciosAlDía. Acabo de terminar mi prueba gratuita.`;
                window.open(`https://wa.me/584124051793?text=${encodeURIComponent(msg)}`, '_blank');
              }}
              className="w-full py-3 bg-brand text-white font-bold rounded-xl shadow-lg shadow-brand/20 active:scale-95 transition-transform text-sm mb-2"
            >
              Solicitar Licencia
            </button>
            <button
              onClick={dismissExpiredMsg}
              className="w-full py-2.5 text-xs font-bold text-slate-400 hover:text-slate-600 transition-colors"
            >
              Continuar con versión gratuita
            </button>
          </div>
        </div>
      )}

      {/* Golden Tester View Overlay */}
      {showTester && (
        <div className="fixed inset-0 z-[150] bg-slate-50 dark:bg-slate-950">
          <TesterView onBack={() => setShowTester(false)} />
        </div>
      )}


      <CartProvider>
      <ProductProvider rates={rates}>
        <main className={`flex-1 min-h-0 w-full max-w-full px-0 lg:px-6 xl:px-8 mx-auto relative ${isKeyboardOpen ? 'pb-4' : 'pb-24'} flex flex-col overflow-y-auto`}>

          {/* Hidden Admin Trigger Area */}
        <div
          className="absolute top-0 left-0 w-20 h-20 z-50 cursor-pointer opacity-0"
          onClick={handleLogoClick}
          title="Ssshh..."
        ></div>

        {/* Lazy views — mount on first access, then stay persistent (visibilidad controlada por CSS) */}
        <div className={`flex-1 min-h-0 flex flex-col ${activeTab === 'ventas' ? '' : 'hidden'}`}>
          <ErrorBoundary>
            <PremiumGuard featureName="Punto de Venta" isShop={true}>
              {(activeTab === 'ventas' || mountedViews.ventas) && (
                <Suspense fallback={<div className="flex-1 p-4 space-y-4"><div className="skeleton h-10 w-40" /><div className="skeleton h-32" /><div className="skeleton h-48" /></div>}>
                  <SalesView rates={rates} triggerHaptic={triggerHaptic} onNavigate={setActiveTab} isActive={activeTab === 'ventas'} />
                </Suspense>
              )}
            </PremiumGuard>
          </ErrorBoundary>
        </div>

        <div className={`flex-1 flex flex-col ${activeTab === 'catalogo' ? '' : 'hidden'}`}>
          <ErrorBoundary>
            <PremiumGuard featureName="Inventario de Productos">
              {(activeTab === 'catalogo' || mountedViews.catalogo) && (
                <Suspense fallback={<div className="flex-1 p-4 space-y-4"><div className="skeleton h-10 w-40" /><div className="skeleton h-32" /><div className="skeleton h-48" /></div>}>
                  <ProductsView rates={rates} triggerHaptic={triggerHaptic} />
                </Suspense>
              )}
            </PremiumGuard>
          </ErrorBoundary>
        </div>

        <div className={`flex-1 flex flex-col ${activeTab === 'inicio' ? '' : 'hidden'}`}>
          <ErrorBoundary>
            <DashboardView rates={rates} triggerHaptic={triggerHaptic} onNavigate={(tab) => { if (tab === 'ajustes') { if (!isCajero) setActiveTab('ajustes'); } else { setActiveTab(tab); } }} theme={theme} toggleTheme={toggleTheme} isActive={activeTab === 'inicio'} isDemo={isDemo} demoTimeLeft={demoTimeLeft} />
          </ErrorBoundary>
        </div>

        {/* Lazy views — mount on first access, then stay persistent */}
        <Suspense fallback={<div className="flex-1 p-4 space-y-4"><div className="skeleton h-10 w-40" /><div className="skeleton h-32" /><div className="skeleton h-48" /></div>}>
          {(activeTab === 'clientes' || mountedViews.clientes) && (
            <div data-view="clientes" className={`flex-1 flex flex-col ${activeTab === 'clientes' ? '' : 'hidden'}`}>
              <ErrorBoundary>
                <PremiumGuard featureName="Gestión de Clientes" isShop={true}>
                  <CustomersView triggerHaptic={triggerHaptic} rates={rates} isActive={activeTab === 'clientes'} />
                </PremiumGuard>
              </ErrorBoundary>
            </div>
          )}
          {(activeTab === 'reportes' || mountedViews.reportes) && (
            <div data-view="reportes" className={`flex-1 flex flex-col ${activeTab === 'reportes' ? '' : 'hidden'}`}>
              <ErrorBoundary>
                <PremiumGuard featureName="Reportes Históricos" isShop={true}>
                  <ReportsView rates={rates} triggerHaptic={triggerHaptic} onNavigate={setActiveTab} isActive={activeTab === 'reportes'} />
                </PremiumGuard>
              </ErrorBoundary>
            </div>
          )}
          {(activeTab === 'ajustes' || mountedViews.ajustes) && (
            <div data-view="ajustes" className={`flex-1 flex flex-col ${activeTab === 'ajustes' ? '' : 'hidden'}`}>
              <ErrorBoundary>
                <SettingsView
                  theme={theme}
                  toggleTheme={toggleTheme}
                  triggerHaptic={triggerHaptic}
                  isTab={true}
                  rates={rates}
                />
              </ErrorBoundary>
            </div>
          )}
        </Suspense>
        {activeTab === 'inicio' && <AIAssistantWidget />}
      </main>

      </ProductProvider>
      </CartProvider>
      
      <CommandPalette 
          isOpen={isCommandPaletteOpen} 
          onClose={() => setIsCommandPaletteOpen(false)} 
          onToggle={() => setIsCommandPaletteOpen(p => !p)} 
          navigateTo={setActiveTab} 
      />

      {/* Bottom Nav — hidden in POS mode for full-screen selling */}
      {!isKeyboardOpen && (
        <div className="fixed bottom-0 left-0 right-0 px-3 sm:px-6 pb-[env(safe-area-inset-bottom)] pt-0 mb-4 max-w-full mx-auto z-30 pointer-events-none animate-in slide-in-from-bottom-4 duration-300">
          <div className="bg-slate-900/95 dark:bg-slate-950/95 backdrop-blur-xl rounded-2xl p-1 flex justify-between items-center shadow-2xl shadow-slate-900/30 border border-white/10 ring-1 ring-black/5 pointer-events-auto">
            {TABS.map(tab => (
              <TabButton
                key={tab.id}
                icon={<tab.icon size={18} strokeWidth={activeTab === tab.id ? 3 : 2} />}
                label={tab.label}
                isActive={activeTab === tab.id}
                onClick={() => { triggerHaptic(); setActiveTab(tab.id); }}
                data-tour={`tab-${tab.id}`}
              />
            ))}

            {/* Logout — solo si el login está activado */}
            {requireLogin && usuarioActivo && (
              <button
                onClick={() => { triggerHaptic(); logout(); }}
                className="flex flex-col items-center justify-center gap-0.5 py-2 px-3 rounded-xl text-slate-400 hover:text-rose-400 transition-colors active:scale-90"
                title={`Cerrar sesión (${usuarioActivo.nombre})`}
              >
                <LogOut size={18} strokeWidth={2} />
              </button>
            )}

            {installPrompt && activeTab === 'inicio' && (
              <button onClick={() => { triggerHaptic(); handleInstall(); }} className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2 rounded-xl transition-all duration-300 bg-brand text-white shadow-md animate-pulse">
                <Download size={20} strokeWidth={3} />
              </button>
            )}

            {/* iOS: botón manual de instalación */}
            {!installPrompt && showIOSButton && activeTab === 'inicio' && (
              <button onClick={() => { triggerHaptic(); setShowIOSInstall(true); }} className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2 rounded-xl transition-all duration-300 bg-brand text-white shadow-md animate-pulse">
                <Download size={20} strokeWidth={3} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* iOS Install Instructions Modal */}
      {showIOSInstall && (
        <div className="fixed inset-0 z-[200] bg-slate-900/60 backdrop-blur-sm flex items-end justify-center p-0 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-t-[2rem] p-6 shadow-2xl animate-in slide-in-from-bottom-10 duration-200">
            <div className="flex justify-between items-start mb-5">
              <div>
                <h3 className="text-lg font-black text-slate-800 dark:text-white">Instalar App</h3>
                <p className="text-xs text-slate-400 mt-1">Sigue estos pasos en Safari</p>
              </div>
              <button onClick={() => { setShowIOSInstall(false); localStorage.setItem('ios_install_dismissed', '1'); }} className="p-2 bg-slate-100 dark:bg-slate-800 rounded-full text-slate-500">
                <X size={18} />
              </button>
            </div>
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 bg-brand-light dark:bg-surface-800/30 rounded-full flex items-center justify-center shrink-0 text-brand-dark font-bold text-sm">1</div>
                <p className="text-sm text-slate-600 dark:text-slate-300">Toca el botón <strong>Compartir</strong> <span className="inline-block w-5 h-5 align-middle">⬆️</span> en la barra de Safari</p>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 bg-brand-light dark:bg-surface-800/30 rounded-full flex items-center justify-center shrink-0 text-brand-dark font-bold text-sm">2</div>
                <p className="text-sm text-slate-600 dark:text-slate-300">Busca y toca <strong>"Agregar a la pantalla de inicio"</strong></p>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 bg-emerald-100 dark:bg-emerald-900/30 rounded-full flex items-center justify-center shrink-0 text-emerald-600 font-bold text-sm">✓</div>
                <p className="text-sm text-slate-600 dark:text-slate-300">¡Listo! La app aparecerá como un ícono en tu teléfono</p>
              </div>
            </div>
            <button onClick={() => { setShowIOSInstall(false); localStorage.setItem('ios_install_dismissed', '1'); }} className="w-full mt-6 py-3 bg-brand text-white font-bold rounded-xl shadow-lg active:scale-95 transition-transform">
              Entendido
            </button>
          </div>
        </div>
      )}

      {/* Admin Panel Modal */}
      {showAdminPanel && (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 w-full max-w-sm rounded-2xl p-6 shadow-2xl">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <FlaskConical className="text-brand" /> Panel Dev
              </h2>
              <button onClick={() => setShowAdminPanel(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            <button
              onClick={() => { triggerHaptic(); setShowTester(true); setShowAdminPanel(false); }}
              className="w-full bg-brand-dark hover:bg-brand text-white font-bold py-3 rounded-lg text-sm uppercase tracking-wider transition-colors"
            >
              🚀 Abrir Tester
            </button>
          </div>
        </div>
      )}

    </div>
  );
}

function TabButton({ icon, label, isActive, onClick, 'data-tour': dataTour }) {
  return (
    <button data-tour={dataTour} onClick={onClick} className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2 rounded-xl transition-all duration-300 ${isActive ? 'bg-brand text-white shadow-md' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}>
      {icon}
      {isActive && <span className="text-[9px] font-extrabold animate-in zoom-in duration-200">{label}</span>}
    </button>
  );
}
