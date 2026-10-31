export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
export const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'localhost';

/** The company subdomain the browser is on, e.g. "acme" for acme.localhost:3000. */
export function tenantSlug(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const host = window.location.hostname.toLowerCase();
  if (!host.endsWith(`.${ROOT_DOMAIN}`)) return undefined;
  const sub = host.slice(0, -(ROOT_DOMAIN.length + 1));
  return sub && !sub.includes('.') && sub !== 'www' ? sub : undefined;
}

/** URL of a page on a company's own subdomain, keeping the current port. */
export function tenantUrl(slug: string, path: string) {
  const { protocol, port } = window.location;
  return `${protocol}//${slug}.${ROOT_DOMAIN}${port ? `:${port}` : ''}${path}`;
}

const TOKEN_KEY = 'erp_token';
export const getToken = () => (typeof window === 'undefined' ? null : localStorage.getItem(TOKEN_KEY));
export const setToken = (t: string) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const slug = tenantSlug();
  if (slug) headers['X-Tenant'] = slug;
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_URL}${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = Array.isArray(data.message) ? data.message.join(', ') : data.message ?? res.statusText;
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER';
}
export interface Tenant {
  id: string;
  slug: string;
  name: string;
  plan: string;
  currency: string;
  taxId: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
}

export interface Contact {
  id: string;
  kind: 'COMPANY' | 'PERSON';
  name: string;
  parentId: string | null;
  parent?: { id: string; name: string } | null;
  children?: Contact[];
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  taxId: string | null;
  isCustomer: boolean;
  isVendor: boolean;
  creditLimit: string | null;
  notes: string | null;
  archived: boolean;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Unit {
  id: string;
  code: string;
  name: string;
}

export interface Warehouse {
  id: string;
  code: string;
  name: string;
  address: string | null;
  archived: boolean;
}

export interface Product {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  type: 'GOODS' | 'SERVICE';
  unitId: string;
  unit?: { code: string };
  salePrice: string;
  cost: string;
  description: string | null;
  archived: boolean;
  onHand?: string | null;
  stock?: { warehouse: { id: string; code: string; name: string }; quantity: string }[];
}

export interface StockMove {
  id: string;
  type: 'RECEIPT' | 'DELIVERY' | 'ADJUSTMENT' | 'TRANSFER_OUT' | 'TRANSFER_IN';
  quantity: string;
  reference: string | null;
  note: string | null;
  createdAt: string;
  product: { id: string; name: string; sku: string | null };
  warehouse: { id: string; code: string };
}

export interface StockLevel {
  product: { id: string; name: string; sku: string | null; unit: string };
  warehouse: { id: string; code: string; name: string };
  quantity: string;
}

export const MOVE_LABELS: Record<StockMove['type'], string> = {
  RECEIPT: 'Receipt',
  DELIVERY: 'Delivery',
  ADJUSTMENT: 'Count adjustment',
  TRANSFER_OUT: 'Transfer out',
  TRANSFER_IN: 'Transfer in',
};

export interface Tax {
  id: string;
  name: string;
  rate: string;
  archived: boolean;
}

export interface DocLine {
  id: string;
  position: number;
  productId: string;
  product: { id: string; name: string; sku: string | null; type?: 'GOODS' | 'SERVICE'; unit: { code: string } };
  description: string;
  quantity: string;
  unitPrice: string;
  discountPct: string;
  taxId: string | null;
  taxRate: string;
  subtotal: string;
  taxAmount: string;
  total: string;
  deliveredQty?: string;
  invoicedQty?: string;
}

export interface Party {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  taxId?: string | null;
}

export interface SalesOrder {
  id: string;
  number: string;
  status: 'QUOTATION' | 'CONFIRMED' | 'CANCELLED';
  customerId: string;
  customer: Party;
  warehouseId: string;
  warehouse?: { id: string; code: string; name: string };
  orderDate: string;
  validUntil: string | null;
  currency: string;
  notes: string | null;
  subtotal: string;
  taxTotal: string;
  total: string;
  lines?: DocLine[];
  invoices?: { id: string; number: string | null; status: Invoice['status']; total: string; amountPaid: string }[];
}

export interface Payment {
  id: string;
  paymentDate: string;
  amount: string;
  method: string;
  reference: string | null;
}

export interface Invoice {
  id: string;
  number: string | null;
  status: 'DRAFT' | 'POSTED' | 'PAID' | 'CANCELLED';
  customerId: string;
  customer: Party;
  order?: { id: string; number: string } | null;
  orderId: string | null;
  invoiceDate: string;
  dueDate: string | null;
  currency: string;
  notes: string | null;
  subtotal: string;
  taxTotal: string;
  total: string;
  amountPaid: string;
  lines?: DocLine[];
  payments?: Payment[];
}

export const money = (v: string | number, currency?: string) =>
  `${currency ? `${currency} ` : ''}${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const qty = (v: string | number) => Number(v).toLocaleString(undefined, { maximumFractionDigits: 3 });

export const day = (v: string | null | undefined) => (v ? new Date(v).toLocaleDateString() : '');

/** yyyy-mm-dd for <input type="date">. */
export const isoDay = (v: string | null | undefined) => (v ? v.slice(0, 10) : '');

export interface PurchaseOrder {
  id: string;
  number: string;
  status: 'RFQ' | 'CONFIRMED' | 'CANCELLED';
  vendorId: string;
  vendor: Party;
  warehouseId: string;
  warehouse?: { id: string; code: string; name: string };
  orderDate: string;
  expectedDate: string | null;
  vendorRef: string | null;
  currency: string;
  notes: string | null;
  subtotal: string;
  taxTotal: string;
  total: string;
  lines?: (DocLine & { receivedQty?: string; billedQty?: string })[];
  bills?: { id: string; number: string | null; status: Bill['status']; total: string; amountPaid: string }[];
}

export interface Bill {
  id: string;
  number: string | null;
  vendorRef: string | null;
  status: 'DRAFT' | 'POSTED' | 'PAID' | 'CANCELLED';
  vendorId: string;
  vendor: Party;
  order?: { id: string; number: string } | null;
  orderId: string | null;
  billDate: string;
  dueDate: string | null;
  currency: string;
  notes: string | null;
  subtotal: string;
  taxTotal: string;
  total: string;
  amountPaid: string;
  lines?: DocLine[];
  payments?: Payment[];
}

export interface Account {
  id: string;
  code: string;
  name: string;
  type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';
  systemKey: string | null;
  archived: boolean;
  balance?: string;
}

export interface JournalEntry {
  id: string;
  number: string;
  date: string;
  memo: string | null;
  source: string;
  reference: string | null;
  lines: {
    id: string;
    debit: string;
    credit: string;
    description: string | null;
    account: { id: string; code: string; name: string };
    contact: { id: string; name: string } | null;
  }[];
}

export const ACCOUNT_TYPE_LABELS: Record<Account['type'], string> = {
  ASSET: 'Assets',
  LIABILITY: 'Liabilities',
  EQUITY: 'Equity',
  INCOME: 'Income',
  EXPENSE: 'Expenses',
};
