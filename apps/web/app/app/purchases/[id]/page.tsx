'use client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { blankLine, EditLine, LineEditor, StatusBadge, toApiLines, Totals } from '@/components/LineEditor';
import { api, Bill, day, isoDay, money, qty, PurchaseOrder } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useSalesData } from '@/lib/useSalesData';

export default function PurchaseOrderPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { tenant } = useSession();
  const { customers: vendors, products, taxes, warehouses } = useSalesData();
  const isNew = id === 'new';
  const [order, setOrder] = useState<PurchaseOrder>();
  const [vendorId, setVendorId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10));
  const [expectedDate, setExpectedDate] = useState('');
  const [vendorRef, setVendorRef] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<EditLine[]>([blankLine()]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const show = useCallback((o: PurchaseOrder) => {
    setOrder(o);
    setVendorId(o.vendorId);
    setWarehouseId(o.warehouseId);
    setOrderDate(isoDay(o.orderDate));
    setExpectedDate(isoDay(o.expectedDate));
    setVendorRef(o.vendorRef ?? '');
    setNotes(o.notes ?? '');
    setLines(
      (o.lines ?? []).map((l) => ({
        productId: l.productId, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, discountPct: l.discountPct, taxId: l.taxId ?? '',
      })),
    );
  }, []);

  useEffect(() => {
    if (!isNew) api<PurchaseOrder>(`/purchase-orders/${id}`).then(show).catch((e) => setError(e.message));
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
      vendorId,
      warehouseId: warehouseId || undefined,
      orderDate,
      expectedDate: expectedDate || null,
      vendorRef: vendorRef || null,
      notes: notes || null,
      lines: toApiLines(lines),
    };
    return run(async () => {
      if (isNew) {
        const o = await api<PurchaseOrder>('/purchase-orders', { method: 'POST', body });
        router.replace(`/app/purchases/${o.id}`);
      } else {
        show(await api<PurchaseOrder>(`/purchase-orders/${id}`, { method: 'PATCH', body }));
      }
    });
  }

  const action = (path: string) => run(async () => show(await api<PurchaseOrder>(`/purchase-orders/${id}/${path}`, { method: 'POST', body: {} })));

  async function confirm() {
    await run(async () => {
      await api(`/purchase-orders/${id}`, { method: 'PATCH', body: { vendorId, warehouseId, orderDate, expectedDate: expectedDate || null, vendorRef: vendorRef || null, notes: notes || null, lines: toApiLines(lines) } });
      show(await api<PurchaseOrder>(`/purchase-orders/${id}/confirm`, { method: 'POST', body: {} }));
    });
  }

  async function bill() {
    await run(async () => {
      const b = await api<Bill>(`/purchase-orders/${id}/bill`, { method: 'POST', body: {} });
      router.push(`/app/bills/${b.id}`);
    });
  }

  const editable = isNew || order?.status === 'RFQ';
  const outstandingReceipt = order?.lines?.some((l) => Number(l.receivedQty) < Number(l.quantity));
  const outstandingBill = order?.lines?.some((l) => Number(l.billedQty) < Number(l.quantity));

  return (
    <>
      <p><Link href="/app/purchases">← Purchases</Link></p>
      <section className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>{isNew ? 'New request for quotation' : order?.number} {order && <StatusBadge status={order.status} purchase />}</h2>
          {order && (
            <div className="actions">
              {order.status === 'RFQ' && <button disabled={busy} onClick={confirm}>Confirm order</button>}
              {order.status === 'CONFIRMED' && outstandingReceipt && <button disabled={busy} onClick={() => action('receive')}>Receive all</button>}
              {order.status === 'CONFIRMED' && outstandingBill && <button disabled={busy} onClick={bill}>Create bill</button>}
              <a className="button secondary-link" href={`/print/purchases/${order.id}`} target="_blank" rel="noreferrer">Print</a>
              {order.status !== 'CANCELLED' && <button disabled={busy} className="secondary" onClick={() => action('cancel')}>Cancel</button>}
            </div>
          )}
        </div>
        {error && <p className="error">{error}</p>}

        {editable ? (
          <form onSubmit={save}>
            <div className="row">
              <div style={{ flex: 2 }}>
                <label>Vendor</label>
                <select required value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
                  <option value="">Choose…</option>
                  {vendors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label>Receive into</label>
                <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
                  {isNew && <option value="">Default</option>}
                  {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
                </select>
              </div>
              <div><label>Date</label><input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} /></div>
              <div><label>Expected</label><input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} /></div>
              <div><label>Vendor reference</label><input value={vendorRef} onChange={(e) => setVendorRef(e.target.value)} /></div>
            </div>
            <h3>Lines</h3>
            <LineEditor lines={lines} onChange={setLines} products={products} taxes={taxes} currency={tenant.currency} priceField="cost" />
            <label>Notes</label>
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            <button disabled={busy}>{isNew ? 'Create request' : 'Save'}</button>
          </form>
        ) : (
          order && (
            <>
              <p>
                <strong>{order.vendor.name}</strong> · {day(order.orderDate)} · receive into {order.warehouse?.code}{order.vendorRef && ` · vendor ref ${order.vendorRef}`}
              </p>
              <table>
                <thead>
                  <tr><th>Description</th><th className="num">Qty</th><th className="num">Received</th><th className="num">Billed</th><th className="num">Unit price</th><th className="num">Disc.</th><th className="num">Tax</th><th className="num">Amount</th></tr>
                </thead>
                <tbody>
                  {order.lines?.map((l) => (
                    <tr key={l.id}>
                      <td>{l.description}</td>
                      <td className="num">{qty(l.quantity)} {l.product.unit.code}</td>
                      <td className="num">{qty(l.receivedQty ?? 0)}</td>
                      <td className="num">{qty(l.billedQty ?? 0)}</td>
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

      {order?.bills && order.bills.length > 0 && (
        <section className="card" style={{ marginTop: 16 }}>
          <h3>Bills</h3>
          <table>
            <tbody>
              {order.bills.map((i) => (
                <tr key={i.id}>
                  <td><Link href={`/app/bills/${i.id}`}>{i.number ?? 'Draft'}</Link></td>
                  <td><StatusBadge status={i.status} purchase /></td>
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
