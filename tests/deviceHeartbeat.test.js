import { describe, expect, it, vi } from 'vitest';
import { sendDeviceHeartbeat } from '../src/services/deviceHeartbeat';

describe('sendDeviceHeartbeat', () => {
    it('envía solo heartbeat_device y devuelve el resultado del RPC', async () => {
        const rpcResult = { data: null, error: null };
        const supabaseClient = { rpc: vi.fn().mockResolvedValue(rpcResult) };

        await expect(sendDeviceHeartbeat(supabaseClient, {
            deviceId: 'PDA-DEVICE-01',
            productId: 'bodega',
            clientName: 'Tienda Ejemplo',
        })).resolves.toBe(rpcResult);

        expect(supabaseClient.rpc).toHaveBeenCalledTimes(1);
        expect(supabaseClient.rpc).toHaveBeenCalledWith('heartbeat_device', {
            p_device_id: 'PDA-DEVICE-01',
            p_product_id: 'bodega',
            p_client_name: 'Tienda Ejemplo',
        });
        expect(supabaseClient.rpc).not.toHaveBeenCalledWith(
            'auto_register_device',
            expect.anything(),
        );
    });

    it('lanza el error devuelto por Supabase para que el monitor lo pueda registrar', async () => {
        const rpcError = new Error('heartbeat failed');
        const supabaseClient = { rpc: vi.fn().mockResolvedValue({ data: null, error: rpcError }) };

        await expect(sendDeviceHeartbeat(supabaseClient, {
            deviceId: 'PDA-DEVICE-01',
            productId: 'bodega',
            clientName: 'Tienda Ejemplo',
        })).rejects.toBe(rpcError);
    });
});
