'use client';
import { useCallback, useEffect, useState } from 'react';
import { platformApi, PlatformInvoice } from '@/lib/api';
import { InvoiceTable } from '@/components/PlatformInvoiceTable';

export default function Invoices() {
  const [status, setStatus] = useState('OPEN');
  const [rows, setRows] = useState<PlatformInvoice[]>();
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(
    () => platformApi<PlatformInvoice[]>(`/invoices${status ? `?status=${status}` : ''}`).then(setRows).catch((e) => setError(e.message)),
    [status],
  );
  useEffect(() => void load(), [load]);

  async function renewals() {
    setError('');
    setMsg('');
    try {
      const res = await platformApi<{ issued: number }>('/invoices/renewals', { method: 'POST' });
      setMsg(res.issued ? `Issued ${res.issued} renewal invoice${res.issued === 1 ? '' : 's'}.` : 'No renewals are due.');
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      <h2>Invoices</h2>
      <p className="muted">Payments companies have reported are listed first. Check the money has arrived, then mark the invoice paid to activate the company.</p>
      <div className="actions" style={{ marginBottom: 12 }}>
        <div className="tabs">
          {[['OPEN', 'Open'], ['PAID', 'Paid'], ['VOID', 'Void'], ['', 'All']].map(([v, l]) => (
            <button key={v} className={`tab ${status === v ? 'active' : ''}`} onClick={() => setStatus(v)}>{l}</button>
          ))}
        </div>
        <button className="secondary" onClick={renewals}>Issue renewal invoices</button>
      </div>
      {msg && <p>{msg}</p>}
      {error && <p className="error">{error}</p>}
      <section className="card">{rows && <InvoiceTable invoices={rows} onChange={load} showCompany />}</section>
    </>
  );
}
