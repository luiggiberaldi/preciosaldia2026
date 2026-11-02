// Retroalimentación «útil / no útil» del asistente. Se guarda solo en este equipo
// (sin enviar nada a la nube) para revisar qué preguntas falla.

export const CHAT_FEEDBACK_KEY = 'pda_bot_feedback_v1';
export const CHAT_FEEDBACK_MAX = 100;

export function readChatFeedback(storage = globalThis.localStorage) {
    try {
        const parsed = JSON.parse(storage?.getItem(CHAT_FEEDBACK_KEY) || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

/** vote: 'up' | 'down'. Conserva las últimas CHAT_FEEDBACK_MAX entradas. */
export function recordChatFeedback({ vote, question, answer }, storage = globalThis.localStorage, now = Date.now()) {
    if (vote !== 'up' && vote !== 'down') return readChatFeedback(storage);
    const entry = {
        ts: new Date(now).toISOString(),
        vote,
        question: String(question || '').slice(0, 200),
        answer: String(answer || '').slice(0, 400),
    };
    const next = [...readChatFeedback(storage), entry].slice(-CHAT_FEEDBACK_MAX);
    try { storage?.setItem(CHAT_FEEDBACK_KEY, JSON.stringify(next)); } catch { /* almacenamiento lleno o bloqueado */ }
    return next;
}
