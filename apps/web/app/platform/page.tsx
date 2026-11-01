'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Access, day, money, Plan, platformApi, STATE_LABELS, Tenant } from '@/lib/api';

interface Stats {
  companies: number;
  byState: Record<string, number>;
  trialsEndingSoon: number;
  mrr: string;
  openInvoices: number;
  openAmount: string;
  paidThisMonth: string;
}
type Row = Tenant & Access & { planRef: Plan; userCount: number };

export default function Companies() {
  const [stats, setStats] = useState<Stats>();
  const [rows, setRows] = useState<Row[]>();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    platformApi<Stats>('/stats').then(setStats).catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    const params = new URLSearchParams({ ...(q ? { q } : {}), ...(status ? { status } : {}) });
    const t = setTimeout(() => platformApi<Row[]>(`/tenants?${params}`).then(setRows).catch((e) => setError(e.message)), 200);
    return () => clearTimeout(t);
  }, [q, status]);

  return (
    <>
      <h2>Companies</h2>
      {stats && (
        <div className="grid">
          <div className="tile">Companies<div className="stat">{stats.companies}</div></div>
          <div className="tile">Paying<div className="stat">{(stats.byState.active ?? 0) + (stats.byState.past_due ?? 0)}</div></div>
          <div className="tile">On trial<div className="stat">{stats.byState.trial ?? 0}</div>{stats.trialsEndingSoon > 0 && `${stats.trialsEndingSoon} ending in 3 days`}</div>
          <div className="tile">Monthly recurring revenue<div className="stat">{money(stats.mrr)}</div></div>
          <div className="tile">Open invoices<div className="stat">{stats.openInvoices}</div>{money(stats.openAmount)}</div>
          <div className="tile">Collected this month<div className="stat">{money(stats.paidThisMonth)}</div></div>
        </div>
      )}
      <div className="row" style={{ marginBottom: 12 }}>
        <div><input placeholder="Search name, address or email" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div style={{ flex: '0 0 200px' }}>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            <option value="TRIALING">Trialing</option>
            <option value="ACTIVE">Active</option>
            <option value="SUSPENDED">Suspended</option>
            <option value="CANCELED">Canceled</option>
          </select>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      <section className="card">
        <table>
          <thead><tr><th>Company</th><th>Address</th><th>Plan</th><th>Status</th><th className="num">Users</th><th>Trial ends / paid until</th><th>Signed up</th></tr></thead>
          <tbody>
            {rows?.map((t) => (
              <tr key={t.id}>
                <td><Link href={`/platform/companies/${t.id}`}>{t.name}</Link></td>
                <td>{t.slug}</td>
                <td>{t.planRef.name}</td>
                <td><span className={`badge ${t.state}`}>{STATE_LABELS[t.state]}</span></td>
                <td className="num">{t.userCount}</td>
                <td>{day(t.status === 'TRIALING' ? t.trialEndsAt : t.currentPeriodEnd)}</td>
                <td>{day(t.createdAt)}</td>
              </tr>
            ))}
            {rows?.length === 0 && <tr><td colSpan={7} className="muted">No companies found.</td></tr>}
          </tbody>
        </table>
      </section>
    </>
  );
}
