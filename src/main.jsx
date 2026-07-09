import React, { useState, useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import ResetPasswordView from './views/ResetPasswordView.jsx'
import { ToastProvider } from './components/Toast.jsx'
import { supabaseCloud } from './config/supabaseCloud.js'
import './index.css'

// ── Interceptor global de Fetch para Electron (protocolo file://) ──
if (window.location.protocol === 'file:') {
  const originalFetch = window.fetch;
  window.fetch = function (input, init) {
    if (typeof input === 'string' && input.startsWith('/api/')) {
      const baseUrl = import.meta.env.VITE_API_URL || 'https://preciosaldiaoficial.vercel.app';
      input = `${baseUrl}${input}`;
    }
    return originalFetch(input, init);
  };
}

// ── Forzar actualización del Service Worker al cargar ──
if ('serviceWorker' in navigator) {
  // Forzar chequeo de nueva versión en cada carga
  navigator.serviceWorker.getRegistrations().then(regs => {
    regs.forEach(reg => reg.update().catch(() => {/* Ignorar fallos en desarrollo o sin conexión */}));
  });

  // Cuando el nuevo SW toma control, recargar la página para servir el nuevo código.
  // Sin esto, el usuario puede tener el SW actualizado pero seguir viendo el JS viejo.
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
}

// ── Evitar que la rueda del mouse cambie valores en inputs numéricos ──
// HOOK-033: Antes este listener se registraba a nivel módulo (sin cleanup),
// lo que causaba:
//   1) En HMR, se acumulaban listeners en cada reload.
//   2) El listener sobrevivía al unmount del root en tests.
// Lo movemos dentro de `AppRouter` (useEffect) para que tenga cleanup correcto.
function _attachWheelGuard() {
  const handler = (e) => {
    if (e.target?.type === 'number') {
      e.target.blur();
      e.preventDefault();
    }
  };
  document.addEventListener('wheel', handler, { passive: false });
  return () => document.removeEventListener('wheel', handler);
}

// Detectar token de recuperación en la URL al cargar (antes de React)
function detectRecovery() {
  const hash = window.location.hash;
  const params = new URLSearchParams(window.location.search);
  return hash.includes('type=recovery') || params.has('code');
}

function AppRouter() {
  const [isRecovery, setIsRecovery] = useState(detectRecovery);

  // HOOK-033: wheel listener con cleanup correcto.
  useEffect(() => _attachWheelGuard(), []);

  useEffect(() => {
    if (!supabaseCloud) return;
    const { data: { subscription } } = supabaseCloud.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setIsRecovery(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  if (isRecovery) {
    return (
      <ResetPasswordView
        onDone={() => {
          window.history.replaceState({}, document.title, window.location.pathname);
          setIsRecovery(false);
        }}
      />
    );
  }

  return <App />;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ToastProvider>
      <AppRouter />
    </ToastProvider>
  </React.StrictMode>,
)

