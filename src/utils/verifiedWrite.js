// Escritura local CON confirmación por relectura (hallazgo H1 de la auditoría
// docs/reports/2026-10-22-auditoria-comandos-supervisor-falsos-positivos.md).
//
// Por qué existe: `storageService.setItem` TRAGA errores (cuota llena →
// fallback a localStorage → cola de reintento) y solo relanza los del
// CircuitBreaker. Un comando del supervisor que escriba con él puede quedar
// confirmado como «aplicado» con un cambio que jamás se guardó — un falso
// positivo. El lote de inventario ya se defendía con su `writeVerified`
// interno («detección de escrituras tragadas»); esta util generaliza la misma
// defensa para producto, turno y usuario.
//
// Semántica: escribe, re-lee y compara. Si el almacenamiento no devuelve
// exactamente lo escrito, LANZA (error honesto → el receptor responde
// `failed`, nunca `applied`). La comparación por JSON normaliza ambos lados
// (campos `undefined` desaparecen igual en el viaje de ida y vuelta).

export async function writeVerifiedValue(storage, key, value, { expectedJson, skipSyncPush = false } = {}) {
    await storage.setItem(key, value, skipSyncPush ? { skipSyncPush: true } : undefined);
    const readBack = await storage.getItem(key, null);
    const confirmed = JSON.stringify(readBack ?? null)
        === (expectedJson !== undefined ? expectedJson : JSON.stringify(value ?? null));
    if (!confirmed) {
        throw new Error(`La escritura de ${key} no se confirmó en el almacenamiento local`);
    }
    return readBack;
}

export default { writeVerifiedValue };
