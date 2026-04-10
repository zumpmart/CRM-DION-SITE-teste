export enum UserRole {
  ADMIN = "ADMIN",
  SUPERVISOR = "SUPERVISOR",
  VENDEDOR = "VENDEDOR",
}

export enum SaleStatus {
  AGUARDANDO = "AGUARDANDO",
  PENDENTE = "PENDENTE",
  REMARKETING = "REMARKETING",
  PAGO = "PAGO",
  CANCELADO = "CANCELADO",
  ARQUIVADO = "ARQUIVADO",
  EXCLUSAO_SOLICITADA = "EXCLUSAO_SOLICITADA",
  DELETED = "DELETED",
}

export enum ReceiptStatus {
  ENVIADO = "ENVIADO",
  AUDITADO_APROVADO = "AUDITADO_APROVADO",
  AUDITADO_DIVERGENTE = "AUDITADO_DIVERGENTE",
  DUPLICADO = "DUPLICADO",
  REJEITADO = "REJEITADO",
  PAGO = "PAGO",
}

export enum SaleType {
  PONTUAL = "PONTUAL",
  RECORRENTE = "RECORRENTE",
}

export enum ContractStatus {
  PENDENTE = "PENDENTE",
  ATIVO = "ATIVO",
  PAUSADO = "PAUSADO",
  CANCELADO = "CANCELADO",
  INADIMPLENTE = "INADIMPLENTE",
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email?: string;
  first_purchase_date: string;
  total_spent: number;
  total_purchases: number;
  services: string[];
  created_at: string;
  updated_at: string;
}

export interface UserProfile {
  id: string;
  name: string;
  username: string;
  role: UserRole;
  daily_goal: number;
  commission: number;
  commissions?: Record<string, number>;
  recurring_commission?: number;
  pix_key?: string;
  photo_url?: string;
  status: "ATIVO" | "INATIVO";
  created_at: string;
  last_login_at?: string;
}

export interface Sale {
  id: string;
  name?: string;
  phone: string;
  service: string;
  services?: string[];
  value: number;
  status: SaleStatus;
  previous_status?: SaleStatus;
  vendedor_id: string;
  customer_id?: string;
  is_returning_customer?: boolean;
  sale_type?: SaleType;
  // Recurring contract fields
  billing_cycle?: 'mensal' | 'trimestral' | 'semestral' | 'anual';
  contract_start?: string;
  contract_end?: string;
  next_billing_date?: string;
  contract_status?: ContractStatus;
  last_payment_date?: string;
  parent_contract_id?: string;
  billing_period?: string;
  transfer_to?: string | null;
  return_date?: string;
  created_at: string;
  updated_at: string;
  paid_at?: string;
  commission_paid?: boolean;
  receipt_id?: string;
  receipt_rejected?: boolean;
  receipt_rejection_reason?: string;
  deleted_at?: string;
  deleted_by?: string;
  notes?: string;
}

export interface Receipt {
  id: string;
  sale_id: string;
  vendedor_id: string;
  file_name: string;
  file_path: string;
  status: ReceiptStatus;
  value: number;
  confirmed_value?: number;
  ocr_value?: number | null;
  ocr_date?: string | null;
  ocr_raw_text?: string;
  audit_status?: 'approved' | 'divergent' | 'duplicate' | 'error' | 'pending';
  audit_details?: string;
  image_hash?: string;
  audited_at?: string;
  paid_date?: string;
  created_at: string;
}

export interface AuditLog {
  id: string;
  user_id: string;
  user_name: string;
  action: string;
  target_id?: string;
  created_at: string;
}

export interface Payment {
  id: string;
  vendedor_id: string;
  amount: number;
  status: string;
  admin_id: string;
  created_at: string;
  receipt_url?: string;
  sales_ids?: string[];
}
