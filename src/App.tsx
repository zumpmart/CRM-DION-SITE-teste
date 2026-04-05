/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { 
  LayoutDashboard, 
  Users, 
  TrendingUp, 
  FileText, 
  CheckCircle, 
  ArrowRightLeft,
  AlertCircle, 
  LogOut, 
  User as UserIcon, 
  PlusCircle, 
  Trophy, 
  Target, 
  DollarSign, 
  Search,
  Menu,
  X,
  XCircle,
  ChevronRight,
  History,
  PieChart,
  ShieldCheck,
  Edit2,
  Calendar,
  Camera,
  List,
  Trash2,
  MessageCircle,
  CalendarDays,
  Database,
  Upload,
  Download,
  Briefcase,
  RefreshCw,
  Repeat,
  UserCheck,
  Clock,
  Plus,
  Eye,
  Wallet,
  Lock
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Cropper from 'react-easy-crop';
import 'react-easy-crop/react-easy-crop.css';
import { UserProfile, UserRole, Sale, SaleStatus, SaleType, ContractStatus, Customer, Receipt, ReceiptStatus, AuditLog, Payment } from './types';
import { auditReceipt, generateImageHash } from './auditService';
import { db, auth, storage, firebaseConfig } from './firebase';
import { initializeApp } from 'firebase/app';
import { collection, doc, getDocs, getDoc, addDoc, setDoc, updateDoc, deleteDoc, query, where, orderBy, onSnapshot, limit, or } from 'firebase/firestore';
import { signInWithEmailAndPassword, signOut, onAuthStateChanged, createUserWithEmailAndPassword, updatePassword, EmailAuthProvider, reauthenticateWithCredential, getAuth as getSecondaryAuth } from 'firebase/auth';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';

// --- Toast System ---
type ToastType = 'success' | 'error' | 'warning' | 'info';
interface ToastItem { id: number; message: string; type: ToastType; }

const ToastContainer = ({ toasts, onRemove }: { toasts: ToastItem[]; onRemove: (id: number) => void }) => (
  <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-3 max-w-sm">
    <AnimatePresence>
      {toasts.map(toast => (
        <motion.div
          key={toast.id}
          initial={{ opacity: 0, y: 20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, x: 100, scale: 0.95 }}
          className={`px-5 py-4 rounded-2xl shadow-xl border backdrop-blur-sm flex items-start gap-3 cursor-pointer ${
            toast.type === 'success' ? 'bg-emerald-50/95 border-emerald-200 text-emerald-800' :
            toast.type === 'error' ? 'bg-red-50/95 border-red-200 text-red-800' :
            toast.type === 'warning' ? 'bg-amber-50/95 border-amber-200 text-amber-800' :
            'bg-blue-50/95 border-blue-200 text-blue-800'
          }`}
          onClick={() => onRemove(toast.id)}
        >
          <span className="text-lg">{toast.type === 'success' ? '✅' : toast.type === 'error' ? '❌' : toast.type === 'warning' ? '⚠️' : 'ℹ️'}</span>
          <p className="text-sm font-medium leading-snug">{toast.message}</p>
        </motion.div>
      ))}
    </AnimatePresence>
  </div>
);

// --- Components ---

const StatCard = ({ title, value, icon: Icon, color, subtitle, action }: any) => (
  <div className="bg-white p-6 rounded-2xl shadow-sm border border-black/5 flex flex-col gap-2">
    <div className="flex justify-between items-start">
      <div>
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-zinc-500 uppercase tracking-wider">{title}</p>
          {action}
        </div>
        <h3 className="text-2xl font-bold mt-1">{value}</h3>
      </div>
      <div className={`p-3 rounded-xl ${color}`}>
        <Icon className="w-5 h-5 text-white" />
      </div>
    </div>
    {subtitle && <p className="text-xs text-zinc-400 mt-2">{subtitle}</p>}
  </div>
);

const ProgressBar = ({ progress, label, current, target }: any) => (
  <div className="space-y-2">
    <div className="flex justify-between text-sm">
      <span className="font-medium text-zinc-700">{label}</span>
      <span className="text-zinc-500">{Math.round(progress)}%</span>
    </div>
    <div className="h-3 w-full bg-zinc-100 rounded-full overflow-hidden">
      <motion.div 
        initial={{ width: 0 }}
        animate={{ width: `${Math.min(progress, 100)}%` }}
        className={`h-full ${progress >= 100 ? 'bg-emerald-500' : 'bg-indigo-600'}`}
      />
    </div>
    <div className="flex justify-between text-xs text-zinc-400">
      <span>R$ {(current || 0).toLocaleString()}</span>
      <span>Meta: R$ {(target || 0).toLocaleString()}</span>
    </div>
  </div>
);

const getLocalISODate = (date?: Date) => {
  const d = date || new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const toLocalDateString = (isoString?: string) => {
  if (!isoString) return '';
  return getLocalISODate(new Date(isoString));
};

const SERVICES = ['Logotipo', 'Flayer', 'Faixada', 'Site', 'Outros'];

// --- Status Label Map (visual only, DB values unchanged) ---
const STATUS_LABELS: Record<string, string> = {
  [SaleStatus.AGUARDANDO]: 'Atendimento Iniciado',
  [SaleStatus.PENDENTE]: 'Projeto Iniciado',

  [SaleStatus.PAGO]: 'PAGO',
  [SaleStatus.CANCELADO]: 'CANCELADO',
  [SaleStatus.ARQUIVADO]: 'ARQUIVADO',
  [SaleStatus.EXCLUSAO_SOLICITADA]: 'AGUARDANDO EXCLUSÃO',
  [SaleStatus.DELETED]: 'DELETED',
};
const getStatusLabel = (status: string) => STATUS_LABELS[status] || status;

// Statuses hidden from Kanban/List columns
const KANBAN_HIDDEN_STATUSES = [SaleStatus.DELETED, SaleStatus.CANCELADO, SaleStatus.REMARKETING];

// --- Stale AGUARDANDO detection (>8h) ---
const STALE_HOURS = 8;
const isStaleAguardando = (sale: Sale) => {
  if (sale.status !== SaleStatus.AGUARDANDO) return false;
  const elapsed = Date.now() - new Date(sale.updated_at).getTime();
  return elapsed > STALE_HOURS * 60 * 60 * 1000;
};

const getStaleHours = (sale: Sale) => {
  const elapsed = Date.now() - new Date(sale.updated_at).getTime();
  return Math.floor(elapsed / (60 * 60 * 1000));
};



// --- PAGO visibility: only show if paid today ---
const isPagoVisibleInFlow = (sale: Sale) => {
  if (sale.status !== SaleStatus.PAGO) return false;
  const paidRef = sale.paid_at || sale.updated_at;
  if (!paidRef) return false;
  return toLocalDateString(paidRef) >= getLocalISODate();
};

const calculateCommission = (sale: Sale, user?: UserProfile) => {
  if (!user) return 0;
  if (sale.sale_type === SaleType.RECORRENTE) {
    const rate = user.recurring_commission || user.commission || 0;
    return (sale.value * rate) / 100;
  }
  if (user.commissions && user.commissions[sale.service] !== undefined) {
    return user.commissions[sale.service];
  }
  return (sale.value * (user.commission || 0)) / 100;
};

// --- Main App ---

export default function App() {
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [sales, setSales] = useState<Sale[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [viewingCustomer, setViewingCustomer] = useState<Customer | null>(null);
  const [newLeadSaleType, setNewLeadSaleType] = useState<SaleType>(SaleType.PONTUAL);
  const [newLeadServices, setNewLeadServices] = useState<string[]>([]);
  const toastIdRef = useRef(0);

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = ++toastIdRef.current;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }, []);

  const removeToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);
  const [loading, setLoading] = useState(true);
  const [showUserModal, setShowUserModal] = useState(false);
  const [viewingImageUrl, setViewingImageUrl] = useState<string | null>(null);
  const [confirmInput, setConfirmInput] = useState('');
  const [confirmModal, setConfirmModal] = useState<{
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    requireInput?: string;
    onConfirm: () => void;
    onCancel?: () => void;
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [editingSale, setEditingSale] = useState<Sale | null>(null);
  const [selectedContract, setSelectedContract] = useState<Sale | null>(null);
  const [editingSeller, setEditingSeller] = useState<UserProfile | null>(null);
  const [payingSeller, setPayingSeller] = useState<UserProfile | null>(null);
  const [salePendingReceipt, setSalePendingReceipt] = useState<Sale | null>(null);
  const [rankingFilter, setRankingFilter] = useState<'daily' | 'weekly' | 'monthly' | 'all'>('daily');
  const [filters, setFilters] = useState({
    vendedor: '',
    status: '',
    startDate: '',
    endDate: ''
  });
  const [showFilters, setShowFilters] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'kanban'>('kanban');

  const [deletingSaleId, setDeletingSaleId] = useState<string | null>(null);

  const [dateRange, setDateRange] = useState({
    start: getLocalISODate(),
    end: getLocalISODate()
  });
  const [payments, setPayments] = useState<Payment[]>([]);
  const [selectedSalesToPay, setSelectedSalesToPay] = useState<string[]>([]);
  const [paymentReceipt, setPaymentReceipt] = useState<File | null>(null);
  const [isUploadingReceipt, setIsUploadingReceipt] = useState(false);
  const [financeiroTab, setFinanceiroTab] = useState<'pendentes' | 'historico'>('pendentes');
  const [cropModalOpen, setCropModalOpen] = useState(false);
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<any>(null);
  const [targetUserIdForPhoto, setTargetUserIdForPhoto] = useState<string | null>(null);
  const [customerVendorFilter, setCustomerVendorFilter] = useState<string>('');
  const [customerDateFrom, setCustomerDateFrom] = useState<string>('');
  const [customerDateTo, setCustomerDateTo] = useState<string>('');
  const [customerSortBy, setCustomerSortBy] = useState<'name' | 'spent_desc' | 'spent_asc' | 'purchases_desc' | 'purchases_asc' | 'recent'>('recent');
  const [duplicateCustomerFound, setDuplicateCustomerFound] = useState<Customer | null>(null);
  const [pendingLeadData, setPendingLeadData] = useState<any>(null);
  const [newSaleSearchPhone, setNewSaleSearchPhone] = useState<string>('');
  const [newSaleSelectedCustomer, setNewSaleSelectedCustomer] = useState<Customer | null>(null);
  const [newSaleSaleType, setNewSaleSaleType] = useState<SaleType>(SaleType.PONTUAL);
  const [newSaleServices, setNewSaleServices] = useState<string[]>([]);
  const [dashboardVendorFilter, setDashboardVendorFilter] = useState<string>('');
  const [lastCleanupDate, setLastCleanupDate] = useState<string | null>(null);
  const [receiptAuditFilter, setReceiptAuditFilter] = useState<'all' | 'approved' | 'divergent' | 'duplicate' | 'pending'>('all');
  const [receiptDateFrom, setReceiptDateFrom] = useState<string>('');
  const [receiptDateTo, setReceiptDateTo] = useState<string>('');
  const [receiptVendorFilter, setReceiptVendorFilter] = useState<string>('');
  const [paymentDateFrom, setPaymentDateFrom] = useState<string>('');
  const [paymentDateTo, setPaymentDateTo] = useState<string>('');
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<'all' | 'paid' | 'pending'>('all');
  const [expandedVendors, setExpandedVendors] = useState<Record<string, boolean>>({});
  const [receiptsLastSeen, setReceiptsLastSeen] = useState<string>(() => localStorage.getItem('receiptsLastSeen') || '');

  // Count new receipts since last time the receipts page was viewed
  const newReceiptsCount = useMemo(() => {
    if (!receiptsLastSeen) return receipts.length;
    return receipts.filter(r => r.created_at > receiptsLastSeen).length;
  }, [receipts, receiptsLastSeen]);

  const clearFilters = () => {
    setFilters({
      vendedor: '',
      status: '',
      startDate: '',
      endDate: ''
    });
  };

  // Login State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');

  useEffect(() => {
    const checkConfig = () => true;

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        await fetchProfile(user.uid);
      } else {
        setCurrentUser(null);
        setLoading(false);
        setIsLoggingIn(false);
      }
    });
    return () => unsubscribe();
  }, []);

  // Safety timeout for loading
  useEffect(() => {
    const timer = setTimeout(() => {
      if (loading) {
        console.warn('Loading timeout reached. Forcing loading to false.');
        setLoading(false);
      }
    }, 6000);
    return () => clearTimeout(timer);
  }, [loading]);

  const fetchProfile = async (userId: string) => {
    try {
      const docRef = doc(db, 'profiles', userId);
      const docSnap = await getDoc(docRef);

      if (!docSnap.exists()) {
        const usersSnap = await getDocs(collection(db, 'profiles'));
        if (usersSnap.empty) {
          const user = auth.currentUser;
          if (user) {
            const newProfile = {
              id: user.uid,
              name: 'Administrador Inicial',
              username: user.email?.split('@')[0] || 'admin',
              role: UserRole.ADMIN,
              status: 'ATIVO',
              created_at: new Date().toISOString()
            };
            await setDoc(docRef, newProfile);
            setCurrentUser(newProfile as UserProfile);
            return;
          }
        }
        
        setLoginError('Usuário sem perfil no CRM. Contate o administrador.');
        signOut(auth);
        return;
      }

      const profileData = docSnap.data() as UserProfile;
      if (profileData.status === 'INATIVO') {
        setLoginError('Sua conta foi desativada pelo administrador.');
        signOut(auth);
        return;
      }

      setCurrentUser({ ...profileData, id: docSnap.id });

      // Update last login timestamp
      try {
        await updateDoc(docRef, { last_login_at: new Date().toISOString() });
      } catch (e) {
        console.warn('Could not update last_login_at:', e);
      }
    } catch (err: any) {
      console.error('Fetch profile exception:', err);
      setLoginError('Erro ao carregar perfil: ' + err.message);
      signOut(auth);
    } finally {
      setLoading(false);
      setIsLoggingIn(false);
    }
  };

  const [syncError, setSyncError] = useState<string | null>(null);

  useEffect(() => {
    if (!currentUser) return;

    const isAdminOrManager = currentUser.role === UserRole.ADMIN || currentUser.role === UserRole.SUPERVISOR;
    
    let unsubSales: any;

    let unsubRankingSales: any;
    let unsubReceipts: any;
    let unsubProfiles: any;
    let unsubLogs: any;
    let unsubPayments: any;

    setSyncError(null);

    const handleSyncError = (error: any, context: string) => {
      console.error(`Erro de sincronização (${context}):`, error);
      setSyncError(`Falha na sincronização de dados (${context}). Por favor, recarregue a página.`);
    };

    const sortSales = (salesList: Sale[]) => {
      return salesList.sort((a, b) => {
        const timeA = new Date(a.created_at).getTime() || 0;
        const timeB = new Date(b.created_at).getTime() || 0;
        if (timeB !== timeA) return timeB - timeA;
        const updatedA = new Date(a.updated_at || a.created_at).getTime() || 0;
        const updatedB = new Date(b.updated_at || b.created_at).getTime() || 0;
        if (updatedB !== updatedA) return updatedB - updatedA;
        return b.id.localeCompare(a.id);
      });
    };

    if (isAdminOrManager) {
      const salesQ = query(collection(db, 'sales'), orderBy('created_at', 'desc'));
      const receiptsQ = query(collection(db, 'receipts'), orderBy('created_at', 'desc'));
      
      unsubSales = onSnapshot(salesQ, (snapshot) => {
        const salesData = snapshot.docs.map(doc => ({ ...(doc.data() as Sale), id: doc.id }));
        setSales(sortSales(salesData));
      }, (error) => handleSyncError(error, 'Vendas'));

      unsubReceipts = onSnapshot(receiptsQ, (snapshot) => {
        const receiptsData = snapshot.docs.map(doc => ({ ...(doc.data() as Receipt), id: doc.id }))
          .sort((a, b) => {
            const timeA = new Date(a.created_at).getTime() || 0;
            const timeB = new Date(b.created_at).getTime() || 0;
            if (timeB !== timeA) return timeB - timeA;
            return b.id.localeCompare(a.id);
          });
        setReceipts(receiptsData);
      }, (error) => handleSyncError(error, 'Comprovantes'));
    } else {
      // For Vendedor, fetch only their sales using separate queries
      const salesQ1 = query(collection(db, 'sales'), where('vendedor_id', '==', currentUser.id));
      const salesQ3 = query(collection(db, 'sales'), where('status', '==', SaleStatus.PAGO));
      
      // Using refs to fix stale closure bug - prevents data from disappearing when only one listener fires
      const mySalesRef = { current: [] as Sale[] };
      const rankingSalesRef = { current: [] as Sale[] };

      const mergeSales = () => {
        const merged = [...mySalesRef.current, ...rankingSalesRef.current];
        const uniqueSalesMap = new Map<string, Sale>();
        
        merged.forEach(item => {
          if (!uniqueSalesMap.has(item.id)) {
            uniqueSalesMap.set(item.id, item);
          } else {
            const existing = uniqueSalesMap.get(item.id)!;
            const existingTime = new Date(existing.updated_at || existing.created_at).getTime() || 0;
            const newTime = new Date(item.updated_at || item.created_at).getTime() || 0;
            if (newTime > existingTime) {
              uniqueSalesMap.set(item.id, item);
            }
          }
        });
        
        setSales(sortSales(Array.from(uniqueSalesMap.values())));
      };

      unsubSales = onSnapshot(salesQ1, (snapshot) => {
        mySalesRef.current = snapshot.docs.map(doc => ({ ...(doc.data() as Sale), id: doc.id }));
        mergeSales();
      }, (error) => handleSyncError(error, 'Minhas Vendas'));

      // For ranking, use all PAGO sales - but only listen, don't block on index errors
      unsubRankingSales = onSnapshot(salesQ3, (snapshot) => {
        rankingSalesRef.current = snapshot.docs.map(doc => ({ ...(doc.data() as Sale), id: doc.id }));
        mergeSales();
      }, (error) => {
        console.warn('Ranking query requires a Firestore index. Ranking may only show your own sales.', error);
        // Don't call handleSyncError - ranking will work with the user's own sales
      });

      const receiptsQ = query(collection(db, 'receipts'), where('vendedor_id', '==', currentUser.id));
      unsubReceipts = onSnapshot(receiptsQ, (snapshot) => {
        const receiptsData = snapshot.docs.map(doc => ({ ...(doc.data() as Receipt), id: doc.id }))
          .sort((a, b) => {
            const timeA = new Date(a.created_at).getTime() || 0;
            const timeB = new Date(b.created_at).getTime() || 0;
            if (timeB !== timeA) return timeB - timeA;
            return b.id.localeCompare(a.id);
          });
        setReceipts(receiptsData);
      }, (error) => handleSyncError(error, 'Meus Comprovantes'));
    }

    if (currentUser.role === UserRole.ADMIN) {
      unsubProfiles = onSnapshot(collection(db, 'profiles'), (snapshot) => {
        setUsers(snapshot.docs.map(doc => ({ ...(doc.data() as UserProfile), id: doc.id })));
      }, (error) => handleSyncError(error, 'Perfis'));
      unsubLogs = onSnapshot(query(collection(db, 'audit_logs'), orderBy('created_at', 'desc'), limit(100)), (snapshot) => {
        setLogs(snapshot.docs.map(doc => ({ ...(doc.data() as AuditLog), id: doc.id })));
      }, (error) => handleSyncError(error, 'Logs'));
      unsubPayments = onSnapshot(query(collection(db, 'payments'), orderBy('created_at', 'desc')), (snapshot) => {
        setPayments(snapshot.docs.map(doc => ({ ...(doc.data() as Payment), id: doc.id })));
      }, (error) => handleSyncError(error, 'Pagamentos'));
    } else {
      unsubProfiles = onSnapshot(collection(db, 'profiles'), (snapshot) => {
        setUsers(snapshot.docs.map(doc => ({ ...(doc.data() as UserProfile), id: doc.id })));
      }, (error) => handleSyncError(error, 'Perfis'));
      unsubPayments = onSnapshot(query(collection(db, 'payments'), where('vendedor_id', '==', currentUser.id)), (snapshot) => {
        const paymentsData = snapshot.docs.map(doc => ({ ...(doc.data() as Payment), id: doc.id }));
        paymentsData.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        setPayments(paymentsData);
      }, (error) => handleSyncError(error, 'Meus Pagamentos'));
    }

    return () => {
      if (unsubSales) unsubSales();
      if (unsubRankingSales) unsubRankingSales();
      if (unsubReceipts) unsubReceipts();
      if (unsubProfiles) unsubProfiles();
      if (unsubLogs) unsubLogs();
      if (unsubPayments) unsubPayments();
    };
  }, [currentUser]);

  // Customers listener (all users)
  useEffect(() => {
    if (!currentUser) return;
    const unsubCustomers = onSnapshot(collection(db, 'customers'), (snapshot) => {
      setCustomers(snapshot.docs.map(doc => ({ ...(doc.data() as Customer), id: doc.id })));
    });
    return () => unsubCustomers();
  }, [currentUser]);

  // Cleanup date listener (Firestore-persisted)
  useEffect(() => {
    if (!currentUser) return;
    const unsubCleanup = onSnapshot(doc(db, 'settings', 'cleanup'), (snap) => {
      if (snap.exists()) {
        setLastCleanupDate(snap.data().lastCleanupDate || null);
      }
    });
    return () => unsubCleanup();
  }, [currentUser]);

  // --- Background Cleanup Routine ---
  // TODO: Implement server-side job for data retention and cleanup
  useEffect(() => {
    // Cleanup removed from frontend to prevent destructive actions
  }, [currentUser]);

  // --- Timer refresh for stale AGUARDANDO alerts ---
  const [, setTimerTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTimerTick(t => t + 1), 60000);
    return () => clearInterval(interval);
  }, []);

  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    setIsLoggingIn(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err: any) {
      setLoginError('Erro inesperado: ' + err.message);
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    if (currentUser) await addLog(currentUser, 'Logout do sistema');
    await signOut(auth);
    setCurrentUser(null);
    setCurrentPage('dashboard');
    setEmail('');
    setPassword('');
    setLoginError('');
  };

  const addLog = async (user: UserProfile, action: string, targetId?: string) => {
    try {
      await addDoc(collection(db, 'audit_logs'), {
        user_id: user.id,
        user_name: user.name,
        action,
        target_id: targetId || null,
        created_at: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error adding log:', error);
    }
  };

  // --- Logic ---

  const mySales = useMemo(() => {
    return sales.filter(sale => {
      if (sale.status === SaleStatus.DELETED) return false;
      if (sale.sale_type === SaleType.RECORRENTE && !sale.parent_contract_id) return false;
      
      const isAdminOrManager = currentUser?.role === UserRole.ADMIN || currentUser?.role === UserRole.SUPERVISOR;
      if (!isAdminOrManager) {
        const isOwner = sale.vendedor_id === currentUser?.id;
        if (!isOwner) {
          return false;
        }
      }

      const matchVendedor = !filters.vendedor || sale.vendedor_id === filters.vendedor;
      const matchStatus = !filters.status || sale.status === filters.status;
      
      let matchStartDate = true;
      let matchEndDate = true;
      if (filters.startDate || filters.endDate) {
        const saleDate = new Date(sale.created_at);
        if (filters.startDate) {
          matchStartDate = saleDate >= new Date(filters.startDate + 'T00:00:00');
        }
        if (filters.endDate) {
          matchEndDate = saleDate <= new Date(filters.endDate + 'T23:59:59');
        }
      }
      
      return matchVendedor && matchStatus && matchStartDate && matchEndDate;
    }).filter(sale => {
      // Search filter by phone
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matchPhone = sale.phone?.toLowerCase().includes(q);
        const matchName = sale.name?.toLowerCase().includes(q);
        if (!matchPhone && !matchName) return false;
      }
      return true;
    }).map(sale => {
      const existingReceipt = receipts.find(r => r.sale_id === sale.id);
      return { ...sale, receipt_id: existingReceipt?.id };
    });
  }, [sales, filters, receipts, currentUser, searchQuery]);

  // --- Dynamic LTV: only count PAGO sales ---
  const getCustomerLTV = useCallback((customerId: string) => {
    const customerSales = sales.filter(s => s.customer_id === customerId && s.status === SaleStatus.PAGO);
    return {
      total_spent: customerSales.reduce((acc, s) => acc + s.value, 0),
      total_purchases: customerSales.length,
    };
  }, [sales]);

  // Helper: PAGO sale only counts in revenue if receipt is approved or no receipt exists
  const isSaleRevenueApproved = useCallback((sale: Sale) => {
    if (sale.status !== SaleStatus.PAGO) return false;
    const saleReceipts = receipts.filter(r => r.sale_id === sale.id);
    if (saleReceipts.length === 0) return true; // no receipt = cash, counts
    return saleReceipts.some(r => r.audit_status === 'approved');
  }, [receipts]);


  const expiringContractsCount = useMemo(() => {
    if (!currentUser) return 0;
    const now = new Date();
    const in7Days = new Date();
    in7Days.setDate(in7Days.getDate() + 7);
    
    return sales.filter(s => {
      if (s.sale_type !== SaleType.RECORRENTE || s.contract_status !== ContractStatus.ATIVO || !s.next_billing_date) return false;
      const nextBilling = new Date(`${s.next_billing_date}T23:59:59`);
      return nextBilling >= now && nextBilling <= in7Days;
    }).length;
  }, [sales, currentUser]);

  const ranking = useMemo(() => {
    const today = toLocalDateString(new Date().toISOString());
    const currentMonth = today.substring(0, 7);
    
    // Fixed: avoid Date mutation bug by creating separate Date objects
    const now = new Date();
    const dayOfWeek = now.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const startOfWeekDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + mondayOffset);
    const endOfWeekDate = new Date(startOfWeekDate.getFullYear(), startOfWeekDate.getMonth(), startOfWeekDate.getDate() + 6);
    const startOfWeek = toLocalDateString(startOfWeekDate.toISOString());
    const endOfWeek = toLocalDateString(endOfWeekDate.toISOString());

    const stats = users
      .map(u => {
        const userSales = sales.filter(s => {
          if (s.vendedor_id !== u.id || !isSaleRevenueApproved(s)) return false;
          const paidRef = s.paid_at || s.updated_at;
          if (!paidRef) return false;
          const paidDate = toLocalDateString(paidRef);
          
          if (rankingFilter === 'daily') {
            return paidDate === today;
          } else if (rankingFilter === 'weekly') {
            return paidDate >= startOfWeek && paidDate <= endOfWeek;
          } else if (rankingFilter === 'monthly') {
            return paidDate.startsWith(currentMonth);
          }
          return true;
        });
        return {
          id: u.id,
          name: u.name,
          photo_url: u.photo_url,
          count: userSales.length,
          total: userSales.reduce((acc, s) => acc + s.value, 0)
        };
      })
      .filter(u => u.count > 0 || true) // Always show all users in ranking
      .sort((a, b) => b.total - a.total);
    return stats;
  }, [sales, users, rankingFilter, isSaleRevenueApproved]);

  const stats = useMemo(() => {
    const start = dateRange.start;
    const end = dateRange.end;
    const hasDateFilter = !!start || !!end;
    
    // Apply dashboard vendor filter for admins
    const isAdminOrManager = currentUser?.role === UserRole.ADMIN || currentUser?.role === UserRole.SUPERVISOR;
    const dashboardSales = isAdminOrManager && dashboardVendorFilter
      ? mySales.filter(s => s.vendedor_id === dashboardVendorFilter)
      : mySales;

    // Leads created in this range (or all if no filter)
    const createdInRange = hasDateFilter ? dashboardSales.filter(s => {
      const date = toLocalDateString(s.created_at);
      if (start && date < start) return false;
      if (end && date > end) return false;
      return true;
    }) : dashboardSales;
    
    // Revenue from sales PAID in this range (or all if no filter)
    const paidInRange = dashboardSales.filter(s => {
      if (!isSaleRevenueApproved(s)) return false;
      const paidRef = s.paid_at || s.updated_at;
      if (!paidRef) return false;
      if (!hasDateFilter) return true;
      const date = toLocalDateString(paidRef);
      if (start && date < start) return false;
      if (end && date > end) return false;
      return true;
    });
    
    const dailyTotal = paidInRange.reduce((acc, s) => acc + s.value, 0);
    const targetMonth = (start || getLocalISODate()).substring(0, 7);
    const monthlyTotal = dashboardSales
      .filter(s => isSaleRevenueApproved(s) && toLocalDateString(s.paid_at || s.updated_at).startsWith(targetMonth))
      .reduce((acc, s) => acc + s.value, 0);

    const statusCounts = {
      [SaleStatus.AGUARDANDO]: createdInRange.filter(s => s.status === SaleStatus.AGUARDANDO).length,
      [SaleStatus.PENDENTE]: createdInRange.filter(s => s.status === SaleStatus.PENDENTE).length,
      [SaleStatus.PAGO]: createdInRange.filter(s => s.status === SaleStatus.PAGO).length,
      [SaleStatus.CANCELADO]: createdInRange.filter(s => s.status === SaleStatus.CANCELADO).length,
    };

    const conversionRate = createdInRange.length > 0 ? (createdInRange.filter(s => s.status === SaleStatus.PAGO).length / createdInRange.length) * 100 : 0;

    const filteredForMRR = isAdminOrManager && dashboardVendorFilter
      ? sales.filter(s => s.vendedor_id === dashboardVendorFilter)
      : sales;
    const mrr = filteredForMRR
      .filter(s => s.sale_type === SaleType.RECORRENTE && s.contract_status === ContractStatus.ATIVO)
      .reduce((acc, s) => acc + s.value, 0);
    const activeContracts = filteredForMRR.filter(s => s.sale_type === SaleType.RECORRENTE && s.contract_status === ContractStatus.ATIVO).length;
    // Count NEW leads = new customers created in this range
    const newLeadsInRange = customers.filter(c => {
      const date = toLocalDateString(c.created_at);
      if (hasDateFilter) {
        if (start && date < start) return false;
        if (end && date > end) return false;
      }
      // Filter by vendor if applicable
      if (isAdminOrManager && dashboardVendorFilter) {
        return dashboardSales.some(s => s.customer_id === c.id);
      }
      if (!isAdminOrManager && currentUser) {
        return dashboardSales.some(s => s.customer_id === c.id);
      }
      return true;
    });

    return {
      dailyTotal,
      monthlyTotal,
      mrr,
      activeContracts,
      dailyCount: newLeadsInRange.length,
      statusCounts,
      conversionRate,
      goalProgress: currentUser?.daily_goal ? (dailyTotal / currentUser.daily_goal) * 100 : 0
    };
  }, [mySales, sales, currentUser, dateRange, dashboardVendorFilter]);

  const adminGoalTracking = useMemo(() => {
    if (!currentUser) return [];
    
    const start = dateRange.start || getLocalISODate();
    const end = dateRange.end || getLocalISODate();
    
    return users
      .filter(u => u.role !== UserRole.SUPERVISOR)
      .map(u => {
        const sellerSales = sales.filter(s => {
          if (s.vendedor_id !== u.id || s.status !== SaleStatus.PAGO) return false;
          const paidRef = s.paid_at || s.updated_at;
          if (!paidRef) return false;
          const date = toLocalDateString(paidRef);
          return date >= start && date <= end;
        });
        
        const totalSold = sellerSales.reduce((acc, s) => acc + s.value, 0);
        const goal = u.daily_goal || 0;
        const progress = goal > 0 ? Math.min((totalSold / goal) * 100, 100) : 0;
        const remaining = Math.max(goal - totalSold, 0);
        
        return {
          id: u.id,
          name: u.name,
          photo_url: u.photo_url,
          totalSold,
          goal,
          progress,
          remaining
        };
      })
      .filter(u => u.goal > 0 || u.totalSold > 0) // Only show users who have a goal set or have sold something
      .sort((a, b) => b.progress - a.progress);
  }, [sales, users, dateRange, currentUser]);

  // --- Actions ---


  const handleContractAction = async (saleId: string, actionItem: 'pause' | 'resume' | 'cancel' | 'inadimplente' | 'pay') => {
    if (!currentUser) return;
    
    // Confirmations for dangerous contract actions
    if (actionItem === 'cancel') {
      setConfirmModal({
        title: '⚠️ Cancelar Contrato',
        message: 'Tem certeza que deseja CANCELAR este contrato? Esta ação não pode ser desfeita facilmente.',
        confirmText: 'Cancelar Contrato',
        onConfirm: () => executeContractAction(saleId, actionItem)
      });
      return;
    }
    if (actionItem === 'inadimplente') {
      setConfirmModal({
        title: '⚠️ Marcar Inadimplente',
        message: 'Deseja marcar este contrato como INADIMPLENTE?',
        confirmText: 'Confirmar',
        onConfirm: () => executeContractAction(saleId, actionItem)
      });
      return;
    }

    await executeContractAction(saleId, actionItem);
  };

  const executeContractAction = async (saleId: string, actionItem: string) => {
    if (!currentUser) return;
    try {
      const saleRef = doc(db, 'sales', saleId);
      let updates: Partial<Sale> = { updated_at: new Date().toISOString() };
      let logMsg = '';

      switch (actionItem) {
        case 'pause':
          updates.contract_status = ContractStatus.PAUSADO;
          logMsg = `Pausou contrato da venda`;
          break;
        case 'resume':
          updates.contract_status = ContractStatus.ATIVO;
          logMsg = `Retomou contrato da venda`;
          break;
        case 'inadimplente':
          updates.contract_status = ContractStatus.INADIMPLENTE;
          logMsg = `Marcou contrato como inadimplente`;
          break;
        case 'cancel':
          updates.contract_status = ContractStatus.CANCELADO;
          logMsg = `Cancelou contrato da venda`;
          break;
        case 'pay':
          const saleObj = sales.find(s => s.id === saleId);
          if (saleObj) {
            // Guard: prevent double payment
            const nextBilling = saleObj.next_billing_date || saleObj.contract_start;
            if (nextBilling && new Date(`${nextBilling}T23:59:59`) > new Date()) {
              showToast('Este período já foi pago. Aguarde o próximo vencimento.', 'warning');
              return;
            }

            const billingPeriod = nextBilling || new Date().toISOString().split('T')[0];
            const currentNextBilling = new Date(billingPeriod);
            if (saleObj.billing_cycle === 'trimestral') currentNextBilling.setMonth(currentNextBilling.getMonth() + 3);
            else if (saleObj.billing_cycle === 'semestral') currentNextBilling.setMonth(currentNextBilling.getMonth() + 6);
            else if (saleObj.billing_cycle === 'anual') currentNextBilling.setFullYear(currentNextBilling.getFullYear() + 1);
            else currentNextBilling.setMonth(currentNextBilling.getMonth() + 1);
            
            updates.next_billing_date = currentNextBilling.toISOString().split('T')[0];
            updates.last_payment_date = new Date().toISOString();
            updates.contract_status = ContractStatus.ATIVO;

            // Create child sale for commission tracking
            await addDoc(collection(db, 'sales'), {
              phone: saleObj.phone,
              name: saleObj.name || '',
              service: saleObj.service,
              services: saleObj.services || [saleObj.service],
              value: saleObj.value,
              status: SaleStatus.PAGO,
              paid_at: new Date().toISOString(),
              sale_type: SaleType.RECORRENTE,
              vendedor_id: saleObj.vendedor_id,
              customer_id: saleObj.customer_id,
              parent_contract_id: saleId,
              billing_period: billingPeriod,
              commission_paid: false,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            });

            logMsg = `Registrou pagamento (${billingPeriod}) e renovou ciclo do contrato para ${updates.next_billing_date}`;
          }
          break;
      }

      await updateDoc(saleRef, updates);
      await addLog(currentUser, logMsg, saleId);
      showToast('Ação no contrato realizada com sucesso!', 'success');
    } catch (error: any) {
      showToast('Erro ao atualizar contrato: ' + error.message, 'error');
    }
  };



  const handleAddLead = async (leadData: any) => {
    if (!currentUser) return;
    
    if (leadData.value < 0) {
      showToast('O valor não pode ser negativo.', 'warning');
      return;
    }

    try {
      // Check for duplicate lead (same phone within last 5 minutes)
      const normalizedPhone = leadData.phone.replace(/\D/g, '');
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const recentDuplicate = sales.find(s => 
        s.phone.replace(/\D/g, '') === normalizedPhone && 
        s.created_at > fiveMinAgo &&
        s.vendedor_id === currentUser.id
      );
      if (recentDuplicate) {
        setConfirmModal({
          title: '⚠️ Lead Duplicado',
          message: 'Já existe um lead com este telefone registrado há poucos minutos. Deseja realmente criar um NOVO lead duplicado?',
          confirmText: 'Criar Mesmo Assim',
          onConfirm: async () => {
            const existingCustomer = customers.find(c => c.phone.replace(/\D/g, '') === normalizedPhone);
            if (existingCustomer) {
              setDuplicateCustomerFound(existingCustomer);
              setPendingLeadData(leadData);
            } else {
              await proceedWithLead(leadData, null);
            }
          }
        });
        return;
      }

      // Check if customer already exists by phone
      const existingCustomer = customers.find(c => c.phone.replace(/\D/g, '') === normalizedPhone);
      
      // If customer exists, show modal with options
      if (existingCustomer) {
        setDuplicateCustomerFound(existingCustomer);
        setPendingLeadData(leadData);
        return; // Wait for user choice in modal
      }

      // No existing customer, proceed normally
      await proceedWithLead(leadData, null);
    } catch (error: any) {
      showToast('Erro ao salvar lead: ' + error.message, 'error');
    }
  };

  const proceedWithLead = async (leadData: any, existingCustomer: Customer | null) => {
    if (!currentUser) return;
    try {
      let customerId: string;
      let isReturning = false;

      if (existingCustomer) {
        customerId = existingCustomer.id;
        isReturning = true;
        await updateDoc(doc(db, 'customers', customerId), {
          total_spent: (existingCustomer.total_spent || 0) + leadData.value,
          total_purchases: (existingCustomer.total_purchases || 0) + 1,
          services: [...new Set([...(existingCustomer.services || []), ...(leadData.services || [leadData.service])])],
          updated_at: new Date().toISOString(),
        });
        showToast(`Venda adicionada ao cliente existente (${existingCustomer.name})`, 'success');
      } else {
        const customerRef = await addDoc(collection(db, 'customers'), {
          name: leadData.name || leadData.phone,
          phone: leadData.phone,
          email: '',
          first_purchase_date: leadData.created_at || new Date().toISOString(),
          total_spent: leadData.value,
          total_purchases: 1,
          services: leadData.services || [leadData.service],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        customerId = customerRef.id;
      }

      const saleData: any = {
        ...leadData,
        name: leadData.name || 'Cliente',
        vendedor_id: currentUser.id,
        customer_id: customerId,
        is_returning_customer: isReturning,
        sale_type: leadData.sale_type || SaleType.PONTUAL,
        created_at: leadData.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      if (leadData.sale_type === SaleType.RECORRENTE) {
        saleData.billing_cycle = leadData.billing_cycle || 'mensal';
        saleData.contract_start = leadData.contract_start || new Date().toISOString().split('T')[0];
        saleData.contract_end = leadData.contract_end || '';
        saleData.contract_status = ContractStatus.ATIVO;
        const start = new Date(saleData.contract_start);
        if (leadData.billing_cycle === 'trimestral') start.setMonth(start.getMonth() + 3);
        else if (leadData.billing_cycle === 'semestral') start.setMonth(start.getMonth() + 6);
        else if (leadData.billing_cycle === 'anual') start.setFullYear(start.getFullYear() + 1);
        else start.setMonth(start.getMonth() + 1);
        saleData.next_billing_date = start.toISOString().split('T')[0];
      }

      const docRef = await addDoc(collection(db, 'sales'), saleData);
      await addLog(currentUser, `Registrou novo lead: ${leadData.phone}${isReturning ? ' (cliente retornante)' : ''}`, docRef.id);
      clearFilters();
      setTimeout(() => {
        setCurrentPage(leadData.sale_type === SaleType.RECORRENTE ? 'contracts' : 'sales');
      }, 100);
    } catch (error: any) {
      showToast('Erro ao salvar lead: ' + error.message, 'error');
    }
  };

  const handleEditSale = async (saleId: string, updatedData: any, newReceipt?: File) => {
    if (!currentUser) return;
    setIsSubmitting(true);

    try {
      const sale = sales.find(s => s.id === saleId);
      if (updatedData.status === SaleStatus.PAGO && !sale?.receipt_id && !newReceipt) {
        showToast('Não é possível marcar como PAGO sem um comprovante enviado. Anexe o comprovante primeiro.', 'warning');
        setIsSubmitting(false);
        return;
      }

      const finalUpdates = { ...updatedData };
      if (updatedData.status === SaleStatus.PAGO && sale?.status !== SaleStatus.PAGO) {
        finalUpdates.paid_at = new Date().toISOString();
      }

      // Clear receipt_rejected flag when sale is edited (value changed or new receipt)
      if (sale?.receipt_rejected) {
        finalUpdates.receipt_rejected = false;
        finalUpdates.receipt_rejection_reason = null;
      }

      await updateDoc(doc(db, 'sales', saleId), {
        ...finalUpdates,
        updated_at: new Date().toISOString()
      });

      if (newReceipt) {
        await handleUploadReceipt(saleId, newReceipt);
      }

      let changes = [];
      if (sale) {
        if ('name' in updatedData && sale.name !== updatedData.name) changes.push(`Nome: ${sale.name || 'Vazio'} -> ${updatedData.name}`);
        if ('phone' in updatedData && sale.phone !== updatedData.phone) changes.push(`Telefone: ${sale.phone} -> ${updatedData.phone}`);
        if ('service' in updatedData && sale.service !== updatedData.service) changes.push(`Serviço: ${sale.service} -> ${updatedData.service}`);
        if ('value' in updatedData && sale.value !== updatedData.value) changes.push(`Valor: R$ ${sale.value} -> R$ ${updatedData.value}`);
        if ('status' in updatedData && sale.status !== updatedData.status) changes.push(`Status: ${sale.status} -> ${updatedData.status}`);
      }
      const changeString = changes.length > 0 ? ` (${changes.join(', ')})` : '';

      await addLog(currentUser, `Editou venda ${saleId}${changeString}`, saleId);
      setEditingSale(null);
    } catch (error: any) {
      showToast('Erro ao editar venda: ' + error.message, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDragStart = (e: React.DragEvent, saleId: string) => {
    e.dataTransfer.setData('saleId', saleId);
  };

  const handleDrop = async (e: React.DragEvent, newStatus: SaleStatus) => {
    e.preventDefault();
    const saleId = e.dataTransfer.getData('saleId');
    if (saleId) {
      await handleUpdateStatus(saleId, newStatus);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleUpdateStatus = async (saleId: string, newStatus: SaleStatus, forceUpdate: boolean = false, returnDate?: string) => {
    if (!currentUser) return;
    
    const sale = sales.find(s => s.id === saleId);
    const hasReceipt = receipts.some(r => r.sale_id === saleId && r.status !== ReceiptStatus.REJEITADO);
    
    if (newStatus === SaleStatus.PAGO && !hasReceipt && !forceUpdate) {
      setSalePendingReceipt(sale || null);
      return;
    }

    if (newStatus === SaleStatus.ARQUIVADO) {
      setConfirmInput('');
      setConfirmModal({
        title: 'Arquivar Lead?',
        message: 'Este lead será removido do Fluxo de Vendas e não aparecerá mais no Kanban nem na Lista. Ele continuará visível na aba Clientes com todo o histórico.',
        confirmText: 'Arquivar',
        onConfirm: async () => {
          try {
            await updateDoc(doc(db, 'sales', saleId), { 
              status: SaleStatus.ARQUIVADO, 
              updated_at: new Date().toISOString() 
            });
            await addLog(currentUser, `Arquivou a venda ${saleId}`, saleId);
            showToast('Lead arquivado com sucesso!', 'success');
          } catch (error: any) {
            showToast('Erro ao arquivar: ' + error.message, 'error');
          }
        }
      });
      return;
    }

    if (newStatus === SaleStatus.EXCLUSAO_SOLICITADA) {
      const otherActiveSales = sales.filter(s => 
        s.customer_id === sale?.customer_id && 
        s.id !== saleId && 
        s.status !== SaleStatus.DELETED && 
        s.status !== SaleStatus.EXCLUSAO_SOLICITADA
      );
      
      if (otherActiveSales.length > 0) {
        // Customer has other sales - warn and suggest archiving
        setConfirmModal({
          title: '⚠️ Cliente com outras vendas',
          message: `Este cliente possui ${otherActiveSales.length} outra(s) venda(s) ativa(s). Recomendamos ARQUIVAR em vez de excluir. Se prosseguir com a exclusão, apenas esta venda será removida mas o cliente permanecerá.`,
          confirmText: 'Solicitar Exclusão Mesmo Assim',
          cancelText: 'Arquivar em vez disso',
          onConfirm: async () => {
            try {
              await updateDoc(doc(db, 'sales', saleId), {
                status: SaleStatus.EXCLUSAO_SOLICITADA,
                previous_status: sale?.status,
                updated_at: new Date().toISOString()
              });
              await addLog(currentUser, `Solicitou exclusão da venda ${saleId} (cliente tem ${otherActiveSales.length} outra(s) venda(s))`, saleId);
              showToast('Solicitação de exclusão enviada ao admin.', 'info');
            } catch (err: any) {
              showToast('Erro: ' + err.message, 'error');
            }
          },
          onCancel: async () => {
            try {
              await updateDoc(doc(db, 'sales', saleId), {
                status: SaleStatus.ARQUIVADO,
                updated_at: new Date().toISOString()
              });
              await addLog(currentUser, `Arquivou a venda ${saleId}`, saleId);
              showToast('Lead arquivado com sucesso!', 'success');
            } catch (err: any) {
              showToast('Erro ao arquivar: ' + err.message, 'error');
            }
          }
        });
        return;
      }
      
      setConfirmModal({
        title: '🗑️ Solicitar Exclusão',
        message: 'Tem certeza que deseja solicitar a EXCLUSÃO desta venda e do cliente? Um administrador precisará aprovar.',
        confirmText: 'Solicitar Exclusão',
        onConfirm: async () => {
          try {
            await updateDoc(doc(db, 'sales', saleId), {
              status: SaleStatus.EXCLUSAO_SOLICITADA,
              previous_status: sale?.status,
              updated_at: new Date().toISOString()
            });
            await addLog(currentUser, `Solicitou exclusão da venda ${saleId}`, saleId);
            showToast('Solicitação de exclusão enviada ao admin.', 'info');
          } catch (err: any) {
            showToast('Erro: ' + err.message, 'error');
          }
        }
      });
      return;
    }



    const updates: any = { 
      status: newStatus, 
      updated_at: new Date().toISOString() 
    };

    if (newStatus === SaleStatus.PAGO) {
      updates.paid_at = new Date().toISOString();
    }
    


    try {
      await updateDoc(doc(db, 'sales', saleId), updates);
      await addLog(currentUser, `Alterou status da venda ${saleId} de ${sale?.status} para ${newStatus}`, saleId);
    } catch (error: any) {
      showToast('Erro ao atualizar status: ' + error.message, 'error');
    }
  };





  const handleDeleteSale = async (saleId: string | null) => {
    if (!currentUser || !saleId) return;
    
    setIsSubmitting(true);
    try {
      const sale = sales.find(s => s.id === saleId);
      if (!sale) return;

      if (currentUser.role === UserRole.ADMIN || currentUser.role === UserRole.SUPERVISOR) {
        await updateDoc(doc(db, 'sales', saleId), {
          status: SaleStatus.DELETED,
          previous_status: sale.status,
          deleted_at: new Date().toISOString(),
          deleted_by: currentUser.id,
          updated_at: new Date().toISOString()
        });
        await addLog(currentUser, `Moveu venda ${saleId} para lixeira`, saleId);
        showToast('Venda movida para a lixeira.', 'success');
      } else {
        await updateDoc(doc(db, 'sales', saleId), {
          status: SaleStatus.EXCLUSAO_SOLICITADA,
          previous_status: sale.status,
          updated_at: new Date().toISOString()
        });
        await addLog(currentUser, `Solicitou exclusão da venda ${saleId}`, saleId);
        showToast('Solicitação de exclusão enviada!', 'success');
      }
    } catch (error: any) {
      showToast('Erro ao excluir venda: ' + error.message, 'error');
    } finally {
      setDeletingSaleId(null);
      setEditingSale(null);
      setIsSubmitting(false);
    }
  };

  const handleDeleteCustomer = async (customerId: string, customerName: string) => {
    if (!currentUser || (currentUser.role !== UserRole.ADMIN)) return;
    const customerSales = sales.filter(s => s.customer_id === customerId);
    const salesCount = customerSales.length;
    const salesWarning = salesCount > 0 
      ? `\n\n⚠️ Este cliente possui ${salesCount} venda(s) que também serão excluídas permanentemente do sistema.` 
      : '';
    setConfirmInput('');
    setConfirmModal({
      title: '⚠️ Excluir Cliente',
      message: `Você está prestes a excluir permanentemente o cliente "${customerName}".${salesWarning}\n\nEsta ação não pode ser desfeita.`,
      confirmText: 'Continuar',
      cancelText: 'Cancelar',
      onConfirm: () => {
        setConfirmInput('');
        setConfirmModal({
          title: '🚨 Confirmação Final',
          message: `Para excluir "${customerName}"${salesCount > 0 ? ` e suas ${salesCount} venda(s)` : ''} permanentemente, digite EXCLUIR abaixo.`,
          requireInput: 'EXCLUIR',
          confirmText: 'Excluir Permanentemente',
          cancelText: 'Cancelar',
          onConfirm: async () => {
            try {
              // Delete all associated sales
              for (const sale of customerSales) {
                // Delete any receipts linked to this sale
                const saleReceipts = receipts.filter(r => r.sale_id === sale.id);
                for (const receipt of saleReceipts) {
                  await deleteDoc(doc(db, 'receipts', receipt.id));
                }
                await deleteDoc(doc(db, 'sales', sale.id));
              }
              // Delete the customer
              await deleteDoc(doc(db, 'customers', customerId));
              await addLog(currentUser!, `Excluiu o cliente ${customerName} (${customerId}) e ${salesCount} venda(s) associada(s)`, customerId);
              showToast(`Cliente "${customerName}" e ${salesCount} venda(s) excluídos com sucesso!`, 'success');
            } catch (error: any) {
              showToast('Erro ao excluir cliente: ' + error.message, 'error');
            }
          }
        });
      }
    });
  };

  const handleRejectDeletion = async (sale: Sale) => {
    if (!currentUser || (currentUser.role !== UserRole.ADMIN && currentUser.role !== UserRole.SUPERVISOR)) return;
    try {
      const restoredStatus = sale.previous_status || SaleStatus.PENDENTE;
      await updateDoc(doc(db, 'sales', sale.id), {
        status: restoredStatus,
        previous_status: null,
        updated_at: new Date().toISOString()
      });
      await addLog(currentUser, `Rejeitou exclusão da venda ${sale.id}`, sale.id);
    } catch (error: any) {
      showToast('Erro ao rejeitar exclusão: ' + error.message, 'error');
    }
  };



  const handleUpdateReceiptStatus = async (receiptId: string, newStatus: ReceiptStatus) => {
    if (!currentUser || currentUser.role === UserRole.VENDEDOR) return;

    try {
      await updateDoc(doc(db, 'receipts', receiptId), { status: newStatus });
      
      // When marking receipt as PAGO, also mark the sale as PAGO
      if (newStatus === ReceiptStatus.PAGO) {
        const receipt = receipts.find(r => r.id === receiptId);
        if (receipt) {
          await updateDoc(doc(db, 'sales', receipt.sale_id), { 
            status: SaleStatus.PAGO,
            paid_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          });
        }
      }
      
      await addLog(currentUser, `Alterou status do comprovante ${receiptId} para ${newStatus}`, receiptId);
    } catch (error: any) {
      showToast('Erro ao atualizar status do comprovante: ' + error.message, 'error');
    }
  };

  const handleMarkReceiptAsPaid = async (receiptId: string) => {
    if (!currentUser || currentUser.role === UserRole.VENDEDOR) return;

    const receipt = receipts.find(r => r.id === receiptId);
    if (!receipt) return;

    try {
      await updateDoc(doc(db, 'receipts', receiptId), { status: ReceiptStatus.PAGO });
      await updateDoc(doc(db, 'sales', receipt.sale_id), { 
        status: SaleStatus.PAGO,
        paid_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
      await addLog(currentUser, `Aprovou pagamento do comprovante ${receiptId}`, receiptId);
    } catch (error: any) {
      showToast('Erro ao atualizar comprovante: ' + error.message, 'error');
    }
  };

  const handleUpdateUser = async (userId: string, updates: Partial<UserProfile>) => {
    if (!currentUser || (currentUser.role !== UserRole.ADMIN)) return;

    try {
      await updateDoc(doc(db, 'profiles', userId), updates);
      if (userId === currentUser.id) {
        setCurrentUser(prev => prev ? { ...prev, ...updates } : null);
      }
      await addLog(currentUser, `Atualizou dados do usuário ${userId}`, userId);
    } catch (error: any) {
      showToast('Erro ao atualizar usuário: ' + error.message, 'error');
    }
  };

  const handleUpdateProfile = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!currentUser) return;
    
    setIsSubmitting(true);
    const formData = new FormData(e.currentTarget);
    const name = formData.get('name') as string;
    const pix_key = formData.get('pix_key') as string;
    
    try {
      await updateDoc(doc(db, 'profiles', currentUser.id), {
        name,
        pix_key
      });
      setCurrentUser(prev => prev ? { ...prev, name, pix_key } : null);
      await addLog(currentUser, `Atualizou o próprio perfil`, currentUser.id);
      showToast('Perfil atualizado com sucesso!', 'success');
    } catch (error: any) {
      showToast('Erro ao atualizar perfil: ' + error.message, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!auth.currentUser || !currentUser) return;

    const formData = new FormData(e.currentTarget);
    const currentPassword = formData.get('currentPassword') as string;
    const newPassword = formData.get('newPassword') as string;
    const confirmPassword = formData.get('confirmPassword') as string;

    if (newPassword !== confirmPassword) {
      showToast('As novas senhas não coincidem.', 'warning');
      return;
    }

    setIsSubmitting(true);
    try {
      const credential = EmailAuthProvider.credential(auth.currentUser.email!, currentPassword);
      await reauthenticateWithCredential(auth.currentUser, credential);

      await updatePassword(auth.currentUser, newPassword);
      
      await addLog(currentUser, `Alterou a própria senha`, currentUser.id);
      showToast('Senha atualizada com sucesso!', 'success');
      (e.target as HTMLFormElement).reset();
    } catch (error: any) {
      console.error('Error updating password:', error);
      if (error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
        showToast('Senha atual incorreta.', 'error');
      } else {
        showToast('Erro ao atualizar senha: ' + error.message, 'error');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    setConfirmModal({
      title: '⚠️ Excluir Usuário',
      message: 'Tem certeza que deseja excluir este usuário permanentemente? Esta ação não pode ser desfeita e pode afetar o histórico de vendas.',
      confirmText: 'Excluir Permanentemente',
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'profiles', userId));
          await addLog(currentUser, `Excluiu o usuário ${userId}`, userId);
          showToast('Usuário excluído com sucesso!', 'success');
        } catch (error) {
          console.error('Erro ao excluir usuário:', error);
          showToast('Erro ao excluir usuário. Verifique suas permissões.', 'error');
        }
      }
    });
  };

  const handleResetDatabase = async () => {
    if (!currentUser || currentUser.role !== UserRole.ADMIN) return;
    
    setConfirmInput('');
    setConfirmModal({
      title: 'Limpar Dados de Teste',
      message: 'ATENÇÃO: Você está prestes a apagar TODOS os leads, vendas, comprovantes, pagamentos e logs do sistema. Esta ação NÃO pode ser desfeita.',
      requireInput: 'APAGAR TUDO',
      confirmText: 'Apagar Tudo',
      onConfirm: async () => {
        setIsSubmitting(true);
        try {
          const salesSnap = await getDocs(collection(db, 'sales'));
          for (const d of salesSnap.docs) await deleteDoc(doc(db, 'sales', d.id));

          const receiptsSnap = await getDocs(collection(db, 'receipts'));
          for (const d of receiptsSnap.docs) await deleteDoc(doc(db, 'receipts', d.id));

          const paymentsSnap = await getDocs(collection(db, 'payments'));
          for (const d of paymentsSnap.docs) await deleteDoc(doc(db, 'payments', d.id));

          const logsSnap = await getDocs(collection(db, 'audit_logs'));
          for (const d of logsSnap.docs) await deleteDoc(doc(db, 'audit_logs', d.id));

          await addLog(currentUser, 'Resetou o banco de dados (apagou vendas, comprovantes, pagamentos e logs)', currentUser.id);
          showToast('Banco de dados limpo com sucesso!', 'success');
        } catch (error: any) {
          console.error('Erro ao limpar banco de dados:', error);
          showToast('Erro ao limpar banco: ' + error.message, 'error');
        } finally {
          setIsSubmitting(false);
        }
      }
    });
  };

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>, targetUserId: string) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      setCropImageSrc(reader.result as string);
      setTargetUserIdForPhoto(targetUserId);
      setCropModalOpen(true);
    };
    reader.readAsDataURL(file);
    e.target.value = ''; // Reset input
  };

  const onCropComplete = (croppedArea: any, croppedAreaPixels: any) => {
    setCroppedAreaPixels(croppedAreaPixels);
  };

  const handleConfirmCrop = async () => {
    if (!cropImageSrc || !croppedAreaPixels || !targetUserIdForPhoto || !currentUser) return;

    setIsSubmitting(true);
    try {
      const img = new Image();
      img.src = cropImageSrc;
      await new Promise((resolve) => { img.onload = resolve; });

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      if (!ctx) throw new Error('No 2d context');

      const MAX_SIZE = 400;
      const scale = Math.min(MAX_SIZE / croppedAreaPixels.width, MAX_SIZE / croppedAreaPixels.height, 1);
      
      canvas.width = croppedAreaPixels.width * scale;
      canvas.height = croppedAreaPixels.height * scale;

      ctx.drawImage(
        img,
        croppedAreaPixels.x,
        croppedAreaPixels.y,
        croppedAreaPixels.width,
        croppedAreaPixels.height,
        0,
        0,
        canvas.width,
        canvas.height
      );

      const dataUrl = canvas.toDataURL('image/jpeg', 0.8);

      await updateDoc(doc(db, 'profiles', targetUserIdForPhoto), {
        photo_url: dataUrl
      });
      
      if (targetUserIdForPhoto === currentUser.id) {
        setCurrentUser(prev => prev ? { ...prev, photo_url: dataUrl } : null);
      }

      await addLog(currentUser, `Atualizou a foto de perfil`, targetUserIdForPhoto);
      
      setCropModalOpen(false);
      setCropImageSrc(null);
      setTargetUserIdForPhoto(null);
    } catch (error: any) {
      showToast('Erro ao atualizar foto: ' + error.message, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePayVendedor = async (vendedorId: string, amount: number) => {
    if (!currentUser || (currentUser.role !== UserRole.ADMIN)) return;

    if (selectedSalesToPay.length === 0) {
      showToast('Selecione pelo menos uma venda para pagar.', 'warning');
      return;
    }

    setIsUploadingReceipt(true);
    try {
      let receiptUrl = '';
      if (paymentReceipt) {
        receiptUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error('Erro ao ler arquivo'));
          reader.readAsDataURL(paymentReceipt);
        });
      }

      const unpaidSales = sales.filter(s => selectedSalesToPay.includes(s.id));
      
      for (const sale of unpaidSales) {
        await updateDoc(doc(db, 'sales', sale.id), {
          commission_paid: true,
          updated_at: new Date().toISOString()
        });
      }

      await addDoc(collection(db, 'payments'), {
        vendedor_id: vendedorId,
        amount,
        status: 'paid',
        admin_id: currentUser.id,
        created_at: new Date().toISOString(),
        receipt_url: receiptUrl,
        sales_ids: selectedSalesToPay
      });
      
      setPayingSeller(null);
      setSelectedSalesToPay([]);
      setPaymentReceipt(null);
      showToast('Pagamento registrado com sucesso!', 'success');
      await addLog(currentUser, `Registrou pagamento de R$ ${amount} para vendedor ${vendedorId}`, vendedorId);
    } catch (error: any) {
      showToast('Erro ao registrar pagamento: ' + error.message, 'error');
    } finally {
      setIsUploadingReceipt(false);
    }
  };

  const handleUploadReceipt = async (saleId: string, file: File, confirmedValue?: number) => {
    try {
      if (!currentUser) throw new Error('Usuário não autenticado');
      const sale = sales.find(s => s.id === saleId);
      if (!sale) throw new Error('Venda não encontrada');

      if (receipts.some(r => r.sale_id === saleId && r.status !== ReceiptStatus.REJEITADO)) {
        return; // Non-rejected receipt already exists
      }

      // Convert file to base64 (stored directly in Firestore, no Storage needed)
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Erro ao ler arquivo'));
        reader.readAsDataURL(file);
      });

      const finalConfirmedValue = confirmedValue ?? sale.value ?? 0;
      const paidDate = getLocalISODate();
      const imageHash = generateImageHash(base64);

      // Save receipt first with ENVIADO status
      const receiptRef = await addDoc(collection(db, 'receipts'), {
        sale_id: saleId,
        vendedor_id: sale.vendedor_id,
        file_name: file.name,
        file_path: base64,
        status: ReceiptStatus.ENVIADO,
        value: sale.value || 0,
        confirmed_value: finalConfirmedValue,
        image_hash: imageHash,
        paid_date: paidDate,
        audit_status: 'pending',
        created_at: new Date().toISOString()
      });

      await addLog(currentUser, `Enviou comprovante para venda ${saleId}`, receiptRef.id);

      // Clear receipt_rejected flag if it was set
      if (sale.receipt_rejected) {
        await updateDoc(doc(db, 'sales', saleId), { receipt_rejected: false, receipt_rejection_reason: null });
      }
      showToast('Comprovante enviado! Auditando...', 'info');

      // Run OCR audit in background (non-blocking)
      try {
        const result = await auditReceipt(base64, finalConfirmedValue, paidDate, receipts);
        
        const auditStatus = result.status === 'approved' 
          ? ReceiptStatus.AUDITADO_APROVADO 
          : result.status === 'duplicate'
          ? ReceiptStatus.DUPLICADO
          : ReceiptStatus.AUDITADO_DIVERGENTE;

        await updateDoc(doc(db, 'receipts', receiptRef.id), {
          status: auditStatus,
          ocr_value: result.ocrValue,
          ocr_date: result.ocrDate,
          ocr_raw_text: result.rawText,
          audit_status: result.status,
          audit_details: result.details,
          image_hash: result.imageHash,
          audited_at: new Date().toISOString()
        });

        if (result.status === 'approved') {
          showToast('✅ Comprovante auditado e aprovado automaticamente!', 'success');
        } else if (result.status === 'duplicate') {
          // Mark receipt as duplicate (don't delete - sellers don't have delete permission)
          await updateDoc(doc(db, 'receipts', receiptRef.id), {
            status: ReceiptStatus.DUPLICADO,
            audit_status: 'duplicate',
            audit_details: 'Comprovante duplicado detectado',
            audited_at: new Date().toISOString()
          });
          await updateDoc(doc(db, 'sales', saleId), {
            status: SaleStatus.AGUARDANDO,
            paid_at: null,
            receipt_rejected: true,
            receipt_rejection_reason: 'Comprovante Duplicado',
            updated_at: new Date().toISOString()
          });
          await addLog(currentUser, `Comprovante duplicado detectado na venda ${saleId} — venda revertida para Atendimento Iniciado`, saleId);
          showToast('🚫 Comprovante duplicado! Venda devolvida para enviar novo comprovante.', 'error');
        } else {
          showToast(`⚠️ Divergência detectada: ${result.details}`, 'warning');
        }
      } catch (auditErr: any) {
        console.error('Erro na auditoria OCR:', auditErr);
        // Audit failed but receipt was saved - admin can review manually
        await updateDoc(doc(db, 'receipts', receiptRef.id), {
          audit_status: 'error',
          audit_details: `Erro na auditoria: ${auditErr.message}`,
          audited_at: new Date().toISOString()
        });
        showToast('Comprovante enviado, mas auditoria falhou. Admin pode revisar manualmente.', 'warning');
      }
    } catch (err: any) {
      console.error('Erro no processo de upload:', err);
      showToast('Erro no upload: ' + err.message, 'error');
      throw err;
    }
  };

  const handleViewReceipt = (filePath: string) => {
    setViewingImageUrl(filePath);
  };

  const handleCreateUser = async (userData: any) => {
    if (!currentUser || (currentUser.role !== UserRole.ADMIN)) return;
    setIsSubmitting(true);

    try {
      // 1. Create Auth User using a secondary app to avoid logging out the admin
      const secondaryApp = initializeApp(firebaseConfig, 'SecondaryApp');
      const secondaryAuth = getSecondaryAuth(secondaryApp);
      const userCredential = await createUserWithEmailAndPassword(secondaryAuth, userData.email, userData.password);
      const user = userCredential.user;
      
      // Sign out from the secondary app immediately
      await signOut(secondaryAuth);

      // 2. Create Profile
      await setDoc(doc(db, 'profiles', user.uid), {
        id: user.uid,
        name: userData.name,
        username: userData.username,
        role: userData.role || UserRole.VENDEDOR,
        daily_goal: Number(userData.daily_goal),
        commission: Number(userData.commission),
        status: 'ATIVO',
        created_at: new Date().toISOString()
      });

      showToast('Vendedor criado com sucesso!', 'success');
      setShowUserModal(false);
      await addLog(currentUser, `Criou novo vendedor: ${userData.name}`, user.uid);
    } catch (error: any) {
      showToast('Erro ao criar vendedor: ' + error.message, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- Render Helpers ---

  if (configError) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-3xl shadow-xl border border-red-100 p-8 text-center">
          <div className="w-16 h-16 bg-red-100 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <AlertCircle className="text-red-600 w-8 h-8" />
          </div>
          <h2 className="text-xl font-bold text-zinc-900 mb-2">Erro de Conexão</h2>
          <p className="text-zinc-600 mb-8">{configError}</p>
          <div className="bg-zinc-50 rounded-2xl p-4 text-left text-xs font-mono text-zinc-500 mb-8 overflow-auto">
            Dica: Verifique se as variáveis VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY estão configuradas corretamente no menu Settings.
          </div>
          <button 
            onClick={() => window.location.reload()}
            className="w-full bg-zinc-900 text-white font-bold py-3 rounded-xl hover:bg-zinc-800 transition-all"
          >
            Tentar Novamente
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md bg-white rounded-3xl shadow-xl border border-black/5 p-8"
        >
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-indigo-200">
              <TrendingUp className="text-white w-8 h-8" />
            </div>
            <h1 className="text-2xl font-bold text-zinc-900">Dion Logos CRM</h1>
            <p className="text-zinc-500 mt-1">Acesse sua conta para gerenciar vendas</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-6">
            <div>
              <label className="block text-sm font-semibold text-zinc-700 mb-2">E-mail</label>
              <input 
                type="email" 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                placeholder="seu@email.com"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-zinc-700 mb-2">Senha</label>
              <input 
                type="password" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                placeholder="••••••••"
                required
              />
            </div>

            {loginError && (
              <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                {loginError}
              </div>
            )}

            <button 
              type="submit"
              disabled={isLoggingIn}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-xl transition-all shadow-lg shadow-indigo-100 active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isLoggingIn ? (
                <>
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  Entrando...
                </>
              ) : 'Entrar no Sistema'}
            </button>
          </form>
        </motion.div>
      </div>
    );
  }


  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: [UserRole.ADMIN, UserRole.VENDEDOR, UserRole.SUPERVISOR] },
    { id: 'ranking', label: 'Ranking', icon: Trophy, roles: [UserRole.ADMIN, UserRole.VENDEDOR, UserRole.SUPERVISOR] },
    { id: 'new-lead', label: 'Novo Lead', icon: PlusCircle, roles: [UserRole.ADMIN, UserRole.VENDEDOR, UserRole.SUPERVISOR] },
    { id: 'new-sale', label: 'Nova Venda', icon: Plus, roles: [UserRole.ADMIN, UserRole.VENDEDOR, UserRole.SUPERVISOR] },
    { id: 'sales', label: 'Fluxo de Vendas', icon: FileText, roles: [UserRole.ADMIN, UserRole.VENDEDOR, UserRole.SUPERVISOR] },
    { id: 'customers', label: 'Clientes', icon: Briefcase, roles: [UserRole.ADMIN, UserRole.VENDEDOR, UserRole.SUPERVISOR] },
    { id: 'contracts', label: 'Contratos', icon: Repeat, roles: [UserRole.ADMIN, UserRole.VENDEDOR, UserRole.SUPERVISOR], badge: expiringContractsCount },

    { id: 'receipts', label: 'Comprovantes', icon: CheckCircle, roles: [UserRole.ADMIN, UserRole.VENDEDOR, UserRole.SUPERVISOR], badge: newReceiptsCount },
    { id: 'my-payments', label: 'Meus Pagamentos', icon: Wallet, roles: [UserRole.VENDEDOR, UserRole.SUPERVISOR] },
    { id: 'profile', label: 'Meu Perfil', icon: UserIcon, roles: [UserRole.ADMIN, UserRole.VENDEDOR, UserRole.SUPERVISOR] },
    { id: 'users', label: 'Equipe', icon: Users, roles: [UserRole.ADMIN] },
    { id: 'financial', label: 'Financeiro', icon: DollarSign, roles: [UserRole.ADMIN] },

    { id: 'logs', label: 'Auditoria', icon: History, roles: [UserRole.ADMIN] },
    { id: 'trash', label: 'Aprovações de Exclusão', icon: Trash2, roles: [UserRole.ADMIN, UserRole.SUPERVISOR], badge: sales.filter(s => s.status === SaleStatus.EXCLUSAO_SOLICITADA).length },
  ];

  return (
    <div className="min-h-screen bg-zinc-50 flex">
      {/* Mobile Menu Overlay */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setMobileMenuOpen(false)}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40 md:hidden"
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <aside className={`${
        sidebarOpen ? 'w-64' : 'w-20'
      } bg-white border-r border-black/5 transition-all duration-300 flex-col z-50 hidden md:flex`}>
        <div className="p-6 flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shrink-0">
            <TrendingUp className="text-white w-6 h-6" />
          </div>
          {sidebarOpen && <span className="font-bold text-lg text-zinc-900 truncate">Dion Logos</span>}
        </div>

        <nav className="flex-1 px-4 space-y-1">
          {menuItems.filter(item => item.roles.includes(currentUser.role)).map((item) => (
            <button
              key={item.id}
              onClick={() => {
                setCurrentPage(item.id);
                if (item.id === 'receipts') {
                  const now = new Date().toISOString();
                  localStorage.setItem('receiptsLastSeen', now);
                  setReceiptsLastSeen(now);
                }
              }}
              className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all ${
                currentPage === item.id 
                ? 'bg-indigo-50 text-indigo-600' 
                : 'text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900'
              }`}
            >
              <item.icon className="w-5 h-5 shrink-0" />
              {sidebarOpen && <span className="font-medium text-sm">{item.label}</span>}
              {sidebarOpen && (item as any).badge > 0 && (
                <span className="ml-auto bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">{(item as any).badge}</span>
              )}
              {sidebarOpen && !(item as any).badge && currentPage === item.id && <div className="ml-auto w-1.5 h-1.5 bg-indigo-600 rounded-full" />}
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-black/5">
          <div className="flex items-center gap-3 px-3 py-3">
            <div className="w-8 h-8 bg-zinc-100 rounded-full flex items-center justify-center shrink-0 overflow-hidden">
              {currentUser.photo_url ? (
                <img src={currentUser.photo_url} alt={currentUser.name} className="w-full h-full object-cover" />
              ) : (
                <UserIcon className="w-4 h-4 text-zinc-500" />
              )}
            </div>
            {sidebarOpen && (
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-zinc-900 truncate">{currentUser.name}</p>
                <p className="text-xs text-zinc-500 truncate">{currentUser.role}</p>
              </div>
            )}
          </div>
          <button 
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-red-500 hover:bg-red-50 transition-all mt-2"
          >
            <LogOut className="w-5 h-5 shrink-0" />
            {sidebarOpen && <span className="font-medium text-sm">Sair</span>}
          </button>
        </div>
      </aside>

      {/* Mobile Sidebar */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.aside
            initial={{ x: -280 }}
            animate={{ x: 0 }}
            exit={{ x: -280 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed top-0 left-0 w-72 h-full bg-white border-r border-black/5 flex flex-col z-50 md:hidden shadow-2xl"
          >
            <div className="p-6 flex items-center gap-3">
              <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shrink-0">
                <TrendingUp className="text-white w-6 h-6" />
              </div>
              <span className="font-bold text-lg text-zinc-900 truncate">Dion Logos</span>
            </div>

            <nav className="flex-1 px-4 space-y-1 overflow-y-auto">
              {menuItems.filter(item => item.roles.includes(currentUser.role)).map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    setCurrentPage(item.id);
                    if (item.id === 'receipts') {
                      const now = new Date().toISOString();
                      localStorage.setItem('receiptsLastSeen', now);
                      setReceiptsLastSeen(now);
                    }
                    setMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all ${
                    currentPage === item.id 
                    ? 'bg-indigo-50 text-indigo-600' 
                    : 'text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900'
                  }`}
                >
                  <item.icon className="w-5 h-5 shrink-0" />
                  <span className="font-medium text-sm">{item.label}</span>
                  {(item as any).badge > 0 && (
                    <span className="ml-auto bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">{(item as any).badge}</span>
                  )}
                  {!(item as any).badge && currentPage === item.id && <div className="ml-auto w-1.5 h-1.5 bg-indigo-600 rounded-full" />}
                </button>
              ))}
            </nav>

            <div className="p-4 border-t border-black/5">
              <button 
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-red-500 hover:bg-red-50 transition-all"
              >
                <LogOut className="w-5 h-5 shrink-0" />
                <span className="font-medium text-sm">Sair</span>
              </button>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        {/* Header */}
        <header className="h-16 bg-white border-bottom border-black/5 px-8 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-4">
            <button onClick={() => { if (window.innerWidth < 768) { setMobileMenuOpen(!mobileMenuOpen); } else { setSidebarOpen(!sidebarOpen); } }} className="p-2 hover:bg-zinc-100 rounded-lg transition-all">
              <Menu className="w-5 h-5 text-zinc-500" />
            </button>
            <h2 className="text-lg font-bold text-zinc-900 capitalize">{menuItems.find(item => item.id === currentPage)?.label || currentPage.replace('-', ' ')}</h2>
          </div>
        </header>

        {/* Cleanup Reminder Banner (every 15 days) */}
        {currentUser.role === UserRole.ADMIN && currentPage === 'dashboard' && (() => {
          const daysSince = lastCleanupDate ? Math.floor((Date.now() - new Date(lastCleanupDate).getTime()) / (1000 * 60 * 60 * 24)) : 999;
          return daysSince >= 15 ? (
            <div className="bg-amber-50 border-l-4 border-amber-500 p-3 mx-4 mt-2 rounded-md shadow-sm flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber-600" />
                <p className="text-sm text-amber-800 font-medium">
                  🧹 Limpeza de dados recomendada {daysSince === 999 ? '(nunca realizada)' : `(${daysSince} dias atrás)`}. Vá em <strong>Logs</strong> para limpar comprovantes e logs antigos.
                </p>
              </div>
              <button 
                onClick={async () => {
                  const now = new Date().toISOString();
                  await setDoc(doc(db, 'settings', 'cleanup'), { lastCleanupDate: now });
                  setLastCleanupDate(now);
                }}
                className="text-xs font-bold text-amber-700 bg-amber-100 hover:bg-amber-200 px-3 py-1 rounded-lg transition-colors whitespace-nowrap"
              >
                OK, Entendi
              </button>
            </div>
          ) : null;
        })()}

        {/* Sync Error Banner */}
        {syncError && (
          <div className="bg-red-50 border-l-4 border-red-500 p-4 m-4 rounded-md shadow-sm">
            <div className="flex">
              <div className="flex-shrink-0">
                <AlertCircle className="h-5 w-5 text-red-400" />
              </div>
              <div className="ml-3">
                <p className="text-sm text-red-700 font-medium">
                  {syncError}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Page Content */}
        <div className="flex-1 overflow-y-auto p-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentPage}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              {currentPage === 'dashboard' && (
                <div className="space-y-8">
                  {expiringContractsCount > 0 && (
                    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3 shadow-sm">
                      <div className="p-2 bg-amber-100 rounded-xl shrink-0">
                        <AlertCircle className="w-5 h-5 text-amber-600" />
                      </div>
                      <div>
                        <h4 className="font-bold text-amber-900">Atenção: Contratos Vencendo ou Vencidos</h4>
                        <p className="text-sm text-amber-800 mt-1 flex items-center flex-wrap">
                          Você tem <strong className="mx-1">{expiringContractsCount}</strong> contrato(s) ativo(s) com cobrança próxima ou já vencida.
                          <button onClick={() => setCurrentPage('contracts')} className="ml-2 font-bold underline hover:text-amber-600 transition-colors">Ver contratos</button>
                        </p>
                      </div>
                    </div>
                  )}
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                      <h3 className="text-2xl font-bold text-zinc-900">Resumo Operacional</h3>
                      <p className="text-zinc-500 text-sm">Acompanhe o desempenho em tempo real</p>
                    </div>
                    <div className="flex items-center gap-3 flex-wrap">
                      {(currentUser.role === UserRole.ADMIN || currentUser.role === UserRole.SUPERVISOR) && (
                        <div className="bg-white p-2 rounded-2xl shadow-sm border border-black/5">
                          <select
                            value={dashboardVendorFilter}
                            onChange={(e) => setDashboardVendorFilter(e.target.value)}
                            className="bg-transparent border-none text-sm font-bold text-zinc-700 outline-none cursor-pointer px-2"
                          >
                            <option value="">👥 Todos</option>
                            {users.filter(u => u.status === 'ATIVO').map(u => (
                              <option key={u.id} value={u.id}>{u.id === currentUser.id ? `👤 ${u.name} (eu)` : u.name}</option>
                            ))}
                          </select>
                        </div>
                      )}
                      <div className="flex items-center gap-2 bg-white p-2 rounded-2xl shadow-sm border border-black/5">
                        <Calendar className="w-4 h-4 text-zinc-400 ml-2" />
                        <input 
                          type="date" 
                          value={dateRange.start}
                          onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
                          className="bg-transparent border-none text-sm font-bold text-zinc-700 outline-none"
                        />
                        <span className="text-zinc-400 text-sm">até</span>
                        <input 
                          type="date" 
                          value={dateRange.end}
                          onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
                          className="bg-transparent border-none text-sm font-bold text-zinc-700 outline-none pr-2"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    <StatCard 
                      title="Faturamento no Período" 
                      value={`R$ ${stats.dailyTotal.toLocaleString()}`} 
                      icon={DollarSign} 
                      color="bg-emerald-500"
                      subtitle={`Vendas aprovadas no período selecionado`}
                    />
                    <StatCard 
                      title="Faturamento Mês" 
                      value={`R$ ${stats.monthlyTotal.toLocaleString()}`} 
                      icon={TrendingUp} 
                      color="bg-indigo-600"
                      subtitle="Baseado na data de pagamento"
                    />
                    <StatCard 
                      title="Leads Criados" 
                      value={stats.dailyCount} 
                      icon={Users} 
                      color="bg-amber-500"
                      subtitle={`Novos leads no período selecionado`}
                    />
                    <StatCard 
                      title="Taxa de Conversão" 
                      value={`${stats.conversionRate.toFixed(1)}%`} 
                      icon={Target} 
                      color="bg-blue-500"
                      subtitle={`Leads convertidos em vendas pagas`}
                    />
                    <StatCard 
                      title="MRR (Receita Recorrente)" 
                      value={`R$ ${stats.mrr.toLocaleString()}`} 
                      icon={Repeat} 
                      color="bg-purple-600"
                      subtitle={`${stats.activeContracts} contratos ativos`}
                    />
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-white p-4 rounded-2xl border border-black/5 shadow-sm">
                      <p className="text-[10px] font-bold text-zinc-400 uppercase mb-1">Atend. Iniciado</p>
                      <p className="text-xl font-black text-zinc-600">{stats.statusCounts[SaleStatus.AGUARDANDO]}</p>
                    </div>
                    <div className="bg-white p-4 rounded-2xl border border-black/5 shadow-sm">
                      <p className="text-[10px] font-bold text-amber-400 uppercase mb-1">Proj. Iniciado</p>
                      <p className="text-xl font-black text-amber-600">{stats.statusCounts[SaleStatus.PENDENTE]}</p>
                    </div>
                    <div className="bg-white p-4 rounded-2xl border border-black/5 shadow-sm">
                      <p className="text-[10px] font-bold text-emerald-400 uppercase mb-1">Pago</p>
                      <p className="text-xl font-black text-emerald-600">{stats.statusCounts[SaleStatus.PAGO]}</p>
                    </div>

                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="lg:col-span-2 space-y-8">
                      {currentUser.role === UserRole.VENDEDOR && (
                        <div className="bg-white p-8 rounded-3xl shadow-sm border border-black/5">
                          <div className="flex items-center gap-3 mb-6">
                            <Target className="w-6 h-6 text-indigo-600" />
                            <h3 className="text-xl font-bold">Minha Meta Diária</h3>
                          </div>
                          <ProgressBar 
                            label="Progresso do Dia" 
                            progress={stats.goalProgress} 
                            current={stats.dailyTotal} 
                            target={currentUser.daily_goal || 0} 
                          />
                        </div>
                      )}

                      {adminGoalTracking.length > 0 && (
                        <div className="bg-white p-8 rounded-3xl shadow-sm border border-black/5">
                          <div className="flex items-center gap-3 mb-6">
                            <Target className="w-6 h-6 text-indigo-600" />
                            <h3 className="text-xl font-bold">Acompanhamento de Metas</h3>
                          </div>
                          <div className="space-y-6">
                            {adminGoalTracking.map(tracker => (
                              <div key={tracker.id} className="space-y-2">
                                <div className="flex justify-between items-center">
                                  <div className="flex items-center gap-2">
                                    <div className="w-6 h-6 bg-zinc-100 rounded-full flex items-center justify-center overflow-hidden">
                                      {tracker.photo_url ? (
                                        <img src={tracker.photo_url} alt={tracker.name} className="w-full h-full object-cover" />
                                      ) : (
                                        <UserIcon className="w-3 h-3 text-zinc-400" />
                                      )}
                                    </div>
                                    <p className="font-bold text-zinc-900">{tracker.name}</p>
                                  </div>
                                  {tracker.remaining > 0 ? (
                                    <p className="text-xs text-zinc-500">Faltam <strong className="text-amber-600">R$ {tracker.remaining.toLocaleString()}</strong></p>
                                  ) : (
                                    <p className="text-xs font-bold text-emerald-600">Meta Batida! 🎉</p>
                                  )}
                                </div>
                                <ProgressBar 
                                  label="" 
                                  progress={tracker.progress} 
                                  current={tracker.totalSold} 
                                  target={tracker.goal} 
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="bg-white rounded-3xl shadow-sm border border-black/5 overflow-hidden">
                        <div className="p-6 border-b border-black/5 flex justify-between items-center">
                          <h3 className="font-bold text-zinc-900">Vendas Recentes</h3>
                          <button onClick={() => setCurrentPage('sales')} className="text-indigo-600 text-sm font-semibold hover:underline">Ver todas</button>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-left">
                            <thead className="bg-zinc-50 text-zinc-500 text-xs uppercase tracking-wider">
                              <tr>
                                <th className="px-6 py-4 font-semibold">Telefone</th>
                                <th className="px-6 py-4 font-semibold">Vendedor</th>
                                <th className="px-6 py-4 font-semibold">Serviço</th>
                                <th className="px-6 py-4 font-semibold">Valor</th>
                                <th className="px-6 py-4 font-semibold">Status</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-black/5">
                              {mySales.slice(0, 5).map((sale) => (
                                <tr key={sale.id} className="hover:bg-zinc-50 transition-all">
                                  <td className="px-6 py-4">
                                    <p className="font-bold text-zinc-900">{sale.phone}</p>
                                    <p className="text-[10px] text-zinc-400">Criado em: {new Date(sale.created_at).toLocaleDateString()}</p>
                                  </td>
                                  <td className="px-6 py-4">
                                    <p className="text-sm font-medium text-zinc-700">{users.find(u => u.id === sale.vendedor_id)?.name || 'Desconhecido'}</p>
                                  </td>
                                  <td className="px-6 py-4 text-sm text-zinc-600">{sale.service}</td>
                                  <td className="px-6 py-4">
                                    <p className="font-bold text-zinc-900">R$ {sale.value.toLocaleString()}</p>
                                    {sale.paid_at && (
                                      <p className="text-[10px] text-emerald-600 font-medium">Pago: {new Date(sale.paid_at).toLocaleDateString()}</p>
                                    )}
                                  </td>
                                  <td className="px-6 py-4">
                                    <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase ${
                                      sale.status === SaleStatus.PAGO ? 'bg-emerald-100 text-emerald-600' :
                                      sale.status === SaleStatus.PENDENTE ? 'bg-amber-100 text-amber-600' :
                                      sale.status === SaleStatus.CANCELADO ? 'bg-red-100 text-red-600' :
                                      sale.status === SaleStatus.ARQUIVADO ? 'bg-zinc-200 text-zinc-700' :
                                      sale.status === SaleStatus.EXCLUSAO_SOLICITADA ? 'bg-zinc-800 text-zinc-100' :
                                      'bg-zinc-100 text-zinc-600'
                                    }`}>
                                      {getStatusLabel(sale.status)}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-8">
                      <div className="bg-white p-6 rounded-3xl shadow-sm border border-black/5">
                        <div className="flex items-center justify-between mb-6">
                          <h3 className="font-bold text-zinc-900 flex items-center gap-2">
                            <Trophy className="w-5 h-5 text-amber-500" />
                            Ranking
                          </h3>
                          <select 
                            value={rankingFilter} 
                            onChange={(e) => setRankingFilter(e.target.value as any)}
                            className="text-xs bg-zinc-100 border-none rounded-md px-2 py-1 text-zinc-600 font-bold outline-none cursor-pointer"
                          >
                            <option value="daily">Diário</option>
                            <option value="weekly">Semanal</option>
                            <option value="monthly">Mensal</option>
                            <option value="all">Geral</option>
                          </select>
                        </div>
                        <div className="space-y-4">
                          {ranking.slice(0, 5).map((item, idx) => (
                            <div key={item.id} className="flex items-center gap-4 p-3 rounded-2xl hover:bg-zinc-50 transition-all">
                              <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm ${
                                idx === 0 ? 'bg-amber-100 text-amber-600' :
                                idx === 1 ? 'bg-zinc-100 text-zinc-600' :
                                idx === 2 ? 'bg-orange-100 text-orange-600' :
                                'text-zinc-400'
                              }`}>
                                {idx + 1}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="font-bold text-sm text-zinc-900 truncate">{item.name}</p>
                                <p className="text-xs text-zinc-500">{item.count} vendas</p>
                              </div>
                              <p className="font-bold text-sm text-indigo-600">R$ {item.total.toLocaleString()}</p>
                            </div>
                          ))}
                        </div>
                      </div>

                      {currentUser.role === UserRole.VENDEDOR && (
                        <div className="bg-white p-6 rounded-3xl shadow-sm border border-black/5">
                          <div className="flex items-center justify-between mb-6">
                            <h3 className="font-bold text-zinc-900 flex items-center gap-2">
                              <DollarSign className="w-5 h-5 text-emerald-500" />
                              Meus Recebimentos
                            </h3>
                          </div>
                          <div className="space-y-4">
                            {payments.length === 0 ? (
                              <p className="text-sm text-zinc-500 text-center py-4">Nenhum recebimento registrado.</p>
                            ) : (
                              payments.slice(0, 5).map(payment => (
                                <div key={payment.id} className="flex flex-col gap-2 p-3 rounded-2xl hover:bg-zinc-50 transition-all border border-black/5">
                                  <div className="flex justify-between items-center">
                                    <p className="text-xs text-zinc-500">{new Date(payment.created_at).toLocaleDateString()}</p>
                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-emerald-100 text-emerald-600">
                                      {payment.status}
                                    </span>
                                  </div>
                                  <div className="flex justify-between items-center">
                                    <p className="font-bold text-sm text-zinc-900">R$ {payment.amount.toLocaleString()}</p>
                                    {payment.receipt_url && (
                                      <a href={payment.receipt_url} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-600 hover:underline font-medium">
                                        Ver Comprovante
                                      </a>
                                    )}
                                  </div>
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {currentPage === 'customers' && (
                <div className="bg-white rounded-3xl shadow-sm border border-black/5 overflow-hidden">
                  <div className="p-6 border-b border-black/5 flex flex-col gap-4">
                    <div className="flex justify-between items-center">
                      <h3 className="font-bold text-zinc-900">Carteira de Clientes</h3>
                      <div className="flex gap-2 items-center">
                        <div className="relative">
                          <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
                          <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Buscar cliente por nome ou telefone..."
                            className="pl-9 pr-4 py-2 rounded-xl border border-zinc-200 text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 w-72"
                          />
                          {searchQuery && (
                            <button onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 hover:bg-zinc-100 rounded-full">
                              <X className="w-3.5 h-3.5 text-zinc-400" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2 flex-wrap items-center">
                      <select 
                        value={customerVendorFilter}
                        onChange={(e) => setCustomerVendorFilter(e.target.value)}
                        className="px-3 py-2 rounded-xl border border-zinc-200 text-sm outline-none focus:ring-2 focus:ring-indigo-500/20"
                      >
                        <option value="">Todos os Vendedores</option>
                        {users.filter(u => u.status === 'ATIVO').map(u => (
                          <option key={u.id} value={u.id}>{u.name}</option>
                        ))}
                      </select>
                      <select
                        value={customerSortBy}
                        onChange={(e) => setCustomerSortBy(e.target.value as any)}
                        className="px-3 py-2 rounded-xl border border-zinc-200 text-sm outline-none focus:ring-2 focus:ring-indigo-500/20"
                      >
                        <option value="recent">Mais Recentes</option>
                        <option value="spent_desc">Maior Gasto</option>
                        <option value="spent_asc">Menor Gasto</option>
                        <option value="purchases_desc">Mais Compras</option>
                        <option value="purchases_asc">Menos Compras</option>
                      </select>
                      <input 
                        type="date"
                        value={customerDateFrom}
                        onChange={(e) => setCustomerDateFrom(e.target.value)}
                        className="px-3 py-2 rounded-xl border border-zinc-200 text-sm outline-none focus:ring-2 focus:ring-indigo-500/20"
                        title="Data de cadastro (a partir de)"
                      />
                      <input 
                        type="date"
                        value={customerDateTo}
                        onChange={(e) => setCustomerDateTo(e.target.value)}
                        className="px-3 py-2 rounded-xl border border-zinc-200 text-sm outline-none focus:ring-2 focus:ring-indigo-500/20"
                        title="Data de cadastro (até)"
                      />
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead className="bg-zinc-50 text-zinc-500 text-xs uppercase tracking-wider">
                        <tr>
                          <th className="p-4 font-semibold">Cliente</th>
                          <th className="p-4 font-semibold">Contato</th>
                          <th className="p-4 font-semibold">Vendedor</th>
                          <th className="p-4 font-semibold">Total Compras</th>
                          <th className="p-4 font-semibold">Valor Total LTV</th>
                          <th className="p-4 font-semibold">Cadastro</th>
                          <th className="p-4 font-semibold text-right">Ações</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-black/5 text-sm">
                        {customers
                          .filter(c => {
                            // Text search filter
                            const matchesSearch = !searchQuery || c.name.toLowerCase().includes(searchQuery.toLowerCase()) || c.phone.includes(searchQuery.replace(/\D/g, ''));
                            // Vendor filter: check if any of the customer's sales belong to the selected vendor
                            const matchesVendor = !customerVendorFilter || sales.some(s => s.customer_id === c.id && s.vendedor_id === customerVendorFilter);
                            // Date filters
                            const custDate = toLocalDateString(c.created_at);
                            const matchesDateFrom = !customerDateFrom || custDate >= customerDateFrom;
                            const matchesDateTo = !customerDateTo || custDate <= customerDateTo;
                            return matchesSearch && matchesVendor && matchesDateFrom && matchesDateTo;
                          })
                          .sort((a, b) => {
                            const ltvA = getCustomerLTV(a.id);
                            const ltvB = getCustomerLTV(b.id);
                            switch (customerSortBy) {
                              case 'spent_desc': return ltvB.total_spent - ltvA.total_spent;
                              case 'spent_asc': return ltvA.total_spent - ltvB.total_spent;
                              case 'purchases_desc': return ltvB.total_purchases - ltvA.total_purchases;
                              case 'purchases_asc': return ltvA.total_purchases - ltvB.total_purchases;
                              case 'recent':
                              default: return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
                            }
                          })
                          .map(customer => (
                          <tr key={customer.id} className="hover:bg-zinc-50/50 transition-colors">
                            <td className="p-4">
                              <div className="flex items-center gap-2 flex-wrap">
                                <div className="font-bold text-zinc-900">{customer.name}</div>
                                {sales
                                  .filter(s => s.customer_id === customer.id && !KANBAN_HIDDEN_STATUSES.includes(s.status) && s.status !== SaleStatus.DELETED)
                                  .filter(s => {
                                    if (s.status === SaleStatus.PAGO) return isPagoVisibleInFlow(s) || receipts.some(r => r.sale_id === s.id && (r.audit_status === 'divergent' || r.audit_status === 'error' || r.audit_status === 'duplicate'));
                                    if (s.status === SaleStatus.ARQUIVADO) return false;
                                    return true;
                                  })
                                  .map(s => {
                                    const stale = isStaleAguardando(s);
                                    const colorClass = stale
                                      ? 'text-red-600 bg-red-50 animate-pulse'
                                      : s.status === SaleStatus.AGUARDANDO ? 'text-orange-600 bg-orange-50'
                                      : s.status === SaleStatus.PENDENTE ? 'text-amber-600 bg-amber-50'
                                      : s.status === SaleStatus.PAGO ? 'text-emerald-600 bg-emerald-50'
                                      : 'text-zinc-500 bg-zinc-100';
                                    return (
                                      <span key={s.id} className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${colorClass}`} title={`Venda: R$ ${s.value} - ${s.service}`}>
                                        {stale ? '⚠️ ' : ''}{getStatusLabel(s.status)}
                                      </span>
                                    );
                                  })
                                }
                              </div>
                              <div className="text-xs text-zinc-500 flex gap-1 mt-1">
                                {customer.services?.map(s => (
                                  <span key={s} className="px-1.5 py-0.5 bg-zinc-100 rounded text-[10px]">{s}</span>
                                ))}
                              </div>
                            </td>
                            <td className="p-4 font-medium text-zinc-600">{customer.phone}</td>
                            <td className="p-4 text-zinc-600 text-xs">
                              {(() => {
                                const firstSale = sales.find(s => s.customer_id === customer.id);
                                if (!firstSale) return <span className="text-zinc-400">—</span>;
                                const seller = users.find(u => u.id === firstSale.vendedor_id);
                                return <span className="font-semibold">{seller?.name || 'Desconhecido'}</span>;
                              })()}
                            </td>
                            <td className="p-4 font-bold text-zinc-900">{getCustomerLTV(customer.id).total_purchases}</td>
                            <td className="p-4 font-black text-emerald-600">
                              R$ {getCustomerLTV(customer.id).total_spent.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                            </td>
                            <td className="p-4 text-xs text-zinc-500 font-medium">
                              {new Date(customer.created_at).toLocaleDateString('pt-BR')}
                            </td>
                            <td className="p-4 text-right flex gap-2 justify-end">
                              <button 
                                onClick={() => setViewingCustomer(customer)}
                                className="px-3 py-1.5 bg-indigo-50 text-indigo-600 rounded-lg text-xs font-bold hover:bg-indigo-100 transition-colors"
                              >
                                Ver Ficha
                              </button>
                              {(currentUser.role === UserRole.ADMIN) && (
                                <button 
                                  onClick={() => handleDeleteCustomer(customer.id, customer.name)}
                                  className="px-3 py-1.5 bg-red-50 text-red-600 rounded-lg text-xs font-bold hover:bg-red-100 transition-colors"
                                >
                                  Excluir
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                        {customers.length === 0 && (
                          <tr>
                            <td colSpan={7} className="p-8 text-center text-zinc-500">
                              Nenhum cliente registrado ainda. Eles aparecerão aqui quando você criar novas vendas.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {currentPage === 'contracts' && (
                <div className="bg-white rounded-3xl shadow-sm border border-black/5 overflow-hidden">
                  <div className="p-6 border-b border-black/5 flex flex-col gap-4">
                    <div className="flex justify-between items-center">
                      <h3 className="font-bold text-zinc-900">Gestão de Contratos</h3>
                      <div className="flex gap-2 items-center">
                        <div className="relative">
                          <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
                          <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Buscar por telefone ou nome..."
                            className="pl-9 pr-4 py-2 rounded-xl border border-zinc-200 text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 w-64"
                          />
                          {searchQuery && (
                            <button onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 hover:bg-zinc-100 rounded-full">
                              <X className="w-3.5 h-3.5 text-zinc-400" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead className="bg-zinc-50 text-zinc-500 text-xs uppercase tracking-wider">
                        <tr>
                          <th className="p-4 font-semibold">Cliente/Serviço</th>
                          <th className="p-4 font-semibold">Status</th>
                          <th className="p-4 font-semibold">Ciclo / Valor</th>
                          <th className="p-4 font-semibold">Próx. Cobrança</th>
                          <th className="p-4 font-semibold text-right">Ações</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-black/5 text-sm">
                        {sales
                          .filter(s => s.sale_type === SaleType.RECORRENTE && !s.parent_contract_id)
                          .filter(s => 
                            s.phone.includes(searchQuery.replace(/\D/g, '')) || 
                            s.name?.toLowerCase().includes(searchQuery.toLowerCase())
                          )
                          .sort((a, b) => new Date(a.next_billing_date || '').getTime() - new Date(b.next_billing_date || '').getTime())
                          .map(sale => {
                            const isOverdue = new Date() > new Date(`${sale.next_billing_date}T23:59:59`) && sale.contract_status === ContractStatus.ATIVO;
                            return (
                              <tr key={sale.id} className="hover:bg-zinc-50/50 transition-colors">
                                <td className="p-4">
                                  <div className="font-bold text-zinc-900">{sale.name}</div>
                                  <div className="text-xs text-zinc-500">{sale.phone}</div>
                                  <div className="mt-1 text-xs font-semibold text-indigo-600">{(sale.services || [sale.service]).join(', ')}</div>
                                </td>
                                <td className="p-4">
                                  <span className={`px-2 py-1 rounded-md text-xs font-bold uppercase ${
                                    sale.contract_status === ContractStatus.ATIVO ? 'bg-emerald-100 text-emerald-700' :
                                    sale.contract_status === ContractStatus.INADIMPLENTE ? 'bg-red-100 text-red-700' :
                                    sale.contract_status === ContractStatus.PAUSADO ? 'bg-amber-100 text-amber-700' :
                                    'bg-zinc-100 text-zinc-700'
                                  }`}>
                                    {sale.contract_status}
                                  </span>
                                  {isOverdue && sale.contract_status !== ContractStatus.INADIMPLENTE && (
                                    <span className="block mt-1 text-[10px] font-bold text-red-500 uppercase">Vencido!</span>
                                  )}
                                </td>
                                <td className="p-4">
                                  <div className="font-bold text-zinc-900 capitalize">{sale.billing_cycle}</div>
                                  <div className="font-black text-xs text-emerald-600">R$ {sale.value.toLocaleString()}</div>
                                </td>
                                <td className="p-4 font-medium text-zinc-700">
                                  {sale.next_billing_date ? new Date(`${sale.next_billing_date}T12:00:00`).toLocaleDateString() : '-'}
                                </td>
                                <td className="p-4 text-right">
                                  <button 
                                    onClick={() => setSelectedContract(sale)}
                                    className="px-3 py-1.5 bg-indigo-50 text-indigo-600 rounded-lg text-xs font-bold hover:bg-indigo-100 transition-colors"
                                  >
                                    📋 Ver Contrato
                                  </button>
                                </td>
                              </tr>
                            );
                        })}
                        {sales.filter(s => s.sale_type === SaleType.RECORRENTE && !s.parent_contract_id).length === 0 && (
                          <tr>
                            <td colSpan={5} className="p-8 text-center text-zinc-500">
                              Nenhum contrato recorrente registrado.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Contract Detail Modal */}
              <AnimatePresence>
                {selectedContract && (() => {
                  const contract = selectedContract;
                  const customer = customers.find(c => c.id === contract.customer_id);
                  const seller = users.find(u => u.id === contract.vendedor_id);
                  const isOverdue = new Date() > new Date(`${contract.next_billing_date}T23:59:59`) && contract.contract_status === ContractStatus.ATIVO;
                  return (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setSelectedContract(null)}>
                      <motion.div 
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className="bg-white w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {/* Header */}
                        <div className="p-6 border-b border-black/5 flex justify-between items-center">
                          <div>
                            <h3 className="text-xl font-bold text-zinc-900">📋 Contrato</h3>
                            <p className="text-sm text-zinc-500">{contract.name || contract.phone}</p>
                          </div>
                          <button onClick={() => setSelectedContract(null)} className="p-2 hover:bg-zinc-100 rounded-full transition-all">
                            <X className="w-5 h-5 text-zinc-400" />
                          </button>
                        </div>

                        <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto">
                          {/* Cliente */}
                          <div className="bg-zinc-50 p-4 rounded-2xl space-y-2">
                            <p className="text-xs font-bold text-zinc-400 uppercase">👤 Cliente</p>
                            <div className="grid grid-cols-2 gap-3 text-sm">
                              <div>
                                <p className="text-zinc-500 text-xs">Nome</p>
                                <p className="font-bold text-zinc-900">{contract.name || 'Não informado'}</p>
                              </div>
                              <div>
                                <p className="text-zinc-500 text-xs">Telefone</p>
                                <p className="font-bold text-zinc-900">{contract.phone}</p>
                              </div>
                              {customer && (
                                <>
                                  <div>
                                    <p className="text-zinc-500 text-xs">Cliente desde</p>
                                    <p className="font-bold text-zinc-900">{new Date(customer.first_purchase_date).toLocaleDateString('pt-BR')}</p>
                                  </div>
                                  <div>
                                    <p className="text-zinc-500 text-xs">Total gasto</p>
                                    <p className="font-bold text-emerald-600">R$ {customer.total_spent?.toLocaleString() || '0'}</p>
                                  </div>
                                </>
                              )}
                            </div>
                          </div>

                          {/* Serviço */}
                          <div className="bg-indigo-50/50 p-4 rounded-2xl space-y-2">
                            <p className="text-xs font-bold text-indigo-400 uppercase">📦 Serviço</p>
                            <div className="grid grid-cols-2 gap-3 text-sm">
                              <div>
                                <p className="text-zinc-500 text-xs">Serviço(s)</p>
                                <p className="font-bold text-zinc-900">{(contract.services || [contract.service]).join(', ')}</p>
                              </div>
                              <div>
                                <p className="text-zinc-500 text-xs">Valor</p>
                                <p className="font-black text-emerald-600">R$ {contract.value.toLocaleString()}</p>
                              </div>
                              <div>
                                <p className="text-zinc-500 text-xs">Ciclo</p>
                                <p className="font-bold text-zinc-900 capitalize">{contract.billing_cycle || 'Mensal'}</p>
                              </div>
                              <div>
                                <p className="text-zinc-500 text-xs">Vendedor</p>
                                <p className="font-bold text-zinc-900">{seller?.name || 'Desconhecido'}</p>
                              </div>
                            </div>
                          </div>

                          {/* Contrato */}
                          <div className="bg-amber-50/50 p-4 rounded-2xl space-y-2">
                            <p className="text-xs font-bold text-amber-500 uppercase">📄 Contrato</p>
                            <div className="grid grid-cols-2 gap-3 text-sm">
                              <div>
                                <p className="text-zinc-500 text-xs">Status</p>
                                <span className={`inline-block px-2 py-1 rounded-md text-xs font-bold uppercase ${
                                  contract.contract_status === ContractStatus.ATIVO ? 'bg-emerald-100 text-emerald-700' :
                                  contract.contract_status === ContractStatus.INADIMPLENTE ? 'bg-red-100 text-red-700' :
                                  contract.contract_status === ContractStatus.PAUSADO ? 'bg-amber-100 text-amber-700' :
                                  'bg-zinc-100 text-zinc-700'
                                }`}>
                                  {contract.contract_status}
                                </span>
                                {isOverdue && contract.contract_status !== ContractStatus.INADIMPLENTE && (
                                  <span className="ml-2 text-[10px] font-bold text-red-500 animate-pulse">VENCIDO!</span>
                                )}
                              </div>
                              <div>
                                <p className="text-zinc-500 text-xs">Início</p>
                                <p className="font-bold text-zinc-900">{contract.contract_start ? new Date(`${contract.contract_start}T12:00:00`).toLocaleDateString('pt-BR') : '-'}</p>
                              </div>
                              <div>
                                <p className="text-zinc-500 text-xs">Próx. cobrança</p>
                                <p className={`font-bold ${isOverdue ? 'text-red-600' : 'text-zinc-900'}`}>{contract.next_billing_date ? new Date(`${contract.next_billing_date}T12:00:00`).toLocaleDateString('pt-BR') : '-'}</p>
                              </div>
                              <div>
                                <p className="text-zinc-500 text-xs">Status venda</p>
                                <p className="font-bold text-zinc-900">{getStatusLabel(contract.status)}</p>
                              </div>
                            </div>
                          </div>

                          {/* Notas */}
                          {contract.notes && (
                            <div className="bg-zinc-50 p-4 rounded-2xl">
                              <p className="text-xs font-bold text-zinc-400 uppercase mb-1">📝 Notas</p>
                              <p className="text-sm text-zinc-700">{contract.notes}</p>
                            </div>
                          )}
                        </div>

                        {/* Actions */}
                        <div className="p-6 border-t border-black/5 flex flex-wrap gap-2">
                          <a 
                            href={`https://wa.me/${contract.phone.replace(/\D/g, '')}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1.5 px-4 py-2 bg-green-50 text-green-600 rounded-xl text-sm font-bold hover:bg-green-100 transition-colors"
                          >
                            <MessageCircle className="w-4 h-4" /> WhatsApp
                          </a>
                          <button 
                            onClick={() => { setEditingSale(contract); setSelectedContract(null); }}
                            className="flex items-center gap-1.5 px-4 py-2 bg-indigo-50 text-indigo-600 rounded-xl text-sm font-bold hover:bg-indigo-100 transition-colors"
                          >
                            <Edit2 className="w-4 h-4" /> Editar
                          </button>
                          {contract.contract_status === ContractStatus.ATIVO && (() => {
                            const nextBill = contract.next_billing_date || contract.contract_start;
                            const isPeriodPaid = nextBill && new Date(`${nextBill}T23:59:59`) > new Date();
                            return isPeriodPaid ? (
                              <span className="flex items-center gap-1.5 px-4 py-2 bg-emerald-50 text-emerald-600 rounded-xl text-sm font-bold">
                                <CheckCircle className="w-4 h-4" /> Pago até {new Date(`${nextBill}T12:00:00`).toLocaleDateString('pt-BR')}
                              </span>
                            ) : (
                              <button 
                                onClick={() => { handleContractAction(contract.id, 'pay'); setSelectedContract(null); }}
                                className="flex items-center gap-1.5 px-4 py-2 bg-emerald-50 text-emerald-600 rounded-xl text-sm font-bold hover:bg-emerald-100 transition-colors"
                              >
                                <CheckCircle className="w-4 h-4" /> Confirmar Pagamento
                              </button>
                            );
                          })()}
                          {contract.contract_status === ContractStatus.ATIVO && (
                            <button 
                              onClick={() => { handleContractAction(contract.id, 'pause'); setSelectedContract(null); }}
                              className="flex items-center gap-1.5 px-4 py-2 bg-amber-50 text-amber-600 rounded-xl text-sm font-bold hover:bg-amber-100 transition-colors"
                            >
                              Pausar
                            </button>
                          )}
                          {contract.contract_status !== ContractStatus.ATIVO && contract.contract_status !== ContractStatus.CANCELADO && (
                            <button 
                              onClick={() => { handleContractAction(contract.id, 'resume'); setSelectedContract(null); }}
                              className="flex items-center gap-1.5 px-4 py-2 bg-emerald-50 text-emerald-600 rounded-xl text-sm font-bold hover:bg-emerald-100 transition-colors"
                            >
                              Retomar
                            </button>
                          )}
                          {contract.contract_status !== ContractStatus.CANCELADO && (
                            <button 
                              onClick={() => { handleContractAction(contract.id, 'cancel'); setSelectedContract(null); }}
                              className="flex items-center gap-1.5 px-4 py-2 bg-red-50 text-red-600 rounded-xl text-sm font-bold hover:bg-red-100 transition-colors"
                            >
                              Cancelar Contrato
                            </button>
                          )}
                        </div>
                      </motion.div>
                    </div>
                  );
                })()}
              </AnimatePresence>

              {currentPage === 'new-lead' && (
                <div className="max-w-2xl mx-auto">
                  <div className="bg-white p-8 rounded-3xl shadow-sm border border-black/5">
                    <h3 className="text-2xl font-bold text-zinc-900 mb-8">Cadastrar Novo Lead</h3>
                    <form onSubmit={(e) => {
                      e.preventDefault();
                      if (newLeadServices.length === 0) {
                        showToast('Selecione pelo menos um serviço.', 'warning');
                        return;
                      }
                      const formData = new FormData(e.currentTarget);
                      handleAddLead({
                        phone: formData.get('phone'),
                        name: newLeadSaleType === SaleType.RECORRENTE ? formData.get('name') : '',
                        services: newLeadServices,
                        service: newLeadServices[0],
                        value: Math.round(Number(formData.get('value')) * 100) / 100,
                        notes: formData.get('notes') || '',
                        created_at: formData.get('date') ? new Date(`${formData.get('date')}T12:00:00`).toISOString() : new Date().toISOString(),
                        status: SaleStatus.AGUARDANDO,
                        sale_type: newLeadSaleType,
                        billing_cycle: formData.get('billing_cycle'),
                        contract_start: formData.get('contract_start')
                      });
                      // Reset local states
                      setNewLeadSaleType(SaleType.PONTUAL);
                      setNewLeadServices([]);
                    }} className="space-y-6">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-2">
                          <label className="text-sm font-semibold text-zinc-700">Data de Adição</label>
                          <input name="date" type="date" defaultValue={getLocalISODate()} required className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-indigo-500/20 outline-none" />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-semibold text-zinc-700">Telefone (WhatsApp)</label>
                          <input name="phone" type="text" required className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-indigo-500/20 outline-none" placeholder="(00) 00000-0000" />
                        </div>
                        <div className="space-y-2 md:col-span-2">
                          <label className="text-sm font-semibold text-zinc-700">Serviços Contratados (selecione um ou mais)</label>
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                            {SERVICES.map(s => (
                              <label key={s} className={`flex items-center gap-2 p-3 rounded-xl border cursor-pointer transition-all ${newLeadServices.includes(s) ? 'border-indigo-500 bg-indigo-50 text-indigo-700 font-semibold' : 'border-zinc-200 hover:border-indigo-300'}`}>
                                <input 
                                  type="checkbox" 
                                  className="hidden" 
                                  checked={newLeadServices.includes(s)}
                                  onChange={(e) => {
                                    if (e.target.checked) setNewLeadServices(prev => [...prev, s]);
                                    else setNewLeadServices(prev => prev.filter(item => item !== s));
                                  }}
                                />
                                {s}
                              </label>
                            ))}
                          </div>
                        </div>
                        <div className="space-y-2 md:col-span-2">
                          <label className="text-sm font-semibold text-zinc-700">Tipo de Venda</label>
                          <div className="grid grid-cols-2 gap-4">
                            <button
                              type="button"
                              onClick={() => setNewLeadSaleType(SaleType.PONTUAL)}
                              className={`py-3 rounded-xl font-semibold transition-all border ${newLeadSaleType === SaleType.PONTUAL ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50'}`}
                            >
                              Pontual
                            </button>
                            <button
                              type="button"
                              onClick={() => setNewLeadSaleType(SaleType.RECORRENTE)}
                              className={`py-3 rounded-xl font-semibold transition-all border ${newLeadSaleType === SaleType.RECORRENTE ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50'}`}
                            >
                              Recorrente (Contrato)
                            </button>
                          </div>
                        </div>
                        
                        {newLeadSaleType === SaleType.RECORRENTE && (
                          <>
                            <div className="space-y-2 md:col-span-2">
                              <label className="text-sm font-semibold text-zinc-700">Nome do Cliente *</label>
                              <input name="name" type="text" required className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-indigo-500/20 outline-none" placeholder="Nome completo do cliente" />
                            </div>
                            <div className="space-y-2">
                              <label className="text-sm font-semibold text-zinc-700">Ciclo de Cobrança</label>
                              <select name="billing_cycle" required className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-indigo-500/20 outline-none">
                                <option value="mensal">Mensal</option>
                                <option value="trimestral">Trimestral</option>
                                <option value="semestral">Semestral</option>
                                <option value="anual">Anual</option>
                              </select>
                            </div>
                            <div className="space-y-2">
                              <label className="text-sm font-semibold text-zinc-700">Início do Contrato</label>
                              <input name="contract_start" type="date" defaultValue={getLocalISODate()} required className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-indigo-500/20 outline-none" />
                            </div>
                          </>
                        )}

                        <div className="space-y-2 md:col-span-2">
                          <label className="text-sm font-semibold text-zinc-700">Valor {newLeadSaleType === SaleType.RECORRENTE ? 'do Contrato (R$/ciclo)' : 'da Venda (R$)'}</label>
                          <input name="value" type="number" step="0.01" required className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-indigo-500/20 outline-none" placeholder="0.00" />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-semibold text-zinc-700">Observações</label>
                        <textarea name="notes" rows={3} className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-indigo-500/20 outline-none resize-none" placeholder="Anotações sobre o lead (opcional)" />
                      </div>
                      <button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 rounded-xl transition-all shadow-lg shadow-indigo-100">
                        Salvar Lead
                      </button>
                    </form>
                  </div>
                </div>
              )}

              {currentPage === 'new-sale' && (
                <div className="max-w-2xl mx-auto space-y-6">
                  <div className="bg-white p-8 rounded-3xl shadow-sm border border-black/5">
                    <h3 className="text-2xl font-bold text-zinc-900 mb-2">Nova Venda</h3>
                    <p className="text-sm text-zinc-500 mb-6">Adicione uma venda a um cliente já cadastrado. Busque pelo número de telefone.</p>

                    {/* Search */}
                    <div className="relative mb-6">
                      <Search className="w-5 h-5 text-zinc-400 absolute left-4 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={newSaleSearchPhone}
                        onChange={(e) => {
                          const val = e.target.value;
                          setNewSaleSearchPhone(val);
                          // Auto-select customer if exact match
                          const normalized = val.replace(/\D/g, '');
                          if (normalized.length >= 8) {
                            const found = customers.find(c => c.phone.replace(/\D/g, '').includes(normalized));
                            setNewSaleSelectedCustomer(found || null);
                          } else {
                            setNewSaleSelectedCustomer(null);
                          }
                        }}
                        placeholder="Digite o telefone do cliente..."
                        className="w-full pl-12 pr-10 py-4 rounded-2xl border-2 border-zinc-200 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 outline-none text-lg font-medium transition-all"
                      />
                      {newSaleSearchPhone && (
                        <button onClick={() => { setNewSaleSearchPhone(''); setNewSaleSelectedCustomer(null); }} className="absolute right-4 top-1/2 -translate-y-1/2 p-1 hover:bg-zinc-100 rounded-full">
                          <X className="w-4 h-4 text-zinc-400" />
                        </button>
                      )}
                    </div>

                    {/* Search Results */}
                    {newSaleSearchPhone.replace(/\D/g, '').length >= 3 && !newSaleSelectedCustomer && (
                      <div className="mb-6">
                        {(() => {
                          const normalized = newSaleSearchPhone.replace(/\D/g, '');
                          const results = customers.filter(c => c.phone.replace(/\D/g, '').includes(normalized));
                          if (results.length === 0) return (
                            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3">
                              <AlertCircle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                              <div>
                                <p className="font-bold text-amber-900 text-sm">Nenhum cliente encontrado</p>
                                <p className="text-xs text-amber-700 mt-1">Cadastre o cliente primeiro em <button onClick={() => setCurrentPage('new-lead')} className="font-bold underline">Novo Lead</button>.</p>
                              </div>
                            </div>
                          );
                          return (
                            <div className="space-y-2">
                              <p className="text-xs font-bold text-zinc-400 uppercase">Resultados ({results.length})</p>
                              {results.slice(0, 5).map(c => (
                                <button
                                  key={c.id}
                                  onClick={() => setNewSaleSelectedCustomer(c)}
                                  className="w-full text-left p-4 bg-zinc-50 hover:bg-indigo-50 border border-zinc-200 hover:border-indigo-300 rounded-2xl transition-all flex justify-between items-center"
                                >
                                  <div>
                                    <p className="font-bold text-zinc-900">{c.name}</p>
                                    <p className="text-sm text-zinc-500">{c.phone}</p>
                                  </div>
                                  <div className="text-right">
                                    <p className="text-xs font-bold text-emerald-600">R$ {getCustomerLTV(c.id).total_spent.toLocaleString()}</p>
                                    <p className="text-[10px] text-zinc-400">{getCustomerLTV(c.id).total_purchases} compra(s)</p>
                                  </div>
                                </button>
                              ))}
                            </div>
                          );
                        })()}
                      </div>
                    )}

                    {/* Selected Customer Card */}
                    {newSaleSelectedCustomer && (
                      <div className="mb-6">
                        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5">
                          <div className="flex justify-between items-start mb-3">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
                                <UserCheck className="w-5 h-5 text-emerald-600" />
                              </div>
                              <div>
                                <p className="font-bold text-zinc-900">{newSaleSelectedCustomer.name}</p>
                                <p className="text-sm text-zinc-500">{newSaleSelectedCustomer.phone}</p>
                              </div>
                            </div>
                            <button
                              onClick={() => setNewSaleSelectedCustomer(null)}
                              className="p-1.5 hover:bg-emerald-100 rounded-lg transition-colors"
                            >
                              <X className="w-4 h-4 text-zinc-400" />
                            </button>
                          </div>
                          <div className="grid grid-cols-3 gap-3">
                            <div className="bg-white/70 p-3 rounded-xl">
                              <p className="text-[10px] text-zinc-500 uppercase font-bold">LTV</p>
                              <p className="font-black text-emerald-700">R$ {getCustomerLTV(newSaleSelectedCustomer.id).total_spent.toLocaleString()}</p>
                            </div>
                            <div className="bg-white/70 p-3 rounded-xl">
                              <p className="text-[10px] text-zinc-500 uppercase font-bold">Compras</p>
                              <p className="font-black text-zinc-800">{getCustomerLTV(newSaleSelectedCustomer.id).total_purchases}</p>
                            </div>
                            <div className="bg-white/70 p-3 rounded-xl">
                              <p className="text-[10px] text-zinc-500 uppercase font-bold">Serviços</p>
                              <p className="font-bold text-xs text-zinc-700 leading-tight">{newSaleSelectedCustomer.services?.join(', ') || '-'}</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Sale Form (only if customer selected) */}
                    {newSaleSelectedCustomer && (
                      <form onSubmit={(e) => {
                        e.preventDefault();
                        if (newSaleServices.length === 0) {
                          showToast('Selecione pelo menos um serviço.', 'warning');
                          return;
                        }
                        const formData = new FormData(e.currentTarget);
                        const leadData = {
                          phone: newSaleSelectedCustomer!.phone,
                          services: newSaleServices,
                          service: newSaleServices[0],
                          value: Number(formData.get('value')),
                          notes: formData.get('notes') || '',
                          created_at: new Date().toISOString(),
                          status: SaleStatus.AGUARDANDO,
                          sale_type: newSaleSaleType,
                          billing_cycle: formData.get('billing_cycle'),
                          contract_start: formData.get('contract_start')
                        };
                        proceedWithLead(leadData, newSaleSelectedCustomer!);
                        // Reset
                        setNewSaleSearchPhone('');
                        setNewSaleSelectedCustomer(null);
                        setNewSaleSaleType(SaleType.PONTUAL);
                        setNewSaleServices([]);
                      }} className="space-y-6 border-t border-black/5 pt-6">
                        <div className="space-y-2">
                          <label className="text-sm font-semibold text-zinc-700">Serviços Contratados (selecione um ou mais)</label>
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                            {SERVICES.map(s => (
                              <label key={s} className={`flex items-center gap-2 p-3 rounded-xl border cursor-pointer transition-all ${newSaleServices.includes(s) ? 'border-indigo-500 bg-indigo-50 text-indigo-700 font-semibold' : 'border-zinc-200 hover:border-indigo-300'}`}>
                                <input
                                  type="checkbox"
                                  className="hidden"
                                  checked={newSaleServices.includes(s)}
                                  onChange={(ev) => {
                                    if (ev.target.checked) setNewSaleServices(prev => [...prev, s]);
                                    else setNewSaleServices(prev => prev.filter(item => item !== s));
                                  }}
                                />
                                {s}
                              </label>
                            ))}
                          </div>
                        </div>

                        <div className="space-y-2">
                          <label className="text-sm font-semibold text-zinc-700">Tipo de Venda</label>
                          <div className="grid grid-cols-2 gap-4">
                            <button
                              type="button"
                              onClick={() => setNewSaleSaleType(SaleType.PONTUAL)}
                              className={`py-3 rounded-xl font-semibold transition-all border ${newSaleSaleType === SaleType.PONTUAL ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50'}`}
                            >
                              Pontual
                            </button>
                            <button
                              type="button"
                              onClick={() => setNewSaleSaleType(SaleType.RECORRENTE)}
                              className={`py-3 rounded-xl font-semibold transition-all border ${newSaleSaleType === SaleType.RECORRENTE ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50'}`}
                            >
                              Recorrente (Contrato)
                            </button>
                          </div>
                        </div>

                        {newSaleSaleType === SaleType.RECORRENTE && (
                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <label className="text-sm font-semibold text-zinc-700">Ciclo de Cobrança</label>
                              <select name="billing_cycle" required className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-indigo-500/20 outline-none">
                                <option value="mensal">Mensal</option>
                                <option value="trimestral">Trimestral</option>
                                <option value="semestral">Semestral</option>
                                <option value="anual">Anual</option>
                              </select>
                            </div>
                            <div className="space-y-2">
                              <label className="text-sm font-semibold text-zinc-700">Início do Contrato</label>
                              <input name="contract_start" type="date" defaultValue={getLocalISODate()} required className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-indigo-500/20 outline-none" />
                            </div>
                          </div>
                        )}

                        <div className="space-y-2">
                          <label className="text-sm font-semibold text-zinc-700">Valor {newSaleSaleType === SaleType.RECORRENTE ? 'do Contrato (R$/ciclo)' : 'da Venda (R$)'}</label>
                          <input name="value" type="number" step="0.01" required className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-indigo-500/20 outline-none" placeholder="0.00" />
                        </div>

                        <div className="space-y-2">
                          <label className="text-sm font-semibold text-zinc-700">Observações</label>
                          <textarea name="notes" rows={3} className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-indigo-500/20 outline-none resize-none" placeholder="Anotações sobre a venda (opcional)" />
                        </div>

                        <button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-4 rounded-xl transition-all shadow-lg shadow-emerald-100">
                          Registrar Venda
                        </button>
                      </form>
                    )}
                  </div>
                </div>
              )}

              {currentPage === 'sales' && (
                <div className="bg-white rounded-3xl shadow-sm border border-black/5 overflow-hidden">
                    <div className="p-6 border-b border-black/5 flex flex-col gap-4">
                      <div className="flex justify-between items-center">
                        <h3 className="font-bold text-zinc-900">Listagem de Vendas</h3>
                        <div className="flex gap-2 items-center">
                          <div className="relative">
                            <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
                            <input
                              type="text"
                              value={searchQuery}
                              onChange={(e) => setSearchQuery(e.target.value)}
                              placeholder="Buscar por telefone ou nome..."
                              className="pl-9 pr-4 py-2 rounded-xl border border-zinc-200 text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 w-64"
                            />
                            {searchQuery && (
                              <button onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 hover:bg-zinc-100 rounded-full">
                                <X className="w-3.5 h-3.5 text-zinc-400" />
                              </button>
                            )}
                          </div>
                          <button 
                            onClick={() => setShowFilters(!showFilters)}
                            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all flex items-center gap-2 ${
                              showFilters ? 'bg-indigo-50 text-indigo-600' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
                            }`}
                          >
                            <Search className="w-4 h-4" />
                            {showFilters ? 'Ocultar Filtros' : 'Filtrar'}
                          </button>
                          {showFilters && (
                            <button 
                              onClick={clearFilters}
                              className="px-4 py-2 bg-zinc-100 rounded-xl text-sm font-semibold text-zinc-600 hover:bg-zinc-200 transition-all"
                            >
                              Limpar
                            </button>
                          )}
                          <button 
                            onClick={() => setViewMode(viewMode === 'list' ? 'kanban' : 'list')}
                            className="px-4 py-2 bg-zinc-100 rounded-xl text-sm font-semibold text-zinc-600 hover:bg-zinc-200 transition-all flex items-center gap-2"
                          >
                            {viewMode === 'list' ? <LayoutDashboard className="w-4 h-4" /> : <List className="w-4 h-4" />}
                            {viewMode === 'list' ? 'Kanban' : 'Lista'}
                          </button>

                        </div>
                      </div>

                      <AnimatePresence>
                        {showFilters && (
                          <motion.div 
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden"
                          >
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 p-4 bg-zinc-50 rounded-2xl border border-black/5">
                              {currentUser.role !== UserRole.VENDEDOR && (
                                <div className="space-y-1">
                                  <label className="text-[10px] font-bold text-zinc-400 uppercase">Vendedor</label>
                                  <select 
                                    value={filters.vendedor}
                                    onChange={(e) => setFilters(f => ({ ...f, vendedor: e.target.value }))}
                                    className="w-full px-3 py-2 rounded-lg border border-zinc-200 text-sm outline-none focus:ring-2 focus:ring-indigo-500/20"
                                  >
                                    <option value="">Todos</option>
                                    {users.map(u => (
                                      <option key={u.id} value={u.id}>{u.name}</option>
                                    ))}
                                  </select>
                                </div>
                              )}
                              <div className="space-y-1">
                                <label className="text-[10px] font-bold text-zinc-400 uppercase">Status</label>
                                <select 
                                  value={filters.status}
                                  onChange={(e) => setFilters(f => ({ ...f, status: e.target.value }))}
                                  className="w-full px-3 py-2 rounded-lg border border-zinc-200 text-sm outline-none focus:ring-2 focus:ring-indigo-500/20"
                                >
                                  <option value="">Todos</option>
                                  {Object.values(SaleStatus).filter(s => s !== SaleStatus.DELETED && s !== SaleStatus.REMARKETING).map(s => (
                                    <option key={s} value={s}>{getStatusLabel(s)}</option>
                                  ))}
                                </select>
                              </div>
                              <div className="space-y-1">
                                <label className="text-[10px] font-bold text-zinc-400 uppercase">Início</label>
                                <input 
                                  type="date"
                                  value={filters.startDate}
                                  onChange={(e) => setFilters(f => ({ ...f, startDate: e.target.value }))}
                                  className="w-full px-3 py-2 rounded-lg border border-zinc-200 text-sm outline-none focus:ring-2 focus:ring-indigo-500/20"
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="text-[10px] font-bold text-zinc-400 uppercase">Fim</label>
                                <input 
                                  type="date"
                                  value={filters.endDate}
                                  onChange={(e) => setFilters(f => ({ ...f, endDate: e.target.value }))}
                                  className="w-full px-3 py-2 rounded-lg border border-zinc-200 text-sm outline-none focus:ring-2 focus:ring-indigo-500/20"
                                />
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  {viewMode === 'list' ? (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left">
                        <thead className="bg-zinc-50 text-zinc-500 text-xs uppercase tracking-wider">
                          <tr>
                            <th className="px-6 py-4 font-semibold">Data</th>
                            {currentUser.role !== UserRole.VENDEDOR && <th className="px-6 py-4 font-semibold">Vendedor</th>}
                            <th className="px-6 py-4 font-semibold">WhatsApp</th>
                            <th className="px-6 py-4 font-semibold">Serviço</th>
                            <th className="px-6 py-4 font-semibold">Valor</th>
                            <th className="px-6 py-4 font-semibold">Status</th>
                            <th className="px-6 py-4 font-semibold">Ações</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-black/5">
                          {mySales.filter(sale => {
                            // Hide CANCELADO and ARQUIVADO from list
                            if (KANBAN_HIDDEN_STATUSES.includes(sale.status as SaleStatus)) return false;
                            if (sale.status === SaleStatus.ARQUIVADO) return false;
                            // PAGO: only show if paid today
                            if (sale.status === SaleStatus.PAGO && !isPagoVisibleInFlow(sale as Sale) && !receipts.some(r => r.sale_id === sale.id && (r.audit_status === 'divergent' || r.audit_status === 'error' || r.audit_status === 'duplicate'))) return false;
                            return true;
                          }).map((sale) => (
                            <tr key={sale.id} className={`hover:bg-zinc-50 transition-all ${isStaleAguardando(sale as Sale) ? 'bg-red-50/40' : ''}`}>
                              <td className="px-6 py-4 text-sm text-zinc-500">{new Date(sale.created_at).toLocaleDateString()}</td>
                              {currentUser.role !== UserRole.VENDEDOR && (
                                <td className="px-6 py-4 text-sm font-medium text-zinc-900">
                                  {users.find(u => u.id === sale.vendedor_id)?.name || 'Desconhecido'}
                                </td>
                              )}
                              <td className="px-6 py-4">
                                <p className="font-bold text-zinc-900">{sale.phone}</p>
                                <p className="text-[10px] text-zinc-400">Criado: {new Date(sale.created_at).toLocaleDateString()}</p>
                              </td>
                              <td className="px-6 py-4 text-sm text-zinc-600">{sale.service}</td>
                              <td className="px-6 py-4">
                                <p className="font-bold text-zinc-900">R$ {sale.value.toLocaleString()}</p>
                                {sale.paid_at && (
                                  <p className="text-[10px] text-emerald-600 font-medium">Pago: {new Date(sale.paid_at).toLocaleDateString()}</p>
                                )}
                              </td>
                              <td className="px-6 py-4">
                                <div className="flex flex-col gap-1">
                                  {(() => {
                                    const isListPago = sale.status === SaleStatus.PAGO;
                                    const isReceiptListLocked = currentUser.role === UserRole.VENDEDOR && receipts.some(r => r.sale_id === sale.id && (r.audit_status === 'divergent' || r.audit_status === 'error' || r.audit_status === 'duplicate'));
                                    const isListLocked = isListPago || isReceiptListLocked;
                                    return (
                                    <>
                                  <select 
                                    value={sale.status}
                                    onChange={(e) => handleUpdateStatus(sale.id, e.target.value as SaleStatus)}
                                    disabled={isListLocked || (sale.status === SaleStatus.EXCLUSAO_SOLICITADA && currentUser.role !== UserRole.ADMIN && currentUser.role !== UserRole.SUPERVISOR)}
                                    className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase outline-none cursor-pointer w-fit ${
                                      sale.status === SaleStatus.PAGO ? 'bg-emerald-100 text-emerald-600' :
                                      sale.status === SaleStatus.PENDENTE ? 'bg-amber-100 text-amber-600' :
                                      sale.status === SaleStatus.CANCELADO ? 'bg-red-100 text-red-600' :
                                      sale.status === SaleStatus.ARQUIVADO ? 'bg-zinc-200 text-zinc-700' :
                                      sale.status === SaleStatus.EXCLUSAO_SOLICITADA ? 'bg-zinc-800 text-zinc-100' :
                                      'bg-zinc-100 text-zinc-600'
                                    }`}
                                  >
                                    {Object.values(SaleStatus).filter(s => s !== SaleStatus.DELETED && s !== SaleStatus.CANCELADO && s !== SaleStatus.REMARKETING).map(s => <option key={s} value={s}>{getStatusLabel(s)}</option>)}
                                  </select>
                                  {/* Stale AGUARDANDO alert in list */}
                                  {isStaleAguardando(sale as Sale) && (
                                    <span className="text-[10px] font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded-full w-fit animate-pulse">
                                      ⚠️ Sem atendimento há {getStaleHours(sale as Sale)}h{getStaleHours(sale as Sale) >= 12 ? ' — Recomendamos arquivar' : ''}
                                    </span>
                                  )}
                                  {/* Receipt Rejected alert in list */}
                                  {(sale as Sale).receipt_rejected && (
                                    <span className="text-[10px] font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded-full w-fit animate-pulse">
                                      ❌ {(sale as Sale).receipt_rejection_reason || 'Comprovante Rejeitado'}
                                    </span>
                                  )}
                                  {/* Locked badge in list */}
                                  {isListPago && (
                                    <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full w-fit flex items-center gap-1">
                                      <Lock className="w-3 h-3" /> Venda finalizada ✅
                                    </span>
                                  )}
                                  {isListPago && receipts.some(r => r.sale_id === sale.id && (r.audit_status === 'divergent' || r.audit_status === 'error' || r.audit_status === 'duplicate' || r.audit_status === 'pending' || !r.audit_status)) && (
                                    <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full w-fit flex items-center gap-1 animate-pulse">
                                      ⏳ Comprovante aguardando aprovação
                                    </span>
                                  )}
                                  {isReceiptListLocked && !isListPago && (
                                    <span className="text-[10px] font-bold text-zinc-500 bg-zinc-100 px-2 py-0.5 rounded-full w-fit flex items-center gap-1">
                                      <Lock className="w-3 h-3" /> Aguardando análise
                                    </span>
                                  )}
                                  </>);
                                  })()}


                                </div>
                              </td>
                              <td className="px-6 py-4">
                                <div className="flex gap-2">
                                  {!sale.receipt_id ? (
                                    <div className="relative">
                                      <input 
                                        type="file" 
                                        className="absolute inset-0 opacity-0 cursor-pointer z-20"
                                        onChange={(e) => {
                                          const file = e.target.files?.[0];
                                          if (file) handleUploadReceipt(sale.id, file);
                                        }}
                                      />
                                      <button 
                                        className="p-2 hover:bg-indigo-50 text-indigo-600 rounded-lg transition-all"
                                        title="Enviar Comprovante"
                                      >
                                        <Upload className="w-4 h-4" />
                                      </button>
                                    </div>
                                  ) : (
                                    <button 
                                      onClick={() => {
                                        const receipt = receipts.find(r => r.sale_id === sale.id);
                                        if (receipt) handleViewReceipt(receipt.file_path);
                                      }}
                                      className="flex items-center gap-1 px-3 py-1.5 bg-emerald-50 text-emerald-600 rounded-lg hover:bg-emerald-100 transition-all text-xs font-bold"
                                      title="Ver Comprovante"
                                    >
                                      <FileText className="w-3.5 h-3.5" />
                                       Comprovante
                                    </button>
                                  )}
                                  <a 
                                        href={`https://wa.me/${sale.phone.replace(/\D/g, '')}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="p-2 hover:bg-green-50 text-green-600 rounded-lg transition-all"
                                        title="Chamar no WhatsApp"
                                      >
                                        <MessageCircle className="w-4 h-4" />
                                      </a>
                                      {!(sale.status === SaleStatus.PAGO && currentUser.role === UserRole.VENDEDOR) && (
                                        <button onClick={() => setEditingSale(sale)} className="p-2 hover:bg-zinc-100 text-zinc-500 rounded-lg transition-all" title="Editar">
                                          <Edit2 className="w-4 h-4" />
                                        </button>
                                      )}
                                      {sale.status === SaleStatus.EXCLUSAO_SOLICITADA && (currentUser.role === UserRole.ADMIN || currentUser.role === UserRole.SUPERVISOR) && (
                                        <>
                                          <button 
                                            onClick={() => handleDeleteSale(sale.id)}
                                            disabled={deletingSaleId === sale.id}
                                            className="p-2 hover:bg-emerald-50 text-emerald-600 rounded-lg transition-all disabled:opacity-50"
                                            title="Aprovar Exclusão"
                                          >
                                            {deletingSaleId === sale.id ? <div className="w-4 h-4 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                                          </button>
                                          <button 
                                            onClick={() => handleRejectDeletion(sale)}
                                            className="p-2 hover:bg-red-50 text-red-600 rounded-lg transition-all"
                                            title="Rejeitar Exclusão"
                                          >
                                            <XCircle className="w-4 h-4" />
                                          </button>
                                        </>
                                      )}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="p-6 overflow-x-auto">
                      <div className="flex gap-6 min-w-max pb-4">
                        {Object.values(SaleStatus).filter(status => !KANBAN_HIDDEN_STATUSES.includes(status)).map(status => {
                          const statusSales = mySales.filter(s => {
                            if (s.status !== status) return false;
                            
                            // PAGO: only show if paid today
                            if (status === SaleStatus.PAGO) {
                              return isPagoVisibleInFlow(s) || receipts.some(r => r.sale_id === s.id && (r.audit_status === 'divergent' || r.audit_status === 'error' || r.audit_status === 'duplicate'));
                            }

                            // ARQUIVADO: column visible as drop target but sales hidden immediately
                            if (status === SaleStatus.ARQUIVADO) {
                              return false;
                            }
                            
                            return true;
                          }).sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

                          return (
                          <div 
                            key={status} 
                            className="w-80 bg-zinc-50 rounded-2xl border border-black/5 flex flex-col max-h-[calc(100vh-300px)]"
                            onDragOver={handleDragOver}
                            onDrop={(e) => handleDrop(e, status)}
                          >
                            <div className="p-4 border-b border-black/5 flex justify-between items-center bg-white rounded-t-2xl">
                              <h4 className="font-bold text-sm text-zinc-700">{getStatusLabel(status)}</h4>
                              <span className="bg-zinc-100 text-zinc-500 text-xs font-bold px-2 py-1 rounded-full">
                                {statusSales.length}
                              </span>
                            </div>
                            <div className="p-4 flex-1 overflow-y-auto flex flex-col gap-3">
                              {statusSales.map(sale => {
                                const stale = isStaleAguardando(sale);

                                const isPago = sale.status === SaleStatus.PAGO;
                                const isReceiptLocked = currentUser.role === UserRole.VENDEDOR && receipts.some(r => r.sale_id === sale.id && (r.audit_status === 'divergent' || r.audit_status === 'error' || r.audit_status === 'duplicate'));
                                const isLocked = isPago || isReceiptLocked;
                                return (
                                <div 
                                  key={sale.id}
                                  draggable={!isLocked}
                                  onDragStart={(e) => isLocked ? e.preventDefault() : handleDragStart(e, sale.id)}
                                  className={`bg-white p-4 rounded-xl border shadow-sm hover:shadow-md transition-all flex flex-col gap-3 ${isLocked ? 'opacity-70 cursor-not-allowed' : 'cursor-grab active:cursor-grabbing'} ${stale ? 'border-red-300 ring-1 ring-red-200' : isPago ? 'border-emerald-300 ring-1 ring-emerald-200' : 'border-black/5'}`}
                                >
                                  {/* Lock badge */}
                                  {isPago && (
                                    <div className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-lg w-fit">
                                      <Lock className="w-3 h-3" />
                                      Venda finalizada ✅
                                    </div>
                                  )}
                                  {isPago && receipts.some(r => r.sale_id === sale.id && (r.audit_status === 'divergent' || r.audit_status === 'error' || r.audit_status === 'duplicate' || r.audit_status === 'pending' || !r.audit_status)) && (
                                    <div className="flex items-center gap-1 text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-1 rounded-lg w-fit animate-pulse">
                                      ⏳ Comprovante aguardando aprovação
                                    </div>
                                  )}
                                  {isReceiptLocked && !isPago && (
                                    <div className="flex items-center gap-1 text-[10px] font-bold text-zinc-500 bg-zinc-100 px-2 py-1 rounded-lg w-fit">
                                      <Lock className="w-3 h-3" />
                                      Aguardando análise do Admin
                                    </div>
                                  )}
                                  {/* Stale AGUARDANDO alert */}
                                  {stale && (
                                    <span className="text-[10px] font-bold text-red-600 bg-red-50 px-2 py-1 rounded-lg animate-pulse">
                                      ⚠️ Sem atendimento há {getStaleHours(sale)}h{getStaleHours(sale) >= 12 ? ' — Recomendamos arquivar' : ''}
                                    </span>
                                  )}
                                  {/* Receipt Rejected alert */}
                                  {sale.receipt_rejected && (
                                    <span className="text-[10px] font-bold text-red-600 bg-red-50 px-2 py-1 rounded-lg animate-pulse w-fit">
                                      ❌ {sale.receipt_rejection_reason || 'Comprovante Rejeitado'} — envie novamente
                                    </span>
                                  )}

                                  <div className="flex justify-between items-start">
                                    <div>
                                      <p className="font-bold text-zinc-900">{sale.phone}</p>
                                      <p className="text-xs text-zinc-500">{sale.service}</p>
                                    </div>
                                    <span className="font-bold text-emerald-600 text-sm">R$ {sale.value.toLocaleString()}</span>
                                  </div>

                                  <div className="flex justify-between items-center pt-2 border-t border-black/5">
                                    <span className="text-[10px] text-zinc-400 font-medium">
                                      {new Date(sale.created_at).toLocaleDateString()}
                                    </span>
                                    <div className="flex items-center gap-2">
                                      {currentUser.role !== UserRole.VENDEDOR && (
                                        <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded-lg">
                                          {users.find(u => u.id === sale.vendedor_id)?.name?.split(' ')[0] || 'Desconhecido'}
                                        </span>
                                      )}
                                      <a 
                                        href={`https://wa.me/${sale.phone.replace(/\D/g, '')}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="p-1.5 bg-green-50 text-green-600 rounded-lg hover:bg-green-100 transition-colors"
                                        title="Chamar no WhatsApp"
                                      >
                                        <MessageCircle className="w-3 h-3" />
                                      </a>
                                      {!(sale.status === SaleStatus.PAGO && currentUser.role === UserRole.VENDEDOR) && !isLocked && (
                                        <button 
                                          onClick={() => setEditingSale(sale)}
                                          className="p-1.5 bg-zinc-50 text-zinc-500 rounded-lg hover:bg-zinc-100 transition-colors"
                                          title="Editar"
                                        >
                                          <Edit2 className="w-3 h-3" />
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                </div>
                                );
                              })}
                            </div>
                          </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {currentPage === 'receipts' && (() => {
                const visibleReceipts = receipts.filter(r => {
                  // Role-based filter
                  if (currentUser.role !== UserRole.ADMIN && r.vendedor_id !== currentUser.id) return false;
                  // Vendor filter
                  if (receiptVendorFilter && r.vendedor_id !== receiptVendorFilter) return false;
                  // Date filter
                  if (receiptDateFrom && r.created_at < receiptDateFrom) return false;
                  if (receiptDateTo && r.created_at > receiptDateTo + 'T23:59:59') return false;
                  return true;
                });
                const approvedCount = visibleReceipts.filter(r => r.audit_status === 'approved').length;
                const divergentCount = visibleReceipts.filter(r => r.audit_status === 'divergent').length;
                const duplicateCount = visibleReceipts.filter(r => r.audit_status === 'duplicate').length;
                const pendingCount = visibleReceipts.filter(r => !r.audit_status || r.audit_status === 'pending' || r.audit_status === 'error').length;
                const filteredReceipts = receiptAuditFilter === 'all' 
                  ? visibleReceipts 
                  : receiptAuditFilter === 'pending'
                  ? visibleReceipts.filter(r => !r.audit_status || r.audit_status === 'pending' || r.audit_status === 'error')
                  : visibleReceipts.filter(r => r.audit_status === receiptAuditFilter);

                return (
                <div className="space-y-6">
                  {/* Summary Cards */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-white rounded-2xl p-4 border border-black/5 shadow-sm">
                      <p className="text-xs font-bold text-zinc-400 uppercase">Total</p>
                      <p className="text-2xl font-black text-zinc-900">{visibleReceipts.length}</p>
                    </div>
                    <div className="bg-emerald-50 rounded-2xl p-4 border border-emerald-100">
                      <p className="text-xs font-bold text-emerald-500 uppercase">✅ Aprovados</p>
                      <p className="text-2xl font-black text-emerald-600">{approvedCount}</p>
                    </div>
                    <div className="bg-amber-50 rounded-2xl p-4 border border-amber-100">
                      <p className="text-xs font-bold text-amber-500 uppercase">⚠️ Divergentes</p>
                      <p className="text-2xl font-black text-amber-600">{divergentCount}</p>
                    </div>
                    <div className="bg-red-50 rounded-2xl p-4 border border-red-100">
                      <p className="text-xs font-bold text-red-400 uppercase">🚫 Duplicados</p>
                      <p className="text-2xl font-black text-red-500">{duplicateCount}</p>
                    </div>
                  </div>

                  {/* Filters + Table */}
                  <div className="bg-white rounded-3xl shadow-sm border border-black/5 overflow-hidden">
                    <div className="p-6 border-b border-black/5 flex flex-col gap-4">
                      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                        <h3 className="font-bold text-zinc-900 text-lg">Gestão de Comprovantes</h3>
                        <div className="flex gap-3 items-center flex-wrap">
                          <div className="flex items-center gap-2">
                            <input
                              type="date"
                              value={receiptDateFrom}
                              onChange={(e) => setReceiptDateFrom(e.target.value)}
                              className="text-xs border border-zinc-200 rounded-lg px-2 py-1.5 focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400 outline-none"
                              title="Data início"
                            />
                            <span className="text-zinc-400 text-xs">até</span>
                            <input
                              type="date"
                              value={receiptDateTo}
                              onChange={(e) => setReceiptDateTo(e.target.value)}
                              className="text-xs border border-zinc-200 rounded-lg px-2 py-1.5 focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400 outline-none"
                              title="Data fim"
                            />
                            {(receiptDateFrom || receiptDateTo) && (
                              <button onClick={() => { setReceiptDateFrom(''); setReceiptDateTo(''); }} className="text-xs text-red-500 hover:text-red-700 font-bold">✕</button>
                            )}
                          </div>
                          {(currentUser.role === UserRole.ADMIN) && (
                            <select
                              value={receiptVendorFilter}
                              onChange={(e) => setReceiptVendorFilter(e.target.value)}
                              className="text-xs border border-zinc-200 rounded-lg px-2 py-1.5 focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400 outline-none min-w-[140px]"
                            >
                              <option value="">Todos os vendedores</option>
                              {users.filter(u => u.status === 'ATIVO').map(u => (
                                <option key={u.id} value={u.id}>{u.name}</option>
                              ))}
                            </select>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        {[
                          { key: 'all' as const, label: 'Todos', count: visibleReceipts.length },
                          { key: 'approved' as const, label: '✅ Aprovados', count: approvedCount },
                          { key: 'divergent' as const, label: '⚠️ Divergentes', count: divergentCount },
                          { key: 'duplicate' as const, label: '🚫 Duplicados', count: duplicateCount },
                          { key: 'pending' as const, label: '⏳ Pendentes', count: pendingCount },
                        ].map(f => (
                          <button
                            key={f.key}
                            onClick={() => setReceiptAuditFilter(f.key)}
                            className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all ${
                              receiptAuditFilter === f.key
                                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-100'
                                : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
                            }`}
                          >
                            {f.label} ({f.count})
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left">
                        <thead className="bg-zinc-50 text-zinc-500 text-xs uppercase tracking-wider">
                          <tr>
                            <th className="px-4 py-3 font-semibold">Data</th>
                            <th className="px-4 py-3 font-semibold">Vendedor</th>
                            <th className="px-4 py-3 font-semibold">Serviço</th>
                            <th className="px-4 py-3 font-semibold">Arquivo</th>
                            <th className="px-4 py-3 font-semibold">Valor Confirmado</th>
                            <th className="px-4 py-3 font-semibold">Valor OCR</th>
                            <th className="px-4 py-3 font-semibold">Auditoria</th>
                            <th className="px-4 py-3 font-semibold">Detalhes</th>
                            {(currentUser.role === UserRole.ADMIN) && <th className="px-4 py-3 font-semibold">Ações</th>}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-black/5">
                          {filteredReceipts.length === 0 ? (
                            <tr>
                              <td colSpan={8} className="px-4 py-12 text-center text-zinc-400">
                                Nenhum comprovante encontrado para este filtro
                              </td>
                            </tr>
                          ) : filteredReceipts.map((receipt) => (
                            <tr key={receipt.id} className={`hover:bg-zinc-50 transition-all ${
                              receipt.audit_status === 'divergent' ? 'bg-amber-50/50' :
                              receipt.audit_status === 'duplicate' ? 'bg-red-50/50' : ''
                            }`}>
                              <td className="px-4 py-3 text-sm text-zinc-500">{new Date(receipt.created_at).toLocaleDateString()}</td>
                              <td className="px-4 py-3 text-sm font-medium text-zinc-900">{users.find(u => u.id === receipt.vendedor_id)?.name}</td>
                              <td className="px-4 py-3 text-sm">
                                {(() => {
                                  const sale = sales.find(s => s.id === receipt.sale_id);
                                  const services = sale?.services || (sale?.service ? [sale.service] : []);
                                  return services.length > 0 ? (
                                    <span className="px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded-full text-xs font-semibold">{services.join(', ')}</span>
                                  ) : <span className="text-zinc-400 text-xs">—</span>;
                                })()}
                              </td>
                              <td className="px-4 py-3 text-sm">
                                <button 
                                  onClick={() => handleViewReceipt(receipt.file_path)} 
                                  className="hover:underline flex items-center gap-1 text-indigo-600 font-medium"
                                >
                                  {receipt.file_name}
                                  <ChevronRight className="w-3 h-3" />
                                </button>
                              </td>
                              <td className="px-4 py-3 font-bold text-zinc-900">
                                R$ {(receipt.confirmed_value ?? receipt.value)?.toLocaleString('pt-BR', {minimumFractionDigits: 2})}
                              </td>
                              <td className="px-4 py-3 font-bold">
                                {receipt.ocr_value !== undefined && receipt.ocr_value !== null ? (
                                  <span className={receipt.ocr_value === (receipt.confirmed_value ?? receipt.value) ? 'text-emerald-600' : 'text-red-500'}>
                                    R$ {receipt.ocr_value.toLocaleString('pt-BR', {minimumFractionDigits: 2})}
                                  </span>
                                ) : (
                                  <span className="text-zinc-300">—</span>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase ${
                                  receipt.audit_status === 'approved' ? 'bg-emerald-100 text-emerald-600' :
                                  receipt.audit_status === 'divergent' ? 'bg-amber-100 text-amber-600' :
                                  receipt.audit_status === 'duplicate' ? 'bg-red-100 text-red-600' :
                                  receipt.audit_status === 'error' ? 'bg-rose-100 text-rose-600' :
                                  receipt.status === ReceiptStatus.PAGO ? 'bg-emerald-100 text-emerald-600' :
                                  'bg-zinc-100 text-zinc-500'
                                }`}>
                                  {receipt.audit_status === 'approved' ? '✅ Aprovado' :
                                   receipt.audit_status === 'divergent' ? '⚠️ Divergente' :
                                   receipt.audit_status === 'duplicate' ? '🚫 Duplicado' :
                                   receipt.audit_status === 'error' ? '❌ Erro OCR' :
                                   receipt.status === ReceiptStatus.PAGO ? '💰 Pago' :
                                   '⏳ Pendente'}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-xs text-zinc-500 max-w-[200px] truncate" title={receipt.audit_details || ''}>
                                {receipt.audit_details || '—'}
                              </td>
                              {(currentUser.role === UserRole.ADMIN) && (
                                <td className="px-4 py-3">
                                  <div className="flex gap-2">
                                    <button 
                                      onClick={() => handleViewReceipt(receipt.file_path)}
                                      className="text-xs font-bold text-indigo-600 hover:underline"
                                    >
                                      Ver
                                    </button>
                                    {(receipt.audit_status === 'divergent' || receipt.audit_status === 'error' || !receipt.audit_status || receipt.audit_status === 'pending') && (
                                      <button 
                                        onClick={async () => {
                                          await updateDoc(doc(db, 'receipts', receipt.id), { 
                                            status: ReceiptStatus.PAGO, 
                                            audit_status: 'approved',
                                            audit_details: 'Aprovado manualmente pelo admin',
                                            audited_at: new Date().toISOString()
                                          });
                                          await handleUpdateStatus(receipt.sale_id, SaleStatus.PAGO, true);
                                          await addLog(currentUser, `Aprovou manualmente comprovante ${receipt.id}`, receipt.id);
                                          showToast('Comprovante aprovado manualmente!', 'success');
                                        }}
                                        className="text-xs font-bold text-emerald-600 hover:underline"
                                      >
                                        ✅ Aprovar
                                      </button>
                                    )}
                                    {(receipt.audit_status === 'divergent' || receipt.audit_status === 'duplicate' || receipt.audit_status === 'error' || !receipt.audit_status || receipt.audit_status === 'pending') && (
                                      <button 
                                        onClick={() => {
                                          setConfirmModal({
                                            title: '❌ Rejeitar Comprovante',
                                            message: 'Rejeitar este comprovante? A venda voltará para "Atendimento Iniciado" e o vendedor precisará enviar um novo.',
                                            confirmText: 'Rejeitar',
                                            onConfirm: async () => {
                                              try {
                                                await deleteDoc(doc(db, 'receipts', receipt.id));
                                                await updateDoc(doc(db, 'sales', receipt.sale_id), {
                                                  status: SaleStatus.AGUARDANDO,
                                                  paid_at: null,
                                                  receipt_rejected: true,
                                                  receipt_rejection_reason: 'Rejeitado pelo Admin',
                                                  updated_at: new Date().toISOString()
                                                });
                                                await addLog(currentUser, `Rejeitou comprovante ${receipt.id} — venda ${receipt.sale_id} voltou para Atendimento Iniciado`, receipt.id);
                                                showToast('Comprovante rejeitado. Venda devolvida ao vendedor.', 'success');
                                              } catch (err: any) {
                                                showToast('Erro ao rejeitar: ' + err.message, 'error');
                                              }
                                            }
                                          });
                                        }}
                                        className="text-xs font-bold text-red-600 hover:underline"
                                      >
                                        ❌ Rejeitar
                                      </button>
                                    )}
                                  </div>
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
                );
              })()}

              {currentPage === 'users' && (currentUser.role === UserRole.ADMIN) && (
                <div className="space-y-6">
                  <div className="flex justify-between items-center">
                    <h3 className="text-2xl font-bold text-zinc-900">Gestão de Equipe</h3>
                    <div className="flex gap-4">
                      {currentUser.role === UserRole.ADMIN && (
                        <button 
                          onClick={handleResetDatabase}
                          disabled={isSubmitting}
                          className="bg-red-100 text-red-600 px-6 py-3 rounded-xl font-bold flex items-center gap-2 hover:bg-red-200 transition-all"
                        >
                          <Trash2 className="w-5 h-5" />
                          Limpar Dados de Teste
                        </button>
                      )}
                      <button 
                        onClick={() => setShowUserModal(true)}
                        className="bg-indigo-600 text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100"
                      >
                        <PlusCircle className="w-5 h-5" />
                        Novo Usuário
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {users.map(user => (
                      <div key={user.id} className="bg-white p-6 rounded-3xl shadow-sm border border-black/5 space-y-4">
                        <div className="flex justify-between items-start">
                          <div className="flex items-center gap-3">
                            <div className="w-12 h-12 bg-zinc-100 rounded-2xl flex items-center justify-center overflow-hidden relative group">
                              {user.photo_url ? (
                                <img src={user.photo_url} alt={user.name} className="w-full h-full object-cover" />
                              ) : (
                                <UserIcon className="w-6 h-6 text-zinc-400" />
                              )}
                              <label className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 cursor-pointer transition-opacity">
                                <Camera className="w-5 h-5 text-white" />
                                <input type="file" accept="image/*" className="hidden" onChange={(e) => handlePhotoSelect(e, user.id)} />
                              </label>
                            </div>
                            <div>
                              <h4 className="font-bold text-zinc-900">{user.name} {user.id === currentUser.id ? '(Você)' : ''}</h4>
                              <p className="text-xs text-zinc-500">@{user.username} • {user.role}</p>
                            </div>
                          </div>
                          <span className={`px-2 py-1 rounded-lg text-[10px] font-bold ${user.status === 'ATIVO' ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-600'}`}>
                            {user.status}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-4 pt-4 border-t border-black/5">
                          <div>
                            <p className="text-[10px] text-zinc-400 uppercase font-bold">Meta Diária</p>
                            <p className="font-bold text-zinc-900">R$ {(user.daily_goal || 0).toLocaleString()}</p>
                          </div>
                          <div>
                            <p className="text-[10px] text-zinc-400 uppercase font-bold">Comissão Padrão</p>
                            <p className="font-bold text-zinc-900">{user.commission || 0}%</p>
                          </div>
                        </div>
                        {user.last_login_at && (
                          <div className="pt-2 border-t border-black/5">
                            <p className="text-[10px] text-zinc-400 uppercase font-bold">Último Acesso</p>
                            <p className="text-xs text-zinc-600 font-medium">{new Date(user.last_login_at).toLocaleString('pt-BR')}</p>
                          </div>
                        )}
                        <div className="flex gap-2 pt-2">
                          <button 
                            onClick={() => setEditingSeller(user)}
                            className="flex-1 py-2 bg-zinc-100 rounded-xl text-xs font-bold text-zinc-600 hover:bg-zinc-200 transition-all"
                          >
                            Editar Perfil
                          </button>
                          {user.id !== currentUser.id && (
                            <>
                              <button 
                                onClick={() => {
                                  setConfirmInput('');
                                  setConfirmModal({
                                    title: user.status === 'ATIVO' ? 'Desativar Usuário' : 'Ativar Usuário',
                                    message: `Tem certeza que deseja ${user.status === 'ATIVO' ? 'desativar' : 'ativar'} este usuário?`,
                                    confirmText: user.status === 'ATIVO' ? 'Desativar' : 'Ativar',
                                    onConfirm: () => {
                                      const newStatus = user.status === 'ATIVO' ? 'INATIVO' : 'ATIVO';
                                      handleUpdateUser(user.id, { status: newStatus });
                                    }
                                  });
                                }}
                                className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all ${user.status === 'ATIVO' ? 'bg-amber-50 text-amber-600 hover:bg-amber-100' : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'}`}
                              >
                                {user.status === 'ATIVO' ? 'Desativar' : 'Ativar'}
                              </button>
                              <button 
                                onClick={() => {
                                  setConfirmInput('');
                                  setConfirmModal({
                                    title: 'Excluir Usuário',
                                    message: 'ATENÇÃO: Excluir este usuário fará com que todas as vendas dele fiquem sem dono (Desconhecido). Recomendamos DESATIVAR o usuário em vez de excluir. Tem certeza absoluta que deseja EXCLUIR?',
                                    confirmText: 'Excluir',
                                    onConfirm: async () => {
                                      try {
                                        await deleteDoc(doc(db, 'profiles', user.id));
                                        await addLog(currentUser, `Excluiu permanentemente o usuário ${user.name}`, user.id);
                                        showToast('Usuário excluído com sucesso.', 'success');
                                      } catch (err: any) {
                                        showToast('Erro ao excluir usuário: ' + err.message, 'error');
                                      }
                                    }
                                  });
                                }}
                                className="flex-1 py-2 bg-red-50 text-red-600 rounded-xl text-xs font-bold hover:bg-red-100 transition-all"
                              >
                                Excluir
                              </button>

                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}



              {currentPage === 'logs' && (currentUser.role === UserRole.ADMIN) && (
                <div className="bg-white rounded-3xl shadow-sm border border-black/5 overflow-hidden">
                  <div className="p-6 border-b border-black/5 flex justify-between items-center">
                    <h3 className="font-bold text-zinc-900">Logs de Auditoria</h3>
                    <div className="flex items-center gap-3">
                      <button 
                        onClick={() => {
                          const cutoff = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
                          const oldReceipts = receipts.filter(r => r.created_at < cutoff);
                          const oldLogs = logs.filter(l => l.created_at < cutoff);
                          if (oldReceipts.length === 0 && oldLogs.length === 0) {
                            const now = new Date().toISOString(); setDoc(doc(db, 'settings', 'cleanup'), { lastCleanupDate: now }); setLastCleanupDate(now);
                            showToast('Nenhum dado antigo encontrado. Tudo limpo!', 'info');
                            return;
                          }
                          setConfirmModal({
                            title: '🧹 Limpeza Geral',
                            message: `Serão removidos:\n• ${oldReceipts.length} comprovante(s)\n• ${oldLogs.length} log(s)\n\nTodos com mais de 15 dias. Esta ação não pode ser desfeita.`,
                            confirmText: 'Limpar Tudo',
                            onConfirm: async () => {
                              try {
                                for (const r of oldReceipts) {
                                  await deleteDoc(doc(db, 'receipts', r.id));
                                }
                                for (const l of oldLogs) {
                                  await deleteDoc(doc(db, 'audit_logs', l.id));
                                }
                                await addLog(currentUser, `Limpeza geral: ${oldReceipts.length} comprovantes + ${oldLogs.length} logs removidos`);
                                const nowCleanup = new Date().toISOString(); await setDoc(doc(db, 'settings', 'cleanup'), { lastCleanupDate: nowCleanup }); setLastCleanupDate(nowCleanup);
                                showToast(`Limpeza concluída: ${oldReceipts.length} comprovante(s) + ${oldLogs.length} log(s) removidos!`, 'success');
                              } catch (err: any) {
                                showToast('Erro na limpeza: ' + err.message, 'error');
                              }
                            }
                          });
                        }}
                        className="w-fit bg-red-600 text-white px-3 py-1.5 rounded-xl font-semibold hover:bg-red-700 transition-colors text-xs"
                      >
                        🧹 Limpar Dados Antigos (+15 dias)
                      </button>
                      {(() => {
                        const daysSince = lastCleanupDate ? Math.floor((Date.now() - new Date(lastCleanupDate).getTime()) / (1000 * 60 * 60 * 24)) : 999;
                        return daysSince >= 15 ? (
                          <span className="text-xs font-bold text-red-600 bg-red-50 px-3 py-1.5 rounded-full animate-pulse">
                            ⚠️ Limpeza pendente ({daysSince === 999 ? 'nunca feita' : `${daysSince} dias`})
                          </span>
                        ) : (
                          <span className="text-xs text-zinc-400">Próxima limpeza em {15 - daysSince} dia(s)</span>
                        );
                      })()}
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead className="bg-zinc-50 text-zinc-500 text-xs uppercase tracking-wider">
                        <tr>
                          <th className="px-6 py-4 font-semibold">Data/Hora</th>
                          <th className="px-6 py-4 font-semibold">Usuário</th>
                          <th className="px-6 py-4 font-semibold">Ação</th>
                          <th className="px-6 py-4 font-semibold">ID Afetado</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-black/5">
                        {logs.map((log) => (
                          <tr key={log.id} className="hover:bg-zinc-50 transition-all">
                            <td className="px-6 py-4 text-xs text-zinc-500 font-mono">{new Date(log.created_at).toLocaleString()}</td>
                            <td className="px-6 py-4 text-sm font-bold text-zinc-900">{log.user_name}</td>
                            <td className="px-6 py-4 text-sm text-zinc-600">{log.action}</td>
                            <td className="px-6 py-4 text-xs text-zinc-400 font-mono">{log.target_id || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {currentPage === 'financial' && (currentUser.role === UserRole.ADMIN) && (
                <div className="space-y-8">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-center gap-2 bg-white p-2 rounded-2xl shadow-sm border border-black/5">
                      <Calendar className="w-4 h-4 text-zinc-400 ml-2" />
                      <input 
                        type="date" 
                        value={dateRange.start}
                        onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
                        className="bg-transparent border-none text-sm font-bold text-zinc-700 outline-none"
                      />
                      <span className="text-zinc-400 text-sm">até</span>
                      <input 
                        type="date" 
                        value={dateRange.end}
                        onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
                        className="bg-transparent border-none text-sm font-bold text-zinc-700 outline-none pr-2"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <StatCard title="Total Vendido (Período)" value={`R$ ${sales.filter(s => isSaleRevenueApproved(s) && (!dateRange.start || toLocalDateString(s.paid_at || '') >= dateRange.start) && (!dateRange.end || toLocalDateString(s.paid_at || '') <= dateRange.end)).reduce((acc, s) => acc + s.value, 0).toLocaleString()}`} icon={PieChart} color="bg-indigo-600" />
                    <StatCard title="Comissões a Pagar" value={`R$ ${sales.filter(s => isSaleRevenueApproved(s) && !s.commission_paid).reduce((acc, s) => {
                      const v = users.find(u => u.id === s.vendedor_id);
                      return acc + calculateCommission(s, v);
                    }, 0).toLocaleString()}`} icon={DollarSign} color="bg-amber-500" />
                    <StatCard title="Total Pago (Período)" value={`R$ ${payments.filter(p => (!dateRange.start || toLocalDateString(p.created_at) >= dateRange.start) && (!dateRange.end || toLocalDateString(p.created_at) <= dateRange.end)).reduce((acc, p) => acc + p.amount, 0).toLocaleString()}`} icon={CheckCircle} color="bg-emerald-500" />
                  </div>

                  {/* Pending Commissions Accordion */}
                  {(() => {
                    const pendingSales = sales.filter(s => isSaleRevenueApproved(s) && !s.commission_paid);
                    if (pendingSales.length === 0) return null;

                    const grouped = pendingSales.reduce((acc, sale) => {
                      const vid = sale.vendedor_id;
                      if (!acc[vid]) acc[vid] = [];
                      acc[vid].push(sale);
                      return acc;
                    }, {} as Record<string, Sale[]>);

                    const grandTotal = pendingSales.reduce((acc, s) => {
                      const v = users.find(u => u.id === s.vendedor_id);
                      return acc + calculateCommission(s, v);
                    }, 0);

                    return (
                      <div className="bg-white rounded-3xl shadow-sm border border-black/5 overflow-hidden">
                        <div className="p-6 border-b border-black/5 flex justify-between items-center">
                          <div>
                            <h3 className="font-bold text-zinc-900 text-lg">Vendas com Comissão Pendente</h3>
                            <p className="text-xs text-zinc-400 mt-1">{pendingSales.length} venda(s) • {Object.keys(grouped).length} vendedor(es)</p>
                          </div>
                          <span className="px-4 py-2 bg-amber-100 text-amber-700 rounded-full text-sm font-black">
                            R$ {grandTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                          </span>
                        </div>
                        <div className="p-4 space-y-3">
                          {(Object.entries(grouped) as [string, Sale[]][]).map(([vendedorId, vendorSales]) => {
                            const vendor = users.find(u => u.id === vendedorId);
                            const vendorTotal = vendorSales.reduce((acc, s) => acc + calculateCommission(s, vendor), 0);
                            const isExpanded = expandedVendors[vendedorId] || false;

                            return (
                              <div key={vendedorId} className="border border-black/5 rounded-2xl overflow-hidden">
                                <div className="flex items-center justify-between p-4 hover:bg-zinc-50 transition-colors">
                                  <button
                                    onClick={() => setExpandedVendors(prev => ({ ...prev, [vendedorId]: !prev[vendedorId] }))}
                                    className="flex items-center gap-3 flex-1"
                                  >
                                    <span className={`text-xs font-bold transition-transform ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                                    <span className="font-bold text-indigo-600">{vendor?.name || 'Desconhecido'}</span>
                                    <span className="text-xs text-zinc-400 bg-zinc-100 px-2 py-0.5 rounded-full">{vendorSales.length} venda{vendorSales.length !== 1 ? 's' : ''}</span>
                                    <span className="font-black text-amber-600 text-sm">R$ {vendorTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                                  </button>
                                  {vendor && (
                                    <button
                                      onClick={() => {
                                        setPayingSeller(vendor);
                                        setSelectedSalesToPay(vendorSales.map(s => s.id));
                                        setPaymentReceipt(null);
                                      }}
                                      className="px-4 py-2 bg-emerald-50 text-emerald-600 rounded-xl text-xs font-bold hover:bg-emerald-100 transition-colors flex items-center gap-1 shrink-0"
                                    >
                                      <DollarSign className="w-3.5 h-3.5" />
                                      Pagar
                                    </button>
                                  )}
                                </div>
                                {isExpanded && (
                                  <div className="border-t border-black/5 max-h-[300px] overflow-y-auto">
                                    <table className="w-full text-left">
                                      <thead className="bg-zinc-50 text-zinc-500 text-[10px] uppercase tracking-wider sticky top-0">
                                        <tr>
                                          <th className="px-4 py-2 font-semibold">Telefone</th>
                                          <th className="px-4 py-2 font-semibold">Serviço</th>
                                          <th className="px-4 py-2 font-semibold">Data Pgto</th>
                                          <th className="px-4 py-2 font-semibold">Valor</th>
                                          <th className="px-4 py-2 font-semibold">%</th>
                                          <th className="px-4 py-2 font-semibold">Comissão</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-zinc-100">
                                        {vendorSales.map(sale => {
                                          const rate = vendor?.commissions?.[sale.service] ?? vendor?.commission ?? 10;
                                          const commission = calculateCommission(sale, vendor);
                                          return (
                                            <tr key={sale.id} className="hover:bg-zinc-50 transition-colors text-sm">
                                              <td className="px-4 py-3 font-medium text-zinc-900">{sale.phone}</td>
                                              <td className="px-4 py-3">
                                                <span className="px-2 py-0.5 bg-zinc-100 rounded-full text-xs font-medium text-zinc-600">{sale.service}</span>
                                              </td>
                                              <td className="px-4 py-3 text-xs text-zinc-500">{sale.paid_at ? new Date(sale.paid_at).toLocaleDateString('pt-BR') : '—'}</td>
                                              <td className="px-4 py-3 font-bold text-zinc-900">R$ {sale.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                                              <td className="px-4 py-3 text-zinc-500">{rate}%</td>
                                              <td className="px-4 py-3 font-black text-emerald-600">R$ {commission.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Payment History */}
                  <div className="bg-white rounded-3xl shadow-sm border border-black/5 overflow-hidden">
                    <div className="p-6 border-b border-black/5">
                      <h3 className="font-bold text-zinc-900 text-lg">Histórico de Pagamentos</h3>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left">
                        <thead className="bg-zinc-50 text-zinc-500 text-xs uppercase tracking-wider">
                          <tr>
                            <th className="px-6 py-4 font-semibold">Data</th>
                            <th className="px-6 py-4 font-semibold">Vendedor</th>
                            <th className="px-6 py-4 font-semibold">Valor Pago</th>
                            <th className="px-6 py-4 font-semibold">Comprovante</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-black/5">
                          {payments.filter(p => (!dateRange.start || toLocalDateString(p.created_at) >= dateRange.start) && (!dateRange.end || toLocalDateString(p.created_at) <= dateRange.end)).length === 0 ? (
                            <tr>
                              <td colSpan={4} className="px-6 py-8 text-center text-zinc-400">Nenhum pagamento registrado no período.</td>
                            </tr>
                          ) : (
                            payments.filter(p => (!dateRange.start || toLocalDateString(p.created_at) >= dateRange.start) && (!dateRange.end || toLocalDateString(p.created_at) <= dateRange.end)).map(payment => {
                              const seller = users.find(u => u.id === payment.vendedor_id);
                              return (
                                <tr key={payment.id} className="hover:bg-zinc-50 transition-all">
                                  <td className="px-6 py-4 text-sm text-zinc-600">{new Date(payment.created_at).toLocaleString()}</td>
                                  <td className="px-6 py-4 font-bold text-zinc-900">{seller?.name || 'Vendedor Removido'}</td>
                                  <td className="px-6 py-4 font-bold text-emerald-600">R$ {payment.amount.toLocaleString()}</td>
                                  <td className="px-6 py-4">
                                    {payment.receipt_url ? (
                                      <button onClick={() => setViewingImageUrl(payment.receipt_url!)} className="text-xs font-bold text-indigo-600 hover:underline flex items-center gap-1">
                                        <FileText className="w-4 h-4" /> Ver Comprovante
                                      </button>
                                    ) : (
                                      <span className="text-xs text-zinc-400">Sem comprovante</span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}



              {currentPage === 'ranking' && (
                <div className="max-w-4xl mx-auto space-y-8">
                  <div className="text-center">
                    <h3 className="text-3xl font-bold text-zinc-900">Ranking de Vendedores</h3>
                    <p className="text-zinc-500 mt-2">Os melhores resultados da Dion Logos Agência</p>
                  </div>

                  <div className="flex justify-center gap-2">
                    {(['daily', 'weekly', 'monthly', 'all'] as const).map(f => (
                      <button
                        key={f}
                        onClick={() => setRankingFilter(f)}
                        className={`px-6 py-2 rounded-full text-sm font-bold transition-all ${
                          rankingFilter === f 
                            ? 'bg-indigo-600 text-white shadow-md' 
                            : 'bg-white text-zinc-500 hover:bg-zinc-100 border border-zinc-200'
                        }`}
                      >
                        {f === 'daily' ? 'Diário' : f === 'weekly' ? 'Semanal' : f === 'monthly' ? 'Mensal' : 'Geral'}
                      </button>
                    ))}
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-end">
                    {/* 2nd Place */}
                    {ranking[1] && (
                      <div className="bg-white p-8 rounded-3xl shadow-sm border border-black/5 text-center order-2 md:order-1">
                        <div className="relative w-16 h-16 mx-auto mb-4">
                          <div className="w-full h-full bg-zinc-100 rounded-2xl flex items-center justify-center overflow-hidden">
                            {ranking[1].photo_url ? (
                              <img src={ranking[1].photo_url} alt={ranking[1].name} className="w-full h-full object-cover" />
                            ) : (
                              <UserIcon className="w-8 h-8 text-zinc-400" />
                            )}
                          </div>
                          <div className="absolute -top-3 -right-3 w-8 h-8 bg-zinc-200 rounded-full flex items-center justify-center font-bold text-zinc-600 border-4 border-white z-10">2</div>
                        </div>
                        <h4 className="font-bold text-zinc-900">{ranking[1].name}</h4>
                        <p className="text-2xl font-black text-zinc-400 mt-2">R$ {ranking[1].total.toLocaleString()}</p>
                        <p className="text-xs text-zinc-500 mt-1">{ranking[1].count} vendas</p>
                      </div>
                    )}
                    {/* 1st Place */}
                    {ranking[0] && (
                      <div className="bg-white p-10 rounded-3xl shadow-xl border-2 border-indigo-600 text-center order-1 md:order-2 scale-105 relative overflow-hidden">
                        <div className="absolute top-0 left-0 w-full h-2 bg-indigo-600" />
                        <div className="relative w-20 h-20 mx-auto mb-4">
                          <div className="w-full h-full bg-amber-100 rounded-3xl flex items-center justify-center overflow-hidden">
                            {ranking[0].photo_url ? (
                              <img src={ranking[0].photo_url} alt={ranking[0].name} className="w-full h-full object-cover" />
                            ) : (
                              <Trophy className="w-10 h-10 text-amber-500" />
                            )}
                          </div>
                          <div className="absolute -top-3 -right-3 w-10 h-10 bg-amber-500 rounded-full flex items-center justify-center font-bold text-white border-4 border-white z-10">1</div>
                        </div>
                        <h4 className="font-bold text-xl text-zinc-900">{ranking[0].name}</h4>
                        <p className="text-3xl font-black text-indigo-600 mt-2">R$ {ranking[0].total.toLocaleString()}</p>
                        <p className="text-sm text-zinc-500 mt-1">{ranking[0].count} vendas</p>
                        <div className="mt-6 inline-flex items-center gap-2 px-4 py-1 bg-indigo-50 text-indigo-600 rounded-full text-xs font-bold uppercase tracking-wider">
                          Líder de Vendas
                        </div>
                      </div>
                    )}
                    {/* 3rd Place */}
                    {ranking[2] && (
                      <div className="bg-white p-8 rounded-3xl shadow-sm border border-black/5 text-center order-3">
                        <div className="relative w-16 h-16 mx-auto mb-4">
                          <div className="w-full h-full bg-orange-50 rounded-2xl flex items-center justify-center overflow-hidden">
                            {ranking[2].photo_url ? (
                              <img src={ranking[2].photo_url} alt={ranking[2].name} className="w-full h-full object-cover" />
                            ) : (
                              <UserIcon className="w-8 h-8 text-orange-300" />
                            )}
                          </div>
                          <div className="absolute -top-3 -right-3 w-8 h-8 bg-orange-200 rounded-full flex items-center justify-center font-bold text-orange-600 border-4 border-white z-10">3</div>
                        </div>
                        <h4 className="font-bold text-zinc-900">{ranking[2].name}</h4>
                        <p className="text-2xl font-black text-orange-400 mt-2">R$ {ranking[2].total.toLocaleString()}</p>
                        <p className="text-xs text-zinc-500 mt-1">{ranking[2].count} vendas</p>
                      </div>
                    )}
                  </div>

                  <div className="bg-white rounded-3xl shadow-sm border border-black/5 overflow-hidden">
                    <table className="w-full text-left">
                      <thead className="bg-zinc-50 text-zinc-500 text-xs uppercase tracking-wider">
                        <tr>
                          <th className="px-8 py-4 font-semibold">Posição</th>
                          <th className="px-8 py-4 font-semibold">Vendedor</th>
                          <th className="px-8 py-4 font-semibold">Vendas</th>
                          <th className="px-8 py-4 font-semibold text-right">Faturamento</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-black/5">
                        {ranking.map((item, idx) => (
                          <tr key={item.id} className="hover:bg-zinc-50 transition-all">
                            <td className="px-8 py-4 font-bold text-zinc-400">#{idx + 1}</td>
                            <td className="px-8 py-4">
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 bg-zinc-100 rounded-full flex items-center justify-center overflow-hidden">
                                  {item.photo_url ? (
                                    <img src={item.photo_url} alt={item.name} className="w-full h-full object-cover" />
                                  ) : (
                                    <UserIcon className="w-4 h-4 text-zinc-400" />
                                  )}
                                </div>
                                <span className="font-bold text-zinc-900">{item.name}</span>
                              </div>
                            </td>
                            <td className="px-8 py-4 text-zinc-600">{item.count}</td>
                            <td className="px-8 py-4 font-black text-indigo-600 text-right">R$ {item.total.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="bg-indigo-50/60 border-t-2 border-indigo-200">
                          <td className="px-8 py-4" colSpan={2}>
                            <span className="font-bold text-indigo-700 uppercase text-sm tracking-wider flex items-center gap-2">
                              <DollarSign className="w-4 h-4" />
                              Total {rankingFilter === 'daily' ? 'do Dia' : rankingFilter === 'weekly' ? 'da Semana' : rankingFilter === 'monthly' ? 'do Mês' : 'Geral'}
                            </span>
                          </td>
                          <td className="px-8 py-4 font-bold text-indigo-700">{ranking.reduce((acc, r) => acc + r.count, 0)}</td>
                          <td className="px-8 py-4 font-black text-indigo-700 text-right text-lg">R$ {ranking.reduce((acc, r) => acc + r.total, 0).toLocaleString()}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              )}
              {currentPage === 'trash' && (currentUser.role === UserRole.ADMIN || currentUser.role === UserRole.SUPERVISOR) && (
                <div className="bg-white rounded-3xl shadow-sm border border-black/5 overflow-hidden p-6">
                  <h3 className="text-2xl font-bold text-zinc-900 mb-6">Aprovações de Exclusão</h3>
                  <div className="space-y-4">
                    {sales.filter(s => s.status === SaleStatus.EXCLUSAO_SOLICITADA).length === 0 ? (
                      <p className="text-zinc-500 text-center py-8">Nenhuma solicitação de exclusão pendente.</p>
                    ) : (
                      sales.filter(s => s.status === SaleStatus.EXCLUSAO_SOLICITADA).map(sale => {
                        const otherActiveSales = sales.filter(s => 
                          s.customer_id === sale.customer_id && 
                          s.id !== sale.id && 
                          s.status !== SaleStatus.DELETED && 
                          s.status !== SaleStatus.EXCLUSAO_SOLICITADA
                        );
                        const customer = customers.find(c => c.id === sale.customer_id);
                        return (
                        <div key={sale.id} className="p-4 border border-black/5 rounded-2xl hover:bg-zinc-50 transition-colors">
                          <div className="flex items-center justify-between">
                            <div className="flex flex-col gap-1">
                              <span className="font-bold text-zinc-900">📞 {sale.phone} {customer ? `— ${customer.name}` : ''}</span>
                              <span className="text-sm text-zinc-500">{sale.service} — R$ {sale.value.toLocaleString()} — Solicitado por {users.find(u => u.id === sale.vendedor_id)?.name || 'Desconhecido'} em {new Date(sale.updated_at).toLocaleDateString('pt-BR')}</span>
                              {otherActiveSales.length > 0 && (
                                <span className="text-xs font-bold text-amber-600 bg-amber-50 px-2 py-1 rounded-full w-fit">
                                  ⚠️ Cliente possui {otherActiveSales.length} outra(s) venda(s) ativa(s) — apenas esta venda será excluída
                                </span>
                              )}
                              {otherActiveSales.length === 0 && (
                                <span className="text-xs font-bold text-red-500 bg-red-50 px-2 py-1 rounded-full w-fit">
                                  🗑️ Cliente será excluído junto (sem outras vendas)
                                </span>
                              )}
                            </div>
                            <div className="flex gap-2">
                              <button 
                                onClick={() => {
                                  const willDeleteCustomer = otherActiveSales.length === 0;
                                  const msg = willDeleteCustomer 
                                    ? 'Aprovar exclusão? A venda, o cliente e os comprovantes serão excluídos permanentemente.'
                                    : 'Aprovar exclusão? Apenas esta venda será excluída. O cliente permanecerá pois tem outras vendas.';
                                  setConfirmModal({
                                    title: '🗑️ Aprovar Exclusão',
                                    message: msg,
                                    confirmText: 'Aprovar Exclusão',
                                    onConfirm: async () => {
                                      try {
                                        const saleReceipts = receipts.filter(r => r.sale_id === sale.id);
                                        for (const r of saleReceipts) {
                                          await deleteDoc(doc(db, 'receipts', r.id));
                                        }
                                        await deleteDoc(doc(db, 'sales', sale.id));
                                        if (willDeleteCustomer && sale.customer_id) {
                                          await deleteDoc(doc(db, 'customers', sale.customer_id));
                                          await addLog(currentUser, `Aprovou exclusão: venda ${sale.id} + cliente ${sale.customer_id} removidos permanentemente`, sale.id);
                                        } else {
                                          await addLog(currentUser, `Aprovou exclusão: venda ${sale.id} removida permanentemente (cliente mantido, tem outras vendas)`, sale.id);
                                        }
                                        showToast('Exclusão aprovada e dados removidos!', 'success');
                                      } catch (error: any) {
                                        console.error(error);
                                        showToast('Erro ao aprovar exclusão: ' + error.message, 'error');
                                      }
                                    }
                                  });
                                }}
                                className="px-4 py-2 bg-red-50 text-red-600 rounded-xl hover:bg-red-100 transition-colors font-medium text-sm"
                              >
                                Aprovar Exclusão
                              </button>
                              <button 
                                onClick={() => {
                                  setConfirmModal({
                                    title: '↩️ Rejeitar Exclusão',
                                    message: 'Deseja rejeitar a exclusão e restaurar esta venda?',
                                    confirmText: 'Restaurar Venda',
                                    onConfirm: async () => {
                                      try {
                                        await updateDoc(doc(db, 'sales', sale.id), {
                                          status: sale.previous_status || SaleStatus.AGUARDANDO,
                                          updated_at: new Date().toISOString()
                                        });
                                        await addLog(currentUser, `Rejeitou exclusão da venda ${sale.id}`, sale.id);
                                        showToast('Venda restaurada com sucesso!', 'success');
                                      } catch (error) {
                                        console.error(error);
                                        showToast('Erro ao restaurar venda.', 'error');
                                      }
                                    }
                                  });
                                }}
                                className="px-4 py-2 bg-zinc-100 text-zinc-600 rounded-xl hover:bg-zinc-200 transition-colors font-medium text-sm"
                              >
                                Rejeitar
                              </button>
                          </div>
                          </div>
                        </div>
                        );
                      })
                    )}
                  </div>

                  <div className="flex justify-between items-center mt-8 mb-6 pt-6 border-t border-black/5">
                    <h3 className="text-2xl font-bold text-zinc-900">Lixeira (Excluídos)</h3>
                    {sales.filter(s => s.status === SaleStatus.DELETED).length > 0 && (
                      <button
                        onClick={() => {
                          const deletedSales = sales.filter(s => s.status === SaleStatus.DELETED);
                          setConfirmModal({
                            title: '🗑️ Limpar Lixeira',
                            message: `Excluir PERMANENTEMENTE ${deletedSales.length} venda(s) da lixeira? Esta ação não pode ser desfeita.`,
                            confirmText: 'Excluir Permanentemente',
                            onConfirm: async () => {
                              try {
                                for (const sale of deletedSales) {
                                  const saleReceipts = receipts.filter(r => r.sale_id === sale.id);
                                  for (const receipt of saleReceipts) {
                                    await deleteDoc(doc(db, 'receipts', receipt.id));
                                  }
                                  await deleteDoc(doc(db, 'sales', sale.id));
                                }
                                await addLog(currentUser, `Limpou a lixeira (${deletedSales.length} venda(s) excluídas permanentemente)`);
                                showToast(`${deletedSales.length} venda(s) excluída(s) permanentemente!`, 'success');
                              } catch (err: any) {
                                showToast('Erro ao limpar lixeira: ' + err.message, 'error');
                              }
                            }
                          });
                        }}
                        className="bg-red-600 text-white px-4 py-2 rounded-xl font-semibold hover:bg-red-700 transition-colors text-sm flex items-center gap-2"
                      >
                        <Trash2 className="w-4 h-4" />
                        Limpar Lixeira
                      </button>
                    )}
                  </div>
                  <div className="space-y-4">
                    {sales.filter(s => s.status === SaleStatus.DELETED).length === 0 ? (
                      <p className="text-zinc-500 text-center py-8">Nenhuma venda na lixeira.</p>
                    ) : (
                      sales.filter(s => s.status === SaleStatus.DELETED).map(sale => (
                        <div key={sale.id} className="flex items-center justify-between p-4 border border-red-100 rounded-2xl hover:bg-red-50/30 transition-colors">
                          <div className="flex flex-col gap-1">
                            <span className="font-bold text-zinc-900">{sale.name || 'Sem Nome'}</span>
                            <span className="text-sm text-zinc-500">{sale.service} - R$ {sale.value.toLocaleString()} — Excluído em {sale.deleted_at ? new Date(sale.deleted_at).toLocaleDateString('pt-BR') : '-'}</span>
                          </div>
                          <button 
                            onClick={() => {
                              setConfirmModal({
                                title: '↩️ Restaurar Venda',
                                message: 'Deseja restaurar esta venda da lixeira?',
                                confirmText: 'Restaurar',
                                onConfirm: async () => {
                                  try {
                                    await updateDoc(doc(db, 'sales', sale.id), {
                                      status: sale.previous_status || SaleStatus.AGUARDANDO,
                                      deleted_at: null,
                                      deleted_by: null,
                                      updated_at: new Date().toISOString()
                                    });
                                    await addLog(currentUser, `Restaurou venda ${sale.id} da lixeira`, sale.id);
                                    showToast('Venda restaurada com sucesso!', 'success');
                                  } catch (error) {
                                    console.error(error);
                                    showToast('Erro ao restaurar venda.', 'error');
                                  }
                                }
                              });
                            }}
                            className="px-4 py-2 bg-emerald-50 text-emerald-600 rounded-xl hover:bg-emerald-100 transition-colors font-medium text-sm"
                          >
                            Restaurar
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {currentPage === 'my-payments' && (() => {
                const myPayments = payments.filter(p => {
                  if (p.vendedor_id !== currentUser.id) return false;
                  if (paymentDateFrom && p.created_at < paymentDateFrom) return false;
                  if (paymentDateTo && p.created_at > paymentDateTo + 'T23:59:59') return false;
                  if (paymentStatusFilter === 'paid' && p.status !== 'paid') return false;
                  if (paymentStatusFilter === 'pending' && p.status === 'paid') return false;
                  return true;
                }).sort((a, b) => b.created_at.localeCompare(a.created_at));
                const totalReceived = myPayments.filter(p => p.status === 'paid').reduce((sum, p) => sum + p.amount, 0);
                const paidCommissionSales = sales.filter(s => s.vendedor_id === currentUser.id && s.commission_paid && isSaleRevenueApproved(s));
                const unpaidCommissionSales = sales.filter(s => s.vendedor_id === currentUser.id && !s.commission_paid && isSaleRevenueApproved(s));
                const pendingAmount = unpaidCommissionSales.reduce((sum, s) => {
                  return sum + calculateCommission(s, currentUser);
                }, 0);

                return (
                <div className="space-y-6">
                  <h2 className="text-2xl font-black text-zinc-900 tracking-tight">Meus Pagamentos</h2>

                  {/* Summary Cards */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-white rounded-2xl p-6 border border-black/5 shadow-sm">
                      <p className="text-xs font-bold text-zinc-400 uppercase mb-1">Total Recebido</p>
                      <p className="text-3xl font-black text-emerald-600">R$ {totalReceived.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                      <p className="text-xs text-zinc-400 mt-1">{myPayments.filter(p => p.status === 'paid').length} pagamento(s)</p>
                    </div>
                    <div className="bg-white rounded-2xl p-6 border border-black/5 shadow-sm">
                      <p className="text-xs font-bold text-zinc-400 uppercase mb-1">Comissão Pendente</p>
                      <p className="text-3xl font-black text-amber-600">R$ {pendingAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                      <p className="text-xs text-zinc-400 mt-1">{unpaidCommissionSales.length} venda(s) não pagas</p>
                    </div>
                    <div className="bg-white rounded-2xl p-6 border border-black/5 shadow-sm">
                      <p className="text-xs font-bold text-zinc-400 uppercase mb-1">Vendas com Comissão Paga</p>
                      <p className="text-3xl font-black text-indigo-600">{paidCommissionSales.length}</p>
                      <p className="text-xs text-zinc-400 mt-1">de {paidCommissionSales.length + unpaidCommissionSales.length} total</p>
                    </div>
                  </div>

                  {/* Pending Commissions Detail */}
                  {unpaidCommissionSales.length > 0 && (
                    <div className="bg-white rounded-3xl shadow-sm border border-black/5 overflow-hidden">
                      <div className="p-6 border-b border-black/5">
                        <h3 className="font-bold text-zinc-900 text-lg">Vendas Pendentes de Receber</h3>
                        <p className="text-xs text-zinc-400 mt-1">Comissões que ainda não foram pagas pelo Admin</p>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left">
                          <thead className="bg-zinc-50 text-zinc-500 text-xs uppercase tracking-wider">
                             <tr>
                              <th className="px-6 py-3 font-semibold">Data Pgto</th>
                              <th className="px-6 py-3 font-semibold">Telefone</th>
                              <th className="px-6 py-3 font-semibold">Serviço</th>
                              <th className="px-6 py-3 font-semibold">Valor Venda</th>
                              <th className="px-6 py-3 font-semibold">% Comissão</th>
                              <th className="px-6 py-3 font-semibold">Comissão</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-zinc-100">
                            {unpaidCommissionSales.map(sale => {
                              const commission = calculateCommission(sale, currentUser);
                              const rate = sale.sale_type === SaleType.RECORRENTE 
                                ? (currentUser.recurring_commission || currentUser.commission || 0)
                                : (currentUser.commissions?.[sale.service] !== undefined ? 'fixa' : (currentUser.commission ?? 10));
                              return (
                                <tr key={sale.id} className="hover:bg-zinc-50 transition-colors">
                                  <td className="px-6 py-4 text-sm text-zinc-500">{sale.paid_at ? new Date(sale.paid_at).toLocaleDateString('pt-BR') : '—'}</td>
                                  <td className="px-6 py-4 font-medium text-zinc-900">{sale.phone}</td>
                                  <td className="px-6 py-4 text-sm text-zinc-600">
                                    <span className="px-2 py-0.5 bg-zinc-100 rounded-full text-xs font-medium">{sale.service}</span>
                                  </td>
                                  <td className="px-6 py-4 font-bold text-zinc-900">R$ {sale.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                                  <td className="px-6 py-4 text-sm text-zinc-500">{rate}%</td>
                                  <td className="px-6 py-4 font-black text-emerald-600">R$ {commission.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                          <tfoot className="bg-zinc-50 border-t-2 border-zinc-200">
                            <tr>
                              <td colSpan={3} className="px-6 py-4 font-bold text-zinc-700 text-sm uppercase">Total</td>
                              <td className="px-6 py-4 font-bold text-zinc-900">R$ {unpaidCommissionSales.reduce((acc, s) => acc + s.value, 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                              <td className="px-6 py-4"></td>
                              <td className="px-6 py-4 font-black text-emerald-600 text-lg">R$ {pendingAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Payment History */}
                  <div className="bg-white rounded-3xl shadow-sm border border-black/5 overflow-hidden">
                    <div className="p-6 border-b border-black/5 flex flex-col gap-4">
                      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                        <h3 className="font-bold text-zinc-900 text-lg">Histórico de Pagamentos</h3>
                        <div className="flex items-center gap-2">
                          <input
                            type="date"
                            value={paymentDateFrom}
                            onChange={(e) => setPaymentDateFrom(e.target.value)}
                            className="text-xs border border-zinc-200 rounded-lg px-2 py-1.5 focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400 outline-none"
                            title="Data início"
                          />
                          <span className="text-zinc-400 text-xs">até</span>
                          <input
                            type="date"
                            value={paymentDateTo}
                            onChange={(e) => setPaymentDateTo(e.target.value)}
                            className="text-xs border border-zinc-200 rounded-lg px-2 py-1.5 focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400 outline-none"
                            title="Data fim"
                          />
                          {(paymentDateFrom || paymentDateTo) && (
                            <button onClick={() => { setPaymentDateFrom(''); setPaymentDateTo(''); }} className="text-xs text-red-500 hover:text-red-700 font-bold">✕</button>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        {[
                          { key: 'all' as const, label: 'Todos', count: myPayments.length },
                          { key: 'paid' as const, label: '✅ Pagos', count: myPayments.filter(p => p.status === 'paid').length },
                          { key: 'pending' as const, label: '⏳ Pendentes', count: myPayments.filter(p => p.status !== 'paid').length },
                        ].map(f => (
                          <button
                            key={f.key}
                            onClick={() => setPaymentStatusFilter(f.key)}
                            className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all ${
                              paymentStatusFilter === f.key
                                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-100'
                                : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
                            }`}
                          >
                            {f.label} ({f.count})
                          </button>
                        ))}
                      </div>
                    </div>
                    {myPayments.length === 0 ? (
                      <div className="p-12 text-center">
                        <Wallet className="w-12 h-12 text-zinc-300 mx-auto mb-3" />
                        <p className="text-zinc-400 font-medium">Nenhum pagamento registrado ainda.</p>
                        <p className="text-zinc-300 text-sm mt-1">Seus pagamentos de comissão aparecerão aqui.</p>
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left">
                          <thead className="bg-zinc-50 text-zinc-500 text-xs uppercase tracking-wider">
                            <tr>
                              <th className="px-6 py-3 font-semibold">Data</th>
                              <th className="px-6 py-3 font-semibold">Valor</th>
                              <th className="px-6 py-3 font-semibold">Status</th>
                              <th className="px-6 py-3 font-semibold">Vendas Incluídas</th>
                              <th className="px-6 py-3 font-semibold">Comprovante</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-zinc-100">
                            {myPayments.map(payment => (
                              <tr key={payment.id} className="hover:bg-zinc-50 transition-all">
                                <td className="px-6 py-4 text-sm font-medium text-zinc-900">
                                  {new Date(payment.created_at).toLocaleDateString('pt-BR')}
                                </td>
                                <td className="px-6 py-4 text-sm font-black text-emerald-600">
                                  R$ {payment.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                </td>
                                <td className="px-6 py-4">
                                  <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase ${
                                    payment.status === 'paid' ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'
                                  }`}>
                                    {payment.status === 'paid' ? '✅ Pago' : '⏳ Pendente'}
                                  </span>
                                </td>
                                <td className="px-6 py-4 text-sm text-zinc-500">
                                  {payment.sales_ids?.length || 0} venda(s)
                                </td>
                                <td className="px-6 py-4">
                                  {payment.receipt_url ? (
                                    <button
                                      onClick={() => handleViewReceipt(payment.receipt_url!)}
                                      className="text-xs font-bold text-indigo-600 hover:underline"
                                    >
                                      Ver Comprovante
                                    </button>
                                  ) : (
                                    <span className="text-xs text-zinc-300">—</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
                );
              })()}

              {currentPage === 'profile' && (
                <div className="max-w-2xl mx-auto">
                  <div className="bg-white p-8 rounded-3xl shadow-sm border border-black/5">
                    <h2 className="text-2xl font-black text-zinc-900 mb-8 tracking-tight">Meu Perfil</h2>
                    
                    <div className="flex flex-col md:flex-row gap-8 items-start mb-8">
                      <div className="flex flex-col items-center gap-4">
                        <div className="w-32 h-32 bg-zinc-100 rounded-full flex items-center justify-center overflow-hidden border-4 border-white shadow-lg relative group">
                          {currentUser.photo_url ? (
                            <img src={currentUser.photo_url} alt={currentUser.name} className="w-full h-full object-cover" />
                          ) : (
                            <UserIcon className="w-12 h-12 text-zinc-400" />
                          )}
                          <label className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 cursor-pointer transition-opacity">
                            <Camera className="w-6 h-6 text-white" />
                            <span className="text-white text-xs font-bold mt-2">Trocar Foto</span>
                            <input type="file" accept="image/*" className="hidden" onChange={(e) => handlePhotoSelect(e, currentUser.id)} />
                          </label>
                        </div>
                        <p className="text-xs text-zinc-500 text-center max-w-[150px]">Clique na imagem para alterar sua foto de perfil</p>
                      </div>

                      <form onSubmit={handleUpdateProfile} className="flex-1 space-y-6 w-full">
                        <div className="space-y-2">
                          <label className="text-sm font-semibold text-zinc-700">Nome Completo</label>
                          <input 
                            name="name" 
                            type="text" 
                            defaultValue={currentUser.name} 
                            required 
                            className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-indigo-500/20 outline-none" 
                          />
                        </div>
                        
                        <div className="space-y-2">
                          <label className="text-sm font-semibold text-zinc-700">Chave PIX</label>
                          <input 
                            name="pix_key" 
                            type="text" 
                            defaultValue={currentUser.pix_key || ''} 
                            className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-indigo-500/20 outline-none" 
                            placeholder="E-mail, CPF, Telefone ou Chave Aleatória"
                          />
                          <p className="text-xs text-zinc-500">Usada para o pagamento das suas comissões.</p>
                        </div>

                        <button 
                          type="submit" 
                          disabled={isSubmitting}
                          className="w-full bg-indigo-600 text-white font-bold py-4 rounded-xl hover:bg-indigo-700 transition-all disabled:opacity-50"
                        >
                          {isSubmitting ? 'Salvando...' : 'Salvar Alterações'}
                        </button>
                      </form>
                    </div>

                    <div className="border-t border-black/5 pt-8 mt-8">
                      <h3 className="text-xl font-bold text-zinc-900 mb-6">Alterar Senha</h3>
                      <form onSubmit={handleUpdatePassword} className="space-y-6 max-w-md">
                        <div className="space-y-2">
                          <label className="text-sm font-semibold text-zinc-700">Senha Atual</label>
                          <input 
                            name="currentPassword" 
                            type="password" 
                            required 
                            className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-indigo-500/20 outline-none" 
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-semibold text-zinc-700">Nova Senha</label>
                          <input 
                            name="newPassword" 
                            type="password" 
                            required 
                            minLength={6}
                            className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-indigo-500/20 outline-none" 
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-semibold text-zinc-700">Confirmar Nova Senha</label>
                          <input 
                            name="confirmPassword" 
                            type="password" 
                            required 
                            minLength={6}
                            className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-indigo-500/20 outline-none" 
                          />
                        </div>
                        <button 
                          type="submit" 
                          disabled={isSubmitting}
                          className="w-full bg-zinc-900 text-white font-bold py-4 rounded-xl hover:bg-zinc-800 transition-all disabled:opacity-50"
                        >
                          {isSubmitting ? 'Atualizando...' : 'Atualizar Senha'}
                        </button>
                      </form>
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      {/* Crop Modal */}
      <AnimatePresence>
        {cropModalOpen && cropImageSrc && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden flex flex-col h-[80vh]"
            >
              <div className="p-6 border-b border-black/5 flex justify-between items-center bg-zinc-50 shrink-0">
                <h3 className="text-xl font-bold text-zinc-900">Ajustar Foto</h3>
                <button onClick={() => { setCropModalOpen(false); setCropImageSrc(null); setTargetUserIdForPhoto(null); }} className="p-2 hover:bg-zinc-200 rounded-full transition-all">
                  <X className="w-5 h-5 text-zinc-500" />
                </button>
              </div>
              <div className="relative flex-1 bg-black">
                <Cropper
                  image={cropImageSrc}
                  crop={crop}
                  zoom={zoom}
                  aspect={1}
                  cropShape="round"
                  showGrid={false}
                  onCropChange={setCrop}
                  onCropComplete={onCropComplete}
                  onZoomChange={setZoom}
                />
              </div>
              <div className="p-6 bg-white shrink-0 space-y-4">
                <div className="flex items-center gap-4">
                  <span className="text-sm font-medium text-zinc-500">Zoom</span>
                  <input
                    type="range"
                    value={zoom}
                    min={1}
                    max={3}
                    step={0.1}
                    aria-labelledby="Zoom"
                    onChange={(e) => {
                      setZoom(Number(e.target.value))
                    }}
                    className="flex-1 accent-indigo-600"
                  />
                </div>
                <div className="flex gap-4">
                  <button 
                    onClick={() => { setCropModalOpen(false); setCropImageSrc(null); setTargetUserIdForPhoto(null); }}
                    className="flex-1 py-4 rounded-xl font-bold text-zinc-500 hover:bg-zinc-100 transition-all"
                  >
                    Cancelar
                  </button>
                  <button 
                    onClick={handleConfirmCrop}
                    disabled={isSubmitting}
                    className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 rounded-xl transition-all shadow-lg shadow-indigo-100 disabled:opacity-50"
                  >
                    {isSubmitting ? 'Salvando...' : 'Confirmar'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>



      {/* Pending Receipt Modal */}
      <AnimatePresence>
        {salePendingReceipt && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white w-full max-w-md rounded-3xl shadow-2xl p-8 text-center"
            >
              <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertCircle className="w-8 h-8 text-amber-600" />
              </div>
              <h3 className="text-xl font-bold text-zinc-900 mb-2">Comprovante de Pagamento</h3>
              <p className="text-zinc-500 mb-6 text-sm">Anexe o comprovante e confirme o valor realmente pago.</p>
              
              {isUploadingReceipt ? (
                <div className="py-8">
                  <div className="w-12 h-12 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mx-auto mb-4"></div>
                  <p className="text-sm font-semibold text-zinc-600">Enviando e auditando comprovante...</p>
                  <p className="text-xs text-zinc-400 mt-1">A IA está verificando o comprovante</p>
                </div>
              ) : (
                <>
                  {/* File upload area */}
                  <div className="mb-4">
                    <div className={`relative border-2 border-dashed rounded-2xl p-6 transition-colors ${
                      (window as any).__receiptFile ? 'border-emerald-400 bg-emerald-50' : 'border-zinc-200 hover:border-indigo-500 bg-zinc-50'
                    }`}>
                      <input 
                        type="file" 
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20"
                        accept="image/*,.pdf"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            (window as any).__receiptFile = file;
                            // Force re-render
                            setSalePendingReceipt({...salePendingReceipt});
                          }
                        }}
                      />
                      {(window as any).__receiptFile ? (
                        <>
                          <CheckCircle className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
                          <p className="text-sm font-semibold text-emerald-700">{(window as any).__receiptFile.name}</p>
                          <p className="text-xs text-emerald-500 mt-1">Clique para trocar</p>
                        </>
                      ) : (
                        <>
                          <Upload className="w-8 h-8 text-zinc-400 mx-auto mb-3" />
                          <p className="text-sm font-semibold text-zinc-700">Clique para anexar comprovante</p>
                          <p className="text-xs text-zinc-500 mt-1">Imagens ou PDF (máx. 5MB)</p>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Confirmed value field */}
                  <div className="mb-6 text-left">
                    <label className="text-sm font-semibold text-zinc-700 block mb-2">Valor Realmente Pago (R$)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      defaultValue={salePendingReceipt.value || 0}
                      id="receipt-confirmed-value"
                      className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-indigo-500/20 outline-none text-lg font-bold text-zinc-900"
                      placeholder="0.00"
                    />
                    <p className="text-xs text-zinc-400 mt-1">Valor do produto: R$ {(salePendingReceipt.value || 0).toFixed(2)} — Ajuste se o cliente pagou valor diferente</p>
                  </div>

                  <div className="flex flex-col gap-3">
                    <button 
                      disabled={!(window as any).__receiptFile}
                      onClick={async () => {
                        const file = (window as any).__receiptFile;
                        if (!file || !salePendingReceipt) return;
                        const confirmedValueInput = document.getElementById('receipt-confirmed-value') as HTMLInputElement;
                        const confirmedValue = confirmedValueInput ? parseFloat(confirmedValueInput.value) : salePendingReceipt.value;
                        const pendingSaleId = salePendingReceipt.id;
                        setIsUploadingReceipt(true);
                        try {
                          await handleUploadReceipt(pendingSaleId, file, confirmedValue);
                          await handleUpdateStatus(pendingSaleId, SaleStatus.PAGO, true);
                          setSalePendingReceipt(null);
                          (window as any).__receiptFile = null;
                        } catch (err: any) {
                          console.error('Comprovante upload error:', err);
                          showToast('Erro: ' + err.message, 'error');
                        } finally {
                          setIsUploadingReceipt(false);
                        }
                      }}
                      className={`w-full px-6 py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2 ${
                        (window as any).__receiptFile 
                          ? 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-lg shadow-indigo-100' 
                          : 'bg-zinc-100 text-zinc-400 cursor-not-allowed'
                      }`}
                    >
                      <Upload className="w-4 h-4" />
                      Enviar e Auditar
                    </button>
                    <button 
                      onClick={() => {
                        setSalePendingReceipt(null);
                        (window as any).__receiptFile = null;
                      }}
                      className="w-full px-6 py-3 rounded-xl font-bold text-zinc-500 hover:bg-zinc-100 transition-all"
                    >
                      Cancelar
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>



      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {deletingSaleId && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white w-full max-w-sm rounded-3xl shadow-2xl p-8 text-center"
            >
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertCircle className="w-8 h-8 text-red-600" />
              </div>
              <h3 className="text-xl font-bold text-zinc-900 mb-2">
                Excluir Lead?
              </h3>
              <p className="text-zinc-500 mb-8">
                {currentUser?.role === UserRole.ADMIN || currentUser?.role === UserRole.SUPERVISOR 
                  ? 'Esta ação não pode ser desfeita. Todos os dados deste lead serão removidos permanentemente.'
                  : 'O administrador será notificado e precisará aprovar a exclusão deste lead.'}
              </p>
              <div className="flex gap-3">
                <button 
                  onClick={() => setDeletingSaleId(null)}
                  className="flex-1 px-6 py-3 rounded-xl font-bold text-zinc-500 hover:bg-zinc-100 transition-all"
                >
                  Cancelar
                </button>
                <button 
                  onClick={() => handleDeleteSale(deletingSaleId)}
                  disabled={isSubmitting}
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold py-3 rounded-xl transition-all shadow-lg shadow-red-100 disabled:opacity-50"
                >
                  {isSubmitting ? 'Excluindo...' : 'Sim, Excluir'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      {/* Edit Sale Modal */}
      <AnimatePresence>
        {editingSale && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setEditingSale(null)}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative bg-white w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="p-8">
                <div className="flex justify-between items-center mb-6">
                  <h3 className="text-xl font-bold text-zinc-900">Editar Venda</h3>
                  <button onClick={() => setEditingSale(null)} className="p-2 hover:bg-zinc-100 rounded-full transition-all">
                    <X className="w-5 h-5 text-zinc-400" />
                  </button>
                </div>

                <form onSubmit={(e) => {
                  e.preventDefault();
                  const formData = new FormData(e.currentTarget);
                  const receiptFile = (e.currentTarget.elements.namedItem('receipt') as HTMLInputElement)?.files?.[0];
                  
                  handleEditSale(editingSale.id, {
                    phone: formData.get('phone'),
                    service: formData.get('service'),
                    value: Number(formData.get('value')),
                    status: formData.get('status') as SaleStatus,
                    notes: formData.get('notes') as string || '',
                  }, receiptFile);
                }} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-zinc-700">Telefone (WhatsApp)</label>
                      <input 
                        name="phone" 
                        type="text" 
                        defaultValue={editingSale.phone}
                        required 
                        className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-indigo-500/20 outline-none" 
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-zinc-700">Serviço</label>
                      <select 
                        name="service" 
                        defaultValue={editingSale.service}
                        required 
                        className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-indigo-500/20 outline-none"
                      >
                        {SERVICES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-zinc-700">Valor da Venda (R$)</label>
                      <input 
                        name="value" 
                        type="number" 
                        step="0.01"
                        defaultValue={editingSale.value}
                        required 
                        className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-indigo-500/20 outline-none" 
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-zinc-700">Status</label>
                      <select 
                        name="status" 
                        defaultValue={editingSale.status}
                        required 
                        className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-indigo-500/20 outline-none"
                      >
                        {Object.values(SaleStatus).filter(s => s !== SaleStatus.DELETED && s !== SaleStatus.CANCELADO && s !== SaleStatus.REMARKETING).map(s => <option key={s} value={s}>{getStatusLabel(s)}</option>)}
                      </select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-zinc-700">Observações</label>
                    <textarea 
                      name="notes" 
                      rows={2} 
                      defaultValue={editingSale.notes || ''}
                      className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-indigo-500/20 outline-none resize-none text-sm" 
                      placeholder="Anotações sobre o lead (opcional)" 
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-zinc-700">
                      {editingSale.receipt_id ? 'Alterar Comprovante' : 'Adicionar Comprovante'}
                    </label>
                    <div className="relative group">
                      <input 
                        name="receipt"
                        type="file" 
                        className="absolute inset-0 opacity-0 cursor-pointer z-10"
                      />
                      <div className="w-full px-4 py-3 rounded-xl border border-dashed border-zinc-300 group-hover:border-indigo-500 transition-all flex items-center justify-center gap-2 text-zinc-500">
                        <Upload className="w-4 h-4" />
                        <span className="text-sm">Clique ou arraste para enviar</span>
                      </div>
                    </div>
                    {editingSale.receipt_id && (
                      <p className="text-[10px] text-amber-600 font-medium">Já existe um comprovante. Ao enviar um novo, ele será substituído.</p>
                    )}
                  </div>

                  <div className="pt-4 flex flex-col gap-3">
                    <div className="flex gap-3">
                      <button 
                        type="button"
                        onClick={() => setEditingSale(null)}
                        className="flex-1 px-6 py-3 rounded-xl font-bold text-zinc-500 hover:bg-zinc-100 transition-all"
                      >
                        Cancelar
                      </button>
                      <button 
                        type="submit"
                        disabled={isSubmitting}
                        className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-xl transition-all shadow-lg shadow-indigo-100 disabled:opacity-50"
                      >
                        {isSubmitting ? 'Salvando...' : 'Salvar Alterações'}
                      </button>
                    </div>
                    <button 
                      type="button"
                      onClick={() => setDeletingSaleId(editingSale.id)}
                      className="w-full py-3 rounded-xl font-bold text-red-500 hover:bg-red-50 transition-all flex items-center justify-center gap-2"
                    >
                      <X className="w-4 h-4" />
                      Excluir Lead
                    </button>
                  </div>
                </form>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showUserModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-black/5 flex justify-between items-center bg-zinc-50">
                <h3 className="text-xl font-bold text-zinc-900">Cadastrar Novo Vendedor</h3>
                <button onClick={() => setShowUserModal(false)} className="p-2 hover:bg-zinc-200 rounded-full transition-all">
                  <X className="w-5 h-5 text-zinc-500" />
                </button>
              </div>
              <form onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                handleCreateUser(Object.fromEntries(formData));
              }} className="p-8 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-zinc-700">Nome Completo</label>
                    <input name="name" type="text" required className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-indigo-500/20 outline-none" placeholder="João Silva" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-zinc-700">Username</label>
                    <input name="username" type="text" required className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-indigo-500/20 outline-none" placeholder="joao.vendas" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-zinc-700">E-mail de Acesso</label>
                    <input name="email" type="email" required className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-indigo-500/20 outline-none" placeholder="joao@dionlogos.com" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-zinc-700">Senha Temporária</label>
                    <input name="password" type="password" required className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-indigo-500/20 outline-none" placeholder="••••••••" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-zinc-700">Meta Diária (R$)</label>
                    <input name="daily_goal" type="number" required className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-indigo-500/20 outline-none" placeholder="1000" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-zinc-700">Comissão (%)</label>
                    <input name="commission" type="number" required className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-indigo-500/20 outline-none" placeholder="10" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-zinc-700">Cargo</label>
                    <select name="role" defaultValue={UserRole.VENDEDOR} className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-indigo-500/20 outline-none bg-white">
                      <option value={UserRole.VENDEDOR}>Vendedor</option>
                      <option value={UserRole.SUPERVISOR}>Supervisor</option>
                                          </select>
                  </div>
                </div>
                <div className="flex gap-4 pt-4">
                  <button 
                    type="button" 
                    onClick={() => setShowUserModal(false)}
                    className="flex-1 py-4 rounded-xl font-bold text-zinc-500 hover:bg-zinc-100 transition-all"
                  >
                    Cancelar
                  </button>
                  <button 
                    type="submit" 
                    disabled={isSubmitting}
                    className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-bold py-4 rounded-xl transition-all shadow-lg shadow-indigo-100"
                  >
                    {isSubmitting ? 'Criando...' : 'Criar Vendedor'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {/* Image/PDF Viewer Modal */}
        {viewingImageUrl && (
          <div 
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
            onClick={() => setViewingImageUrl(null)}
          >
            <button 
              onClick={() => setViewingImageUrl(null)} 
              className="absolute top-6 right-6 p-2 bg-white/10 hover:bg-white/20 rounded-full transition-all z-10"
            >
              <X className="w-6 h-6 text-white" />
            </button>
            {viewingImageUrl.includes('application/pdf') ? (
              <iframe 
                src={viewingImageUrl} 
                title="Comprovante PDF"
                className="w-full max-w-4xl h-[90vh] rounded-2xl shadow-2xl bg-white"
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <img 
                src={viewingImageUrl} 
                alt="Comprovante" 
                className="max-w-full max-h-[90vh] object-contain rounded-2xl shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              />
            )}
          </div>
        )}

        {editingSeller && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-black/5 flex justify-between items-center bg-zinc-50">
                <h3 className="text-xl font-bold text-zinc-900">Editar Vendedor</h3>
                <button onClick={() => setEditingSeller(null)} className="p-2 hover:bg-zinc-200 rounded-full transition-all">
                  <X className="w-5 h-5 text-zinc-500" />
                </button>
              </div>
              <form onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                
                const commissions: Record<string, number> = {};
                SERVICES.forEach(service => {
                  const val = formData.get(`commission_${service}`);
                  if (val) commissions[service] = Number(val);
                });

                handleUpdateUser(editingSeller.id, {
                  daily_goal: Number(formData.get('daily_goal')),
                  commission: Number(formData.get('commission')),
                  recurring_commission: Number(formData.get('recurring_commission')),
                  commissions,
                  pix_key: formData.get('pix_key') as string,
                  role: (formData.get('role') as UserRole) || editingSeller.role
                });
                setEditingSeller(null);
              }} className="p-8 space-y-6 max-h-[80vh] overflow-y-auto">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-zinc-700">Meta Diária (R$)</label>
                    <input name="daily_goal" type="number" defaultValue={editingSeller.daily_goal || 0} required className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-indigo-500/20 outline-none" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-zinc-700">Comissão (Pontual) (%)</label>
                    <input name="commission" type="number" defaultValue={editingSeller.commission || 0} required className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-indigo-500/20 outline-none" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-zinc-700">Comissão Recorrente (%)</label>
                    <input name="recurring_commission" type="number" defaultValue={editingSeller.recurring_commission || 0} required className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-indigo-500/20 outline-none" />
                  </div>
                  <div className="space-y-2 md:col-span-1">
                    <label className="text-sm font-semibold text-zinc-700">Chave PIX</label>
                    <input name="pix_key" type="text" defaultValue={editingSeller.pix_key || ''} className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-indigo-500/20 outline-none" placeholder="E-mail, CPF, Telefone ou Chave Aleatória" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-zinc-700">Cargo</label>
                    <select name="role" defaultValue={editingSeller.role} className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-indigo-500/20 outline-none bg-white" disabled={editingSeller.id === currentUser?.id && editingSeller.role === UserRole.ADMIN}>
                      <option value={UserRole.VENDEDOR}>Vendedor</option>
                      <option value={UserRole.SUPERVISOR}>Supervisor</option>
                      <option value={UserRole.ADMIN}>Administrador</option>
                    </select>
                    {editingSeller.id === currentUser?.id && editingSeller.role === UserRole.ADMIN && (
                      <p className="text-xs text-zinc-400">Não é possível alterar seu próprio cargo de Admin.</p>
                    )}
                  </div>
                  
                  <div className="md:col-span-2 pt-4 border-t border-black/5">
                    <h4 className="font-bold text-zinc-900 mb-4">Comissões Fixas por Serviço (R$)</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {SERVICES.map(service => (
                        <div key={service} className="space-y-2">
                          <label className="text-sm font-semibold text-zinc-700">{service}</label>
                          <input 
                            name={`commission_${service}`} 
                            type="number" 
                            step="0.01"
                            defaultValue={editingSeller.commissions?.[service] || ''} 
                            className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-indigo-500/20 outline-none" 
                            placeholder="Deixe em branco para usar a % padrão" 
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex gap-4 pt-4">
                  <button 
                    type="button" 
                    onClick={() => setEditingSeller(null)}
                    className="flex-1 py-4 rounded-xl font-bold text-zinc-500 hover:bg-zinc-100 transition-all"
                  >
                    Cancelar
                  </button>
                  <button 
                    type="submit" 
                    className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 rounded-xl transition-all shadow-lg shadow-indigo-100"
                  >
                    Salvar Alterações
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {payingSeller && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
            >
              <div className="p-6 border-b border-black/5 flex justify-between items-center bg-zinc-50 shrink-0">
                <h3 className="text-xl font-bold text-zinc-900">Pagar Vendedor</h3>
                <button onClick={() => setPayingSeller(null)} className="p-2 hover:bg-zinc-200 rounded-full transition-all">
                  <X className="w-5 h-5 text-zinc-500" />
                </button>
              </div>
              <div className="p-8 space-y-6 overflow-y-auto">
                <div className="text-center space-y-2">
                  <p className="text-sm text-zinc-500 font-medium">Valor a Pagar para <strong className="text-zinc-900">{payingSeller.name}</strong></p>
                  <p className="text-4xl font-black text-emerald-600">
                    R$ {sales.filter(s => selectedSalesToPay.includes(s.id)).reduce((acc, s) => acc + calculateCommission(s, payingSeller), 0).toLocaleString()}
                  </p>
                </div>
                
                <div className="bg-zinc-50 p-4 rounded-2xl border border-zinc-200 space-y-3">
                  <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Vendas Selecionadas</p>
                  <div className="max-h-48 overflow-y-auto space-y-2">
                    {sales.filter(s => s.vendedor_id === payingSeller.id && s.status === SaleStatus.PAGO && !s.commission_paid).map(sale => (
                      <label key={sale.id} className="flex items-center gap-3 p-2 hover:bg-zinc-100 rounded-lg cursor-pointer">
                        <input 
                          type="checkbox" 
                          checked={selectedSalesToPay.includes(sale.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedSalesToPay(prev => [...prev, sale.id]);
                            } else {
                              setSelectedSalesToPay(prev => prev.filter(id => id !== sale.id));
                            }
                          }}
                          className="w-4 h-4 text-indigo-600 rounded border-zinc-300 focus:ring-indigo-500"
                        />
                        <div className="flex-1">
                          <p className="text-sm font-bold text-zinc-900">{sale.phone}</p>
                          <p className="text-xs text-zinc-500">{sale.service} - {new Date(sale.paid_at || '').toLocaleDateString()}</p>
                        </div>
                        <p className="text-sm font-bold text-emerald-600">R$ {calculateCommission(sale, payingSeller).toLocaleString()}</p>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="bg-zinc-50 p-4 rounded-2xl border border-zinc-200 space-y-3">
                  <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Comprovante de Pagamento</p>
                  <input 
                    type="file" 
                    accept="image/*,.pdf"
                    onChange={(e) => setPaymentReceipt(e.target.files?.[0] || null)}
                    className="block w-full text-sm text-zinc-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-600 hover:file:bg-indigo-100 cursor-pointer"
                  />
                </div>

                <div className="bg-zinc-50 p-4 rounded-2xl border border-zinc-200 space-y-3">
                  <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Dados para Pagamento (PIX)</p>
                  {payingSeller.pix_key ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between bg-white p-3 rounded-xl border border-zinc-200">
                        <div className="flex flex-col">
                          <span className="text-xs text-zinc-500 font-medium mb-1">Nome do Recebedor</span>
                          <span className="font-bold text-sm text-zinc-900">{payingSeller.name}</span>
                        </div>
                      </div>
                      <div className="flex items-center justify-between bg-white p-3 rounded-xl border border-zinc-200">
                        <div className="flex flex-col">
                          <span className="text-xs text-zinc-500 font-medium mb-1">Chave PIX</span>
                          <span className="font-mono text-sm font-medium text-zinc-800 break-all">{payingSeller.pix_key}</span>
                        </div>
                        <button 
                          onClick={() => {
                            navigator.clipboard.writeText(payingSeller.pix_key || '');
                            showToast('Chave PIX copiada!', 'success');
                          }}
                          className="ml-3 px-3 py-1.5 bg-indigo-50 text-indigo-600 text-xs font-bold rounded-lg hover:bg-indigo-100 transition-all shrink-0"
                        >
                          Copiar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-amber-600 font-medium bg-amber-50 p-3 rounded-xl border border-amber-200">
                      Nenhuma chave PIX cadastrada para este vendedor.
                    </p>
                  )}
                </div>

                <div className="flex gap-4 pt-4 shrink-0">
                  <button 
                    type="button" 
                    onClick={() => setPayingSeller(null)}
                    className="flex-1 py-4 rounded-xl font-bold text-zinc-500 hover:bg-zinc-100 transition-all"
                  >
                    Cancelar
                  </button>
                  <button 
                    onClick={() => handlePayVendedor(payingSeller.id, sales.filter(s => selectedSalesToPay.includes(s.id)).reduce((acc, s) => acc + calculateCommission(s, payingSeller), 0))}
                    disabled={selectedSalesToPay.length === 0 || isUploadingReceipt}
                    className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-4 rounded-xl transition-all shadow-lg shadow-emerald-100 flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {isUploadingReceipt ? 'Processando...' : 'Confirmar Pagamento'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {confirmModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl border border-black/5"
          >
            <h3 className="text-2xl font-bold text-zinc-900 mb-4">{confirmModal.title}</h3>
            <p className="text-zinc-600 mb-6">{confirmModal.message}</p>
            
            {confirmModal.requireInput && (
              <div className="mb-6">
                <label className="block text-sm font-semibold text-zinc-700 mb-2">
                  Digite "{confirmModal.requireInput}" para confirmar:
                </label>
                <input
                  type="text"
                  value={confirmInput}
                  className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none transition-all"
                  onChange={(e) => setConfirmInput(e.target.value)}
                />
              </div>
            )}

            <div className="flex gap-3 justify-end">
              <button
                onClick={() => {
                  if (confirmModal.onCancel) confirmModal.onCancel();
                  setConfirmModal(null);
                }}
                className="px-6 py-3 rounded-xl font-bold text-zinc-600 hover:bg-zinc-100 transition-all"
              >
                {confirmModal.cancelText || 'Cancelar'}
              </button>
              <button
                disabled={!!confirmModal.requireInput && confirmInput !== confirmModal.requireInput}
                onClick={() => {
                  const cb = confirmModal.onConfirm;
                  setConfirmModal(null);
                  setTimeout(() => cb(), 0);
                }}
                className="px-6 py-3 rounded-xl font-bold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {confirmModal.confirmText || 'Confirmar'}
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {viewingCustomer && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white w-full max-w-3xl rounded-3xl shadow-xl overflow-hidden flex flex-col max-h-[90vh]"
          >
            <div className="p-6 border-b border-black/5 flex justify-between items-center bg-zinc-50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-indigo-100 text-indigo-600 rounded-xl flex items-center justify-center">
                  <UserCheck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-xl text-zinc-900">{viewingCustomer.name}</h3>
                  <p className="text-sm text-zinc-500">{viewingCustomer.phone}</p>
                </div>
              </div>
              <button 
                onClick={() => setViewingCustomer(null)}
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-zinc-200 text-zinc-500 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1 flex flex-col gap-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-emerald-50 p-4 rounded-2xl border border-emerald-100">
                  <p className="text-[10px] text-emerald-600 uppercase font-black tracking-wider mb-1">LTV (Lifetime Value)</p>
                  <p className="font-black text-2xl text-emerald-700">R$ {getCustomerLTV(viewingCustomer.id).total_spent.toLocaleString()}</p>
                </div>
                <div className="bg-indigo-50 p-4 rounded-2xl border border-indigo-100">
                  <p className="text-[10px] text-indigo-600 uppercase font-black tracking-wider mb-1">Total Compras</p>
                  <p className="font-black text-2xl text-indigo-700">{getCustomerLTV(viewingCustomer.id).total_purchases}</p>
                </div>
                <div className="bg-zinc-50 p-4 rounded-2xl border border-zinc-200">
                  <p className="text-[10px] text-zinc-500 uppercase font-black tracking-wider mb-1">Cliente Desde</p>
                  <p className="font-bold text-lg text-zinc-800">{new Date(viewingCustomer.first_purchase_date).toLocaleDateString()}</p>
                </div>
                <div className="bg-zinc-50 p-4 rounded-2xl border border-zinc-200">
                  <p className="text-[10px] text-zinc-500 uppercase font-black tracking-wider mb-1">Serviços</p>
                  <p className="font-bold text-sm text-zinc-800 leading-tight">
                    {viewingCustomer.services?.join(', ') || '-'}
                  </p>
                </div>
              </div>

              <div>
                <h4 className="font-bold text-zinc-900 mb-4 border-b pb-2">Histórico de Vendas / Contratos</h4>
                <div className="flex flex-col gap-3">
                  {sales
                    .filter(s => s.customer_id === viewingCustomer.id)
                    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                    .map(s => (
                    <div key={s.id} className="border border-zinc-200 rounded-xl p-4 flex justify-between items-center hover:bg-zinc-50 transition-colors">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-bold text-zinc-900">{s.services ? s.services.join(', ') : s.service}</span>
                          {s.sale_type === SaleType.RECORRENTE ? (
                            <span className="px-2 py-0.5 bg-purple-100 text-purple-700 text-[10px] font-bold rounded-md flex items-center gap-1">
                              <Repeat className="w-3 h-3" /> RECORRENTE
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-[10px] font-bold rounded-md">
                              PONTUAL
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-zinc-500">
                          {new Date(s.created_at).toLocaleDateString()} • Vendedor: {users.find(u => u.id === s.vendedor_id)?.name || 'Desconhecido'}
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-black text-zinc-900">R$ {s.value.toLocaleString()}</p>
                        <p className={`text-[10px] font-bold mt-1 uppercase ${
                          s.status === SaleStatus.PAGO ? 'text-emerald-600' : 
                          s.status === SaleStatus.CANCELADO ? 'text-red-500' : 
                          s.status === SaleStatus.ARQUIVADO ? 'text-zinc-400' : 'text-amber-500'
                        }`}>
                          {getStatusLabel(s.status)}
                        </p>
                      </div>
                    </div>
                  ))}
                  {sales.filter(s => s.customer_id === viewingCustomer.id).length === 0 && (
                    <p className="text-sm text-zinc-500 text-center py-4">Nenhuma venda explícita vinculada a este cliente.</p>
                  )}
                </div>
              </div>
            </div>
            <div className="p-4 border-t bg-zinc-50 flex justify-end">
              <button 
                onClick={() => setViewingCustomer(null)}
                className="px-6 py-2 bg-zinc-200 hover:bg-zinc-300 text-zinc-800 font-bold rounded-xl transition-all"
              >
                Fechar Ficha
              </button>
            </div>
          </motion.div>
        </div>
      )}



      {duplicateCustomerFound && pendingLeadData && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white p-6 rounded-3xl shadow-xl max-w-lg w-full border border-black/5"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center">
                <AlertCircle className="w-6 h-6 text-amber-600" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-zinc-900">Cliente Já Cadastrado</h3>
                <p className="text-sm text-zinc-500">Encontramos um cliente com este telefone na base.</p>
              </div>
            </div>

            <div className="bg-zinc-50 p-4 rounded-2xl mb-6 border border-zinc-100">
              <div className="flex justify-between items-center mb-2">
                <span className="font-bold text-zinc-900">{duplicateCustomerFound.name}</span>
                <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full">
                  {getCustomerLTV(duplicateCustomerFound.id).total_purchases} compra{getCustomerLTV(duplicateCustomerFound.id).total_purchases !== 1 ? 's' : ''}
                </span>
              </div>
              <p className="text-sm text-zinc-500">{duplicateCustomerFound.phone}</p>
              <p className="text-sm text-zinc-500 mt-1">
                LTV: <strong className="text-emerald-600">R$ {getCustomerLTV(duplicateCustomerFound.id).total_spent.toLocaleString()}</strong>
              </p>
              {duplicateCustomerFound.services?.length > 0 && (
                <div className="flex gap-1 mt-2 flex-wrap">
                  {duplicateCustomerFound.services.map(s => (
                    <span key={s} className="px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded text-[10px] font-bold">{s}</span>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-3">
              <button 
                onClick={async () => {
                  const customer = duplicateCustomerFound;
                  const data = pendingLeadData;
                  setDuplicateCustomerFound(null);
                  setPendingLeadData(null);
                  await proceedWithLead(data, customer);
                }}
                className="w-full px-4 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl transition-all shadow-lg shadow-emerald-100 text-left flex items-center gap-3"
              >
                <Plus className="w-5 h-5 flex-shrink-0" />
                <div>
                  <span className="block">Adicionar Venda ao Cliente Existente</span>
                  <span className="text-xs font-normal text-emerald-100">A nova venda será vinculada a {duplicateCustomerFound.name}</span>
                </div>
              </button>
              <button 
                onClick={() => {
                  setViewingCustomer(duplicateCustomerFound);
                  setDuplicateCustomerFound(null);
                  setPendingLeadData(null);
                  setCurrentPage('customers');
                }}
                className="w-full px-4 py-3 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold rounded-xl transition-all text-left flex items-center gap-3"
              >
                <Eye className="w-5 h-5 flex-shrink-0" />
                <div>
                  <span className="block">Ver Ficha do Cliente</span>
                  <span className="text-xs font-normal text-indigo-400">Abrir a ficha completa antes de decidir</span>
                </div>
              </button>
              <button 
                onClick={() => {
                  setNewSaleSearchPhone(duplicateCustomerFound!.phone);
                  setNewSaleSelectedCustomer(duplicateCustomerFound);
                  setDuplicateCustomerFound(null);
                  setPendingLeadData(null);
                  setCurrentPage('new-sale');
                }}
                className="w-full px-4 py-3 bg-amber-50 hover:bg-amber-100 text-amber-700 font-bold rounded-xl transition-all text-left flex items-center gap-3"
              >
                <PlusCircle className="w-5 h-5 flex-shrink-0" />
                <div>
                  <span className="block">Ir para Nova Venda</span>
                  <span className="text-xs font-normal text-amber-500">Abrir a aba de nova venda com este cliente</span>
                </div>
              </button>
              <button 
                onClick={() => {
                  setDuplicateCustomerFound(null);
                  setPendingLeadData(null);
                }}
                className="w-full px-4 py-3 bg-zinc-100 hover:bg-zinc-200 text-zinc-600 font-medium rounded-xl transition-all text-center"
              >
                Cancelar
              </button>
            </div>
          </motion.div>
        </div>
      )}

      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
}
