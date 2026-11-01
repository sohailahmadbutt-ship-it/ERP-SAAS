import type { PlatformInvoice } from '@/lib/api';

export function InvoiceBadge({ inv }: { inv: PlatformInvoice }) {
  if (inv.status === 'OPEN' && inv.reportedAt) return <span className="badge reported">Payment reported</span>;
  return <span className={`badge ${inv.status.toLowerCase()}`}>{{ OPEN: 'Open', PAID: 'Paid', VOID: 'Void' }[inv.status]}</span>;
}
