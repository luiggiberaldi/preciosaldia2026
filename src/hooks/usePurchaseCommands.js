// Supervisor: órdenes de compra de mercancía ya aplicadas por la caja (sondeo
// liviano + recarga cuando el tracker confirma una orden nueva).
import { useEffect, useState } from 'react';
import { fetchAppliedPurchaseCommands } from '../services/supervisorControlService';
import { subscribeSupervisorCommandTracker } from '../services/supervisorCommandTracker';

const POLL_MS = 30_000;

export function usePurchaseCommands(targetDeviceId) {
    const [commands, setCommands] = useState([]);
    useEffect(() => {
        if (!targetDeviceId) { setCommands([]); return undefined; }
        let alive = true;
        let timer = null;
        const load = async () => {
            const { data, error } = await fetchAppliedPurchaseCommands({ targetDeviceId });
            if (alive && !error) setCommands(data);
        };
        // Una orden recién confirmada por la caja se refleja sin esperar el sondeo.
        const scheduleLoad = () => { clearTimeout(timer); timer = setTimeout(load, 1500); };
        void load();
        const interval = setInterval(load, POLL_MS);
        const unsubscribe = subscribeSupervisorCommandTracker(scheduleLoad);
        return () => { alive = false; clearInterval(interval); clearTimeout(timer); unsubscribe(); };
    }, [targetDeviceId]);
    return commands;
}
