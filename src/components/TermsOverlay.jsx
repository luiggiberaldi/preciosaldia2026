import React, { useState, useRef } from 'react';
import { Check, FileText, ChevronDown, Store } from 'lucide-react';
import { useReveal } from '../hooks/useReveal';

export default function TermsOverlay({ onAccept }) {
    const [hasAccepted, setHasAccepted] = useState(
        () => localStorage.getItem('pda_terms_accepted') === 'true'
    );
    const [step, setStep] = useState(1); // 1 = Términos, 2 = Configuración negocio
    const [businessName, setBusinessName] = useState('');
    const [marketingEmail, setMarketingEmail] = useState('');
    const [canAccept, setCanAccept] = useState(false);
    const scrollRef = useRef(null);
    // v1.2.0: reveal-on-scroll para los bloques de sección (stagger automático).
    const revealRef = useReveal();

    const handleScroll = () => {
        const element = scrollRef.current;
        if (!element) return;
        const scrolledToBottom = Math.abs(element.scrollHeight - element.scrollTop - element.clientHeight) < 10;
        if (scrolledToBottom && !canAccept) setCanAccept(true);
    };

    const handleAcceptTerms = () => {
        setStep(2);
    };

    const handleFinish = () => {
        const trimmedName = businessName.trim();
        const trimmedEmail = marketingEmail.trim();
        localStorage.setItem('business_name', trimmedName);
        localStorage.setItem('marketing_email', trimmedEmail);
        localStorage.setItem('pda_terms_accepted', 'true');
        setHasAccepted(true);
        if (onAccept) onAccept();
    };

    if (hasAccepted) return null;

    return (
        // v1.2.0: backdrop warm cream (bg-surface-950/95) con blur.
        <div ref={revealRef} className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-300">
            {/* v1.2.0: tarjeta bg-surface-100, con border warm y shadow-tone-lg. */}
            <div className="reveal w-full max-w-2xl bg-surface-100 dark:bg-surface-100 border border-surface-200 dark:border-surface-700 rounded-[2rem] shadow-tone-lg overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-500">

                {step === 1 ? (
                    <>
                        {/* Header — bg-surface-200 (fondo elevado) */}
                        <div className="px-6 py-5 border-b border-surface-200 dark:border-surface-700 bg-surface-200 dark:bg-surface-200 flex items-center gap-3">
                            <div className="p-2.5 bg-brand rounded-xl shadow-primary-tone">
                                <FileText size={24} className="text-white" strokeWidth={2.5} />
                            </div>
                            <div>
                                {/* v1.2.0: font-display (Instrument Serif) en el título principal del modal */}
                                <h2 className="font-display text-2xl text-surface-700 tracking-tight leading-tight">Términos y Condiciones</h2>
                                <p className="text-xs text-surface-500 dark:text-surface-400 font-medium">Por favor, lee y acepta para continuar</p>
                            </div>
                        </div>

                        {/* Scroll Indicator */}
                        {!canAccept && (
                            <div className="px-6 py-3 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800/40 flex items-center gap-2 animate-pulse">
                                <ChevronDown size={16} className="text-amber-600 dark:text-amber-400" />
                                <p className="text-xs font-bold text-amber-700 dark:text-amber-300">
                                    Desplázate hasta el final para poder aceptar
                                </p>
                            </div>
                        )}

                        {/* Terms Content */}
                        <div
                            ref={scrollRef}
                            onScroll={handleScroll}
                            className="flex-1 overflow-y-auto px-6 py-6 prose prose-sm max-w-none"
                            style={{ scrollbarWidth: 'thin' }}
                        >
                            {/* v1.2.0: cada sección con clase reveal — stagger automático por :nth-child. */}
                            <section className="reveal">
                                <h1 className="font-display text-3xl text-surface-700 mb-4 leading-tight">Términos y Condiciones de Uso — PreciosAlDía</h1>
                                <p className="text-xs text-surface-500 dark:text-surface-400 font-bold mb-6">Última actualización: Febrero 2026</p>
                            </section>

                            <hr className="my-6 border-surface-200 dark:border-surface-700" />

                            <section className="reveal">
                                <h2 className="font-display text-xl text-surface-700 mt-6 mb-3">1. Aceptación de los Términos</h2>
                                <p className="text-sm text-surface-700 leading-relaxed mb-4">
                                    Al acceder y utilizar la aplicación <strong>PreciosAlDía</strong> (en adelante, "la Aplicación"), usted acepta estar sujeto a estos Términos y Condiciones. Si no está de acuerdo con alguna parte de estos términos, no debe utilizar la Aplicación.
                                </p>
                            </section>

                            <section className="reveal">
                                <h2 className="font-display text-xl text-surface-700 mt-6 mb-3">2. Descripción del Servicio</h2>
                                <p className="text-sm text-surface-700 leading-relaxed mb-2">PreciosAlDía es una aplicación web progresiva (PWA) diseñada para la gestión de bodegas y pequeños comercios que proporciona:</p>
                                <ul className="text-sm text-surface-700 space-y-1 mb-4">
                                    <li><strong>Gestión de inventario</strong> con precios en múltiples monedas (USD, Bolívares)</li>
                                    <li><strong>Punto de venta (POS)</strong> con carrito, checkout y recibos</li>
                                    <li><strong>Dashboard de ventas</strong> con reportes y estadísticas</li>
                                    <li><strong>Gestión de clientes</strong> con sistema de fiados y pagos parciales</li>
                                    <li><strong>Inventario compartible</strong> mediante código temporal de 6 dígitos</li>
                                </ul>
                            </section>

                            <section className="reveal">
                                <h2 className="font-display text-xl text-surface-700 mt-6 mb-3">3. Descargo de Responsabilidad</h2>

                                <h3 className="text-base font-bold text-surface-700 mt-4 mb-2">3.1 Información No Vinculante</h3>
                                <p className="text-sm text-surface-700 leading-relaxed mb-4">
                                    <strong className="text-red-600 dark:text-red-400">TODA LA INFORMACIÓN PROPORCIONADA EN LA APLICACIÓN ES ESTRICTAMENTE INFORMATIVA Y DE REFERENCIA.</strong> PreciosAlDía no garantiza la exactitud, integridad, vigencia o fiabilidad de las tasas de cambio, precios o cualquier otra información mostrada.
                                </p>

                                <h3 className="text-base font-bold text-surface-700 mt-4 mb-2">3.2 No Constituye Asesoría Financiera</h3>
                                <p className="text-sm text-surface-700 leading-relaxed mb-4">
                                    La información provista <strong>NO constituye asesoría financiera, legal, tributaria o de inversión</strong>. Usted es responsable de verificar los precios y tasas con fuentes oficiales.
                                </p>

                                <h3 className="text-base font-bold text-surface-700 mt-4 mb-2">3.3 Limitación de Responsabilidad</h3>
                                <p className="text-sm text-surface-700 leading-relaxed mb-2"><strong>PreciosAlDía y sus desarrolladores NO se hacen responsables por:</strong></p>
                                <ul className="text-sm text-surface-700 space-y-1 mb-4">
                                    <li>Pérdidas económicas directas o indirectas derivadas del uso de la información</li>
                                    <li>Errores en el cálculo de precios o conversiones de moneda</li>
                                    <li>Decisiones comerciales tomadas con base en la información de la Aplicación</li>
                                    <li>Pérdida de datos almacenados en el dispositivo</li>
                                </ul>

                                <h3 className="text-base font-bold text-surface-700 mt-4 mb-2">3.4 Uso Bajo Propio Riesgo</h3>
                                <p className="text-sm text-surface-700 leading-relaxed mb-4">
                                    Al usar PreciosAlDía, usted acepta que lo hace <strong>bajo su propio riesgo y responsabilidad</strong>.
                                </p>
                            </section>

                            <section className="reveal">
                                <h2 className="font-display text-xl text-surface-700 mt-6 mb-3">4. Funcionalidades Premium</h2>
                                <p className="text-sm text-surface-700 leading-relaxed mb-2">PreciosAlDía ofrece funciones gratuitas y funciones exclusivas para usuarios con <strong>Licencia Premium</strong>:</p>
                                <ul className="text-sm text-surface-700 space-y-1 mb-2">
                                    <li><strong>Gratuito:</strong> Dashboard básico, hasta 10 productos en inventario.</li>
                                    <li><strong>Premium:</strong> Inventario ilimitado, sistema de ventas POS, gestión de clientes, compartir inventario, reportes completos.</li>
                                </ul>
                                <p className="text-sm text-surface-700 leading-relaxed mb-4">
                                    El acceso Premium se otorga mediante código de activación único vinculado al dispositivo. La licencia es personal, intransferible y no reembolsable. Se ofrece un periodo de demostración de 3 días por dispositivo.
                                </p>
                            </section>

                            <section className="reveal">
                                <h2 className="font-display text-xl text-surface-700 mt-6 mb-3">5. Privacidad y Datos</h2>
                                <p className="text-sm text-surface-700 leading-relaxed mb-4">
                                    PreciosAlDía opera con principios de <strong>privacidad por diseño</strong>. Los datos se almacenan localmente en su dispositivo y <strong>NO se venden ni comparten con terceros</strong>.
                                </p>
                            </section>

                            <section className="reveal">
                                <h2 className="font-display text-xl text-surface-700 mt-6 mb-3">6. Legislación Aplicable</h2>
                                <p className="text-sm text-surface-700 leading-relaxed mb-4">
                                    Estos Términos se rigen por las leyes de la <strong>República Bolivariana de Venezuela</strong>.
                                </p>
                            </section>

                            <section className="reveal">
                                <h2 className="font-display text-xl text-surface-700 mt-6 mb-3">7. Código de Conducta</h2>
                                <p className="text-sm text-surface-700 leading-relaxed mb-2">Al utilizar PreciosAlDía, usted se compromete a:</p>
                                <ul className="text-sm text-surface-700 space-y-1 mb-4">
                                    <li><strong>NO</strong> utilizar la Aplicación para actividades ilícitas</li>
                                    <li><strong>NO</strong> intentar vulnerar la seguridad del sistema</li>
                                    <li><strong>NO</strong> realizar ingeniería inversa del código</li>
                                    <li><strong>NO</strong> distribuir licencias Premium de forma no autorizada</li>
                                </ul>
                            </section>

                            <hr className="my-6 border-surface-200 dark:border-surface-700" />

                            {/* v1.2.0: bloque de aceptación final con accent (naranja/óxido) — destaca el compromiso. */}
                            <section className="reveal">
                                <div className="bg-accent-50 dark:bg-accent-900/20 border-l-4 border-accent-500 p-4 rounded-r-xl mb-6">
                                    <h3 className="font-display text-lg text-surface-700 mb-2">Aceptación Final</h3>
                                    <p className="text-sm text-surface-700 leading-relaxed">
                                        <strong>AL USAR PRECIOSALDÍA, USTED DECLARA HABER LEÍDO, ENTENDIDO Y ACEPTADO ESTOS TÉRMINOS Y CONDICIONES EN SU TOTALIDAD.</strong>
                                    </p>
                                </div>
                            </section>

                            <p className="reveal text-center text-sm font-bold text-surface-700 mt-8 mb-4">
                                PreciosAlDía — Tu Bodega Inteligente 🇻🇪
                            </p>
                            <p className="reveal text-center text-xs text-surface-500 dark:text-surface-400 mb-8">
                                Gestión de inventario y ventas para el comerciante venezolano
                            </p>

                            <div id="terms-end" className="h-1"></div>
                        </div>

                        {/* Footer with Accept Button — bg-surface-200 */}
                        <div className="px-6 py-4 border-t border-surface-200 dark:border-surface-700 bg-surface-200 dark:bg-surface-200">
                            {/* v1.2.0: botón aceptar con bg-brand (cian) — design system .btn-primary tone. */}
                            <button
                                onClick={handleAcceptTerms}
                                disabled={!canAccept}
                                className={`btn w-full ${canAccept ? 'btn-primary' : 'bg-surface-300 dark:bg-surface-700 text-surface-500 dark:text-surface-400 cursor-not-allowed'} shadow-tone-md`}
                            >
                                <Check size={20} strokeWidth={2.5} />
                                <span>{canAccept ? 'Acepto los Términos y Condiciones' : 'Lee hasta el final para aceptar'}</span>
                            </button>
                        </div>
                    </>
                ) : (
                    <>
                        {/* Header Paso 2 */}
                        <div className="px-6 py-5 border-b border-surface-200 dark:border-surface-700 bg-surface-200 dark:bg-surface-200 flex items-center gap-3">
                            <div className="p-2.5 bg-brand rounded-xl shadow-primary-tone">
                                <Store size={24} className="text-white" strokeWidth={2.5} />
                            </div>
                            <div>
                                <h2 className="font-display text-2xl text-surface-700 tracking-tight leading-tight">Configuración del Negocio</h2>
                                <p className="text-xs text-surface-500 dark:text-surface-400 font-medium">Personaliza tu punto de venta</p>
                            </div>
                        </div>

                        {/* Cuerpo Paso 2 */}
                        <div className="flex-1 overflow-y-auto px-8 py-8 space-y-6">
                            <div className="text-center max-w-md mx-auto mb-4">
                                <h3 className="font-display text-3xl text-surface-700 tracking-tight mb-2">¡Bienvenido a Precios al Día!</h3>
                                <p className="text-xs text-surface-500 dark:text-surface-400 font-medium leading-relaxed">
                                    Para comenzar a gestionar tu negocio, por favor ingresa los siguientes datos. El correo electrónico nos ayudará a mantenerte al tanto de actualizaciones y promociones exclusivas.
                                </p>
                            </div>

                            <div className="space-y-4 max-w-md mx-auto">
                                <div className="space-y-1.5">
                                    <label className="text-[10px] uppercase font-bold text-surface-500 block">
                                        Nombre de tu Emprendimiento *
                                    </label>
                                    <input
                                        type="text"
                                        placeholder="Ej: Bodega Don José, Inversiones Rojas"
                                        value={businessName}
                                        onChange={e => setBusinessName(e.target.value)}
                                        className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand/30 transition-all font-medium"
                                        autoFocus
                                    />
                                </div>

                                <div className="space-y-1.5">
                                    <label className="text-[10px] uppercase font-bold text-surface-500 block">
                                        Correo Electrónico (Opcional)
                                    </label>
                                    <input
                                        type="email"
                                        placeholder="Ej: contacto@minegocio.com"
                                        value={marketingEmail}
                                        onChange={e => setMarketingEmail(e.target.value)}
                                        className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand/30 transition-all font-medium"
                                    />
                                    <p className="text-[10px] text-surface-400 font-medium leading-tight">
                                        Este correo será registrado para el envío de novedades e información de marketing relevante para tu negocio.
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Footer Paso 2 */}
                        <div className="px-6 py-4 border-t border-surface-200 dark:border-surface-700 bg-surface-200 dark:bg-surface-200">
                            <button
                                onClick={handleFinish}
                                disabled={!businessName.trim()}
                                className={`btn w-full ${businessName.trim() ? 'btn-primary' : 'bg-surface-300 dark:bg-surface-700 text-surface-500 dark:text-surface-400 cursor-not-allowed'} shadow-tone-md`}
                            >
                                <Check size={20} strokeWidth={2.5} />
                                <span>Finalizar Registro</span>
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
