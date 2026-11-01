'use client';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, money, POS_METHOD_LABELS, PosOrder, Tenant } from '@/lib/api';

/** An 80 mm till receipt. */
export default function Receipt() {
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<PosOrder>();
  const [tenant, setTenant] = useState<Tenant>();
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api<PosOrder>(`/pos/orders/${id}`), api<Tenant>('/company')])
      .then(([o, t]) => {
        setOrder(o);
        setTenant(t);
        setTimeout(() => window.print(), 300);
      })
      .catch((e) => setError(e.message));
  }, [id]);

  if (error) return <p className="error">{error}</p>;
  if (!order || !tenant) return <p>Loading…</p>;
  const refund = Number(order.total) < 0;
  return (
    <div className="receipt">
      <h1>{tenant.name}</h1>
      <div className="c">{[tenant.address, tenant.city].filter(Boolean).join(', ')}</div>
      {tenant.phone && <div className="c">{tenant.phone}</div>}
      {tenant.taxId && <div className="c">Tax no. {tenant.taxId}</div>}
      <hr />
      <div>{refund ? 'REFUND' : 'Receipt'} {order.number}{order.refundOf && ` (for ${order.refundOf.number})`}</div>
      <div>{new Date(order.createdAt).toLocaleString()}</div>
      <div>{order.session?.register.name}{order.customer && ` · ${order.customer.name}`}</div>
      <hr />
      <table>
        <tbody>
          {order.lines?.map((l) => (
            <tr key={l.id}>
              <td>
                {l.description}
                <br />
                {Number(l.quantity)} x {money(l.unitPrice)}{Number(l.discountPct) > 0 && ` -${Number(l.discountPct)}%`}
              </td>
              <td className="num" style={{ verticalAlign: 'bottom' }}>{money(l.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <hr />
      <table>
        <tbody>
          <tr><td>Subtotal</td><td className="num">{money(order.subtotal)}</td></tr>
          <tr><td>Tax</td><td className="num">{money(order.taxTotal)}</td></tr>
          <tr><td><strong>Total {tenant.currency}</strong></td><td className="num"><strong>{money(order.total)}</strong></td></tr>
          {order.payments.map((p, i) => (
            <tr key={i}><td>{POS_METHOD_LABELS[p.method]}{p.reference && ` (${p.reference})`}</td><td className="num">{money(p.method === 'CASH' && !refund ? Number(p.amount) + Number(order.change) : p.amount)}</td></tr>
          ))}
          {Number(order.change) > 0 && <tr><td>Change</td><td className="num">{money(order.change)}</td></tr>}
        </tbody>
      </table>
      <hr />
      <div className="c">{order.session?.register.receiptFooter ?? 'Thank you!'}</div>
      <p className="c no-print"><button onClick={() => window.print()}>Print</button></p>
    </div>
  );
}
