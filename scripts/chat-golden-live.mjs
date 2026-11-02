// Corre las preguntas de oro contra el endpoint real del asistente (IA en vivo).
// Uso: node scripts/chat-golden-live.mjs            (con `bun run dev` activo en :5173)
//      CHAT_GOLDEN_URL=https://tu-dominio/api/chat node scripts/chat-golden-live.mjs
// Sale con código 1 si alguna respuesta no menciona lo esperado o contiene una ruta inventada.
import { GOLDEN_QUESTIONS, FORBIDDEN_ROUTES } from '../tests/fixtures/chatGoldenQuestions.js';

const url = process.env.CHAT_GOLDEN_URL || 'http://127.0.0.1:5173/api/chat';
const DELAY_MS = Number(process.env.CHAT_GOLDEN_DELAY_MS || 7000); // respeta 10 consultas/min

async function ask(question) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-PDA-Device-Id': 'golden-live-check' },
    body: JSON.stringify({ messages: [{ role: 'user', content: question }] }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const text = await res.text();
  let answer = '';
  for (const line of text.split('\n')) {
    if (!line.startsWith('data: ') || line.includes('[DONE]')) continue;
    try { answer += JSON.parse(line.slice(6)).choices?.[0]?.delta?.content || ''; } catch { /* línea parcial */ }
  }
  return answer;
}

let failures = 0;
for (const q of GOLDEN_QUESTIONS) {
  try {
    const answer = await ask(q.question);
    const lower = answer.toLowerCase();
    const mentions = q.mustMentionAny.some((word) => lower.includes(word.toLowerCase()));
    const invented = FORBIDDEN_ROUTES.filter((route) => answer.includes(route));
    const words = answer.trim().split(/\s+/).length;
    const ok = mentions && invented.length === 0;
    if (!ok) failures += 1;
    console.log(`${ok ? 'OK  ' : 'FALLA'} [${q.id}] ${words} palabras${mentions ? '' : ' | no menciona lo esperado'}${invented.length ? ` | ruta inventada: ${invented.join(', ')}` : ''}`);
    if (!ok) console.log(`      ${answer.replace(/\s+/g, ' ').slice(0, 300)}`);
  } catch (error) {
    failures += 1;
    console.log(`FALLA [${q.id}] ${error.message}`);
  }
  await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
}
console.log(failures === 0 ? '\nTodas las preguntas de oro pasaron.' : `\n${failures} pregunta(s) con problemas.`);
process.exit(failures === 0 ? 0 : 1);
