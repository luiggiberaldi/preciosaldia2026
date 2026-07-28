import React, { useState, useEffect, useRef } from 'react';
import { Bot, Send, Trash2, X, Sparkles, User, AlertCircle, Mic, MicOff, DollarSign, Package, BarChart3, Users, Receipt } from 'lucide-react';
import { useProductContext } from '../context/ProductContext';
import { useCart } from '../context/CartContext';
import { useAuthStore } from '../hooks/store/useAuthStore';
import { useOfflineQueue } from '../hooks/useOfflineQueue';
import { storageService } from '../utils/storageService';
import { getActivePaymentMethods } from '../config/paymentMethods';

export default function AIAssistantWidget() {
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState(() => {
        try {
            const saved = localStorage.getItem('pda_bot_chat_v2');
            if (saved) return JSON.parse(saved);
        } catch {}
        return [
            {
                role: 'assistant',
                content: '¡Hola! Soy tu **Asistente Bot 2.0 de Precios al Día**. Pregúntame sobre ventas, inventario, deudas del negocio o cálculo de vuelto cambiario en bolívares y dólares.'
            }
        ];
    });
    const [input, setInput] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [isKeyboardActive, setIsKeyboardActive] = useState(false);
    const [isConfirmOpen, setIsConfirmOpen] = useState(false);
    const [isListening, setIsListening] = useState(false);

    // Persistir chat localmente
    useEffect(() => {
        try {
            localStorage.setItem('pda_bot_chat_v2', JSON.stringify(messages));
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
            alert('El dictado por voz no está soportado en este navegador');
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

    // Compilar contexto completo del POS en tiempo real
    const compilePosContext = async () => {
        const rateBcv = effectiveRate || 0;
        const rateCop = tasaCop || 0;
        const username = usuarioActivo?.nombre || 'Sin sesión';
        const role = usuarioActivo?.rol || 'CAJERO';
        const connection = isOnline ? 'Online (Sincronizado)' : 'Offline (Modo sin conexión)';
        const businessName = localStorage.getItem('business_name') || 'Sin nombre registrado';
        const businessRif = localStorage.getItem('business_rif') || 'Sin RIF';

        const totalProducts = products?.length || 0;
        const lowStockItems = products
            ? products.filter(p => (p.stock ?? 0) <= (p.lowStockAlert ?? 5) && (p.stock ?? 0) >= 0)
            : [];
        const outOfStockItems = products
            ? products.filter(p => (p.stock ?? 0) <= 0)
            : [];

        const criticalStock = lowStockItems
            .sort((a, b) => (a.stock ?? 0) - (b.stock ?? 0))
            .slice(0, 5)
            .map(p => `${p.name} (stock: ${p.stock ?? 0}, alerta: ${p.lowStockAlert ?? 5})`)
            .join(', ');

        const categoriesInUse = products
            ? [...new Set(products.map(p => p.category).filter(Boolean))]
            : [];

        const cartLen = cart?.length || 0;
        const cartItems = cart?.length > 0
            ? cart.map(i => `${i.name} x${i.qty} ($${(i.priceUsd || 0).toFixed(2)})`).join(', ')
            : 'vacío';

        let salesCount = 0, totalSalesUsd = 0, totalSalesBs = 0;
        let paymentBreakdown = {};
        let voidedCount = 0;
        let lastSalesDetail = 'Sin ventas registradas hoy';
        try {
            const sales = await storageService.getItem('bodega_sales_v1', []);
            const todayStr = new Date().toISOString().split('T')[0];
            const todaySales = sales
                .filter(s => s.timestamp?.startsWith(todayStr) && s.status !== 'ANULADA')
                .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            const todayVoided = sales.filter(s => s.timestamp?.startsWith(todayStr) && s.status === 'ANULADA');
            salesCount = todaySales.length;
            voidedCount = todayVoided.length;
            totalSalesUsd = todaySales.reduce((acc, s) => acc + (s.totalUsd || 0), 0);
            totalSalesBs = todaySales.reduce((acc, s) => acc + (s.totalBs || 0), 0);

            todaySales.forEach(s => {
                const pmethods = s.payments?.length > 0
                    ? s.payments.map(p => p.methodLabel || p.methodId || 'Sin dato').join(' + ')
                    : (s.paymentMethod || s.metodoPago || 'Sin dato');
                if (!paymentBreakdown[pmethods]) paymentBreakdown[pmethods] = { count: 0, usd: 0 };
                paymentBreakdown[pmethods].count++;
                paymentBreakdown[pmethods].usd += (s.totalUsd || 0);
            });

            const last5 = sales
                .filter(s => s.status !== 'ANULADA')
                .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
                .slice(0, 5);

            if (last5.length > 0) {
                lastSalesDetail = last5.map((s, idx) => {
                    const fDate = s.timestamp ? new Date(s.timestamp).toLocaleString('es-VE') : 'fecha/hora desconocida';
                    const num = s.saleNumber ? `#${String(s.saleNumber).padStart(5, '0')}` : `(sin número)`;
                    const cliente = s.customerName || s.clienteName || 'Consumidor Final';
                    const tipo = s.tipo || 'VENTA';
                    const productos = (s.items || []).map(i => `${i.name} x${i.qty}`).join(', ') || 'sin detalle';
                    const metodo = s.payments?.length > 0
                        ? s.payments.map(p => `${p.methodLabel || p.methodId || '?'} (${p.currency || '?'}): $${(p.amountUsd || 0).toFixed(2)}`).join(' | ')
                        : 'Sin dato';
                    const casheaDesglose = s.tipo === 'VENTA_CASHEA' && s.casheaUsd > 0
                        ? `\n     Inicial pagado por el cliente: $${((s.totalUsd || 0) - (s.casheaUsd || 0)).toFixed(2)} USD | Financiado por Cashea: $${(s.casheaUsd || 0).toFixed(2)} USD`
                        : '';
                    const vuelto = (s.changeUsd > 0 || s.changeBs > 0)
                        ? ` | Vuelto: $${(s.changeUsd || 0).toFixed(2)} USD / Bs.${(s.changeBs || 0).toFixed(2)}`
                        : '';
                    return `  ${idx === 0 ? '➡️ Última' : `  ${idx + 1}º`} Venta ${num} — ${fDate} | ${tipo} | Cliente: ${cliente}\n     Productos: ${productos}\n     Total: $${(s.totalUsd || 0).toFixed(2)} USD / Bs.${(s.totalBs || 0).toFixed(2)}\n     Pago: ${metodo}${casheaDesglose}${vuelto}`;
                }).join('\n');
            }
        } catch (e) {}

        const paymentSummary = Object.entries(paymentBreakdown)
            .map(([pm, v]) => `${pm}: ${v.count} ventas ($${v.usd.toFixed(2)})`)
            .join(' | ') || 'sin datos';

        let customersCount = 0, customersWithDebt = 0, totalDebtUsd = 0;
        let topDebtors = '';
        try {
            const customers = await storageService.getItem('bodega_customers_v1', []);
            customersCount = customers.length;
            const debtors = customers.filter(c => (c.deuda || 0) > 0.01);
            customersWithDebt = debtors.length;
            totalDebtUsd = debtors.reduce((acc, c) => acc + (c.deuda || 0), 0);
            topDebtors = debtors
                .sort((a, b) => (b.deuda || 0) - (a.deuda || 0))
                .slice(0, 3)
                .map(c => `${c.name}: $${(c.deuda || 0).toFixed(2)}`)
                .join(', ');
        } catch (e) {}

        let suppliersCount = 0, pendingInvoices = 0, totalPendingUsd = 0;
        try {
            const suppliers = await storageService.getItem('bodega_suppliers_v1', []);
            const invoices = await storageService.getItem('bodega_supplier_invoices_v1', []);
            suppliersCount = suppliers.length;
            const pending = invoices.filter(inv => inv.status === 'PENDIENTE');
            pendingInvoices = pending.length;
            totalPendingUsd = pending.reduce((acc, inv) => acc + (inv.totalUsd || inv.total || 0), 0);
        } catch (e) {}

        let activePayMethods = [];
        try {
            const methods = await getActivePaymentMethods();
            activePayMethods = methods.map(m => `${m.label} (${m.currency})`);
        } catch (e) { activePayMethods = ['Efectivo Bs', 'Pago Móvil', 'USD']; }

        let usersInfo = 'Solo sesión simple (sin multi-usuario activo)';
        try {
            const usuarios = JSON.parse(localStorage.getItem('bodega_usuarios') || '[]');
            if (usuarios.length > 0) {
                usersInfo = usuarios.map(u => `${u.nombre} (${u.rol})`).join(', ');
            }
        } catch (e) {}

        let aperturaInfo = 'No registrada hoy';
        try {
            const todayKey = new Date().toISOString().split('T')[0];
            const apertura = JSON.parse(localStorage.getItem(`apertura_caja_${todayKey}`) || 'null');
            if (apertura) {
                aperturaInfo = `Fondo inicial: $${(apertura.fondoUsd || 0).toFixed(2)} USD / Bs.${(apertura.fondoBs || 0).toFixed(2)}`;
            }
        } catch (e) {}

        return `
[CONTEXTO EN TIEMPO REAL DEL POS — ${new Date().toLocaleString('es-VE')}]

## NEGOCIO
- Nombre: ${businessName} | RIF: ${businessRif}
- Conexión: ${connection}
- Usuario activo: ${username} (Rol: ${role})

## TASAS DE CAMBIO VIGENTES
- Tasa BCV (USD→Bs): Bs. ${rateBcv.toFixed(2)} por dólar
- Tasa COP: ${rateCop > 0 ? `${rateCop.toFixed(2)} COP por dólar` : 'No configurada'}

## INVENTARIO
- Total productos registrados: ${totalProducts}
- Productos con stock bajo: ${lowStockItems.length} (${outOfStockItems.length} agotados)
- Críticos: ${criticalStock || 'ninguno'}
- Categorías: ${categoriesInUse.join(', ') || 'ninguna'}

## CARRITO ACTUAL
- Productos en carrito: ${cartLen} (${cartItems})

## VENTAS DEL DÍA
- Transacciones: ${salesCount} | Anuladas: ${voidedCount}
- Total: $${totalSalesUsd.toFixed(2)} USD / Bs. ${totalSalesBs.toFixed(2)}
- Método de pago: ${paymentSummary}
- Apertura: ${aperturaInfo}

## ÚLTIMAS 5 VENTAS
${lastSalesDetail}

## CLIENTES
- Total: ${customersCount}
- Con deuda: ${customersWithDebt} ($${totalDebtUsd.toFixed(2)})
- Mayores deudores: ${topDebtors || 'ninguno'}

## PROVEEDORES
- Total: ${suppliersCount}
- Facturas pendientes: ${pendingInvoices} ($${totalPendingUsd.toFixed(2)})

## MÉTODOS DE PAGO
- ${activePayMethods.join(', ')}

## USUARIOS
- ${usersInfo}
`.trim();
    };

    const handleSend = async (textToSend) => {
        const messageText = textToSend || input;
        if (!messageText.trim() || isTyping) return;

        setInput('');
        if (inputRef.current) inputRef.current.style.height = 'auto';

        const newMessages = [...messages, { role: 'user', content: messageText }];
        setMessages(newMessages);
        setIsTyping(true);

        try {
            const contextText = await compilePosContext();
            
            const apiMessages = [
                { role: 'system', content: contextText },
                ...newMessages.map(m => ({ role: m.role, content: m.content }))
            ];

            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: apiMessages })
            });

            if (!response.ok) throw new Error(`Error de servidor (${response.status})`);

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
                        const updated = [...prev];
                        updated[updated.length - 1].content = aiResponse;
                        return updated;
                    });
                }
            }
        } catch (error) {
            setMessages(prev => {
                const updated = [...prev];
                if (updated[updated.length - 1].role === 'assistant' && updated[updated.length - 1].content === "") {
                    updated[updated.length - 1].content = `❌ **Error de conexión**: ${error.message}`;
                } else {
                    updated.push({ role: 'assistant', content: `❌ **Error**: ${error.message}` });
                }
                return updated;
            });
        } finally {
            setIsTyping(false);
        }
    };

    const parseInline = (text) => {
        const parts = text.split(/(\*\*.*?\*\*|\*.*?\*|`.*?`)/g);
        return parts.map((part, index) => {
            if (part.startsWith('**') && part.endsWith('**')) return <strong key={index} className="font-bold text-slate-950 dark:text-white">{part.slice(2, -2)}</strong>;
            if (part.startsWith('*') && part.endsWith('*')) return <em key={index} className="italic font-medium">{part.slice(1, -1)}</em>;
            if (part.startsWith('`') && part.endsWith('`')) return <code key={index} className="bg-slate-200 dark:bg-slate-700/80 px-1.5 py-0.5 rounded text-[11px] font-mono text-emerald-700 dark:text-emerald-300 font-bold">{part.slice(1, -1)}</code>;
            return part;
        });
    };

    const parseMarkdown = (text) => {
        if (!text) return null;
        const lines = text.split('\n');
        const result = [];
        lines.forEach((line, lineIndex) => {
            const isLast = lineIndex === lines.length - 1;
            if (line.startsWith('### ')) {
                result.push(<h4 key={lineIndex} className="text-xs font-black text-slate-950 dark:text-white mt-2 mb-1">{parseInline(line.slice(4))}</h4>);
                return;
            }
            if (line.startsWith('## ')) {
                result.push(<h3 key={lineIndex} className="text-sm font-black text-slate-950 dark:text-white mt-2.5 mb-1">{parseInline(line.slice(3))}</h3>);
                return;
            }
            if (line.startsWith('# ')) {
                result.push(<h2 key={lineIndex} className="text-sm font-black text-emerald-600 dark:text-emerald-400 mt-3 mb-1">{parseInline(line.slice(2))}</h2>);
                return;
            }
            if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
                const content = line.trim().slice(2);
                result.push(<div key={lineIndex} className="flex items-start gap-1.5 ml-1 my-0.5"><span className="text-emerald-600 dark:text-emerald-400 font-bold">•</span><span>{parseInline(content)}</span></div>);
                return;
            }
            if (line.trim() === '') {
                if (!isLast) result.push(<br key={lineIndex} />);
                return;
            }
            result.push(<span key={lineIndex}>{parseInline(line)}</span>);
            if (!isLast) result.push(<br key={`br-${lineIndex}`} />);
        });
        return result;
    };

    const handleClear = () => setIsConfirmOpen(true);

    const confirmClear = () => {
        setMessages([
            {
                role: 'assistant',
                content: 'Conversación reiniciada. ¿En qué puedo ayudarte con el sistema **Precios al Día Bot 2.0**?'
            }
        ]);
        setIsConfirmOpen(false);
    };

    const suggestions = [
        { label: "Vuelto Cambiario", icon: DollarSign, prompt: "¿Cómo me ayuda el POS a calcular el vuelto o cambio?" },
        { label: "Cuadre de Hoy", icon: BarChart3, prompt: "¿Cuánto llevo vendido hoy en total y cuál es el desglose por método de pago?" },
        { label: "Stock Crítico", icon: Package, prompt: "¿Cuáles son los productos con bajo stock o agotados en mi inventario?" },
        { label: "Cuentas por Cobrar", icon: Users, prompt: "¿Cuáles clientes tienen deudas pendientes en el negocio?" },
        { label: "Últimas Ventas", icon: Receipt, prompt: "¿Muestras el detalle completo de las últimas ventas registradas?" }
    ];

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
                                onClick={() => setIsOpen(false)} 
                                className="p-2 text-slate-400 hover:text-slate-700 dark:text-slate-400 dark:hover:text-white rounded-xl hover:bg-slate-200 dark:hover:bg-white/10 transition-all"
                                title="Cerrar asistente"
                            >
                                <X size={16} />
                            </button>
                        </div>
                    </div>

                    {/* Mensajes Chat Stream */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-3.5 custom-scrollbar bg-slate-50/50 dark:bg-slate-900/50">
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
                                    {parseMarkdown(m.content)}
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

                    {/* Sugerencias Rápidas — Carrusel Horizontal High Contrast */}
                    <div className="px-3 py-2 flex items-center gap-1.5 bg-slate-100 dark:bg-slate-850 shrink-0 border-t border-slate-200 dark:border-slate-800 overflow-x-auto no-scrollbar">
                        {suggestions.map((s, idx) => {
                            const IconComponent = s.icon;
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
