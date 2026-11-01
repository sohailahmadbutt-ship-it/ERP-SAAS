'use client';
import Link from 'next/link';
import { useState } from 'react';
import { day, money, platformApi, PlatformInvoice } from '@/lib/api';
import { InvoiceBadge } from './InvoiceBadge';

/** Platform invoices with the console's mark-paid and void actions. */
export function InvoiceTable({ invoices, onChange, showCompany = false }: { invoices: PlatformInvoice[]; onChange: () => unknown; showCompany?: boolean }) {
  const [error, setError] = useState('');
  async function run(path: string, body?: object) {
    setError('');
    try {
      await platformApi(path, { method: 'POST', body: body ?? {} });
      await onChange();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  if (invoices.length === 0) return <p className="muted" style={{ margin: 0 }}>No invoices.</p>;
  return (
    <>
      <table>
        <thead>
          <tr>
            <th>Number</th>{showCompany && <th>Company</th>}<th>Plan</th><th>Period</th><th className="num">Amount</th><th>Reference</th><th>Status</th><th></th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((i) => (
            <tr key={i.id}>
              <td>{i.number}</td>
              {showCompany && <td>{i.tenant && <Link href={`/platform/companies/${i.tenant.id}`}>{i.tenant.name}</Link>}</td>}
              <td>{i.planName}</td>
              <td>{day(i.periodStart)} to {day(i.periodEnd)}</td>
              <td className="num">{money(i.amount, i.currency)}</td>
              <td>{i.paymentReference ?? ''}</td>
              <td><InvoiceBadge inv={i} />{i.paidAt && <div className="muted">{day(i.paidAt)}</div>}</td>
              <td>
                {i.status === 'OPEN' && (
                  <div className="actions">
                    <button className="link" onClick={() => confirm(`Mark ${i.number} paid? This activates the company until ${day(i.periodEnd)}.`) && run(`/invoices/${i.id}/mark-paid`)}>Mark paid</button>
                    <button className="link" onClick={() => confirm(`Void ${i.number}?`) && run(`/invoices/${i.id}/void`)}>Void</button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {error && <p className="error">{error}</p>}
    </>
  );
}
