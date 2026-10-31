'use client';
import { money, Product, Tax } from '@/lib/api';

export interface EditLine {
  productId: string;
  description: string;
  quantity: string;
  unitPrice: string;
  discountPct: string;
  taxId: string;
}

export const blankLine = (): EditLine => ({ productId: '', description: '', quantity: '1', unitPrice: '', discountPct: '0', taxId: '' });

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Same arithmetic as the API (discount, then tax, each rounded); the API's figures are the ones saved. */
export function previewTotals(lines: EditLine[], taxes: Tax[]) {
  let subtotal = 0;
  let tax = 0;
  for (const l of lines) {
    const s = r2(Number(l.quantity || 0) * Number(l.unitPrice || 0) * (1 - Number(l.discountPct || 0) / 100));
    const rate = Number(taxes.find((t) => t.id === l.taxId)?.rate ?? 0);
    subtotal += s;
    tax += r2((s * rate) / 100);
  }
  return { subtotal: r2(subtotal), tax: r2(tax), total: r2(subtotal + tax) };
}

export const toApiLines = (lines: EditLine[]) =>
  lines
    .filter((l) => l.productId)
    .map((l) => ({
      productId: l.productId,
      description: l.description || undefined,
      quantity: Number(l.quantity),
      unitPrice: l.unitPrice === '' ? undefined : Number(l.unitPrice),
      discountPct: Number(l.discountPct || 0),
      taxId: l.taxId || null,
    }));

export function LineEditor({
  lines,
  onChange,
  products,
  taxes,
  currency,
}: {
  lines: EditLine[];
  onChange: (lines: EditLine[]) => void;
  products: Product[];
  taxes: Tax[];
  currency: string;
}) {
  const set = (i: number, patch: Partial<EditLine>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const pick = (i: number, productId: string) => {
    const p = products.find((x) => x.id === productId);
    set(i, { productId, description: p?.name ?? '', unitPrice: p?.salePrice ?? '', taxId: lines[i].taxId || taxes.find((t) => !t.archived)?.id || '' });
  };
  const t = previewTotals(lines, taxes);

  return (
    <div>
      <table className="lines">
        <thead>
          <tr>
            <th style={{ width: '22%' }}>Product</th>
            <th>Description</th>
            <th className="num" style={{ width: 90 }}>Qty</th>
            <th className="num" style={{ width: 110 }}>Unit price</th>
            <th className="num" style={{ width: 80 }}>Disc. %</th>
            <th style={{ width: 120 }}>Tax</th>
            <th style={{ width: 30 }}></th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td>
                <select value={l.productId} onChange={(e) => pick(i, e.target.value)}>
                  <option value="">Choose…</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.sku ? `[${p.sku}] ` : ''}{p.name}</option>)}
                </select>
              </td>
              <td><input value={l.description} onChange={(e) => set(i, { description: e.target.value })} /></td>
              <td><input className="num" type="number" min={0.001} step="0.001" value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value })} /></td>
              <td><input className="num" type="number" min={0} step="0.01" value={l.unitPrice} onChange={(e) => set(i, { unitPrice: e.target.value })} /></td>
              <td><input className="num" type="number" min={0} max={100} step="0.01" value={l.discountPct} onChange={(e) => set(i, { discountPct: e.target.value })} /></td>
              <td>
                <select value={l.taxId} onChange={(e) => set(i, { taxId: e.target.value })}>
                  <option value="">No tax</option>
                  {taxes.filter((x) => !x.archived || x.id === l.taxId).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              </td>
              <td><button type="button" className="link" title="Remove line" onClick={() => onChange(lines.filter((_, j) => j !== i))}>✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="secondary" onClick={() => onChange([...lines, blankLine()])}>Add line</button>
      <Totals subtotal={t.subtotal} tax={t.tax} total={t.total} currency={currency} />
    </div>
  );
}

export function Totals({ subtotal, tax, total, currency, paid }: { subtotal: string | number; tax: string | number; total: string | number; currency: string; paid?: string | number }) {
  return (
    <table className="totals">
      <tbody>
        <tr><td>Subtotal</td><td className="num">{money(subtotal)}</td></tr>
        <tr><td>Tax</td><td className="num">{money(tax)}</td></tr>
        <tr className="grand"><td>Total</td><td className="num">{money(total, currency)}</td></tr>
        {paid !== undefined && Number(paid) > 0 && (
          <>
            <tr><td>Paid</td><td className="num">{money(paid)}</td></tr>
            <tr className="grand"><td>Balance due</td><td className="num">{money(Number(total) - Number(paid), currency)}</td></tr>
          </>
        )}
      </tbody>
    </table>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const label: Record<string, string> = {
    QUOTATION: 'Quotation', CONFIRMED: 'Sales order', CANCELLED: 'Cancelled', DRAFT: 'Draft', POSTED: 'Posted', PAID: 'Paid',
  };
  return <span className={`badge ${status.toLowerCase()}`}>{label[status] ?? status}</span>;
}
