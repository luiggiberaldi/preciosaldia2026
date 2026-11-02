import { describe, it, expect } from 'vitest';
import { recordChatFeedback, readChatFeedback, CHAT_FEEDBACK_MAX, CHAT_FEEDBACK_KEY } from '../src/services/chatFeedback';

const fakeStorage = () => {
  const data = new Map();
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, v) };
};

describe('retroalimentación del asistente', () => {
  it('guarda voto, pregunta y respuesta recortadas', () => {
    const storage = fakeStorage();
    recordChatFeedback({ vote: 'down', question: 'p'.repeat(500), answer: 'r'.repeat(900) }, storage, 0);
    const [entry] = readChatFeedback(storage);
    expect(entry.vote).toBe('down');
    expect(entry.question).toHaveLength(200);
    expect(entry.answer).toHaveLength(400);
    expect(entry.ts).toBe('1970-01-01T00:00:00.000Z');
  });

  it('ignora votos inválidos y conserva solo las últimas entradas', () => {
    const storage = fakeStorage();
    recordChatFeedback({ vote: 'meh', question: 'x', answer: 'y' }, storage);
    expect(readChatFeedback(storage)).toHaveLength(0);
    for (let i = 0; i < CHAT_FEEDBACK_MAX + 5; i += 1) recordChatFeedback({ vote: 'up', question: `q${i}`, answer: 'a' }, storage);
    const list = readChatFeedback(storage);
    expect(list).toHaveLength(CHAT_FEEDBACK_MAX);
    expect(list.at(-1).question).toBe(`q${CHAT_FEEDBACK_MAX + 4}`);
  });

  it('tolera almacenamiento corrupto', () => {
    const storage = fakeStorage();
    storage.setItem(CHAT_FEEDBACK_KEY, '{no es json');
    expect(readChatFeedback(storage)).toEqual([]);
  });
});
