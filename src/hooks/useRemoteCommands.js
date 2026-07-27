import { useEffect } from 'react';
import { supabaseCloud } from '../config/supabaseCloud';

export function useRemoteCommands(deviceId) {
    useEffect(() => {
        if (!supabaseCloud) return;

        // Suscribirse al canal global de comandos remotos de La Estación
        const channel = supabaseCloud.channel('system_commands', {
            config: { broadcast: { self: false } }
        });

        channel
            .on('broadcast', { event: 'force_reload' }, (payload) => {
                const target = payload.payload?.targetDeviceId;
                if (!target || target === 'all' || target === deviceId) {
                    console.log('[RemoteCommands] Recibida orden de recarga remota desde La Estación. Recargando app...');
                    window.location.reload();
                }
            })
            .subscribe();

        return () => {
            supabaseCloud.removeChannel(channel).catch(() => {});
        };
    }, [deviceId]);
}
