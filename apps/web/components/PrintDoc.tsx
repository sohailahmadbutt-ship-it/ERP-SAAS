'use client';
import { useEffect, useState } from 'react';
import { api, day, DocLine, money, Party, qty, Tenant } from '@/lib/api';

interface Doc {
  title: string;
  number: string;
  date: string;
  extraDate?: { label: string; value: string | null };
  customer: Party;
  lines: DocLine[];
  subtotal: string;
  taxTotal: string;
  total: string;
  amountPaid?: string;
  currency: string;
  notes: string | null;
}

const addr = (p: Partial<Party>) => [p.address, p.city, p.country].filter(Boolean).join(', ');

/** Printable quotation / order / invoice. Use the browser's Print (or Save as PDF). */
export function PrintDoc({ load }: { load: () => Promise<Doc> }) {
  const [doc, setDoc] = useState<Doc>();
  const [company, setCompany] = useState<Tenant>();
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([load(), api<Tenant>('/company')])
      .then(([d, c]) => {
        setDoc(d);
        setCompany(c);
        document.title = `${d.title} ${d.number}`;
      })
      .catch((e) => setError(e.message));
  }, [load]);

  if (error) return <p className="error" style={{ padding: 24 }}>{error}. Sign in from your company address first.</p>;
  if (!doc || !company) return <p style={{ padding: 24 }}>Loading…</p>;
  const taxes = new Map<string, number>();
  for (const l of doc.lines) if (Number(l.taxRate)) taxes.set(`${Number(l.taxRate)}%`, (taxes.get(`${Number(l.taxRate)}%`) ?? 0) + Number(l.taxAmount));

  return (
    <div className="print-page">
      <div className="no-print" style={{ textAlign: 'right' }}>
        <button onClick={() => window.print()}>Print or save as PDF</button>
      </div>
      <header className="print-head">
        <div>
          <h1>{company.name}</h1>
          <div>{addr(company)}</div>
          <div>{[company.phone, company.email].filter(Boolean).join(' · ')}</div>
          {company.taxId && <div>Tax no. {company.taxId}</div>}
        </div>
        <div className="print-title">
          <h2>{doc.title}</h2>
          <div><strong>{doc.number}</strong></div>
          <div>Date: {day(doc.date)}</div>
          {doc.extraDate?.value && <div>{doc.extraDate.label}: {day(doc.extraDate.value)}</div>}
        </div>
      </header>
      <section className="print-to">
        <div className="muted">Bill to</div>
        <strong>{doc.customer.name}</strong>
        <div>{addr(doc.customer)}</div>
        {doc.customer.taxId && <div>Tax no. {doc.customer.taxId}</div>}
      </section>
      <table>
        <thead>
          <tr><th>#</th><th>Description</th><th className="num">Qty</th><th className="num">Unit price</th><th className="num">Disc.</th><th className="num">Tax</th><th className="num">Amount</th></tr>
        </thead>
        <tbody>
          {doc.lines.map((l, i) => (
            <tr key={l.id}>
              <td>{i + 1}</td>
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
      <table className="totals">
        <tbody>
          <tr><td>Subtotal</td><td className="num">{money(doc.subtotal)}</td></tr>
          {[...taxes].map(([rate, amt]) => <tr key={rate}><td>Tax {rate}</td><td className="num">{money(amt)}</td></tr>)}
          <tr className="grand"><td>Total</td><td className="num">{money(doc.total, doc.currency)}</td></tr>
          {doc.amountPaid !== undefined && Number(doc.amountPaid) > 0 && (
            <>
              <tr><td>Paid</td><td className="num">{money(doc.amountPaid)}</td></tr>
              <tr className="grand"><td>Balance due</td><td className="num">{money(Number(doc.total) - Number(doc.amountPaid), doc.currency)}</td></tr>
            </>
          )}
        </tbody>
      </table>
      {doc.notes && <p style={{ marginTop: 24 }}>{doc.notes}</p>}
    </div>
  );
}
