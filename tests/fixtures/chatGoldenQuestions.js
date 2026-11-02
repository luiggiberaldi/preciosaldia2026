// Preguntas de oro del asistente. Se usan de dos formas:
//  - offline (tests/chatGoldenQuestions.test.js): el prompt debe contener los hechos (`promptCovers`).
//  - en vivo (scripts/chat-golden-live.mjs): la respuesta real de la IA debe mencionar algo de
//    `mustMentionAny` y nunca contener `forbid`.
export const GOLDEN_QUESTIONS = [
  { id: 'anular', question: '¿Cómo anulo una venta?', promptCovers: ['Solo el Administrador anula', 'Venta protegida por Cierre de Caja'], mustMentionAny: ['administrador', 'cierre de caja'] },
  { id: 'cierre', question: '¿Dónde hago el cierre de caja?', promptCovers: ['módulo Dashboard (no desde Ventas)'], mustMentionAny: ['dashboard'] },
  { id: 'config', question: '¿Qué pestañas tiene Configuración?', promptCovers: ['Negocio, Ventas, Usuarios, Licencia y Sistema'], mustMentionAny: ['licencia'] },
  { id: 'vuelto-pm', question: '¿El pago móvil genera vuelto?', promptCovers: ['Pago móvil, punto de venta y transferencias no generan vuelto'], mustMentionAny: ['no genera', 'no generan', 'no hay vuelto', 'no aparece', 'solo los métodos de efectivo', 'sólo los métodos de efectivo'] },
  { id: 'redondeo', question: '¿Cómo se redondean los bolívares?', promptCovers: ['hacia arriba al entero'], mustMentionAny: ['entero', 'arriba'] },
  { id: 'fifo', question: '¿Cómo pago a un proveedor varias facturas a la vez?', promptCovers: ['Automático FIFO'], mustMentionAny: ['fifo', 'antigu'] },
  { id: 'supervisor', question: '¿Cómo vinculo el celular del supervisor?', promptCovers: ['Celular del Supervisor', 'Configuración -> Sistema'], mustMentionAny: ['sistema', 'qr'] },
  { id: 'reportes', question: '¿Qué pestañas tiene Reportes?', promptCovers: ['Métricas', 'Gastos', 'Cierres'], mustMentionAny: ['métricas', 'gastos'] },
  { id: 'fuera-de-alcance', question: '¿Dónde está el botón «Nuevo Ticket»?', promptCovers: ['NUNCA inventes rutas'], mustMentionAny: ['no existe', 'no conozco', 'no tengo', 'no cuento', 'no hay'] },
];

// Rutas inventadas detectadas en auditorías: jamás deben aparecer en una respuesta.
export const FORBIDDEN_ROUTES = ['Ventas -> Tasas', 'Configuración -> Tasas', 'Configuración -> Ventas -> Redondeo'];
