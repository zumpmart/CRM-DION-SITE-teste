/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
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
  Upload,
  Edit2,
  Calendar,
  Camera
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Cropper from 'react-easy-crop';
import 'react-easy-crop/react-easy-crop.css';
import { UserProfile, UserRole, Sale, SaleStatus, Receipt, ReceiptStatus, AuditLog, Payment } from './types';
import { db, auth, storage } from './firebase';
import { collection, doc, getDocs, getDoc, addDoc, setDoc, updateDoc, deleteDoc, query, where, orderBy, onSnapshot, limit } from 'firebase/firestore';
import { signInWithEmailAndPassword, signOut, onAuthStateChanged, createUserWithEmailAndPassword, updatePassword, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';

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

const calculateCommission = (sale: Sale, user?: UserProfile) => {
  if (!user) return 0;
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
  const [loading, setLoading] = useState(true);
  const [showUserModal, setShowUserModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [editingSale, setEditingSale] = useState<Sale | null>(null);
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
  const [deletingSaleId, setDeletingSaleId] = useState<string | null>(null);
  const [transferringSale, setTransferringSale] = useState<Sale | null>(null);
  const [transferTargetId, setTransferTargetId] = useState<string>('');
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

      setCurrentUser({ ...(docSnap.data() as UserProfile), id: docSnap.id });
    } catch (err: any) {
      console.error('Fetch profile exception:', err);
      setLoginError('Erro ao carregar perfil: ' + err.message);
      signOut(auth);
    } finally {
      setLoading(false);
      setIsLoggingIn(false);
    }
  };

  useEffect(() => {
    if (!currentUser) return;

    let salesQ = query(collection(db, 'sales'), orderBy('created_at', 'desc'));
    let receiptsQ = query(collection(db, 'receipts'), orderBy('created_at', 'desc'));

    const unsubSales = onSnapshot(salesQ, (snapshot) => {
      const salesData = snapshot.docs.map(doc => ({ ...(doc.data() as Sale), id: doc.id }))
        .sort((a, b) => {
          const timeA = new Date(a.created_at).getTime() || 0;
          const timeB = new Date(b.created_at).getTime() || 0;
          if (timeB !== timeA) return timeB - timeA;
          const updatedA = new Date(a.updated_at || a.created_at).getTime() || 0;
          const updatedB = new Date(b.updated_at || b.created_at).getTime() || 0;
          if (updatedB !== updatedA) return updatedB - updatedA;
          return b.id.localeCompare(a.id);
        });
      setSales(salesData);
    }, (error) => {
      console.error("Erro ao buscar vendas:", error);
    });

    const unsubReceipts = onSnapshot(receiptsQ, (snapshot) => {
      const receiptsData = snapshot.docs.map(doc => ({ ...(doc.data() as Receipt), id: doc.id }))
        .sort((a, b) => {
          const timeA = new Date(a.created_at).getTime() || 0;
          const timeB = new Date(b.created_at).getTime() || 0;
          if (timeB !== timeA) return timeB - timeA;
          return b.id.localeCompare(a.id);
        });
      setReceipts(receiptsData);
    }, (error) => {
      console.error("Erro ao buscar comprovantes:", error);
    });

    let unsubProfiles: any;
    let unsubLogs: any;
    let unsubPayments: any;

    if (currentUser.role === UserRole.ADMIN) {
      unsubProfiles = onSnapshot(collection(db, 'profiles'), (snapshot) => {
        setUsers(snapshot.docs.map(doc => ({ ...(doc.data() as UserProfile), id: doc.id })));
      });
      unsubLogs = onSnapshot(query(collection(db, 'audit_logs'), orderBy('created_at', 'desc'), limit(100)), (snapshot) => {
        setLogs(snapshot.docs.map(doc => ({ ...(doc.data() as AuditLog), id: doc.id })));
      });
      unsubPayments = onSnapshot(query(collection(db, 'payments'), orderBy('created_at', 'desc')), (snapshot) => {
        setPayments(snapshot.docs.map(doc => ({ ...(doc.data() as Payment), id: doc.id })));
      });
    } else {
      unsubProfiles = onSnapshot(collection(db, 'profiles'), (snapshot) => {
        setUsers(snapshot.docs.map(doc => ({ ...(doc.data() as UserProfile), id: doc.id })));
      });
      unsubPayments = onSnapshot(query(collection(db, 'payments'), where('vendedor_id', '==', currentUser.id), orderBy('created_at', 'desc')), (snapshot) => {
        setPayments(snapshot.docs.map(doc => ({ ...(doc.data() as Payment), id: doc.id })));
      });
    }

    return () => {
      unsubSales();
      unsubReceipts();
      if (unsubProfiles) unsubProfiles();
      if (unsubLogs) unsubLogs();
      if (unsubPayments) unsubPayments();
    };
  }, [currentUser]);

  // --- Background Cleanup Routine ---
  useEffect(() => {
    if (!currentUser || currentUser.role !== UserRole.ADMIN) return;

    const runCleanup = async () => {
      try {
        const now = new Date();
        const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

        // 1. Cleanup Sales Receipts (older than 24h since sale was PAGO)
        const paidSalesQuery = query(collection(db, 'sales'), where('status', '==', SaleStatus.PAGO), where('paid_at', '<', oneDayAgo));
        const paidSalesSnapshot = await getDocs(paidSalesQuery);
        const oldPaidSaleIds = paidSalesSnapshot.docs.map(d => d.id);

        if (oldPaidSaleIds.length > 0) {
          const receiptsSnapshot = await getDocs(collection(db, 'receipts'));
          const receiptsToDelete = receiptsSnapshot.docs.filter(d => oldPaidSaleIds.includes(d.data().sale_id));

          for (const receiptDoc of receiptsToDelete) {
            const data = receiptDoc.data() as Receipt;
            if (data.file_path) {
              try {
                const fileRef = ref(storage, data.file_path);
                await deleteObject(fileRef);
              } catch (e) {
                console.error("Erro ao excluir arquivo do comprovante de venda:", e);
              }
            }
            await deleteDoc(doc(db, 'receipts', receiptDoc.id));
          }
        }

        // 2. Cleanup Audit Logs (older than 30 days)
        const oldLogsQuery = query(collection(db, 'audit_logs'), where('created_at', '<', thirtyDaysAgo));
        const oldLogsSnapshot = await getDocs(oldLogsQuery);
        for (const logDoc of oldLogsSnapshot.docs) {
          await deleteDoc(doc(db, 'audit_logs', logDoc.id));
        }

        // 3. Cleanup Commission Payments (older than 30 days)
        const oldPaymentsQuery = query(collection(db, 'payments'), where('created_at', '<', thirtyDaysAgo));
        const oldPaymentsSnapshot = await getDocs(oldPaymentsQuery);
        for (const paymentDoc of oldPaymentsSnapshot.docs) {
          const data = paymentDoc.data() as Payment;
          if (data.receipt_url) {
            try {
              const fileRef = ref(storage, data.receipt_url);
              await deleteObject(fileRef);
            } catch (e) {
              console.error("Erro ao excluir arquivo do comprovante de pagamento:", e);
            }
          }
          await deleteDoc(doc(db, 'payments', paymentDoc.id));
        }

      } catch (error) {
        console.error("Erro ao executar limpeza em segundo plano:", error);
      }
    };

    // Run cleanup once when admin logs in
    runCleanup();
  }, [currentUser]);

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
      if (currentUser?.role !== UserRole.ADMIN && currentUser?.role !== UserRole.SUPERVISOR) {
        const authUid = auth.currentUser?.uid || currentUser?.id;
        if (sale.vendedor_id !== authUid && sale.transfer_to !== authUid) {
          return false;
        }
      }
      const matchVendedor = !filters.vendedor || sale.vendedor_id === filters.vendedor;
      const matchStatus = !filters.status || sale.status === filters.status;
      const saleDate = new Date(sale.created_at);
      const matchStartDate = !filters.startDate || saleDate >= new Date(filters.startDate + 'T00:00:00');
      const matchEndDate = !filters.endDate || saleDate <= new Date(filters.endDate + 'T23:59:59');
      
      return matchVendedor && matchStatus && matchStartDate && matchEndDate;
    }).map(sale => {
      const existingReceipt = receipts.find(r => r.sale_id === sale.id);
      return { ...sale, receipt_id: existingReceipt?.id };
    });
  }, [sales, filters, receipts, currentUser]);

  const ranking = useMemo(() => {
    const today = toLocalDateString(new Date().toISOString());
    const currentMonth = today.substring(0, 7);
    
    const curr = new Date();
    const first = curr.getDate() - curr.getDay() + (curr.getDay() === 0 ? -6 : 1);
    const startOfWeekDate = new Date(curr.setDate(first));
    const endOfWeekDate = new Date(curr.setDate(first + 6));
    const startOfWeek = toLocalDateString(startOfWeekDate.toISOString());
    const endOfWeek = toLocalDateString(endOfWeekDate.toISOString());

    const stats = users
      .map(u => {
        const userSales = sales.filter(s => {
          if (s.vendedor_id !== u.id || s.status !== SaleStatus.PAGO || !s.paid_at) return false;
          
          const paidDate = toLocalDateString(s.paid_at);
          
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
      .filter(u => u.count > 0 || u.id === currentUser?.id) // Keep users with sales, or the current user so they always see themselves
      .sort((a, b) => b.total - a.total);
    return stats;
  }, [sales, users, rankingFilter]);

  const stats = useMemo(() => {
    const start = dateRange.start || getLocalISODate();
    const end = dateRange.end || getLocalISODate();
    
    // Leads created in this range
    const createdInRange = mySales.filter(s => {
      const date = toLocalDateString(s.created_at);
      return date >= start && date <= end;
    });
    
    // Revenue from sales PAID in this range
    const paidInRange = mySales.filter(s => {
      if (s.status !== SaleStatus.PAGO || !s.paid_at) return false;
      const date = toLocalDateString(s.paid_at);
      return date >= start && date <= end;
    });
    
    const dailyTotal = paidInRange.reduce((acc, s) => acc + s.value, 0);
    const targetMonth = start.substring(0, 7);
    const monthlyTotal = mySales
      .filter(s => s.status === SaleStatus.PAGO && toLocalDateString(s.paid_at).startsWith(targetMonth))
      .reduce((acc, s) => acc + s.value, 0);

    const statusCounts = {
      [SaleStatus.AGUARDANDO]: createdInRange.filter(s => s.status === SaleStatus.AGUARDANDO).length,
      [SaleStatus.PENDENTE]: createdInRange.filter(s => s.status === SaleStatus.PENDENTE).length,
      [SaleStatus.PAGO]: createdInRange.filter(s => s.status === SaleStatus.PAGO).length,
      [SaleStatus.CANCELADO]: createdInRange.filter(s => s.status === SaleStatus.CANCELADO).length,
    };

    return {
      dailyTotal,
      monthlyTotal,
      dailyCount: createdInRange.length,
      statusCounts,
      goalProgress: currentUser?.daily_goal ? (dailyTotal / currentUser.daily_goal) * 100 : 0
    };
  }, [mySales, currentUser, dateRange]);

  const adminGoalTracking = useMemo(() => {
    if (currentUser?.role !== UserRole.ADMIN) return [];
    
    const start = dateRange.start || getLocalISODate();
    const end = dateRange.end || getLocalISODate();
    
    return users
      .filter(u => u.role === UserRole.VENDEDOR || u.role === UserRole.ADMIN)
      .map(u => {
        const sellerSales = sales.filter(s => {
          if (s.vendedor_id !== u.id || s.status !== SaleStatus.PAGO || !s.paid_at) return false;
          const date = toLocalDateString(s.paid_at);
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

  const handleAddLead = async (leadData: any) => {
    if (!currentUser) return;
    
    if (leadData.value < 0) {
      alert('O valor não pode ser negativo.');
      return;
    }

    try {
      const docRef = await addDoc(collection(db, 'sales'), {
        ...leadData,
        name: leadData.name || 'Cliente',
        vendedor_id: currentUser.id,
        created_at: leadData.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      await addLog(currentUser, `Registrou novo lead: ${leadData.phone}`, docRef.id);
      clearFilters();
      setTimeout(() => {
        setCurrentPage('sales');
      }, 100);
    } catch (error: any) {
      alert('Erro ao salvar lead: ' + error.message);
    }
  };

  const handleEditSale = async (saleId: string, updatedData: any, newReceipt?: File) => {
    if (!currentUser) return;
    setIsSubmitting(true);

    try {
      const sale = sales.find(s => s.id === saleId);
      if (updatedData.status === SaleStatus.PAGO && !sale?.receipt_id && !newReceipt) {
        alert('⚠️ ATENÇÃO: Não é possível marcar como PAGO sem um comprovante enviado. Por favor, anexe o comprovante primeiro.');
        setIsSubmitting(false);
        return;
      }

      const finalUpdates = { ...updatedData };
      if (updatedData.status === SaleStatus.PAGO && sale?.status !== SaleStatus.PAGO) {
        finalUpdates.paid_at = new Date().toISOString();
      }

      await updateDoc(doc(db, 'sales', saleId), {
        ...finalUpdates,
        updated_at: new Date().toISOString()
      });

      if (newReceipt) {
        await handleUploadReceipt(saleId, newReceipt);
      }

      await addLog(currentUser, `Editou venda ${saleId}`, saleId);
      setEditingSale(null);
    } catch (error: any) {
      alert('Erro ao editar venda: ' + error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateStatus = async (saleId: string, newStatus: SaleStatus, forceUpdate: boolean = false) => {
    if (!currentUser) return;
    
    const sale = sales.find(s => s.id === saleId);
    const hasReceipt = receipts.some(r => r.sale_id === saleId);
    
    if (newStatus === SaleStatus.PAGO && !hasReceipt && !forceUpdate) {
      setSalePendingReceipt(sale || null);
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
      await addLog(currentUser, `Alterou status da venda ${saleId} para ${newStatus}`, saleId);
    } catch (error: any) {
      alert('Erro ao atualizar status: ' + error.message);
    }
  };

  const handleDeleteSale = async (saleId: string | null) => {
    if (!currentUser || !saleId) return;
    
    setIsSubmitting(true);
    try {
      const sale = sales.find(s => s.id === saleId);
      if (!sale) return;

      if (currentUser.role === UserRole.ADMIN) {
        const receipt = receipts.find(r => r.sale_id === saleId);
        if (receipt) {
          if (receipt.file_path) {
            try {
              const fileRef = ref(storage, receipt.file_path);
              await deleteObject(fileRef);
            } catch (e) {
              console.error("Erro ao excluir arquivo do comprovante:", e);
            }
          }
          await deleteDoc(doc(db, 'receipts', receipt.id));
        }
        await deleteDoc(doc(db, 'sales', saleId));
        await addLog(currentUser, `Excluiu venda ${saleId}`, saleId);
        alert('Exclusão confirmada!');
      } else {
        await updateDoc(doc(db, 'sales', saleId), {
          status: SaleStatus.EXCLUSAO_SOLICITADA,
          previous_status: sale.status,
          updated_at: new Date().toISOString()
        });
        await addLog(currentUser, `Solicitou exclusão da venda ${saleId}`, saleId);
        alert('Exclusão enviada!');
      }
    } catch (error: any) {
      alert('Erro ao excluir venda: ' + error.message);
    } finally {
      setDeletingSaleId(null);
      setEditingSale(null);
      setIsSubmitting(false);
    }
  };

  const handleRejectDeletion = async (sale: Sale) => {
    if (!currentUser || currentUser.role !== UserRole.ADMIN) return;
    try {
      const restoredStatus = sale.previous_status || SaleStatus.PENDENTE;
      await updateDoc(doc(db, 'sales', sale.id), {
        status: restoredStatus,
        previous_status: null,
        updated_at: new Date().toISOString()
      });
      await addLog(currentUser, `Rejeitou exclusão da venda ${sale.id}`, sale.id);
    } catch (error: any) {
      alert('Erro ao rejeitar exclusão: ' + error.message);
    }
  };

  const handleInitiateTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !transferringSale || !transferTargetId) return;
    setIsSubmitting(true);
    try {
      await updateDoc(doc(db, 'sales', transferringSale.id), {
        transfer_to: transferTargetId,
        updated_at: new Date().toISOString()
      });
      const targetUser = users.find(u => u.id === transferTargetId);
      await addLog(currentUser, `Solicitou transferência do lead ${transferringSale.name} para ${targetUser?.name}`, transferringSale.id);
      setTransferringSale(null);
      setTransferTargetId('');
    } catch (error: any) {
      alert('Erro ao transferir: ' + error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAcceptTransfer = async (sale: Sale) => {
    if (!currentUser) return;
    try {
      await updateDoc(doc(db, 'sales', sale.id), {
        vendedor_id: currentUser.id,
        transfer_to: null,
        updated_at: new Date().toISOString()
      });
      await addLog(currentUser, `Aceitou a transferência do lead ${sale.name}`, sale.id);
    } catch (error: any) {
      alert('Erro ao aceitar transferência: ' + error.message);
    }
  };

  const handleRejectTransfer = async (sale: Sale) => {
    if (!currentUser) return;
    try {
      await updateDoc(doc(db, 'sales', sale.id), {
        transfer_to: null,
        updated_at: new Date().toISOString()
      });
      await addLog(currentUser, `Recusou a transferência do lead ${sale.name}`, sale.id);
    } catch (error: any) {
      alert('Erro ao recusar transferência: ' + error.message);
    }
  };

  const handleCancelTransfer = async (sale: Sale) => {
    if (!currentUser) return;
    try {
      await updateDoc(doc(db, 'sales', sale.id), {
        transfer_to: null,
        updated_at: new Date().toISOString()
      });
      await addLog(currentUser, `Cancelou a transferência do lead ${sale.name}`, sale.id);
    } catch (error: any) {
      alert('Erro ao cancelar transferência: ' + error.message);
    }
  };

  const handleUpdateReceiptStatus = async (receiptId: string, newStatus: ReceiptStatus) => {
    if (!currentUser || currentUser.role === UserRole.VENDEDOR) return;

    try {
      await updateDoc(doc(db, 'receipts', receiptId), { status: newStatus });
      await addLog(currentUser, `Alterou status do comprovante ${receiptId} para ${newStatus}`, receiptId);
    } catch (error: any) {
      alert('Erro ao atualizar status do comprovante: ' + error.message);
    }
  };

  const handleMarkReceiptAsPaid = async (receiptId: string) => {
    if (!currentUser || currentUser.role !== UserRole.ADMIN) return;

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
      alert('Erro ao atualizar comprovante: ' + error.message);
    }
  };

  const handleUpdateUser = async (userId: string, updates: Partial<UserProfile>) => {
    if (!currentUser || currentUser.role !== UserRole.ADMIN) return;

    try {
      await updateDoc(doc(db, 'profiles', userId), updates);
      if (userId === currentUser.id) {
        setCurrentUser(prev => prev ? { ...prev, ...updates } : null);
      }
      await addLog(currentUser, `Atualizou dados do usuário ${userId}`, userId);
    } catch (error: any) {
      alert('Erro ao atualizar usuário: ' + error.message);
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
      alert('Perfil atualizado com sucesso!');
    } catch (error: any) {
      alert('Erro ao atualizar perfil: ' + error.message);
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
      alert('As novas senhas não coincidem.');
      return;
    }

    setIsSubmitting(true);
    try {
      const credential = EmailAuthProvider.credential(auth.currentUser.email!, currentPassword);
      await reauthenticateWithCredential(auth.currentUser, credential);

      await updatePassword(auth.currentUser, newPassword);
      
      await addLog(currentUser, `Alterou a própria senha`, currentUser.id);
      alert('Senha atualizada com sucesso!');
      (e.target as HTMLFormElement).reset();
    } catch (error: any) {
      console.error('Error updating password:', error);
      if (error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
        alert('Senha atual incorreta.');
      } else {
        alert('Erro ao atualizar senha: ' + error.message);
      }
    } finally {
      setIsSubmitting(false);
    }
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
      alert('Erro ao atualizar foto: ' + error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePayVendedor = async (vendedorId: string, amount: number) => {
    if (!currentUser || currentUser.role !== UserRole.ADMIN) return;

    if (selectedSalesToPay.length === 0) {
      alert('Selecione pelo menos uma venda para pagar.');
      return;
    }

    setIsUploadingReceipt(true);
    try {
      let receiptUrl = '';
      if (paymentReceipt) {
        const fileRef = ref(storage, `payment_receipts/${vendedorId}/${Date.now()}_${paymentReceipt.name}`);
        await uploadBytes(fileRef, paymentReceipt);
        receiptUrl = await getDownloadURL(fileRef);
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
        status: 'PAGO',
        admin_id: currentUser.id,
        created_at: new Date().toISOString(),
        receipt_url: receiptUrl,
        sales_ids: selectedSalesToPay
      });
      
      setPayingSeller(null);
      setSelectedSalesToPay([]);
      setPaymentReceipt(null);
      alert('Pagamento registrado com sucesso!');
      await addLog(currentUser, `Registrou pagamento de R$ ${amount} para vendedor ${vendedorId}`, vendedorId);
    } catch (error: any) {
      alert('Erro ao registrar pagamento: ' + error.message);
    } finally {
      setIsUploadingReceipt(false);
    }
  };

  const handleUploadReceipt = async (saleId: string, file: File) => {
    try {
      if (!currentUser) return;
      const sale = sales.find(s => s.id === saleId);
      if (!sale) return;

      if (receipts.some(r => r.sale_id === saleId)) {
        alert('⚠️ Esta venda já possui um comprovante anexado.');
        return;
      }

      // Compress image to base64
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
          const img = new Image();
          img.src = event.target?.result as string;
          img.onload = () => {
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 800;
            const MAX_HEIGHT = 800;
            let width = img.width;
            let height = img.height;

            if (width > height) {
              if (width > MAX_WIDTH) {
                height *= MAX_WIDTH / width;
                width = MAX_WIDTH;
              }
            } else {
              if (height > MAX_HEIGHT) {
                width *= MAX_HEIGHT / height;
                height = MAX_HEIGHT;
              }
            }
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx?.drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL('image/jpeg', 0.7));
          };
          img.onerror = error => reject(error);
        };
        reader.onerror = error => reject(error);
      });

      const receiptRef = await addDoc(collection(db, 'receipts'), {
        sale_id: saleId,
        vendedor_id: currentUser.id,
        file_name: file.name,
        file_path: base64, // Storing base64 directly
        status: ReceiptStatus.ENVIADO,
        value: sale.value || 0,
        created_at: new Date().toISOString()
      });

      await addLog(currentUser, `Enviou comprovante para venda ${saleId}`, receiptRef.id);
      alert('✅ Comprovante enviado e registrado com sucesso!');
    } catch (err: any) {
      console.error('Erro no processo de upload:', err);
      alert('Erro no upload: ' + err.message);
    }
  };

  const handleViewReceipt = (base64Data: string) => {
    try {
      if (base64Data.startsWith('data:')) {
        const arr = base64Data.split(',');
        const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/jpeg';
        const bstr = atob(arr[1]);
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        while (n--) {
          u8arr[n] = bstr.charCodeAt(n);
        }
        const blob = new Blob([u8arr], { type: mime });
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
      } else {
        window.open(base64Data, '_blank');
      }
    } catch (e) {
      console.error(e);
      const win = window.open();
      if (win) win.document.write(`<img src="${base64Data}" style="max-width: 100%;" />`);
    }
  };

  const handleCreateUser = async (userData: any) => {
    if (!currentUser || currentUser.role !== UserRole.ADMIN) return;
    setIsSubmitting(true);

    try {
      // 1. Create Auth User
      const userCredential = await createUserWithEmailAndPassword(auth, userData.email, userData.password);
      const user = userCredential.user;

      // 2. Create Profile
      await setDoc(doc(db, 'profiles', user.uid), {
        id: user.uid,
        name: userData.name,
        username: userData.username,
        role: UserRole.VENDEDOR,
        daily_goal: Number(userData.daily_goal),
        commission: Number(userData.commission),
        status: 'ATIVO',
        created_at: new Date().toISOString()
      });

      alert('Vendedor criado com sucesso!');
      setShowUserModal(false);
      await addLog(currentUser, `Criou novo vendedor: ${userData.name}`, user.uid);
    } catch (error: any) {
      alert('Erro ao criar vendedor: ' + error.message);
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
    { id: 'new-lead', label: 'Novo Lead', icon: PlusCircle, roles: [UserRole.ADMIN, UserRole.VENDEDOR] },
    { id: 'sales', label: currentUser.role === UserRole.VENDEDOR ? 'Minhas Vendas' : 'Todas as Vendas', icon: FileText, roles: [UserRole.ADMIN, UserRole.VENDEDOR, UserRole.SUPERVISOR] },
    { id: 'ranking', label: 'Ranking', icon: Trophy, roles: [UserRole.ADMIN, UserRole.VENDEDOR, UserRole.SUPERVISOR] },
    { id: 'receipts', label: 'Comprovantes', icon: CheckCircle, roles: [UserRole.ADMIN, UserRole.VENDEDOR, UserRole.SUPERVISOR] },
    { id: 'users', label: 'Equipe', icon: Users, roles: [UserRole.ADMIN] },
    { id: 'financial', label: 'Financeiro', icon: DollarSign, roles: [UserRole.ADMIN] },
    { id: 'logs', label: 'Auditoria', icon: History, roles: [UserRole.ADMIN] },
    { id: 'profile', label: 'Meu Perfil', icon: UserIcon, roles: [UserRole.ADMIN, UserRole.VENDEDOR, UserRole.SUPERVISOR] },
  ];

  return (
    <div className="min-h-screen bg-zinc-50 flex">
      {/* Sidebar */}
      <aside className={`${sidebarOpen ? 'w-64' : 'w-20'} bg-white border-r border-black/5 transition-all duration-300 flex flex-col z-50`}>
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
              onClick={() => setCurrentPage(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all ${
                currentPage === item.id 
                ? 'bg-indigo-50 text-indigo-600' 
                : 'text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900'
              }`}
            >
              <item.icon className="w-5 h-5 shrink-0" />
              {sidebarOpen && <span className="font-medium text-sm">{item.label}</span>}
              {sidebarOpen && currentPage === item.id && <div className="ml-auto w-1.5 h-1.5 bg-indigo-600 rounded-full" />}
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

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        {/* Header */}
        <header className="h-16 bg-white border-bottom border-black/5 px-8 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-4">
            <button onClick={() => setSidebarOpen(!sidebarOpen)} className="p-2 hover:bg-zinc-100 rounded-lg transition-all">
              <Menu className="w-5 h-5 text-zinc-500" />
            </button>
            <h2 className="text-lg font-bold text-zinc-900 capitalize">{currentPage.replace('-', ' ')}</h2>
          </div>
        </header>

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
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                      <h3 className="text-2xl font-bold text-zinc-900">Resumo Operacional</h3>
                      <p className="text-zinc-500 text-sm">Acompanhe o desempenho em tempo real</p>
                    </div>
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
                      title="Ranking Atual" 
                      value={`#${ranking.findIndex(r => r.id === currentUser.id) + 1 || '-'}`} 
                      icon={Trophy} 
                      color="bg-purple-500"
                      action={
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
                      }
                    />
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-white p-4 rounded-2xl border border-black/5 shadow-sm">
                      <p className="text-[10px] font-bold text-zinc-400 uppercase mb-1">Aguardando</p>
                      <p className="text-xl font-black text-zinc-600">{stats.statusCounts[SaleStatus.AGUARDANDO]}</p>
                    </div>
                    <div className="bg-white p-4 rounded-2xl border border-black/5 shadow-sm">
                      <p className="text-[10px] font-bold text-amber-400 uppercase mb-1">Pendente</p>
                      <p className="text-xl font-black text-amber-600">{stats.statusCounts[SaleStatus.PENDENTE]}</p>
                    </div>
                    <div className="bg-white p-4 rounded-2xl border border-black/5 shadow-sm">
                      <p className="text-[10px] font-bold text-emerald-400 uppercase mb-1">Pago</p>
                      <p className="text-xl font-black text-emerald-600">{stats.statusCounts[SaleStatus.PAGO]}</p>
                    </div>
                    <div className="bg-white p-4 rounded-2xl border border-black/5 shadow-sm">
                      <p className="text-[10px] font-bold text-red-400 uppercase mb-1">Cancelado</p>
                      <p className="text-xl font-black text-red-600">{stats.statusCounts[SaleStatus.CANCELADO]}</p>
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

                      {currentUser.role === UserRole.ADMIN && adminGoalTracking.length > 0 && (
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
                                <th className="px-6 py-4 font-semibold">Cliente</th>
                                <th className="px-6 py-4 font-semibold">Serviço</th>
                                <th className="px-6 py-4 font-semibold">Valor</th>
                                <th className="px-6 py-4 font-semibold">Status</th>
                              </tr>
                            </thead>
                      <tbody className="divide-y divide-black/5">
                              {mySales.slice(0, 5).map((sale) => (
                                <tr key={sale.id} className="hover:bg-zinc-50 transition-all">
                                  <td className="px-6 py-4">
                                    <p className="font-bold text-zinc-900">{sale.name || 'Cliente'}</p>
                                    <p className="text-xs text-zinc-500">{sale.phone}</p>
                                    <p className="text-[10px] text-zinc-400">Criado em: {new Date(sale.created_at).toLocaleDateString()}</p>
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
                                      sale.status === SaleStatus.EXCLUSAO_SOLICITADA ? 'bg-zinc-800 text-zinc-100' :
                                      'bg-zinc-100 text-zinc-600'
                                    }`}>
                                      {sale.status === SaleStatus.EXCLUSAO_SOLICITADA ? 'AGUARDANDO EXCLUSÃO' : sale.status}
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

              {currentPage === 'new-lead' && (
                <div className="max-w-2xl mx-auto">
                  <div className="bg-white p-8 rounded-3xl shadow-sm border border-black/5">
                    <h3 className="text-2xl font-bold text-zinc-900 mb-8">Cadastrar Novo Lead</h3>
                    <form onSubmit={(e) => {
                      e.preventDefault();
                      const formData = new FormData(e.currentTarget);
                      handleAddLead({
                        phone: formData.get('phone'),
                        service: formData.get('service'),
                        value: Number(formData.get('value')),
                        created_at: formData.get('date') ? new Date(`${formData.get('date')}T12:00:00`).toISOString() : new Date().toISOString(),
                        status: SaleStatus.AGUARDANDO
                      });
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
                        <div className="space-y-2">
                          <label className="text-sm font-semibold text-zinc-700">Serviço</label>
                          <select name="service" required className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-indigo-500/20 outline-none">
                            {SERVICES.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-semibold text-zinc-700">Valor da Venda (R$)</label>
                          <input name="value" type="number" step="0.01" required className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-indigo-500/20 outline-none" placeholder="0.00" />
                        </div>
                      </div>
                      <button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 rounded-xl transition-all shadow-lg shadow-indigo-100">
                        Salvar Lead
                      </button>
                    </form>
                  </div>
                </div>
              )}

              {currentPage === 'sales' && (
                <div className="bg-white rounded-3xl shadow-sm border border-black/5 overflow-hidden">
                    <div className="p-6 border-b border-black/5 flex flex-col gap-4">
                      <div className="flex justify-between items-center">
                        <h3 className="font-bold text-zinc-900">Listagem de Vendas</h3>
                        <div className="flex gap-2">
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
                          <button className="px-4 py-2 bg-indigo-600 rounded-xl text-sm font-semibold text-white hover:bg-indigo-700 transition-all">Exportar</button>
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
                                    {users.filter(u => u.role === UserRole.VENDEDOR).map(u => (
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
                                  {Object.values(SaleStatus).map(s => (
                                    <option key={s} value={s}>{s}</option>
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
                        {mySales.map((sale) => (
                          <tr key={sale.id} className="hover:bg-zinc-50 transition-all">
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
                                <select 
                                  value={sale.status}
                                  onChange={(e) => handleUpdateStatus(sale.id, e.target.value as SaleStatus)}
                                  disabled={(sale.status === SaleStatus.EXCLUSAO_SOLICITADA && currentUser.role !== UserRole.ADMIN) || sale.transfer_to !== undefined && sale.transfer_to !== null}
                                  className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase outline-none cursor-pointer w-fit ${
                                    sale.status === SaleStatus.PAGO ? 'bg-emerald-100 text-emerald-600' :
                                    sale.status === SaleStatus.PENDENTE ? 'bg-amber-100 text-amber-600' :
                                    sale.status === SaleStatus.CANCELADO ? 'bg-red-100 text-red-600' :
                                    sale.status === SaleStatus.EXCLUSAO_SOLICITADA ? 'bg-zinc-800 text-zinc-100' :
                                    'bg-zinc-100 text-zinc-600'
                                  }`}
                                >
                                  {Object.values(SaleStatus).map(s => <option key={s} value={s}>{s === SaleStatus.EXCLUSAO_SOLICITADA ? 'AGUARDANDO EXCLUSÃO' : s}</option>)}
                                </select>
                                {sale.transfer_to && sale.transfer_to !== currentUser?.id && (
                                  <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full w-fit">
                                    Aguardando aceite
                                  </span>
                                )}
                                {sale.transfer_to === currentUser?.id && (
                                  <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full w-fit">
                                    Transferência recebida
                                  </span>
                                )}
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
                                {sale.transfer_to === currentUser?.id ? (
                                  <>
                                    <button onClick={() => handleAcceptTransfer(sale)} className="p-2 hover:bg-emerald-50 text-emerald-600 rounded-lg transition-all" title="Aceitar Transferência">
                                      <CheckCircle className="w-4 h-4" />
                                    </button>
                                    <button onClick={() => handleRejectTransfer(sale)} className="p-2 hover:bg-red-50 text-red-600 rounded-lg transition-all" title="Recusar Transferência">
                                      <XCircle className="w-4 h-4" />
                                    </button>
                                  </>
                                ) : sale.transfer_to ? (
                                  <button onClick={() => handleCancelTransfer(sale)} className="p-2 hover:bg-zinc-100 text-zinc-500 rounded-lg transition-all" title="Cancelar Transferência">
                                    <X className="w-4 h-4" />
                                  </button>
                                ) : (
                                  <>
                                    <button onClick={() => setEditingSale(sale)} className="p-2 hover:bg-zinc-100 text-zinc-500 rounded-lg transition-all" title="Editar">
                                      <Edit2 className="w-4 h-4" />
                                    </button>
                                    <button onClick={() => setTransferringSale(sale)} className="p-2 hover:bg-blue-50 text-blue-600 rounded-lg transition-all" title="Transferir Lead">
                                      <ArrowRightLeft className="w-4 h-4" />
                                    </button>
                                    {sale.status === SaleStatus.EXCLUSAO_SOLICITADA && currentUser.role === UserRole.ADMIN && (
                                      <>
                                        <button 
                                          onClick={() => setDeletingSaleId(sale.id)}
                                          className="p-2 hover:bg-emerald-50 text-emerald-600 rounded-lg transition-all"
                                          title="Aprovar Exclusão"
                                        >
                                          <CheckCircle className="w-4 h-4" />
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
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {currentPage === 'receipts' && (
                <div className="bg-white rounded-3xl shadow-sm border border-black/5 overflow-hidden">
                  <div className="p-6 border-b border-black/5">
                    <h3 className="font-bold text-zinc-900">Gestão de Comprovantes</h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead className="bg-zinc-50 text-zinc-500 text-xs uppercase tracking-wider">
                        <tr>
                          <th className="px-6 py-4 font-semibold">Data Envio</th>
                          <th className="px-6 py-4 font-semibold">Vendedor</th>
                          <th className="px-6 py-4 font-semibold">Arquivo</th>
                          <th className="px-6 py-4 font-semibold">Valor</th>
                          <th className="px-6 py-4 font-semibold">Status</th>
                          {currentUser.role === UserRole.ADMIN && <th className="px-6 py-4 font-semibold">Ações</th>}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-black/5">
                        {receipts.filter(r => currentUser.role === UserRole.ADMIN || r.vendedor_id === currentUser.id).map((receipt) => (
                          <tr key={receipt.id} className="hover:bg-zinc-50 transition-all">
                            <td className="px-6 py-4 text-sm text-zinc-500">{new Date(receipt.created_at).toLocaleDateString()}</td>
                            <td className="px-6 py-4 text-sm font-medium text-zinc-900">{users.find(u => u.id === receipt.vendedor_id)?.name}</td>
                            <td className="px-6 py-4 text-sm text-indigo-600 font-medium">
                              <button 
                                onClick={() => handleViewReceipt(receipt.file_path)} 
                                className="hover:underline flex items-center gap-1 text-indigo-600 font-medium"
                              >
                                {receipt.file_name}
                                <ChevronRight className="w-3 h-3" />
                              </button>
                            </td>
                            <td className="px-6 py-4 font-bold text-zinc-900">R$ {receipt.value.toLocaleString()}</td>
                            <td className="px-6 py-4">
                              {currentUser.role === UserRole.ADMIN ? (
                                <select 
                                  value={receipt.status}
                                  onChange={(e) => handleUpdateReceiptStatus(receipt.id, e.target.value as ReceiptStatus)}
                                  className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase outline-none cursor-pointer ${
                                    receipt.status === ReceiptStatus.PAGO ? 'bg-emerald-100 text-emerald-600' :
                                    receipt.status === ReceiptStatus.CONFERIDO ? 'bg-indigo-100 text-indigo-600' :
                                    'bg-amber-100 text-amber-600'
                                  }`}
                                >
                                  {Object.values(ReceiptStatus).map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                              ) : (
                                <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase ${
                                  receipt.status === ReceiptStatus.PAGO ? 'bg-emerald-100 text-emerald-600' :
                                  receipt.status === ReceiptStatus.CONFERIDO ? 'bg-indigo-100 text-indigo-600' :
                                  'bg-amber-100 text-amber-600'
                                }`}>
                                  {receipt.status}
                                </span>
                              )}
                            </td>
                            {currentUser.role === UserRole.ADMIN && (
                              <td className="px-6 py-4">
                                <button 
                                  onClick={() => handleViewReceipt(receipt.file_path)}
                                  className="text-xs font-bold text-indigo-600 hover:underline"
                                >
                                  Ver Arquivo
                                </button>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {currentPage === 'users' && currentUser.role === UserRole.ADMIN && (
                <div className="space-y-6">
                  <div className="flex justify-between items-center">
                    <h3 className="text-2xl font-bold text-zinc-900">Gestão de Equipe</h3>
                    <button 
                      onClick={() => setShowUserModal(true)}
                      className="bg-indigo-600 text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100"
                    >
                      <PlusCircle className="w-5 h-5" />
                      Novo Usuário
                    </button>
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
                        <div className="flex gap-2 pt-2">
                          <button 
                            onClick={() => setEditingSeller(user)}
                            className="flex-1 py-2 bg-zinc-100 rounded-xl text-xs font-bold text-zinc-600 hover:bg-zinc-200 transition-all"
                          >
                            Editar Perfil
                          </button>
                          {user.id !== currentUser.id && (
                            <button 
                              onClick={() => {
                                const newStatus = user.status === 'ATIVO' ? 'INATIVO' : 'ATIVO';
                                handleUpdateUser(user.id, { status: newStatus });
                              }}
                              className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all ${user.status === 'ATIVO' ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'}`}
                            >
                              {user.status === 'ATIVO' ? 'Desativar' : 'Ativar'}
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {currentPage === 'logs' && currentUser.role === UserRole.ADMIN && (
                <div className="bg-white rounded-3xl shadow-sm border border-black/5 overflow-hidden">
                  <div className="p-6 border-b border-black/5">
                    <h3 className="font-bold text-zinc-900">Logs de Auditoria</h3>
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

              {currentPage === 'financial' && currentUser.role === UserRole.ADMIN && (
                <div className="space-y-8">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-center gap-2 bg-white p-1 rounded-xl shadow-sm border border-black/5">
                      <button
                        onClick={() => setFinanceiroTab('pendentes')}
                        className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${financeiroTab === 'pendentes' ? 'bg-indigo-50 text-indigo-600' : 'text-zinc-500 hover:bg-zinc-50'}`}
                      >
                        Pendentes
                      </button>
                      <button
                        onClick={() => setFinanceiroTab('historico')}
                        className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${financeiroTab === 'historico' ? 'bg-indigo-50 text-indigo-600' : 'text-zinc-500 hover:bg-zinc-50'}`}
                      >
                        Histórico
                      </button>
                    </div>
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
                    <StatCard title="Total Vendido (Período)" value={`R$ ${sales.filter(s => s.status === SaleStatus.PAGO && (!dateRange.start || toLocalDateString(s.paid_at || '') >= dateRange.start) && (!dateRange.end || toLocalDateString(s.paid_at || '') <= dateRange.end)).reduce((acc, s) => acc + s.value, 0).toLocaleString()}`} icon={PieChart} color="bg-indigo-600" />
                    <StatCard title="Comissões a Pagar (Período)" value={`R$ ${(sales.filter(s => s.status === SaleStatus.PAGO && !s.commission_paid && (!dateRange.start || toLocalDateString(s.paid_at || '') >= dateRange.start) && (!dateRange.end || toLocalDateString(s.paid_at || '') <= dateRange.end)).reduce((acc, s) => {
                      const v = users.find(u => u.id === s.vendedor_id);
                      return acc + calculateCommission(s, v);
                    }, 0) || 0).toLocaleString()}`} icon={DollarSign} color="bg-amber-500" />
                    <StatCard title="Total Pago (Período)" value={`R$ ${payments.filter(p => (!dateRange.start || toLocalDateString(p.created_at) >= dateRange.start) && (!dateRange.end || toLocalDateString(p.created_at) <= dateRange.end)).reduce((acc, p) => acc + p.amount, 0).toLocaleString()}`} icon={CheckCircle} color="bg-emerald-500" />
                  </div>

                  <div className="bg-white rounded-3xl shadow-sm border border-black/5 overflow-hidden">
                    <div className="p-6 border-b border-black/5">
                      <h3 className="font-bold text-zinc-900">
                        {financeiroTab === 'pendentes' ? 'Controle de Comissões Pendentes' : 'Histórico de Pagamentos'}
                      </h3>
                    </div>
                    <div className="overflow-x-auto">
                      {financeiroTab === 'pendentes' ? (
                        <table className="w-full text-left">
                          <thead className="bg-zinc-50 text-zinc-500 text-xs uppercase tracking-wider">
                            <tr>
                              <th className="px-6 py-4 font-semibold">Vendedor</th>
                              <th className="px-6 py-4 font-semibold">Total Vendido</th>
                              <th className="px-6 py-4 font-semibold">Valor Comissão</th>
                              <th className="px-6 py-4 font-semibold">Ações</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-black/5">
                            {users.filter(u => u.role === UserRole.VENDEDOR).map(user => {
                              const sellerSales = sales.filter(s => s.vendedor_id === user.id && s.status === SaleStatus.PAGO && !s.commission_paid && (!dateRange.start || toLocalDateString(s.paid_at || '') >= dateRange.start) && (!dateRange.end || toLocalDateString(s.paid_at || '') <= dateRange.end));
                              const total = sellerSales.reduce((acc, s) => acc + s.value, 0);
                              const commissionVal = sellerSales.reduce((acc, s) => acc + calculateCommission(s, user), 0);
                              
                              if (sellerSales.length === 0) return null;
                              
                              return (
                                <tr key={user.id} className="hover:bg-zinc-50 transition-all">
                                  <td className="px-6 py-4 font-bold text-zinc-900">{user.name}</td>
                                  <td className="px-6 py-4 text-sm text-zinc-600">R$ {total.toLocaleString()}</td>
                                  <td className="px-6 py-4 font-bold text-emerald-600">R$ {commissionVal.toLocaleString()}</td>
                                  <td className="px-6 py-4">
                                    <button 
                                      onClick={() => {
                                        setPayingSeller(user);
                                        setSelectedSalesToPay(sellerSales.map(s => s.id));
                                        setPaymentReceipt(null);
                                      }}
                                      disabled={commissionVal === 0}
                                      className="text-xs font-bold text-indigo-600 hover:underline disabled:opacity-50 disabled:hover:no-underline"
                                    >
                                      Pagar Selecionadas
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      ) : (
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
                            {payments.filter(p => (!dateRange.start || toLocalDateString(p.created_at) >= dateRange.start) && (!dateRange.end || toLocalDateString(p.created_at) <= dateRange.end)).map(payment => {
                              const seller = users.find(u => u.id === payment.vendedor_id);
                              return (
                                <tr key={payment.id} className="hover:bg-zinc-50 transition-all">
                                  <td className="px-6 py-4 text-sm text-zinc-600">{new Date(payment.created_at).toLocaleString()}</td>
                                  <td className="px-6 py-4 font-bold text-zinc-900">{seller?.name || 'Vendedor Removido'}</td>
                                  <td className="px-6 py-4 font-bold text-emerald-600">R$ {payment.amount.toLocaleString()}</td>
                                  <td className="px-6 py-4">
                                    {payment.receipt_url ? (
                                      <a href={payment.receipt_url} target="_blank" rel="noopener noreferrer" className="text-xs font-bold text-indigo-600 hover:underline flex items-center gap-1">
                                        <FileText className="w-4 h-4" /> Ver Comprovante
                                      </a>
                                    ) : (
                                      <span className="text-xs text-zinc-400">Sem comprovante</span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )}
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
                    </table>
                  </div>
                </div>
              )}
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
              <h3 className="text-xl font-bold text-zinc-900 mb-2">Comprovante Necessário</h3>
              <p className="text-zinc-500 mb-6 text-sm">Para marcar esta venda como PAGA, você precisa anexar o comprovante de pagamento.</p>
              
              <div className="mb-8">
                <div className="relative border-2 border-dashed border-zinc-200 rounded-2xl p-8 hover:border-indigo-500 transition-colors bg-zinc-50">
                  <input 
                    type="file" 
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20"
                    accept="image/*,.pdf"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        setSalePendingReceipt(null);
                        await handleUploadReceipt(salePendingReceipt.id, file);
                        await handleUpdateStatus(salePendingReceipt.id, SaleStatus.PAGO, true);
                      }
                    }}
                  />
                  <Upload className="w-8 h-8 text-zinc-400 mx-auto mb-3" />
                  <p className="text-sm font-semibold text-zinc-700">Clique ou arraste o comprovante aqui</p>
                  <p className="text-xs text-zinc-500 mt-1">Imagens ou PDF (máx. 5MB)</p>
                </div>
              </div>

              <div className="flex gap-3">
                <button 
                  onClick={() => setSalePendingReceipt(null)}
                  className="w-full px-6 py-3 rounded-xl font-bold text-zinc-500 hover:bg-zinc-100 transition-all"
                >
                  Cancelar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Transfer Modal */}
      <AnimatePresence>
        {transferringSale && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white w-full max-w-md rounded-3xl shadow-2xl p-8"
            >
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-bold text-zinc-900">Transferir Lead</h3>
                <button onClick={() => { setTransferringSale(null); setTransferTargetId(''); }} className="p-2 hover:bg-zinc-100 rounded-full transition-all">
                  <X className="w-5 h-5 text-zinc-500" />
                </button>
              </div>
              <form onSubmit={handleInitiateTransfer} className="space-y-6">
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-zinc-700">Selecione o Vendedor</label>
                  <select 
                    required
                    value={transferTargetId}
                    onChange={(e) => setTransferTargetId(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-indigo-500/20 outline-none"
                  >
                    <option value="">Selecione...</option>
                    {users.filter(u => u.id !== currentUser.id && (u.role === UserRole.VENDEDOR || u.role === UserRole.ADMIN)).map(u => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-3 pt-4">
                  <button 
                    type="button" 
                    onClick={() => { setTransferringSale(null); setTransferTargetId(''); }}
                    className="flex-1 px-4 py-3 rounded-xl font-bold text-zinc-600 bg-zinc-100 hover:bg-zinc-200 transition-all"
                  >
                    Cancelar
                  </button>
                  <button 
                    type="submit" 
                    disabled={isSubmitting || !transferTargetId}
                    className="flex-1 px-4 py-3 rounded-xl font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {isSubmitting ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                        Transferindo...
                      </>
                    ) : 'Transferir'}
                  </button>
                </div>
              </form>
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
                {currentUser?.role === UserRole.ADMIN 
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
                        {Object.values(SaleStatus).map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
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
                  commissions,
                  pix_key: formData.get('pix_key') as string
                });
                setEditingSeller(null);
              }} className="p-8 space-y-6 max-h-[80vh] overflow-y-auto">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-zinc-700">Meta Diária (R$)</label>
                    <input name="daily_goal" type="number" defaultValue={editingSeller.daily_goal || 0} required className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-indigo-500/20 outline-none" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-zinc-700">Comissão Padrão (%)</label>
                    <input name="commission" type="number" defaultValue={editingSeller.commission || 0} required className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-indigo-500/20 outline-none" />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <label className="text-sm font-semibold text-zinc-700">Chave PIX</label>
                    <input name="pix_key" type="text" defaultValue={editingSeller.pix_key || ''} className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-indigo-500/20 outline-none" placeholder="E-mail, CPF, Telefone ou Chave Aleatória" />
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
                          <p className="text-sm font-bold text-zinc-900">{sale.name || 'Cliente'}</p>
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
                            alert('Chave PIX copiada!');
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
    </div>
  );
}
