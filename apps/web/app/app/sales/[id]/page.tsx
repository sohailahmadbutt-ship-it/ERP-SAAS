'use client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { blankLine, EditLine, LineEditor, StatusBadge, toApiLines, Totals } from '@/components/LineEditor';
import { api, day, Invoice, isoDay, money, qty, SalesOrder } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useSalesData } from '@/lib/useSalesData';

export default function SalesOrderPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { tenant } = useSession();
  const { customers, products, taxes, warehouses } = useSalesData();
  const isNew = id === 'new';
  const [order, setOrder] = useState<SalesOrder>();
  const [customerId, setCustomerId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10));
  const [validUntil, setValidUntil] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<EditLine[]>([blankLine()]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const show = useCallback((o: SalesOrder) => {
    setOrder(o);
    setCustomerId(o.customerId);
    setWarehouseId(o.warehouseId);
    setOrderDate(isoDay(o.orderDate));
    setValidUntil(isoDay(o.validUntil));
    setNotes(o.notes ?? '');
    setLines(
      (o.lines ?? []).map((l) => ({
        productId: l.productId, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, discountPct: l.discountPct, taxId: l.taxId ?? '',
      })),
    );
  }, []);

  useEffect(() => {
    if (!isNew) api<SalesOrder>(`/sales-orders/${id}`).then(show).catch((e) => setError(e.message));
  }, [id, isNew, show]);

  async function run<T>(fn: () => Promise<T>) {
    setError('');
    setBusy(true);
    try {
      return await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function save(e?: FormEvent) {
    e?.preventDefault();
    const body = {
      customerId,
      warehouseId: warehouseId || undefined,
      orderDate,
      validUntil: validUntil || null,
      notes: notes || null,
      lines: toApiLines(lines),
    };
    return run(async () => {
      if (isNew) {
        const o = await api<SalesOrder>('/sales-orders', { method: 'POST', body });
        router.replace(`/app/sales/${o.id}`);
      } else {
        show(await api<SalesOrder>(`/sales-orders/${id}`, { method: 'PATCH', body }));
      }
    });
  }

  const action = (path: string) => run(async () => show(await api<SalesOrder>(`/sales-orders/${id}/${path}`, { method: 'POST', body: {} })));

  async function confirm() {
    await run(async () => {
      await api(`/sales-orders/${id}`, { method: 'PATCH', body: { customerId, warehouseId, orderDate, validUntil: validUntil || null, notes: notes || null, lines: toApiLines(lines) } });
      show(await api<SalesOrder>(`/sales-orders/${id}/confirm`, { method: 'POST', body: {} }));
    });
  }

  async function invoice() {
    await run(async () => {
      const inv = await api<Invoice>(`/sales-orders/${id}/invoice`, { method: 'POST', body: {} });
      router.push(`/app/invoices/${inv.id}`);
    });
  }

  const editable = isNew || order?.status === 'QUOTATION';
  const outstandingDelivery = order?.lines?.some((l) => Number(l.deliveredQty) < Number(l.quantity));
  const outstandingInvoice = order?.lines?.some((l) => Number(l.invoicedQty) < Number(l.quantity));

  return (
    <>
      <p><Link href="/app/sales">← Sales</Link></p>
      <section className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>{isNew ? 'New quotation' : order?.number} {order && <StatusBadge status={order.status} />}</h2>
          {order && (
            <div className="actions">
              {order.status === 'QUOTATION' && <button disabled={busy} onClick={confirm}>Confirm order</button>}
              {order.status === 'CONFIRMED' && outstandingDelivery && <button disabled={busy} onClick={() => action('deliver')}>Deliver all</button>}
              {order.status === 'CONFIRMED' && outstandingInvoice && <button disabled={busy} onClick={invoice}>Create invoice</button>}
              <a className="button secondary-link" href={`/print/sales/${order.id}`} target="_blank" rel="noreferrer">Print</a>
              {order.status !== 'CANCELLED' && <button disabled={busy} className="secondary" onClick={() => action('cancel')}>Cancel</button>}
            </div>
          )}
        </div>
        {error && <p className="error">{error}</p>}

        {editable ? (
          <form onSubmit={save}>
            <div className="row">
              <div style={{ flex: 2 }}>
                <label>Customer</label>
                <select required value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                  <option value="">Choose…</option>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label>Ship from</label>
                <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
                  {isNew && <option value="">Default</option>}
                  {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
                </select>
              </div>
              <div><label>Date</label><input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} /></div>
              <div><label>Valid until</label><input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} /></div>
            </div>
            <h3>Lines</h3>
            <LineEditor lines={lines} onChange={setLines} products={products} taxes={taxes} currency={tenant.currency} />
            <label>Notes</label>
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            <button disabled={busy}>{isNew ? 'Create quotation' : 'Save'}</button>
          </form>
        ) : (
          order && (
            <>
              <p>
                <strong>{order.customer.name}</strong> · {day(order.orderDate)} · ships from {order.warehouse?.code}
              </p>
              <table>
                <thead>
                  <tr><th>Description</th><th className="num">Qty</th><th className="num">Delivered</th><th className="num">Invoiced</th><th className="num">Unit price</th><th className="num">Disc.</th><th className="num">Tax</th><th className="num">Amount</th></tr>
                </thead>
                <tbody>
                  {order.lines?.map((l) => (
                    <tr key={l.id}>
                      <td>{l.description}</td>
                      <td className="num">{qty(l.quantity)} {l.product.unit.code}</td>
                      <td className="num">{qty(l.deliveredQty ?? 0)}</td>
                      <td className="num">{qty(l.invoicedQty ?? 0)}</td>
                      <td className="num">{money(l.unitPrice)}</td>
                      <td className="num">{Number(l.discountPct) ? `${Number(l.discountPct)}%` : ''}</td>
                      <td className="num">{Number(l.taxRate) ? `${Number(l.taxRate)}%` : ''}</td>
                      <td className="num">{money(l.subtotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Totals subtotal={order.subtotal} tax={order.taxTotal} total={order.total} currency={order.currency} />
              {order.notes && <p className="muted">{order.notes}</p>}
            </>
          )
        )}
      </section>

      {order?.invoices && order.invoices.length > 0 && (
        <section className="card" style={{ marginTop: 16 }}>
          <h3>Invoices</h3>
          <table>
            <tbody>
              {order.invoices.map((i) => (
                <tr key={i.id}>
                  <td><Link href={`/app/invoices/${i.id}`}>{i.number ?? 'Draft'}</Link></td>
                  <td><StatusBadge status={i.status} /></td>
                  <td className="num">{money(i.total, order.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
