'use client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { blankLine, EditLine, LineEditor, StatusBadge, toApiLines, Totals } from '@/components/LineEditor';
import { api, Bill, day, isoDay, money, qty } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useSalesData } from '@/lib/useSalesData';

const METHODS = [
  { value: 'CASH', label: 'Cash' },
  { value: 'BANK', label: 'Bank transfer' },
  { value: 'CARD', label: 'Card' },
  { value: 'CHEQUE', label: 'Cheque' },
  { value: 'OTHER', label: 'Other' },
];

export default function BillPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { tenant } = useSession();
  const { customers: vendors, products, taxes } = useSalesData();
  const isNew = id === 'new';
  const [inv, setInv] = useState<Bill>();
  const [vendorId, setVendorId] = useState('');
  const [vendorRef, setVendorRef] = useState('');
  const [billDate, setBillDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<EditLine[]>([blankLine()]);
  const [pay, setPay] = useState({ amount: '', method: 'CASH', reference: '', paymentDate: new Date().toISOString().slice(0, 10) });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const show = useCallback((i: Bill) => {
    setInv(i);
    setVendorId(i.vendorId);
    setVendorRef(i.vendorRef ?? '');
    setBillDate(isoDay(i.billDate));
    setDueDate(isoDay(i.dueDate));
    setNotes(i.notes ?? '');
    setLines((i.lines ?? []).map((l) => ({ productId: l.productId, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, discountPct: l.discountPct, taxId: l.taxId ?? '' })));
    setPay((p) => ({ ...p, amount: (Number(i.total) - Number(i.amountPaid)).toFixed(2) }));
  }, []);

  useEffect(() => {
    if (!isNew) api<Bill>(`/bills/${id}`).then(show).catch((e) => setError(e.message));
  }, [id, isNew, show]);

  async function run(fn: () => Promise<void>) {
    setError('');
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const fromOrder = !!inv?.orderId;
  const editable = isNew || inv?.status === 'DRAFT';
  const linesEditable = isNew || (inv?.status === 'DRAFT' && !fromOrder);

  function body() {
    const b: Record<string, unknown> = { billDate, vendorRef: vendorRef || null, dueDate: dueDate || null, notes: notes || null };
    if (linesEditable) {
      b.vendorId = vendorId;
      b.lines = toApiLines(lines);
    }
    return b;
  }

  async function save(e?: FormEvent) {
    e?.preventDefault();
    await run(async () => {
      if (isNew) {
        const i = await api<Bill>('/bills', { method: 'POST', body: body() });
        router.replace(`/app/bills/${i.id}`);
      } else {
        show(await api<Bill>(`/bills/${id}`, { method: 'PATCH', body: body() }));
      }
    });
  }

  const postIt = () =>
    run(async () => {
      await api(`/bills/${id}`, { method: 'PATCH', body: body() });
      show(await api<Bill>(`/bills/${id}/post`, { method: 'POST', body: {} }));
    });
  const cancel = () => run(async () => show(await api<Bill>(`/bills/${id}/cancel`, { method: 'POST', body: {} })));

  async function recordPayment(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      show(await api<Bill>(`/bills/${id}/payments`, {
        method: 'POST',
        body: { amount: Number(pay.amount), method: pay.method, paymentDate: pay.paymentDate, reference: pay.reference || undefined },
      }));
      setPay((p) => ({ ...p, reference: '' }));
    });
  }

  return (
    <>
      <p><Link href="/app/bills">← Vendor bills</Link></p>
      <section className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>{isNew ? 'New bill' : inv?.number ?? 'Draft bill'} {inv && <StatusBadge status={inv.status} purchase />}</h2>
          {inv && (
            <div className="actions">
              {inv.status === 'DRAFT' && <button disabled={busy} onClick={postIt}>Post bill</button>}
              <a className="button secondary-link" href={`/print/bills/${inv.id}`} target="_blank" rel="noreferrer">Print</a>
              {inv.status !== 'CANCELLED' && Number(inv.amountPaid) === 0 && <button disabled={busy} className="secondary" onClick={cancel}>Cancel</button>}
            </div>
          )}
        </div>
        {inv?.order && <p className="muted">From purchase order <Link href={`/app/purchases/${inv.order.id}`}>{inv.order.number}</Link></p>}
        {error && <p className="error">{error}</p>}

        {editable ? (
          <form onSubmit={save}>
            <div className="row">
              <div style={{ flex: 2 }}>
                <label>Vendor</label>
                <select required disabled={!linesEditable} value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
                  <option value="">Choose…</option>
                  {vendors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div><label>Vendor's invoice no.</label><input value={vendorRef} onChange={(e) => setVendorRef(e.target.value)} /></div>
              <div><label>Bill date</label><input type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} /></div>
              <div><label>Due date</label><input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
            </div>
            <h3>Lines</h3>
            {linesEditable ? (
              <LineEditor lines={lines} onChange={setLines} products={products} taxes={taxes} currency={tenant.currency} priceField="cost" />
            ) : (
              inv && <ReadOnlyLines inv={inv} />
            )}
            <label>Notes</label>
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            <button disabled={busy}>{isNew ? 'Create draft' : 'Save draft'}</button>
          </form>
        ) : (
          inv && (
            <>
              <p><strong>{inv.vendor.name}</strong> · {day(inv.billDate)}{inv.vendorRef && ` · vendor invoice ${inv.vendorRef}`}{inv.dueDate && ` · due ${day(inv.dueDate)}`}</p>
              <ReadOnlyLines inv={inv} />
              {inv.notes && <p className="muted">{inv.notes}</p>}
            </>
          )
        )}
      </section>

      {inv && (inv.status === 'POSTED' || inv.status === 'PAID') && (
        <section className="card" style={{ marginTop: 16 }}>
          <h3>Payments</h3>
          {inv.payments && inv.payments.length > 0 ? (
            <table>
              <thead><tr><th>Date</th><th>Method</th><th>Reference</th><th className="num">Amount</th></tr></thead>
              <tbody>
                {inv.payments.map((p) => (
                  <tr key={p.id}><td>{day(p.paymentDate)}</td><td>{METHODS.find((m) => m.value === p.method)?.label ?? p.method}</td><td>{p.reference}</td><td className="num">{money(p.amount)}</td></tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">No payments yet.</p>
          )}
          {inv.status === 'POSTED' && (
            <form onSubmit={recordPayment} className="row">
              <div><label>Amount</label><input required type="number" min={0.01} step="0.01" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></div>
              <div>
                <label>Method</label>
                <select value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>
                  {METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
              <div><label>Date</label><input type="date" value={pay.paymentDate} onChange={(e) => setPay({ ...pay, paymentDate: e.target.value })} /></div>
              <div><label>Reference</label><input value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} /></div>
              <button disabled={busy}>Record payment</button>
            </form>
          )}
        </section>
      )}
    </>
  );
}

function ReadOnlyLines({ inv }: { inv: Bill }) {
  return (
    <>
      <table>
        <thead>
          <tr><th>Description</th><th className="num">Qty</th><th className="num">Unit price</th><th className="num">Disc.</th><th className="num">Tax</th><th className="num">Amount</th></tr>
        </thead>
        <tbody>
          {inv.lines?.map((l) => (
            <tr key={l.id}>
              <td>{l.description}</td>
              <td className="num">{qty(l.quantity)} {l.product.unit.code}</td>
              <td className="num">{money(l.unitPrice)}</td>
              <td className="num">{Number(l.discountPct) ? `${Number(l.discountPct)}%` : ''}</td>
              <td className="num">{Number(l.taxRate) ? `${Number(l.taxRate)}%` : ''}</td>
              <td className="num">{money(l.subtotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Totals subtotal={inv.subtotal} tax={inv.taxTotal} total={inv.total} currency={inv.currency} paid={inv.amountPaid} />
    </>
  );
}
