import React, { useState, useEffect, useRef } from 'react';
import { Bot, Send, Trash2, X, Sparkles, User, AlertCircle, Mic, MicOff, DollarSign, Package, BarChart3, Users, Receipt, WifiOff, ShieldCheck, ThumbsUp, ThumbsDown } from 'lucide-react';
import { useProductContext } from '../context/ProductContext';
import { useCart } from '../context/CartContext';
import { useAuthStore } from '../hooks/store/useAuthStore';
import { useOfflineQueue } from '../hooks/useOfflineQueue';
import { storageService } from '../utils/storageService';
import { compileSystemConsciousnessContext } from '../services/systemConsciousnessService';
import { processDeterministicOfflineQuery } from '../services/deterministicBotEngine';
import { getChatSuggestions } from '../services/chatSuggestions';
import { recordChatFeedback } from '../services/chatFeedback';
import { renderChatMarkdown } from './Chat/ChatMarkdown';

// Historial que se envía a la IA: el servidor acepta hasta 20 mensajes (con el contexto del POS delante).
const MAX_HISTORY_MESSAGES = 12;

const SUGGESTION_ICONS = { vuelto: DollarSign, cuadre: BarChart3, stock: Package, cobrar: Users, ventas: Receipt, anular: AlertCircle, supervisor: ShieldCheck };

// Identificador de instalación: permite al servidor dar un cupo por equipo y no por wifi compartido.
const getDeviceId = () => {
    try { return localStorage.getItem('pda_device_id') || ''; } catch { return ''; }
};

export default function AIAssistantWidget() {
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState(() => {
        try {
            const saved = localStorage.getItem('pda_bot_chat_v2');
            const timestamp = localStorage.getItem('pda_bot_chat_v2_time');
            const now = Date.now();

            // Expiración a las 24 horas (Fase 8)
            if (saved && timestamp && (now - parseInt(timestamp, 10) < 24 * 60 * 60 * 1000)) {
                return JSON.parse(saved).slice(-15); // Máximo 15 mensajes
            }
        } catch {}
        return [
            {
                role: 'assistant',
                content: '¡Hola! Soy el **Asistente de Precios al Día**. Pregúntame sobre ventas, inventario, proveedores, reportes o cálculo de vuelto cambiario.'
            }
        ];
    });
    const [input, setInput] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [isKeyboardActive, setIsKeyboardActive] = useState(false);
    const [isConfirmOpen, setIsConfirmOpen] = useState(false);
    const [isListening, setIsListening] = useState(false);
    const [toastMessage, setToastMessage] = useState(null);

    // Persistir chat localmente con expiración de 24h
    useEffect(() => {
        try {
            localStorage.setItem('pda_bot_chat_v2', JSON.stringify(messages.slice(-15)));
            localStorage.setItem('pda_bot_chat_v2_time', Date.now().toString());
        } catch {}
    }, [messages]);

    // Conexiones de contexto del POS
    const { effectiveRate, tasaCop, products } = useProductContext();
    const { cart } = useCart();
    const { usuarioActivo } = useAuthStore();
    const { isOnline } = useOfflineQueue();

    const messagesEndRef = useRef(null);
    const inputRef = useRef(null);
    const recognitionRef = useRef(null);
    const abortControllerRef = useRef(null);

    // Privacidad y limpieza: al desmontar, detener el micrófono y cancelar cualquier stream en curso
    useEffect(() => {
        return () => {
            try { recognitionRef.current?.stop(); } catch {}
            try { abortControllerRef.current?.abort(); } catch {}
        };
    }, []);

    // Cierre del panel: detener el micrófono (privacidad en el mostrador) y cancelar el stream activo
    const closePanel = () => {
        try { recognitionRef.current?.stop(); } catch {}
        setIsListening(false);
        try { abortControllerRef.current?.abort(); } catch {}
        setIsOpen(false);
    };

    // Toast de notificación no-nativo (PISU UX Standard)
    const showToast = (msg) => {
        setToastMessage(msg);
        setTimeout(() => setToastMessage(null), 3000);
    };

    // Scroll al final al recibir nuevos mensajes
    useEffect(() => {
        if (messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [messages, isTyping]);

    // Ocultar widget si el teclado móvil está activo
    useEffect(() => {
        if (!window.visualViewport) return;
        const handleResize = () => {
            const isKeyboard = window.visualViewport.height < window.innerHeight - 150;
            setIsKeyboardActive(isKeyboard);
        };
        window.visualViewport.addEventListener('resize', handleResize);
        return () => window.visualViewport?.removeEventListener('resize', handleResize);
    }, []);

    // Dictado por voz (Speech-to-Text)
    const toggleListening = () => {
        if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
            showToast('El dictado por voz no está soportado en este navegador');
            return;
        }
        if (isListening) {
            recognitionRef.current?.stop();
            setIsListening(false);
            return;
        }
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        const recognition = new SpeechRecognition();
        recognition.lang = 'es-VE';
        recognition.continuous = false;
        recognition.interimResults = false;

        recognition.onstart = () => setIsListening(true);
        recognition.onresult = (e) => {
            const transcript = e.results[0][0].transcript;
            setInput(prev => (prev ? `${prev} ${transcript}` : transcript));
            setIsListening(false);
        };
        recognition.onerror = () => setIsListening(false);
        recognition.onend = () => setIsListening(false);

        recognitionRef.current = recognition;
        recognition.start();
    };

    const handleSend = async (textToSend) => {
        const messageText = textToSend || input;
        if (!messageText.trim() || isTyping) return;

        setInput('');
        if (inputRef.current) inputRef.current.style.height = 'auto';

        const newMessages = [...messages, { role: 'user', content: messageText }];
        setMessages(newMessages);
        setIsTyping(true);

        // FASE 6: Modo Offline Determinista (Si no hay internet, no llama a Groq y responde con motor local)
        if (!isOnline || (typeof navigator !== 'undefined' && !navigator.onLine)) {
            const offlineReply = await processDeterministicOfflineQuery(messageText, {
                effectiveRate,
                tasaCop,
                products,
                cart,
                usuarioActivo
            });

            setMessages([...newMessages, { role: 'assistant', content: offlineReply }]);
            setIsTyping(false);
            return;
        }

        try {
            // FASE 4 & 5: Servicio de Contexto de Salud Operativa y Permisos por Rol
            const contextText = await compileSystemConsciousnessContext({
                effectiveRate,
                tasaCop,
                products,
                cart,
                usuarioActivo,
                isOnline
            });

            // Enviar mensajes (api/chat.js inyecta CHAT_SYSTEM_PROMPT; el cliente no puede enviar «system»)
            const apiMessages = newMessages.slice(-MAX_HISTORY_MESSAGES).map(m => ({ role: m.role, content: m.content }));

            abortControllerRef.current = new AbortController();
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(getDeviceId() ? { 'X-PDA-Device-Id': getDeviceId() } : {})
                },
                // El contexto del POS viaja aparte: el servidor lo anexa al system prompt como datos.
                body: JSON.stringify({ messages: apiMessages, context: contextText }),
                signal: abortControllerRef.current.signal
            });

            if (!response.ok) {
                // El servidor explica el motivo (límite de consultas, servicio saturado): se muestra tal cual.
                const body = await response.json().catch(() => null);
                const serverError = new Error(`Error de servidor (${response.status})`);
                serverError.userMessage = body?.error || null;
                throw serverError;
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let aiResponse = "";
            let streamBuffer = "";

            setMessages(prev => [...prev, { role: 'assistant', content: "" }]);

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                streamBuffer += decoder.decode(value, { stream: true });
                const lines = streamBuffer.split('\n');
                streamBuffer = lines.pop() || "";
                
                let updatedNeeded = false;
                for (const line of lines) {
                    const cleanLine = line.trim();
                    if (!cleanLine || !cleanLine.startsWith('data: ')) continue;
                    const dataStr = cleanLine.slice(6);
                    if (dataStr === '[DONE]') break;
                    try {
                        const parsed = JSON.parse(dataStr);
                        const content = parsed.choices?.[0]?.delta?.content;
                        if (content) {
                            aiResponse += content;
                            updatedNeeded = true;
                        }
                    } catch (e) {}
                }

                if (updatedNeeded) {
                    setMessages(prev => {
                        return [...prev.slice(0, -1), { role: 'assistant', content: aiResponse }];
                    });
                }
            }
            // Stream vacío: sin texto no hay respuesta que mostrar; pasa al respaldo local.
            if (!aiResponse.trim()) throw new Error('Respuesta vacía del asistente');
        } catch (error) {
            if (error?.name === 'AbortError') {
                // El usuario cerró el panel: limpiar la burbuja vacía y no mostrar fallback ni error
                setMessages(prev => {
                    const updated = [...prev];
                    if (updated.length && updated[updated.length - 1].role === 'assistant' && updated[updated.length - 1].content === '') {
                        updated.pop();
                    }
                    return updated;
                });
                return;
            }
            if (error?.userMessage) {
                // Aviso del servidor (límite de consultas, servicio saturado): no hay respaldo offline que mostrar.
                setMessages(prev => [...prev, { role: 'assistant', content: `⚠️ ${error.userMessage}` }]);
                return;
            }
            // Fallback seguro a respuesta determinista local en caso de fallo de red/IA.
            // Distinguimos la causa: si hay internet pero /api/chat falló, el problema
            // es el servicio de IA (no la conexión) y el mensaje debe decirlo.
            const fallbackOfflineReply = await processDeterministicOfflineQuery(messageText, {
                effectiveRate,
                tasaCop,
                products,
                cart,
                usuarioActivo,
                offlineReason: (typeof navigator !== 'undefined' && !navigator.onLine) ? 'no_internet' : 'ai_service_error'
            });

            setMessages(prev => {
                const last = prev[prev.length - 1];
                const base = last?.role === 'assistant' && last.content === "" ? prev.slice(0, -1) : prev;
                return [...base, { role: 'assistant', content: fallbackOfflineReply }];
            });
        } finally {
            setIsTyping(false);
        }
    };

    const handleFeedback = (index, vote) => {
        const answer = messages[index];
        if (!answer || answer.feedback) return;
        const question = [...messages.slice(0, index)].reverse().find(m => m.role === 'user')?.content || '';
        recordChatFeedback({ vote, question, answer: answer.content });
        setMessages(prev => prev.map((m, idx) => (idx === index ? { ...m, feedback: vote } : m)));
        showToast('¡Gracias por tu opinión!');
    };

    const handleClear = () => setIsConfirmOpen(true);

    const confirmClear = () => {
        setMessages([
            {
                role: 'assistant',
                content: 'Conversación reiniciada. ¿En qué puedo ayudarte con **Precios al Día**?'
            }
        ]);
        setIsConfirmOpen(false);
    };

    const suggestions = getChatSuggestions(usuarioActivo?.rol);

    if (isKeyboardActive && !isOpen) return null;

    return (
        <>
            {/* Panel de Chat — Bot 2.0 Responsive Layout (High Contrast Theme) */}
            {isOpen && (
                <div className="fixed inset-x-0 bottom-0 sm:bottom-24 sm:right-6 sm:left-auto z-[250] w-full sm:w-[390px] h-[84vh] sm:h-[540px] bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden animate-in slide-in-from-bottom duration-250 select-text">
                    
                    {/* Handle bar superior para móviles */}
                    <div className="w-12 h-1.5 bg-slate-300 dark:bg-slate-700 rounded-full mx-auto my-2 sm:hidden shrink-0" />

                    {/* Header Bot 2.0 (High Contrast) */}
                    <div className="px-4 py-3 bg-slate-100/90 dark:bg-slate-850 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
                        <div className="flex items-center gap-2.5">
                            <div className="relative w-9 h-9 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-400 p-0.5 shadow-md shrink-0">
                                <img src="./bot-avatar.png" alt="Bot Avatar" className="w-full h-full object-contain rounded-xl bg-white dark:bg-slate-900" />
                                <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-slate-900 animate-pulse" />
                            </div>
                            <div>
                                <div className="flex items-center gap-1.5">
                                    <h3 className="text-xs font-black text-slate-900 dark:text-white tracking-wide">Asistente Bot 2.0</h3>
                                    <span className="px-1.5 py-0.2 bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-[8px] font-black rounded uppercase">AI</span>
                                </div>
                                <p className="text-[9px] font-bold text-slate-500 dark:text-slate-400 mt-0.5">
                                    Conectado a datos del negocio en vivo
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-1">
                            <button 
                                onClick={handleClear} 
                                className="p-2 text-slate-400 hover:text-rose-500 dark:text-slate-400 dark:hover:text-rose-400 rounded-xl hover:bg-slate-200 dark:hover:bg-white/10 transition-all"
                                title="Reiniciar chat"
                            >
                                <Trash2 size={15} />
                            </button>
                            <button 
                                onClick={closePanel} 
                                className="p-2 text-slate-400 hover:text-slate-700 dark:text-slate-400 dark:hover:text-white rounded-xl hover:bg-slate-200 dark:hover:bg-white/10 transition-all"
                                title="Cerrar asistente"
                            >
                                <X size={16} />
                            </button>
                        </div>
                    </div>

                    {/* Mensajes Chat Stream */}
                    <div role="log" aria-live="polite" aria-label="Conversación con el asistente" className="flex-1 overflow-y-auto p-4 space-y-3.5 custom-scrollbar bg-slate-50/50 dark:bg-slate-900/50">
                        {messages.map((m, i) => (
                            <div key={i} className={`flex items-start gap-2.5 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
                                <div className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 text-xs font-bold overflow-hidden ${
                                    m.role === 'user' 
                                        ? 'bg-emerald-600 text-white shadow-sm' 
                                        : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-0.5'
                                }`}>
                                    {m.role === 'user' ? <User size={13} /> : <img src="./bot-avatar.png" alt="Bot" className="w-full h-full object-contain rounded-lg" />}
                                </div>
                                <div className={`max-w-[82%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed shadow-sm ${
                                    m.role === 'user'
                                        ? 'bg-emerald-600 text-white rounded-tr-none font-medium'
                                        : 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 rounded-tl-none border border-slate-200/90 dark:border-slate-700/80 font-medium'
                                }`}>
                                    {renderChatMarkdown(m.content)}
                                    {m.role === 'assistant' && i > 0 && m.content && !(isTyping && i === messages.length - 1) && (
                                        <div className="flex items-center gap-1 mt-1.5 -mb-0.5">
                                            <button type="button" aria-label="Respuesta útil" aria-pressed={m.feedback === 'up'} disabled={Boolean(m.feedback)} onClick={() => handleFeedback(i, 'up')} className={`p-1 rounded-lg transition-colors ${m.feedback === 'up' ? 'text-emerald-600' : 'text-slate-400 hover:text-emerald-600 disabled:opacity-40'}`}><ThumbsUp size={12} /></button>
                                            <button type="button" aria-label="Respuesta no útil" aria-pressed={m.feedback === 'down'} disabled={Boolean(m.feedback)} onClick={() => handleFeedback(i, 'down')} className={`p-1 rounded-lg transition-colors ${m.feedback === 'down' ? 'text-rose-600' : 'text-slate-400 hover:text-rose-600 disabled:opacity-40'}`}><ThumbsDown size={12} /></button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                        {isTyping && messages[messages.length - 1].content === "" && (
                            <div className="flex items-start gap-2.5">
                                <div className="w-7 h-7 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-0.5 flex items-center justify-center shrink-0 overflow-hidden">
                                    <img src="./bot-avatar.png" alt="Bot" className="w-full h-full object-contain rounded-lg" />
                                </div>
                                <div className="bg-white dark:bg-slate-800 rounded-2xl rounded-tl-none px-3.5 py-2.5 flex gap-1 items-center border border-slate-200 dark:border-slate-700">
                                    <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                                    <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                                    <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                                </div>
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>

                    {toastMessage && (
                        <div role="status" className="absolute bottom-28 left-1/2 -translate-x-1/2 z-[290] px-3 py-1.5 rounded-xl bg-slate-900 text-white text-[10px] font-bold shadow-lg dark:bg-white dark:text-slate-900">
                            {toastMessage}
                        </div>
                    )}

                    {/* Sugerencias Rápidas — Carrusel Horizontal High Contrast */}
                    <div className="px-3 py-2 flex items-center gap-1.5 bg-slate-100 dark:bg-slate-850 shrink-0 border-t border-slate-200 dark:border-slate-800 overflow-x-auto no-scrollbar">
                        {suggestions.map((s, idx) => {
                            const IconComponent = SUGGESTION_ICONS[s.id] || Sparkles;
                            return (
                                <button
                                    key={idx}
                                    onClick={() => handleSend(s.prompt)}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 border border-slate-200 dark:border-slate-700 rounded-xl text-[10px] font-bold text-slate-700 dark:text-slate-200 transition-all shrink-0 shadow-sm"
                                >
                                    <IconComponent size={12} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                                    <span>{s.label}</span>
                                </button>
                            );
                        })}
                    </div>

                    {/* Input Bar con Dictado por Voz High Contrast */}
                    <div className="p-3 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 shrink-0">
                        <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800/90 rounded-2xl px-3 py-1.5 border border-slate-200 dark:border-slate-700 focus-within:border-emerald-500 transition-all">
                            <textarea
                                ref={inputRef}
                                value={input}
                                onChange={(e) => {
                                    setInput(e.target.value);
                                    e.target.style.height = 'auto';
                                    e.target.style.height = `${Math.min(e.target.scrollHeight, 70)}px`;
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        handleSend();
                                    }
                                }}
                                placeholder={isListening ? "Escuchando tu pregunta..." : "Haz una consulta al negocio..."}
                                rows={1}
                                className="flex-1 bg-transparent border-none text-xs focus:ring-0 outline-none text-slate-900 dark:text-white placeholder-slate-400 resize-none min-h-[20px] max-h-[70px] font-medium py-1"
                            />
                            
                            {/* Botón Dictado por Voz */}
                            <button
                                type="button"
                                onClick={toggleListening}
                                className={`p-1.5 rounded-xl transition-all ${
                                    isListening 
                                        ? 'bg-rose-500 text-white animate-pulse shadow-md' 
                                        : 'text-slate-400 hover:text-slate-700 dark:hover:text-white'
                                }`}
                                title={isListening ? "Detener micrófono" : "Dictar pregunta por voz"}
                            >
                                {isListening ? <MicOff size={15} /> : <Mic size={15} />}
                            </button>

                            {/* Botón Enviar */}
                            <button
                                onClick={() => handleSend()}
                                disabled={!input.trim() || isTyping}
                                className={`p-1.5 rounded-xl transition-all ${
                                    input.trim() && !isTyping 
                                        ? 'bg-emerald-600 text-white shadow-md active:scale-95' 
                                        : 'text-slate-300 dark:text-slate-600 cursor-not-allowed'
                                }`}
                            >
                                <Send size={14} />
                            </button>
                        </div>
                    </div>

                    {/* Modal Confirmación Reset */}
                    {isConfirmOpen && (
                        <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm z-[300] flex items-center justify-center p-4">
                            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 w-full max-w-[280px] shadow-2xl text-center select-none animate-in fade-in zoom-in-95 duration-150">
                                <h4 className="text-xs font-black text-slate-900 dark:text-white mb-2">Reiniciar Conversación</h4>
                                <p className="text-[10px] text-slate-500 dark:text-slate-400 mb-4 leading-relaxed">
                                    ¿Está seguro de restablecer el chat? Se borrará el historial de la sesión.
                                </p>
                                <div className="flex gap-2 justify-center">
                                    <button 
                                        onClick={() => setIsConfirmOpen(false)}
                                        className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-xl text-[10px] font-bold text-slate-700 dark:text-slate-300 transition-colors"
                                    >
                                        Cancelar
                                    </button>
                                    <button 
                                        onClick={confirmClear}
                                        className="px-3.5 py-1.5 bg-rose-500 hover:bg-rose-600 rounded-xl text-[10px] font-bold text-white shadow-md active:scale-95 transition-all"
                                    >
                                        Reiniciar
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Botón FAB Único (Solo visible cuando el chat está cerrado para evitar la colisión X del screenshot) */}
            {!isOpen && (
                <button
                    onClick={() => setIsOpen(true)}
                    className="fixed bottom-20 right-4 sm:bottom-24 sm:right-6 z-[200] w-12 h-12 rounded-full flex items-center justify-center bg-emerald-500 hover:bg-emerald-600 text-white shadow-xl shadow-emerald-500/30 transition-all duration-300 active:scale-90 hover:scale-105 pointer-events-auto"
                    title="Asistente Bot 2.0"
                >
                    <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center p-0.5">
                        <img src="./bot-avatar.png" alt="Bot" className="w-full h-full object-contain rounded-full" />
                    </div>
                </button>
            )}
        </>
    );
}
