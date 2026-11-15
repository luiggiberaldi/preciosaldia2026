// Botón «Pantalla completa» (CASO-058). No se muestra si el equipo no lo permite (por ejemplo, iPhone).
import { Maximize2, Minimize2 } from 'lucide-react';
import { useFullscreen } from '../hooks/useFullscreen';

export default function FullscreenButton({ className = '', showLabel = false, iconSize = 18 }) {
  const { supported, active, byF11, toggle } = useFullscreen();
  if (!supported && !byF11) return null;

  const label = active ? 'Salir de pantalla completa' : 'Pantalla completa';
  const hint = byF11 ? 'Pulsa F11 para salir de pantalla completa' : `${label} (F11)`;
  const Icon = active ? Minimize2 : Maximize2;

  return (
    <button
      type="button"
      onClick={toggle}
      title={hint}
      aria-label={label}
      aria-pressed={active}
      data-testid="fullscreen-toggle"
      className={className}
    >
      <Icon size={iconSize} className="shrink-0" />
      {showLabel && <span className="truncate">{active ? 'Salir de pantalla' : 'Pantalla completa'}</span>}
    </button>
  );
}
