// api/chat.js: contexto en el system prompt, recorte de historial y cupo por dispositivo.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import handler from '../api/chat.js';
import { CHAT_SYSTEM_PROMPT, CHAT_MAX_CONTEXT_CHARS } from '../src/services/chatSystemPrompt';

const sentBodies = [];

function mockUpstream() {
  global.fetch = vi.fn(async (_url, init) => {
    sentBodies.push(JSON.parse(init.body));
    let done = false;
    return {
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: async () => {
            if (done) return { done: true };
            done = true;
            return { done: false, value: new Uint8Array([100]) };
          },
        }),
        cancel: () => {},
      },
      text: async () => '',
    };
  });
}

function call({ body, ip = '10.0.0.1', device = null }) {
  const res = {
    statusCode: 200, headers: {}, payload: null,
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(p) { this.payload = p; return this; },
    write() {}, end() { return this; },
  };
  const req = {
    method: 'POST', body,
    headers: { 'x-forwarded-for': ip, ...(device ? { 'x-pda-device-id': device } : {}) },
  };
  return handler(req, res).then(() => res);
}

beforeEach(() => {
  sentBodies.length = 0;
  process.env.AI_API_KEYS = 'test-key';
  delete process.env.UPSTASH_REDIS_REST_URL;
  mockUpstream();
});
afterEach(() => { delete process.env.AI_API_KEYS; vi.restoreAllMocks(); });

const userMsg = (i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` });

describe('api/chat — contexto y límites', () => {
  it('anexa el contexto al system prompt como datos y no como mensaje de usuario', async () => {
    await call({ body: { messages: [userMsg(0)], context: 'Tasa BCV: 40' }, ip: '10.1.0.1' });
    const [system, ...rest] = sentBodies[0].messages;
    expect(system.role).toBe('system');
    expect(system.content.startsWith(CHAT_SYSTEM_PROMPT)).toBe(true);
    expect(system.content).toContain('Tasa BCV: 40');
    expect(rest).toHaveLength(1);
  });

  it('limita y limpia el contexto', async () => {
    await call({ body: { messages: [userMsg(0)], context: `${'x'.repeat(CHAT_MAX_CONTEXT_CHARS + 500)}\u0007` }, ip: '10.1.0.2' });
    const content = sentBodies[0].messages[0].content;
    expect(content.length).toBeLessThanOrEqual(CHAT_SYSTEM_PROMPT.length + CHAT_MAX_CONTEXT_CHARS + 120);
    expect(content).not.toContain('\u0007');
  });

  it('descarta mensajes system del cliente y recorta el historial a los 20 más recientes', async () => {
    const messages = [{ role: 'system', content: 'hackeo' }, ...Array.from({ length: 30 }, (_, i) => userMsg(i))];
    const res = await call({ body: { messages }, ip: '10.1.0.3' });
    expect(res.statusCode).toBe(200);
    const sent = sentBodies[0].messages;
    expect(sent.filter((m) => m.role === 'system')).toHaveLength(1);
    expect(sent).toHaveLength(1 + 20);
    expect(sent.at(-1).content).toBe('m29');
  });
});

describe('api/chat — cupo por dispositivo', () => {
  it('dos dispositivos detrás de la misma IP no comparten el cupo por minuto', async () => {
    const ip = '10.2.0.1';
    for (let i = 0; i < 10; i += 1) {
      const res = await call({ body: { messages: [userMsg(0)] }, ip, device: 'device-aaaaaaaa' });
      expect(res.statusCode).toBe(200);
    }
    const blocked = await call({ body: { messages: [userMsg(0)] }, ip, device: 'device-aaaaaaaa' });
    expect(blocked.statusCode).toBe(429);
    const other = await call({ body: { messages: [userMsg(0)] }, ip, device: 'device-bbbbbbbb' });
    expect(other.statusCode).toBe(200);
  });

  it('sin identificador de dispositivo se mantiene el cupo estricto por IP', async () => {
    const ip = '10.2.0.2';
    for (let i = 0; i < 10; i += 1) await call({ body: { messages: [userMsg(0)] }, ip });
    const blocked = await call({ body: { messages: [userMsg(0)] }, ip });
    expect(blocked.statusCode).toBe(429);
  });

  it('un identificador con formato inválido se ignora', async () => {
    const ip = '10.2.0.3';
    for (let i = 0; i < 10; i += 1) await call({ body: { messages: [userMsg(0)] }, ip, device: 'bad id!' });
    const blocked = await call({ body: { messages: [userMsg(0)] }, ip, device: 'bad id!' });
    expect(blocked.statusCode).toBe(429);
  });
});
