import { useState, useEffect } from 'react';
// v1.2.0: useReveal hook para animaciones reveal-on-scroll (design system "Precios al Día")
import { useReveal } from '../hooks/useReveal';
import { Users, Plus, Search, User, X, Trash2, Pencil, Phone, RefreshCw, Save, ArrowDownRight, ArrowUpRight, Clock, CheckCircle2, CreditCard, ShoppingBag, Truck, Smartphone } from 'lucide-react';
import { storageService } from '../utils/storageService';
import { showToast } from '../components/Toast';
import { formatBs, formatUsd, formatCop } from '../utils/calculatorUtils';
import { procesarImpactoCliente } from '../utils/financialLogic';
import TransactionModal from '../components/Customers/TransactionModal';
import { processCustomerTransaction } from '../utils/customerTransactionProcessor';
import { DEFAULT_PAYMENT_METHODS } from '../config/paymentMethods';
import ConfirmModal from '../components/ConfirmModal';
import EmptyState from '../components/EmptyState';
import SwipeableItem from '../components/SwipeableItem';
import { useProductContext } from '../context/ProductContext';
import { useAudit } from '../hooks/useAudit';
import { useAuthStore } from '../hooks/store/useAuthStore';
import { useSupplierManagement } from '../hooks/useSupplierManagement';
import { usePagination } from '../hooks/usePagination';
import PaginationBar from '../components/PaginationBar';
import CasheaIcon from '../components/CasheaIcon';

// Importaciones de Proveedores
import SuppliersList from '../components/Suppliers/SuppliersList';
import { AddSupplierModal, AddInvoiceModal, PayInvoiceModal, SupplierDetailsSheet } from '../components/Suppliers/SupplierModals';
import { getActivePaymentMethods } from '../config/paymentMethods';

export default function CustomersView({ triggerHaptic, rates, isActive }) {
    // v1.2.0: reveal-on-scroll para header, filtros y lista de tarjetas.
    const revealRef = useReveal();
    const [customers, setCustomers] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterType, setFilterType] = useState('all'); // 'all' | 'deuda' | 'favor'
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);

    const usuarioActivo = useAuthStore(state => state.usuarioActivo);
    const isAdmin = !usuarioActivo || usuarioActivo.rol === 'ADMIN';
    const isCajero = usuarioActivo?.rol === 'CAJERO';

    // Modal de Abono / Crédito
    const [transactionModal, setTransactionModal] = useState({ isOpen: false, type: null, customer: null }); // type: 'ABONO' | 'CREDITO'
    const [transactionAmount, setTransactionAmount] = useState('');
    const [currencyMode, setCurrencyMode] = useState('BS'); // 'BS' | 'USD'
    const [paymentMethod, setPaymentMethod] = useState('efectivo_bs');
    const [activePaymentMethods, setActivePaymentMethods] = useState([]);
    const [resetBalanceCustomer, setResetBalanceCustomer] = useState(null);
    const { effectiveRate: bcvRate, tasaCop, copEnabled, copPrimary } = useProductContext();
    const { log: auditLog } = useAudit();
    const [expandedHistory, setExpandedHistory] = useState(null);
    const [historyData, setHistoryData] = useState([]);
    // Modales de Clientes
    const [selectedCustomer, setSelectedCustomer] = useState(null);
    const [editingCustomer, setEditingCustomer] = useState(null);
    const [deleteCustomerTarget, setDeleteCustomerTarget] = useState(null);

    // Guard: evita eliminar clientes con deuda o saldo a favor pendiente
    const handleDeleteCustomerRequest = (customer) => {
        const deuda = customer.deuda || 0;
        const saldo = customer.saldoFavor || 0;
        if (deuda > 0.005) {
            showToast(`No se puede eliminar: ${customer.name} tiene una deuda de $${deuda.toFixed(2)} pendiente.`, 'error');
            return;
        }
        if (saldo > 0.005) {
            showToast(`No se puede eliminar: ${customer.name} tiene un saldo a favor de $${saldo.toFixed(2)}.`, 'error');
            return;
        }
        setDeleteCustomerTarget(customer);
    };

    // ── ESTADOS DE PROVEEDORES ──
    const [activeTab, setActiveTab] = useState('clientes'); // 'clientes' | 'proveedores'

    // Cajero no puede ver proveedores — forzar a clientes si accedió antes
    useEffect(() => {
        if (isCajero && activeTab === 'proveedores') setActiveTab('clientes');
    }, [isCajero, activeTab]);

    const {
        suppliers, invoices, selectedSupplier,
        isAddSupplierModalOpen, editingSupplier,
        isAddInvoiceModalOpen, isPayInvoiceModalOpen,
        deleteSupplierTarget, supplierHistoryData,
        setSelectedSupplier, setIsAddSupplierModalOpen, setEditingSupplier,
        setIsAddInvoiceModalOpen, setIsPayInvoiceModalOpen, setDeleteSupplierTarget,
        handleSaveSupplier, refreshSupplierHistory, handleSelectSupplier,
        handleAddInvoice, handlePayInvoice, handleDeleteSupplier, hydrateSuppliers,
    } = useSupplierManagement({ bcvRate, tasaCop, copEnabled, triggerHaptic, auditLog });

    const loadData = async () => {
        const [savedCustomers, savedSuppliers, savedInvoices, savedMethods] = await Promise.all([
            storageService.getItem('bodega_customers_v1', []),
            storageService.getItem('bodega_suppliers_v1', []),
            storageService.getItem('bodega_supplier_invoices_v1', []),
            getActivePaymentMethods()
        ]);
        setCustomers(savedCustomers);
        hydrateSuppliers(savedSuppliers, savedInvoices);
        setActivePaymentMethods(savedMethods);
    };

    useEffect(() => {
        loadData();
    }, []);

    // Re-sincronizar cuando el usuario navega a esta tab para reflejar cambios
    // realizados por otras vistas (e.g. ventas fiadas, abonos desde el ticket)
    useEffect(() => {
        if (isActive) loadData();
    }, [isActive]);

    const saveCustomers = async (updatedCustomers) => {
        setCustomers(updatedCustomers);
        await storageService.setItem('bodega_customers_v1', updatedCustomers);
    };

    const filteredCustomers = customers.filter(c => {
        const matchesSearch = c.name.toLowerCase().includes(searchTerm.toLowerCase()) || (c.phone && c.phone.includes(searchTerm));
        if (!matchesSearch) return false;
        if (filterType === 'deuda') return c.deuda > 0.01;
        if (filterType === 'favor') return c.deuda < -0.01;
        return true;
    });

    const {
        currentPage,
        totalPages,
        paginatedItems: paginatedCustomers,
        goNext,
        goPrev,
        resetPage,
        hasNext,
        hasPrev,
        startIndex,
        endIndex,
        totalItems,
    } = usePagination(filteredCustomers, 10);

    useEffect(() => {
        resetPage();
    }, [searchTerm, filterType]);

    const toggleHistory = async (customerId) => {
        triggerHaptic && triggerHaptic();
        setExpandedHistory(customerId);
        const allSales = await storageService.getItem('bodega_sales_v1', []);
        const customerSales = allSales
            .filter(s => s.customerId === customerId || s.clienteId === customerId)
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
            .slice(0, 20);
        setHistoryData(customerSales);
    };

    const handleResetBalance = async (customer) => {
        triggerHaptic();
        setResetBalanceCustomer(customer);
    };

    const confirmResetBalance = async () => {
        const customer = resetBalanceCustomer;
        if (!customer) return;

        const updatedCustomer = { ...customer, deuda: 0, favor: 0, casheaDeuda: 0 };
        const newCustomers = customers.map(c => c.id === customer.id ? updatedCustomer : c);
        await saveCustomers(newCustomers);
        showToast(`Saldo reiniciado a cero para ${customer.name}`, 'success');
        auditLog('CLIENTE', 'DEUDA_CONDONADA', `Saldo reiniciado a $0 para ${customer.name}`);
        setResetBalanceCustomer(null);
    };

    const handleSaldarCashea = async (customer) => {
        triggerHaptic();
        if (!customer || (customer.casheaDeuda || 0) <= 0) return;
        const updatedCustomer = { ...customer, casheaDeuda: 0 };
        const newCustomers = customers.map(c => c.id === customer.id ? updatedCustomer : c);
        await saveCustomers(newCustomers);
        showToast(`Deuda de Cashea saldada para ${customer.name}`, 'success');
        auditLog('CLIENTE', 'SALDAR_CASHEA', `Deuda Cashea saldada para ${customer.name}`);
    };

    const handleTransaction = async () => {
        if (!transactionAmount || isNaN(transactionAmount) || parseFloat(transactionAmount) <= 0) return;
        triggerHaptic();

        const { newCustomers } = await processCustomerTransaction({
            transactionAmount,
            currencyMode,
            type: transactionModal.type,
            customer: transactionModal.customer,
            paymentMethod,
            bcvRate,
            tasaCop,
            copEnabled
        });

        await saveCustomers(newCustomers);
        showToast(`Operación de ${transactionModal.type} exitosa`, 'success');
        auditLog('CLIENTE', transactionModal.type === 'ABONO' ? 'ABONO_REGISTRADO' : 'CREDITO_REGISTRADO', `${transactionModal.type} de ${transactionAmount} ${currencyMode} para ${transactionModal.customer?.name}`);

        // Cerrar modal
        setTransactionModal({ isOpen: false, type: null, customer: null });
        setTransactionAmount('');
        setCurrencyMode('BS');
        setPaymentMethod('efectivo_bs');
    };

    if (activeTab === 'proveedores') {
        return (
            // v1.2.0: revealRef reutilizado + surface tokens (warm cream).
            <div ref={revealRef} className="flex flex-col h-full bg-surface-50 dark:bg-surface-950 overflow-hidden relative">
                {/* Segmented Control Premium */}
                <div className="px-3 sm:px-6 pt-3 sm:pt-6 shrink-0 z-10 bg-surface-50/80 dark:bg-surface-950/80 backdrop-blur-xl">
                    <div className="flex bg-surface-200/50 dark:bg-surface-800/80 p-1.5 rounded-2xl shadow-inner">
                        <button
                            onClick={() => { setActiveTab('clientes'); triggerHaptic && triggerHaptic(); }}
                            className={`flex flex-1 items-center justify-center gap-2 py-2.5 min-h-[40px] text-sm font-bold rounded-xl transition-all duration-300 ${activeTab === 'clientes' ? 'bg-surface dark:bg-surface-900 shadow-tone-sm text-brand-dark dark:text-brand scale-100' : 'text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 scale-95 hover:scale-100'}`}
                        >
                            <Users size={18} aria-hidden="true" /> Clientes
                        </button>
                        {!isCajero && (
                            <button
                                onClick={() => { setActiveTab('proveedores'); triggerHaptic && triggerHaptic(); }}
                                className={`flex flex-1 items-center justify-center gap-2 py-2.5 min-h-[40px] text-sm font-bold rounded-xl transition-all duration-300 ${activeTab === 'proveedores' ? 'bg-surface dark:bg-surface-900 shadow-tone-sm text-brand dark:text-brand scale-100 ring-1 ring-surface-900/5 dark:ring-white/10' : 'text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 scale-95 hover:scale-100'}`}
                            >
                                <Truck size={18} aria-hidden="true" /> Proveedores
                            </button>
                        )}
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto scrollbar-hide">
                    <SuppliersList
                        suppliers={suppliers}
                        bcvRate={bcvRate}
                        tasaCop={tasaCop}
                        copEnabled={copEnabled}
                        copPrimary={copPrimary}
                        triggerHaptic={triggerHaptic}
                        isAdmin={isAdmin}
                        onAddSupplier={() => setIsAddSupplierModalOpen(true)}
                        onSelectSupplier={handleSelectSupplier}
                        onDeleteSupplier={(s) => setDeleteSupplierTarget(s)}
                    />
                </div>

                {isAddSupplierModalOpen && (
                    <AddSupplierModal 
                        editingSupplier={editingSupplier}
                        onClose={() => { setIsAddSupplierModalOpen(false); setEditingSupplier(null); }} 
                        onSave={handleSaveSupplier} 
                    />
                )}
                {isAddInvoiceModalOpen && selectedSupplier && (
                    <AddInvoiceModal 
                        supplier={selectedSupplier}
                        bcvRate={bcvRate}
                        onClose={() => setIsAddInvoiceModalOpen(false)}
                        onSave={handleAddInvoice}
                    />
                )}
                {isPayInvoiceModalOpen && selectedSupplier && (
                    <PayInvoiceModal
                        supplier={selectedSupplier}
                        bcvRate={bcvRate}
                        tasaCop={tasaCop}
                        copEnabled={copEnabled}
                        copPrimary={copPrimary}
                        activePaymentMethods={activePaymentMethods}
                        onClose={() => setIsPayInvoiceModalOpen(false)}
                        onSave={handlePayInvoice}
                    />
                )}
                <SupplierDetailsSheet
                    supplier={selectedSupplier}
                    isOpen={!!selectedSupplier}
                    isAdmin={isAdmin}
                    bcvRate={bcvRate}
                    tasaCop={tasaCop}
                    copEnabled={copEnabled}
                    copPrimary={copPrimary}
                    historyData={supplierHistoryData}
                    onClose={() => setSelectedSupplier(null)}
                    onAddInvoice={() => setIsAddInvoiceModalOpen(true)}
                    onPayInvoice={() => setIsPayInvoiceModalOpen(true)}
                    onEdit={() => { setEditingSupplier(selectedSupplier); setIsAddSupplierModalOpen(true); }}
                    onDelete={() => setDeleteSupplierTarget(selectedSupplier)}
                />
                <ConfirmModal
                    isOpen={!!deleteSupplierTarget}
                    onClose={() => setDeleteSupplierTarget(null)}
                    onConfirm={handleDeleteSupplier}
                    title="Eliminar Proveedor"
                    message={deleteSupplierTarget ? `¿Eliminar a ${deleteSupplierTarget.name}? Esta acción no se puede deshacer.` : ''}
                    confirmText="Sí, eliminar"
                    variant="danger"
                />
            </div>
        );
    }

    return (
        // v1.2.0: revealRef + surface tokens (warm cream).
        <div ref={revealRef} className="flex flex-col h-full bg-surface-50 dark:bg-surface-950 overflow-hidden relative">
            {/* Segmented Control Premium */}
            <div className="px-3 sm:px-6 pt-3 sm:pt-6 shrink-0 z-10 bg-surface-50/80 dark:bg-surface-950/80 backdrop-blur-xl">
                <div className="flex bg-surface-200/50 dark:bg-surface-800/80 p-1.5 rounded-2xl shadow-inner">
                    <button
                        onClick={() => { setActiveTab('clientes'); triggerHaptic && triggerHaptic(); }}
                        className={`flex flex-1 items-center justify-center gap-2 py-2.5 min-h-[40px] text-sm font-bold rounded-xl transition-all duration-300 ${activeTab === 'clientes' ? 'bg-surface dark:bg-surface-900 shadow-tone-sm text-brand-dark dark:text-brand scale-100 ring-1 ring-surface-900/5 dark:ring-white/10' : 'text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 scale-95 hover:scale-100'}`}
                    >
                        <Users size={18} aria-hidden="true" /> Clientes
                    </button>
                    {!isCajero && (
                        <button
                            onClick={() => { setActiveTab('proveedores'); triggerHaptic && triggerHaptic(); }}
                            className={`flex flex-1 items-center justify-center gap-2 py-2.5 min-h-[40px] text-sm font-bold rounded-xl transition-all duration-300 ${activeTab === 'proveedores' ? 'bg-surface dark:bg-surface-900 shadow-tone-sm text-brand dark:text-brand scale-100' : 'text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 scale-95 hover:scale-100'}`}
                        >
                            <Truck size={18} aria-hidden="true" /> Proveedores
                        </button>
                    )}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-hide p-3 sm:p-6 pb-20">
                {/* Header Clientes */}
            <div className="reveal shrink-0 mb-5 flex justify-between items-start">
                <div>
                    {/* v1.2.0: text-surface-700 en vez de slate-700 (warm tone) */}
                    <h2 className="text-2xl font-black text-surface-700 dark:text-white tracking-tight flex items-center gap-2">
                        <Users size={26} className="text-brand" aria-hidden="true" /> Contactos
                    </h2>
                    <p className="text-sm text-surface-400 font-medium ml-1">
                        Deudas y Saldos a Favor
                    </p>
                </div>
                {/* v1.2.0: touch target ≥ 48px + shadow-primary-tone */}
                <button
                    onClick={() => { triggerHaptic(); setIsAddModalOpen(true); }}
                    className="p-3 min-h-[48px] bg-brand text-white rounded-2xl shadow-primary-tone hover:scale-105 active:scale-95 transition-all flex items-center gap-2"
                >
                    <Plus size={20} className="shrink-0" aria-hidden="true" />
                    <span className="text-sm font-bold hidden sm:inline">Nuevo Contacto</span>
                </button>
            </div>

            {/* Búsqueda y Filtros */}
            <div className="reveal mb-5 shrink-0 flex flex-col gap-3">
                <div className="relative">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-surface-400" size={20} aria-hidden="true" />
                    <input
                        type="text"
                        placeholder="Buscar cliente..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="input w-full bg-surface dark:bg-surface-900 border border-surface-200 dark:border-surface-800 rounded-2xl pl-11 pr-4 text-surface-700 dark:text-white placeholder:text-surface-400 focus:ring-2 focus:ring-brand/50 shadow-tone-sm"
                    />
                </div>
                {/* Filtros tipo Chips */}
                {/* v1.2.0: chips con min-h-[40px] (a11y) + surface tokens + .badge classes opcional. */}
                <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide pb-1">
                    <button
                        onClick={() => { setFilterType('all'); triggerHaptic && triggerHaptic(); }}
                        className={`px-4 py-2 min-h-[40px] rounded-full text-sm font-bold whitespace-nowrap transition-colors ${filterType === 'all' ? 'bg-brand text-white shadow-primary-tone' : 'bg-surface dark:bg-surface-900 text-surface-600 dark:text-surface-400 border border-surface-200 dark:border-surface-800'}`}
                    >
                        Todos
                    </button>
                    <button
                        onClick={() => { setFilterType('deuda'); triggerHaptic && triggerHaptic(); }}
                        className={`px-4 py-2 min-h-[40px] rounded-full text-sm font-bold whitespace-nowrap transition-colors flex items-center gap-1.5 ${filterType === 'deuda' ? 'bg-red-500 text-white shadow-tone-sm' : 'bg-surface dark:bg-surface-900 text-surface-600 dark:text-surface-400 border border-surface-200 dark:border-surface-800'}`}
                    >
                        <div className={`w-2 h-2 rounded-full ${filterType === 'deuda' ? 'bg-white' : 'bg-red-500'}`}></div>
                        Con Deuda
                    </button>
                    <button
                        onClick={() => { setFilterType('favor'); triggerHaptic && triggerHaptic(); }}
                        className={`px-4 py-2 min-h-[40px] rounded-full text-sm font-bold whitespace-nowrap transition-colors flex items-center gap-1.5 ${filterType === 'favor' ? 'bg-emerald-500 text-white shadow-tone-sm' : 'bg-surface dark:bg-surface-900 text-surface-600 dark:text-surface-400 border border-surface-200 dark:border-surface-800'}`}
                    >
                        <div className={`w-2 h-2 rounded-full ${filterType === 'favor' ? 'bg-white' : 'bg-emerald-500'}`}></div>
                        Saldo a Favor
                    </button>
                </div>
            </div>

            {/* Listado de Clientes */}
            <div className="flex-1 space-y-3 pb-20">
                {customers.length === 0 ? (
                    <EmptyState
                        icon={Users}
                        title="Sin Clientes"
                        description="Registra a tus clientes habituales para llevar un control de sus fiados y saldos a favor."
                        actionLabel="NUEVO CLIENTE"
                        onAction={() => { triggerHaptic && triggerHaptic(); setIsAddModalOpen(true); }}
                    />
                ) : filteredCustomers.length === 0 ? (
                    <EmptyState
                        icon={Search}
                        title="Sin resultados"
                        description={`No encontramos ningún cliente con el término "${searchTerm}".`}
                        secondaryActionLabel="Limpiar Búsqueda"
                        onSecondaryAction={() => { setSearchTerm(''); triggerHaptic && triggerHaptic(); }}
                    />
                ) : (
                    <>
                        {paginatedCustomers.map(customer => (
                            <SwipeableItem
                                key={customer.id}
                                onDelete={isAdmin ? () => handleDeleteCustomerRequest(customer) : undefined}
                                triggerHaptic={triggerHaptic}
                            >
                                <CustomerCard
                                    customer={customer}
                                    bcvRate={bcvRate}
                                    tasaCop={tasaCop}
                                    copEnabled={copEnabled}
                                    copPrimary={copPrimary}
                                    onClick={() => {
                                        setSelectedCustomer(customer);
                                        toggleHistory(customer.id);
                                    }}
                                    onDelete={isAdmin ? () => handleDeleteCustomerRequest(customer) : undefined}
                                />
                            </SwipeableItem>
                        ))}
                        <PaginationBar
                            currentPage={currentPage}
                            totalPages={totalPages}
                            totalItems={totalItems}
                            startIndex={startIndex}
                            endIndex={endIndex}
                            onNext={goNext}
                            onPrev={goPrev}
                            hasNext={hasNext}
                            hasPrev={hasPrev}
                            label="clientes"
                        />
                    </>
                )}
            </div>
        </div>

            {/* Modal para Agregar Cliente */}
            {
                isAddModalOpen && (
                    <AddCustomerModal
                        onClose={() => setIsAddModalOpen(false)}
                        onSave={async (newC) => {
                            const nextCodeNum = customers.reduce((mx, c) => {
                                const numPart = parseInt(c.code?.replace('CLI-', ''), 10);
                                return isNaN(numPart) ? mx : Math.max(mx, numPart);
                            }, 0) + 1;
                            const code = `CLI-${String(nextCodeNum).padStart(5, '0')}`;
                            const clientWithCode = { ...newC, code };
                            const updated = [...customers, clientWithCode];
                            await saveCustomers(updated);
                            auditLog('CLIENTE', 'CLIENTE_CREADO', `Cliente "${newC.name}" creado con código ${code}`);
                            setIsAddModalOpen(false);
                        }}
                    />
                )
            }

            {/* Modal Unificado: Ajustar Cuenta */}
            <TransactionModal
                transactionModal={transactionModal}
                setTransactionModal={setTransactionModal}
                transactionAmount={transactionAmount}
                setTransactionAmount={setTransactionAmount}
                currencyMode={currencyMode}
                setCurrencyMode={setCurrencyMode}
                paymentMethod={paymentMethod}
                setPaymentMethod={setPaymentMethod}
                activePaymentMethods={activePaymentMethods}
                bcvRate={bcvRate}
                tasaCop={tasaCop}
                copEnabled={copEnabled}
                copPrimary={copPrimary}
                handleTransaction={handleTransaction}
            />

            {/* Customer Detail Bottom Sheet */}
            <CustomerDetailSheet
                customer={selectedCustomer}
                isOpen={!!selectedCustomer}
                isAdmin={isAdmin}
                onClose={() => {
                    setSelectedCustomer(null);
                    setExpandedHistory(null);
                    setHistoryData([]);
                }}
                onAjustar={() => {
                    setTransactionModal({ isOpen: true, type: 'ABONO', customer: selectedCustomer });
                    setSelectedCustomer(null);
                }}
                onReset={() => {
                    handleResetBalance(selectedCustomer);
                    setSelectedCustomer(null);
                }}
                onSaldarCashea={(c) => {
                    handleSaldarCashea(c);
                    setSelectedCustomer(null);
                }}
                onEdit={() => {
                    setEditingCustomer(selectedCustomer);
                    setSelectedCustomer(null);
                }}
                onDelete={() => {
                    const deuda = selectedCustomer?.deuda || 0;
                    const saldo = selectedCustomer?.saldoFavor || 0;
                    const casheaDeuda = selectedCustomer?.casheaDeuda || 0;
                    if (deuda > 0.005) {
                        showToast(`No se puede eliminar: ${selectedCustomer.name} tiene una deuda de $${deuda.toFixed(2)} pendiente.`, 'error');
                        return;
                    }
                    if (saldo > 0.005) {
                        showToast(`No se puede eliminar: ${selectedCustomer.name} tiene un saldo a favor de $${saldo.toFixed(2)}.`, 'error');
                        return;
                    }
                    if (casheaDeuda > 0.005) {
                        showToast(`No se puede eliminar: ${selectedCustomer.name} tiene una deuda Cashea de $${casheaDeuda.toFixed(2)} pendiente.`, 'error');
                        return;
                    }
                    setDeleteCustomerTarget(selectedCustomer);
                    setSelectedCustomer(null);
                }}
                bcvRate={bcvRate}
                tasaCop={tasaCop}
                copEnabled={copEnabled}
                copPrimary={copPrimary}
                sales={historyData}
            />

            {/* Modal Confirmación: Reiniciar Saldo */}
            <ConfirmModal
                isOpen={!!resetBalanceCustomer}
                onClose={() => setResetBalanceCustomer(null)}
                onConfirm={confirmResetBalance}
                title="Reiniciar saldo del cliente"
                message={resetBalanceCustomer ? `¿Estás seguro de reiniciar la deuda y saldo a favor a $0.00 para ${resetBalanceCustomer.name}?\n\nEsta acción es permanente y no se puede deshacer.` : ''}
                confirmText="Sí, reiniciar"
                variant="danger"
            />

            {/* Modal Confirmación: Eliminar Cliente */}
            <ConfirmModal
                isOpen={!!deleteCustomerTarget}
                onClose={() => setDeleteCustomerTarget(null)}
                onConfirm={async () => {
                    const updated = customers.filter(c => c.id !== deleteCustomerTarget.id);
                    await saveCustomers(updated);
                    showToast(`Cliente ${deleteCustomerTarget.name} eliminado`, 'success');
                    auditLog('CLIENTE', 'CLIENTE_ELIMINADO', `Cliente "${deleteCustomerTarget.name}" eliminado`);
                    setDeleteCustomerTarget(null);
                }}
                title="Eliminar cliente"
                message={deleteCustomerTarget ? `¿Eliminar a ${deleteCustomerTarget.name}? Esta acción no se puede deshacer.` : ''}
                confirmText="Sí, eliminar"
                variant="danger"
            />

            {/* Modal Editar Cliente */}
            {editingCustomer && (
                <EditCustomerModal
                    customer={editingCustomer}
                    onClose={() => setEditingCustomer(null)}
                    onSave={async (updated) => {
                        const newCustomers = customers.map(c => c.id === updated.id ? updated : c);
                        await saveCustomers(newCustomers);
                        setEditingCustomer(null);
                        showToast('Cliente actualizado', 'success');
                    }}
                />
            )}
        </div >
    );
}

// ─── Sub-componente: Tarjeta Compacta ───────────────────────
function CustomerCard({ customer, bcvRate, tasaCop, copEnabled, copPrimary, onClick, onDelete }) {
    return (
        // v1.2.0: surface tokens + shadow-tone-sm (warm shadow) en vez de shadow-sm.
        <article className="reveal bg-white dark:bg-surface-900 rounded-2xl px-4 py-3 border border-slate-200 dark:border-slate-700 shadow-sm transition-all active:scale-[0.98] flex items-center gap-2 relative">
            <div
                onClick={onClick}
                className="flex-1 min-w-0 flex items-center gap-3 cursor-pointer"
            >
                <div className="w-11 h-11 rounded-full bg-brand-light dark:bg-slate-700 flex items-center justify-center shrink-0">
                    <span className="text-lg font-black text-brand-dark dark:text-white">
                        {customer.name.charAt(0).toUpperCase()}
                    </span>
                </div>
                <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-slate-800 dark:text-white text-sm truncate capitalize">
                        {customer.name}
                    </h3>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1">
                        {customer.code && (
                            <span className="font-mono text-[9px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500 bg-slate-50 dark:bg-slate-800/40 border border-slate-200/55 dark:border-slate-800/50 px-1.5 py-0.5 rounded-md leading-none shrink-0">
                                {customer.code}
                            </span>
                        )}
                        {customer.documentId && (
                            <span className="font-mono text-[9px] font-black text-cyan-600 dark:text-cyan-400 bg-cyan-50 dark:bg-cyan-950/20 border border-cyan-100 dark:border-cyan-900/30 px-1.5 py-0.5 rounded-md leading-none shrink-0">
                                C.I: {customer.documentId}
                            </span>
                        )}
                        {customer.phone && (
                            <span className="text-[9px] font-bold text-slate-500 dark:text-slate-300 flex items-center gap-0.5 bg-slate-50 dark:bg-slate-800/40 border border-slate-200/55 dark:border-slate-800/50 px-1.5 py-0.5 rounded-md leading-none shrink-0">
                                <Phone size={9} aria-hidden="true" /> {customer.phone}
                            </span>
                        )}
                    </div>
                </div>
                <div className="text-right shrink-0">
                    {customer.deuda > 0 || customer.casheaDeuda > 0 ? (
                        <>
                            {customer.deuda > 0 && (
                                <>
                                    <p className={`text-sm font-black ${copEnabled && copPrimary ? 'text-amber-600 dark:text-amber-400' : 'text-red-500'} leading-tight`}>
                                        {copEnabled && copPrimary && tasaCop > 0
                                            ? `-${formatCop(customer.deuda * tasaCop)} COP`
                                            : `-$${formatUsd(customer.deuda)}`}
                                    </p>
                                    {copEnabled && copPrimary && <p className="text-[10px] font-bold text-red-600 dark:text-red-400">-${formatUsd(customer.deuda)}</p>}
                                    {bcvRate > 0 && <p className="text-[10px] font-bold text-red-600 dark:text-red-400">-{formatBs(customer.deuda * bcvRate)} Bs</p>}
                                    {copEnabled && !copPrimary && tasaCop > 0 && <p className="text-[10px] font-bold text-red-600 dark:text-red-400">-{formatCop(customer.deuda * tasaCop)} COP</p>}
                                </>
                            )}
                            {customer.casheaDeuda > 0 && (
                                <div className="text-[10px] font-black text-purple-500 dark:text-purple-400 flex items-center justify-end gap-1 mt-0.5">
                                    <CasheaIcon size={12} />
                                    <span>-${formatUsd(customer.casheaDeuda)}</span>
                                </div>
                            )}
                        </>
                    ) : customer.favor > 0 ? (
                        <>
                            <p className={`text-sm font-black ${copEnabled && copPrimary ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-500'} leading-tight`}>
                                {copEnabled && copPrimary && tasaCop > 0
                                    ? `+${formatCop(customer.favor * tasaCop)} COP`
                                    : `+$${formatUsd(customer.favor)}`}
                            </p>
                            {copEnabled && copPrimary && <p className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">+${formatUsd(customer.favor)}</p>}
                            {bcvRate > 0 && <p className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">+{formatBs(customer.favor * bcvRate)} Bs</p>}
                            {copEnabled && !copPrimary && tasaCop > 0 && <p className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">+{formatCop(customer.favor * tasaCop)} COP</p>}
                        </>
                    ) : (
                        // v1.2.0: badge-success class para "Al día".
                        <span className="badge badge-success !text-xs">
                            <CheckCircle2 size={12} aria-hidden="true" /> Al día
                        </span>
                    )}
                </div>
            </div>
            {onDelete && (
                // v1.2.0: touch target ≥ 48px (a11y WCAG AA).
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onDelete();
                    }}
                    aria-label="Eliminar contacto"
                    className="p-2 min-h-[48px] min-w-[48px] flex items-center justify-center shrink-0 text-surface-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-colors active:scale-95 z-10"
                >
                    <Trash2 size={16} aria-hidden="true" />
                </button>
            )}
        </article>
    );
}

// Genera la URL de WhatsApp con el estado de cuenta formateado y las últimas 7 transacciones
function buildCustomerStatementWhatsAppUrl(customer, sales, bcvRate) {
    const formattedName = customer.name
        ? customer.name.trim().toLowerCase().split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
        : '';
        
    let msg = `*ESTADO DE CUENTA - PRECIOS AL DÍA*\n`;
    msg += `----------------------------------\n`;
    msg += `*Cliente:* ${formattedName}\n`;
    if (customer.documentId) msg += `*C.I:* ${customer.documentId}\n`;

    const deuda = customer.deuda || 0;
    const favor = customer.favor || 0;
    const casheaDeuda = customer.casheaDeuda || 0;

    if (deuda > 0) {
        msg += `*Estado:* Deuda Pendiente de *$${formatUsd(deuda)}*`;
        if (bcvRate > 0) msg += ` (Bs ${formatBs(deuda * bcvRate)})`;
        msg += `\n`;
    } else if (favor > 0) {
        msg += `*Estado:* Saldo a Favor de *$${formatUsd(favor)}*`;
        if (bcvRate > 0) msg += ` (Bs ${formatBs(favor * bcvRate)})`;
        msg += `\n`;
    } else {
        msg += `*Estado:* Al día [Activo]\n`;
    }

    if (casheaDeuda > 0) {
        msg += `*Financiamiento Cashea:* Debe *$${formatUsd(casheaDeuda)}*\n`;
    }

    msg += `\n*ÚLTIMAS TRANSACCIONES:*\n`;
    const lastSales = (sales || []).slice(0, 7);
    if (lastSales.length === 0) {
        msg += `Sin movimientos registrados.\n`;
    } else {
        lastSales.forEach((sale, idx) => {
            const date = new Date(sale.timestamp);
            const dateStr = date.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: '2-digit' });
            
            const isCobro = sale.tipo === 'COBRO_DEUDA';
            const isFiada = sale.tipo === 'VENTA_FIADA';
            const isCashea = sale.tipo === 'VENTA_CASHEA';
            const isAnulada = sale.status === 'ANULADA';

            let typeStr = isCobro ? 'Abono de deuda' : isFiada ? 'Venta fiada' : isCashea ? 'Venta Cashea' : 'Venta';
            if (isAnulada) typeStr += ' (ANULADA)';

            let sign = isCobro ? '+' : '';
            msg += `${idx + 1}. [${dateStr}] ${typeStr}: *${sign}$${formatUsd(sale.totalUsd || 0)}*`;
            if (bcvRate > 0 && !isAnulada) msg += ` (Bs ${formatBs((sale.totalUsd || 0) * bcvRate)})`;
            msg += `\n`;

            if (sale.items && sale.items.length > 0) {
                const itemsStr = sale.items.map(i => i.name).join(', ');
                msg += `   _${itemsStr.substring(0, 60)}${itemsStr.length > 60 ? '...' : ''}_\n`;
            }
        });
    }

    msg += `----------------------------------\n`;
    msg += `_Reporte generado el ${new Date().toLocaleDateString('es-VE')} a las ${new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', hour12: true })}._`;

    const cleanPhone = (customer.phone || '').replace(/\D/g, '');
    const phoneWithCountry = cleanPhone.length === 10 ? `58${cleanPhone}` : cleanPhone;

    return `https://wa.me/${phoneWithCountry}?text=${encodeURIComponent(msg)}`;
}

// ─── Sub-componente: Bottom Sheet de Detalle ────────────────
function CustomerDetailSheet({ customer, isOpen, isAdmin, onClose, onAjustar, onReset, onSaldarCashea, onEdit, onDelete, bcvRate, tasaCop, copEnabled, copPrimary, sales }) {
    if (!isOpen || !customer) return null;

    // Mini-paginación del historial
    const [historyPage, setHistoryPage] = useState(1);
    
    // Resetear página de historial cuando cambia el cliente
    useEffect(() => {
        setHistoryPage(1);
    }, [customer.id]);

    const createdDate = customer.createdAt
        ? new Date(customer.createdAt).toLocaleDateString('es-VE', { month: 'long', year: 'numeric' })
        : null;

    return (
        // v1.2.0: surface tokens + shadow-tone-lg en el bottom sheet.
        <div className="fixed inset-0 z-50 bg-surface-900/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose}>
            <div
                className="fixed bottom-0 sm:bottom-auto sm:top-1/2 left-0 sm:left-1/2 right-0 sm:right-auto sm:-translate-x-1/2 sm:-translate-y-1/2 max-w-md w-full mx-auto bg-surface dark:bg-surface-900 rounded-t-3xl sm:rounded-3xl max-h-[85vh] sm:max-h-[90vh] overflow-y-auto animate-in slide-in-from-bottom sm:slide-in-from-bottom-0 sm:zoom-in-95 duration-250 shadow-tone-lg"
                onClick={e => e.stopPropagation()}
            >
                {/* Close + Drag Handle */}
                <div className="flex items-center justify-between px-4 pt-3 pb-2">
                    <div className="w-8 sm:hidden" />
                    <div className="w-8 h-1 bg-surface-300 dark:bg-surface-700 rounded-full sm:hidden" />
                    {/* v1.2.0: touch target ≥ 48px + aria-label */}
                    <button onClick={onClose} aria-label="Cerrar" className="p-2 min-h-[48px] min-w-[48px] flex items-center justify-center text-surface-400 hover:text-surface-600 dark:hover:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-800 rounded-full transition-colors ml-auto">
                        <X size={18} aria-hidden="true" />
                    </button>
                </div>

                <div className="px-5 pb-6 space-y-5">
                    {/* Header */}
                    <div className="flex items-center gap-4">
                        <div className="w-14 h-14 rounded-full bg-gradient-to-br from-brand/20 to-emerald-500/10 dark:from-brand/30 dark:to-emerald-500/20 flex items-center justify-center shrink-0 border border-emerald-100 dark:border-slate-700 shadow-sm animate-in fade-in">
                            <span className="text-2xl font-black text-brand-dark dark:text-brand">
                                {customer.name.charAt(0).toUpperCase()}
                            </span>
                        </div>
                        <div>
                            <h3 className="text-lg font-black text-surface-700 dark:text-white capitalize leading-tight">{customer.name}</h3>
                            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                                {customer.documentId && (
                                    <span className="font-mono text-[9px] font-black text-cyan-600 dark:text-cyan-400 bg-cyan-50 dark:bg-cyan-950/20 border border-cyan-100/60 dark:border-cyan-900/30 px-2 py-0.5 rounded-md leading-none shrink-0">
                                        C.I: {customer.documentId}
                                    </span>
                                )}
                                {customer.phone ? (
                                    <span className="text-[9px] font-bold text-slate-500 dark:text-slate-355 flex items-center gap-0.5 bg-slate-50 dark:bg-slate-800/40 border border-slate-200/50 dark:border-slate-800/50 px-1.5 py-0.5 rounded-md leading-none shrink-0">
                                        <Phone size={9} aria-hidden="true" /> {customer.phone}
                                    </span>
                                ) : (
                                    <button
                                        onClick={onEdit}
                                        className="text-[9px] font-black text-emerald-800 dark:text-emerald-300 bg-emerald-100/80 dark:bg-emerald-950/40 border border-emerald-200/80 dark:border-emerald-800/50 px-2 py-1 rounded-md leading-none flex items-center gap-1 hover:bg-emerald-200/80 dark:hover:bg-emerald-900/50 transition-all shrink-0 active:scale-95 shadow-sm"
                                    >
                                        <Phone size={9} aria-hidden="true" /> Añadir Teléfono
                                    </button>
                                )}
                            </div>
                            {createdDate && (
                                <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1.5">Cliente desde {createdDate}</p>
                            )}
                        </div>
                    </div>

                    {/* Saldo */}
                    <div className="flex flex-col gap-2 w-full">
                        <div className="flex gap-2">
                            {customer.deuda > 0 || customer.casheaDeuda > 0 ? (
                                <>
                                    {customer.deuda > 0 && (
                                        <div className="flex-1 bg-red-500/[0.03] dark:bg-red-500/[0.05] border border-red-200 dark:border-red-900/40 rounded-2xl px-3 py-2.5 text-center shadow-sm">
                                            <p className="text-[10px] font-black text-red-500 dark:text-red-400 uppercase tracking-wider mb-1">Deuda Pendiente</p>
                                            <p className={`text-xl font-black ${copEnabled && copPrimary ? 'text-amber-700 dark:text-amber-450' : 'text-red-500'} tracking-tight leading-tight`}>
                                                {copEnabled && copPrimary && tasaCop > 0
                                                    ? `-${formatCop(customer.deuda * tasaCop)} COP`
                                                    : `-$${formatUsd(customer.deuda)}`}
                                            </p>
                                            <div className="mt-1 space-y-0.5 text-[9px] font-bold text-slate-400 dark:text-slate-550 leading-none">
                                                {copEnabled && copPrimary && <p>-${formatUsd(customer.deuda)}</p>}
                                                {bcvRate > 0 && <p>-{formatBs(customer.deuda * bcvRate)} Bs</p>}
                                                {copEnabled && !copPrimary && tasaCop > 0 && <p>-{formatCop(customer.deuda * tasaCop)} COP</p>}
                                            </div>
                                        </div>
                                    )}
                                    {customer.casheaDeuda > 0 && (
                                        <div className="flex-1 bg-purple-500/[0.03] dark:bg-purple-500/[0.05] border border-purple-200 dark:border-purple-900/40 rounded-2xl px-3 py-2.5 text-center shadow-sm animate-in fade-in">
                                            <p className="text-[10px] font-black text-purple-600 dark:text-purple-400 uppercase tracking-wider mb-1 flex items-center justify-center gap-1"><CasheaIcon size={11} /> Cashea</p>
                                            <p className="text-xl font-black text-purple-600 dark:text-purple-450 tracking-tight leading-tight">
                                                -${formatUsd(customer.casheaDeuda)}
                                            </p>
                                            {bcvRate > 0 && <p className="text-[9px] font-bold text-slate-400 dark:text-slate-550 mt-1 leading-none">-{formatBs(customer.casheaDeuda * bcvRate)} Bs</p>}
                                        </div>
                                    )}
                                </>
                            ) : customer.favor > 0 ? (
                                <div className="flex-1 bg-emerald-500/[0.03] dark:bg-emerald-500/[0.05] border border-emerald-200 dark:border-emerald-900/40 rounded-2xl px-3 py-2.5 text-center shadow-sm">
                                    <p className="text-[10px] font-black text-emerald-600 dark:text-emerald-450 uppercase tracking-wider mb-1">Saldo a Favor</p>
                                    <p className={`text-xl font-black ${copEnabled && copPrimary ? 'text-amber-700 dark:text-amber-450' : 'text-emerald-500'} tracking-tight leading-tight`}>
                                        {copEnabled && copPrimary && tasaCop > 0
                                            ? `+${formatCop(customer.favor * tasaCop)} COP`
                                            : `+$${formatUsd(customer.favor)}`}
                                    </p>
                                    <div className="mt-1 space-y-0.5 text-[9px] font-bold text-slate-400 dark:text-slate-550 leading-none">
                                        {copEnabled && copPrimary && <p>+${formatUsd(customer.favor)}</p>}
                                        {bcvRate > 0 && <p>+{formatBs(customer.favor * bcvRate)} Bs</p>}
                                        {copEnabled && !copPrimary && tasaCop > 0 && <p>+{formatCop(customer.favor * tasaCop)} COP</p>}
                                    </div>
                                </div>
                            ) : (
                                <div className="flex-1 bg-emerald-500/[0.02] dark:bg-emerald-500/[0.04] border border-emerald-100 dark:border-emerald-900/30 rounded-2xl px-3 py-3 text-center shadow-sm">
                                    <p className="text-[10px] font-black text-emerald-500 dark:text-emerald-450 uppercase tracking-wider mb-0.5">Estado Financiero</p>
                                    <p className="text-sm font-black text-emerald-600 dark:text-emerald-400 flex items-center justify-center gap-1.5 mt-1.5">
                                        <CheckCircle2 size={15} className="text-emerald-500" aria-hidden="true" /> Al día
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Acciones */}
                    {(() => {
                        const showReset = (customer.deuda !== 0 || customer.favor !== 0) && isAdmin;
                        return (
                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    onClick={onAjustar}
                                    className={`flex flex-col items-center justify-center gap-1 py-2.5 min-h-[64px] bg-brand dark:bg-brand-dark text-white rounded-xl text-xs font-bold hover:opacity-95 transition-all active:scale-95 shadow-sm ${showReset ? 'col-span-1' : 'col-span-2'}`}
                                >
                                    <CreditCard size={16} aria-hidden="true" />
                                    <span>Ajustar Cuenta</span>
                                </button>
                                {showReset && (
                                    <button
                                        onClick={onReset}
                                        className="flex flex-col items-center justify-center gap-1 py-2.5 min-h-[64px] bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold hover:bg-slate-100 dark:hover:bg-slate-750 transition-colors active:scale-95 border border-slate-200/40 dark:border-slate-700/50"
                                    >
                                        <RefreshCw size={16} aria-hidden="true" />
                                        <span>Poner en 0</span>
                                    </button>
                                )}
                                {customer.casheaDeuda > 0 && isAdmin && (
                                    <button
                                        onClick={() => onSaldarCashea(customer)}
                                        className="flex flex-col items-center justify-center gap-1 py-2.5 min-h-[64px] bg-purple-100 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 rounded-xl text-xs font-bold hover:bg-purple-200 dark:hover:bg-purple-900/40 transition-colors active:scale-95 col-span-2"
                                    >
                                        <CheckCircle2 size={16} aria-hidden="true" />
                                        <span>Saldar Deuda Cashea</span>
                                    </button>
                                )}
                            </div>
                        );
                    })()}

                    {/* Botón Enviar Estado de Cuenta por WhatsApp */}
                    <div className="flex flex-col gap-1.5 w-full">
                        <button
                            onClick={() => {
                                const url = buildCustomerStatementWhatsAppUrl(customer, sales, bcvRate);
                                window.open(url, '_blank');
                            }}
                            disabled={!customer.phone}
                            title={!customer.phone ? "Debe configurar un teléfono para el cliente para poder enviar por WhatsApp" : "Enviar estado de cuenta por WhatsApp"}
                            className="flex items-center justify-center gap-2 py-3 px-4 w-full bg-emerald-600 dark:bg-emerald-700 text-white rounded-xl text-xs font-bold hover:bg-emerald-700 dark:hover:bg-emerald-600 transition-all active:scale-95 disabled:bg-slate-100 disabled:text-slate-400 dark:disabled:bg-surface-800 dark:disabled:text-slate-500 disabled:shadow-none disabled:cursor-not-allowed shadow-sm shrink-0"
                        >
                            <svg className="w-4 h-4 fill-current shrink-0" viewBox="0 0 24 24">
                                <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946C.06 5.348 5.397.01 12.008.01c3.202.001 6.212 1.246 8.477 3.514 2.266 2.268 3.507 5.28 3.505 8.484-.004 6.657-5.34 11.997-11.953 11.997-2.005-.001-3.973-.502-5.724-1.455L0 24zm6.59-4.846c1.6.95 3.188 1.449 4.625 1.451 5.403.002 9.803-4.392 9.806-9.8.001-2.617-1.01-5.079-2.859-6.93C16.378 2.025 13.926.994 12.01.994c-5.405 0-9.804 4.393-9.807 9.8-.001 1.77.464 3.5 1.345 5.03L2.57 20.31l4.077-1.156z"/>
                            </svg>
                            <span>Enviar Estado de Cuenta (WhatsApp)</span>
                        </button>
                        {!customer.phone && (
                            <div className="bg-amber-500/[0.06] dark:bg-amber-500/[0.08] border border-amber-200/60 dark:border-amber-900/40 text-amber-800 dark:text-amber-300 rounded-xl px-3 py-2 flex items-center justify-center gap-1.5 text-[10px] font-bold mt-1 shadow-sm">
                                <span>\u26A0\uFE0F Asigna un teléfono arriba para habilitar WhatsApp</span>
                            </div>
                        )}
                    </div>

                    {/* Historial */}
                    <div>
                        <h4 className="text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1.5 mb-3">
                            <Clock size={12} /> Historial
                        </h4>
                        {(!sales || sales.length === 0) ? (
                            <div className="flex flex-col items-center justify-center py-8 px-4 border border-dashed border-slate-200/80 dark:border-slate-800/80 rounded-2xl bg-slate-50/50 dark:bg-slate-900/20 text-center animate-in fade-in duration-200">
                                <Clock size={20} className="text-slate-300 dark:text-slate-655 mb-2" />
                                <p className="text-xs font-bold text-slate-500 dark:text-slate-400">Sin movimientos registrados</p>
                                <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1 max-w-[200px] leading-relaxed">Las compras, abonos y deudas de este cliente se listarán en esta sección.</p>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {sales.slice(0, historyPage * 5).map(sale => {
                                    const date = new Date(sale.timestamp);
                                    const dateStr = date.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: '2-digit' });
                                    const timeStr = date.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', hour12: false });
                                    const isCobro = sale.tipo === 'COBRO_DEUDA';
                                    const isFiada = sale.tipo === 'VENTA_FIADA';
                                    const isCashea = sale.tipo === 'VENTA_CASHEA';
                                    const isAnulada = sale.status === 'ANULADA';
                                    return (
                                        <div key={sale.id} className={`flex items-start gap-2.5 py-3 px-3.5 bg-slate-50 dark:bg-slate-950 rounded-xl ${isAnulada ? 'opacity-50 grayscale' : ''}`}>
                                            <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${isAnulada ? 'bg-slate-200 dark:bg-slate-800' : isCobro ? 'bg-emerald-100 dark:bg-emerald-900/30' : isFiada ? 'bg-amber-100 dark:bg-amber-900/30' : isCashea ? 'bg-purple-100 dark:bg-purple-900/30' : 'bg-brand-light dark:bg-surface-800/30'}`}>
                                                {isCobro ? <ArrowUpRight size={14} className={isAnulada ? "text-slate-500" : "text-emerald-500"} /> : isFiada ? <CreditCard size={14} className={isAnulada ? "text-slate-500" : "text-amber-500"} /> : isCashea ? <Smartphone size={14} className={isAnulada ? "text-slate-500" : "text-purple-500"} /> : <ShoppingBag size={14} className={isAnulada ? "text-slate-500" : "text-brand"} />}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex justify-between items-start">
                                                    <div className="flex flex-col">
                                                        <p className={`text-xs font-bold ${isAnulada ? 'text-slate-500 line-through' : 'text-slate-700 dark:text-slate-200'}`}>
                                                            {isCobro ? 'Abono de deuda' : isFiada ? 'Venta fiada' : isCashea ? 'Venta Cashea' : 'Venta'}
                                                        </p>
                                                        {isAnulada && <span className="text-[10px] font-black text-red-500 tracking-wider">ANULADA</span>}
                                                    </div>
                                                    <div className="text-right">
                                                        <p className={`text-xs font-black ${isAnulada ? 'text-slate-400 line-through' : isCobro ? 'text-emerald-500' : isFiada ? 'text-amber-500' : isCashea ? 'text-purple-500 dark:text-purple-400' : 'text-slate-700 dark:text-white'}`}>
                                                            {isCobro ? '+' : ''}${formatUsd(sale.totalUsd || 0)}
                                                        </p>
                                                        {bcvRate > 0 && !isAnulada && (
                                                            <p className={`text-[9px] font-bold ${isCobro ? 'text-emerald-400/70' : isFiada ? 'text-amber-400/70' : isCashea ? 'text-purple-400/70' : 'text-slate-400'}`}>
                                                                {isCobro ? '+' : ''}{formatBs((sale.totalUsd || 0) * bcvRate)} Bs
                                                            </p>
                                                        )}
                                                    </div>
                                                </div>
                                                {sale.items && sale.items.length > 0 && (
                                                    <p className="text-[10px] text-slate-400 truncate mt-0.5">
                                                        {sale.items.map(i => i.name).join(', ')}
                                                    </p>
                                                )}
                                                {sale.fiadoUsd > 0 && (
                                                    <p className="text-[10px] text-amber-500 font-bold mt-0.5">Deuda: ${formatUsd(sale.fiadoUsd)}</p>
                                                )}
                                                {sale.casheaUsd > 0 && (
                                                    <p className="text-[10px] text-purple-500 dark:text-purple-400 font-bold mt-0.5">Deuda Cashea: ${formatUsd(sale.casheaUsd)}</p>
                                                )}
                                                <p className="text-[9px] text-slate-400 mt-0.5">{dateStr} • {timeStr}</p>
                                            </div>
                                        </div>
                                    );
                                })}

                                {sales.length > historyPage * 5 && (
                                    <button
                                        onClick={() => setHistoryPage(p => p + 1)}
                                        className="w-full mt-2.5 py-2 px-4 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 text-[10px] font-bold text-slate-600 dark:text-slate-300 rounded-xl transition-all flex items-center justify-center gap-1 active:scale-[0.97]"
                                    >
                                        <Clock size={11} className="opacity-70" />
                                        <span>Cargar más transacciones ({sales.length - historyPage * 5} más)</span>
                                    </button>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Editar / Eliminar */}
                    {/* v1.2.0: touch targets ≥ 48px + surface tokens */}
                    <div className="flex gap-2 pt-2 border-t border-surface-100 dark:border-surface-800">
                        <button
                            onClick={onEdit}
                            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 min-h-[48px] bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-300 rounded-xl text-xs font-bold hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors active:scale-95"
                        >
                            <Pencil size={14} aria-hidden="true" /> Editar
                        </button>
                        {isAdmin && (
                            <button
                                onClick={onDelete}
                                aria-label="Eliminar cliente"
                                className="flex items-center justify-center gap-1.5 py-2.5 min-h-[48px] px-4 bg-red-50 dark:bg-red-900/20 text-red-500 rounded-xl text-xs font-bold hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors active:scale-95"
                            >
                                <Trash2 size={14} aria-hidden="true" />
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

// ─── Sub-componente: Editar Cliente ───────────────────────
function EditCustomerModal({ customer, onClose, onSave }) {
    const [name, setName] = useState(customer.name);
    const [documentId, setDocumentId] = useState(customer.documentId || '');
    const [phone, setPhone] = useState(customer.phone || '');

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        onSave({ ...customer, name: name.trim(), documentId: documentId.trim(), phone: phone.trim() });
    };

    return (
        // v1.2.0: surface tokens + shadow-tone-lg en modal de editar.
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-surface-900/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-surface dark:bg-surface-900 w-full max-w-sm rounded-t-3xl sm:rounded-3xl shadow-tone-lg overflow-hidden animate-in slide-in-from-bottom-10 sm:zoom-in-95 duration-200">
                <div className="p-5 border-b border-surface-100 dark:border-surface-800 flex justify-between items-center bg-surface-100 dark:bg-surface-800/50">
                    <h3 className="text-xl font-black text-surface-700 dark:text-white flex items-center gap-2">
                        <Pencil size={20} className="text-brand" aria-hidden="true" /> Editar Cliente
                    </h3>
                    {/* v1.2.0: touch target ≥ 48px + aria-label */}
                    <button onClick={onClose} aria-label="Cerrar" className="p-2 min-h-[48px] min-w-[48px] flex items-center justify-center text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700 rounded-full transition-colors">
                        <X size={20} aria-hidden="true" />
                    </button>
                </div>
                <form onSubmit={handleSubmit} className="p-5 space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-surface-400 uppercase mb-2">Nombre *</label>
                        <input
                            type="text"
                            required
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="input w-full bg-surface-100 dark:bg-surface-950 border border-surface-200 dark:border-surface-800 rounded-xl px-4 py-3 text-surface-700 dark:text-white placeholder:text-surface-400 focus:ring-2 focus:ring-brand/50 transition-all font-medium"
                            autoFocus
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-surface-400 uppercase mb-2">Cédula / RIF (Opcional)</label>
                        <input
                            type="text"
                            value={documentId}
                            onChange={(e) => setDocumentId(e.target.value.toUpperCase())}
                            placeholder="V-12345678"
                            className="input w-full bg-surface-100 dark:bg-surface-950 border border-surface-200 dark:border-surface-800 rounded-xl px-4 py-3 text-surface-700 dark:text-white placeholder:text-surface-400 focus:ring-2 focus:ring-brand/50 transition-all font-medium uppercase"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-surface-400 uppercase mb-2">Teléfono</label>
                        <div className="w-full flex items-center bg-surface-100 dark:bg-surface-950 border border-surface-200 dark:border-surface-800 rounded-xl focus-within:ring-2 focus-within:ring-brand/50 transition-all overflow-hidden">
                            <span className="px-3 py-3 text-sm font-black text-brand border-r border-surface-200 dark:border-surface-700 bg-surface-200 dark:bg-surface-800 shrink-0 select-none">+58</span>
                            <input
                                type="tel"
                                placeholder="0412 1234567"
                                value={phone}
                                onChange={(e) => {
                                    const clean = e.target.value.replace(/^\+?58/, '');
                                    setPhone(clean);
                                }}
                                className="flex-1 bg-transparent px-3 py-3 text-surface-700 dark:text-white outline-none text-sm font-medium placeholder:text-surface-400"
                            />
                        </div>
                        <p className="text-[9px] text-surface-400 mt-1 ml-1">Venezuela · Ej: 0412 1234567</p>
                    </div>
                    {/* v1.2.0: touch target ≥ 48px */}
                    <button
                        type="submit"
                        disabled={!name.trim()}
                        className="w-full py-3.5 min-h-[48px] bg-brand disabled:bg-surface-300 dark:disabled:bg-surface-700 text-white font-bold rounded-xl active:scale-95 transition-all mt-4 flex justify-center items-center gap-2"
                    >
                        <Save size={18} aria-hidden="true" /> Guardar Cambios
                    </button>
                </form>
            </div>
        </div>
    );
}

function AddCustomerModal({ onClose, onSave }) {
    const [name, setName] = useState('');
    const [documentId, setDocumentId] = useState('');
    const [phone, setPhone] = useState('');

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!name.trim()) return;

        onSave({
            id: crypto.randomUUID(),
            name: name.trim(),
            documentId: documentId.trim(),
            phone: phone.trim(),
            deuda: 0,
            favor: 0,
            createdAt: new Date().toISOString()
        });
    };

    return (
        // v1.2.0: surface tokens + shadow-tone-lg + aria-hidden en AddCustomerModal.
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-surface-900/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-surface dark:bg-surface-900 w-full max-w-sm rounded-t-3xl sm:rounded-3xl shadow-tone-lg overflow-hidden animate-in slide-in-from-bottom-10 sm:zoom-in-95 duration-200">
                <div className="p-5 border-b border-surface-100 dark:border-surface-800 flex justify-between items-center bg-surface-100 dark:bg-surface-800/50">
                    <h3 className="text-xl font-black text-surface-700 dark:text-white flex items-center gap-2">
                        <User size={22} className="text-brand" aria-hidden="true" /> Nuevo Cliente
                    </h3>
                    {/* v1.2.0: touch target ≥ 48px + aria-label */}
                    <button onClick={onClose} aria-label="Cerrar" className="p-2 min-h-[48px] min-w-[48px] flex items-center justify-center text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700 rounded-full transition-colors">
                        <X size={20} aria-hidden="true" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-5 space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-surface-400 uppercase mb-2">Nombre del Cliente *</label>
                        <input
                            type="text"
                            required
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Ej. María Pérez"
                            className="input w-full bg-surface-100 dark:bg-surface-950 border border-surface-200 dark:border-surface-800 rounded-xl px-4 py-3 text-surface-700 dark:text-white placeholder:text-surface-400 focus:ring-2 focus:ring-brand/50 transition-all font-medium"
                            autoFocus
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-surface-400 uppercase mb-2">Cédula / RIF (Opcional)</label>
                        <input
                            type="text"
                            value={documentId}
                            onChange={(e) => setDocumentId(e.target.value.toUpperCase())}
                            placeholder="V-12345678"
                            className="input w-full bg-surface-100 dark:bg-surface-950 border border-surface-200 dark:border-surface-800 rounded-xl px-4 py-3 text-surface-700 dark:text-white placeholder:text-surface-400 focus:ring-2 focus:ring-brand/50 transition-all font-medium uppercase"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-surface-400 uppercase mb-2">Teléfono (opcional)</label>
                        <div className="w-full flex items-center bg-surface-100 dark:bg-surface-950 border border-surface-200 dark:border-surface-800 rounded-xl focus-within:ring-2 focus-within:ring-brand/50 transition-all overflow-hidden">
                            <span className="px-3 py-3 text-sm font-black text-brand border-r border-surface-200 dark:border-surface-700 bg-surface-200 dark:bg-surface-800 shrink-0 select-none">+58</span>
                            <input
                                type="tel"
                                placeholder="0412 1234567"
                                value={phone}
                                onChange={(e) => {
                                    const clean = e.target.value.replace(/^\+?58/, '');
                                    setPhone(clean);
                                }}
                                className="flex-1 bg-transparent px-3 py-3 text-surface-700 dark:text-white outline-none text-sm font-medium placeholder:text-surface-400"
                            />
                        </div>
                        <p className="text-[9px] text-surface-400 mt-1 ml-1">Venezuela · Ej: 0412 1234567</p>
                    </div>

                    {/* v1.2.0: touch target ≥ 48px */}
                    <button
                        type="submit"
                        disabled={!name.trim()}
                        className="w-full py-3.5 min-h-[48px] bg-brand disabled:bg-surface-300 dark:disabled:bg-surface-700 text-white font-bold rounded-xl active:scale-95 transition-all mt-4 flex justify-center items-center gap-2"
                    >
                        <Save size={18} aria-hidden="true" /> Guardar Cliente
                    </button>
                </form>
            </div>
        </div>
    );
}
