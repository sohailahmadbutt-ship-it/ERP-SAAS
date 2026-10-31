'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, day, money, Page } from '@/lib/api';
import { StatusBadge } from './LineEditor';

interface Row {
  id: string;
  number: string | null;
  status: string;
  customer: { name: string };
  total: string;
  currency: string;
  orderDate?: string;
  invoiceDate?: string;
  amountPaid?: string;
}

/** Shared list page for sales orders and invoices. */
export function DocList({
  title,
  endpoint,
  basePath,
  tabs,
  newLabel,
}: {
  title: string;
  endpoint: string;
  basePath: string;
  tabs: { label: string; status: string }[];
  newLabel: string;
}) {
  const [status, setStatus] = useState(tabs[0].status);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<Row>>();
  const [error, setError] = useState('');

  useEffect(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: '50' });
    if (status) params.set('status', status);
    if (q) params.set('q', q);
    const t = setTimeout(() => api<Page<Row>>(`${endpoint}?${params}`).then(setData).catch((e) => setError(e.message)), 200);
    return () => clearTimeout(t);
  }, [endpoint, status, q, page]);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>{title}</h2>
        <Link href={`${basePath}/new`} className="button">{newLabel}</Link>
      </div>
      <div className="status-tabs">
        {tabs.map((t) => (
          <button key={t.label} type="button" className={status === t.status ? 'tab active' : 'tab'} onClick={() => { setStatus(t.status); setPage(1); }}>
            {t.label}
          </button>
        ))}
      </div>
      <input placeholder="Search number or customer" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
      {error && <p className="error">{error}</p>}
      <section className="card" style={{ marginTop: 16, padding: 0 }}>
        <table>
          <thead>
            <tr><th>Number</th><th>Customer</th><th>Date</th><th>Status</th><th className="num">Total</th></tr>
          </thead>
          <tbody>
            {data?.items.map((d) => (
              <tr key={d.id}>
                <td><Link href={`${basePath}/${d.id}`}>{d.number ?? 'Draft'}</Link></td>
                <td>{d.customer.name}</td>
                <td>{day(d.orderDate ?? d.invoiceDate)}</td>
                <td><StatusBadge status={d.status} /></td>
                <td className="num">{money(d.total, d.currency)}</td>
              </tr>
            ))}
            {data && data.items.length === 0 && <tr><td colSpan={5} className="muted">Nothing here yet.</td></tr>}
          </tbody>
        </table>
      </section>
      {data && pages > 1 && (
        <p>
          <button className="link" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
          {' '}Page {page} of {pages}{' '}
          <button className="link" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
        </p>
      )}
    </>
  );
}
