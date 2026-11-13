// Pantalla completa con un botón (CASO-058).
// Hay dos formas de estar en pantalla completa y se distinguen así:
//  - «del botón»: la pide la página (Fullscreen API). Se sale con el botón o con Esc.
//  - «de F11»: la pone el navegador. La página no puede quitarla; se sale con F11.
//    Se detecta con `(display-mode: fullscreen)` sin `document.fullscreenElement`.
import { useCallback, useEffect, useState } from 'react';

function readState() {
  if (typeof document === 'undefined') return { supported: false, active: false, byF11: false };
  const supported = Boolean(document.fullscreenEnabled && document.documentElement?.requestFullscreen);
  const byApi = Boolean(document.fullscreenElement);
  const byF11 = !byApi && Boolean(window.matchMedia?.('(display-mode: fullscreen)')?.matches);
  return { supported, active: byApi || byF11, byF11 };
}

export function useFullscreen() {
  const [state, setState] = useState(readState);

  useEffect(() => {
    const update = () => setState(readState());
    const mq = window.matchMedia?.('(display-mode: fullscreen)');
    document.addEventListener('fullscreenchange', update);
    mq?.addEventListener?.('change', update);
    window.addEventListener('resize', update);
    return () => {
      document.removeEventListener('fullscreenchange', update);
      mq?.removeEventListener?.('change', update);
      window.removeEventListener('resize', update);
    };
  }, []);

  const toggle = useCallback(async () => {
    const now = readState();
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (!now.byF11) await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      // En F11 no se puede salir desde la página: el aviso del botón dice «Pulsa F11».
    } catch (err) {
      console.warn('[useFullscreen] No se pudo cambiar la pantalla completa:', err);
    }
    setState(readState());
  }, []);

  return { ...state, toggle };
}
