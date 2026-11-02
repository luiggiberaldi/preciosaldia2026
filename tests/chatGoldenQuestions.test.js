// tests/chatGoldenQuestions.test.js — Cobertura offline de las preguntas de oro del asistente.
// La verificación con la IA real se corre a mano: `node scripts/chat-golden-live.mjs`.
import { describe, it, expect } from 'vitest';
import { buildChatSystemMessage } from '../src/services/chatSystemPrompt';
import { GOLDEN_QUESTIONS, FORBIDDEN_ROUTES } from './fixtures/chatGoldenQuestions';

const system = buildChatSystemMessage('');

describe('preguntas de oro del asistente', () => {
  it('hay preguntas y cada una tiene hechos y criterio de respuesta', () => {
    expect(GOLDEN_QUESTIONS.length).toBeGreaterThanOrEqual(8);
    for (const q of GOLDEN_QUESTIONS) {
      expect(q.promptCovers.length, q.id).toBeGreaterThan(0);
      expect(q.mustMentionAny.length, q.id).toBeGreaterThan(0);
    }
  });

  for (const q of GOLDEN_QUESTIONS) {
    it(`el prompt contiene los hechos para: ${q.id}`, () => {
      for (const fact of q.promptCovers) expect(system, fact).toContain(fact);
    });
  }

  it('el prompt no contiene rutas inventadas conocidas', () => {
    for (const route of FORBIDDEN_ROUTES) expect(system).not.toContain(route);
  });
});
