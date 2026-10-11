/** Send the presence heartbeat without re-running one-time device registration. */
export async function sendDeviceHeartbeat(supabaseClient, { deviceId, productId, clientName }) {
    const result = await supabaseClient.rpc('heartbeat_device', {
        p_device_id: deviceId,
        p_product_id: productId,
        p_client_name: clientName,
    });

    if (result?.error) throw result.error;
    return result;
}
