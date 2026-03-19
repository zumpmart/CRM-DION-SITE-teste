export enum UserRole {
  ADMIN = "ADMIN",
  GERENTE = "GERENTE",
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
  CONFERIDO = "CONFERIDO",
  PAGO = "PAGO",
}

export interface UserProfile {
  id: string;
  name: string;
  username: string;
  role: UserRole;
  daily_goal: number;
  commission: number;
  commissions?: Record<string, number>;
  pix_key?: string;
  photo_url?: string;
  status: "ATIVO" | "INATIVO";
  created_at: string;
}

export interface Sale {
  id: string;
  name?: string;
  phone: string;
  service: string;
  value: number;
  status: SaleStatus;
  previous_status?: SaleStatus;
  vendedor_id: string;
  transfer_to?: string | null;
  return_date?: string;
  created_at: string;
  updated_at: string;
  paid_at?: string;
  commission_paid?: boolean;
  receipt_id?: string; // Virtual field or joined
  deleted_at?: string;
  deleted_by?: string;
}

export interface Receipt {
  id: string;
  sale_id: string;
  vendedor_id: string;
  file_name: string;
  file_path: string;
  status: ReceiptStatus;
  value: number;
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
