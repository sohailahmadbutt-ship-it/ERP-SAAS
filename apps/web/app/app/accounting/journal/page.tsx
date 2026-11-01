'use client';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { AccountingTabs } from '@/components/AccountingTabs';
import { Account, api, day, JournalEntry, money, Page } from '@/lib/api';
import { useSession } from '@/lib/session';

const SOURCES: Record<string, string> = {
  MANUAL: 'Manual', INVOICE: 'Invoice', INVOICE_PAYMENT: 'Customer payment', BILL: 'Vendor bill', BILL_PAYMENT: 'Vendor payment', STOCK: 'Stock',
};

type Line = { accountId: string; debit: string; credit: string; description: string };
const blank = (): Line => ({ accountId: '', debit: '', credit: '', description: '' });

export default function Journal() {
  const { user, tenant } = useSession();
  const [data, setData] = useState<Page<JournalEntry>>();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [q, setQ] = useState('');
  const [source, setSource] = useState('');
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [memo, setMemo] = useState('');
  const [lines, setLines] = useState<Line[]>([blank(), blank()]);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: '30' });
    if (q) params.set('q', q);
    if (source) params.set('source', source);
    return api<Page<JournalEntry>>(`/journal-entries?${params}`).then(setData);
  }, [q, source, page]);

  useEffect(() => {
    const t = setTimeout(() => load().catch((e) => setError(e.message)), 200);
    return () => clearTimeout(t);
  }, [load]);
  useEffect(() => {
    api<Account[]>('/accounts').then((a) => setAccounts(a.filter((x) => !x.archived))).catch(() => {});
  }, []);

  const dr = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
  const cr = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
  const balanced = Math.abs(dr - cr) < 0.005 && dr > 0;
  const setLine = (i: number, patch: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  async function save(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api('/journal-entries', {
        method: 'POST',
        body: {
          date,
          memo: memo || undefined,
          lines: lines.filter((l) => l.accountId).map((l) => ({
            accountId: l.accountId, debit: Number(l.debit || 0), credit: Number(l.credit || 0), description: l.description || undefined,
          })),
        },
      });
      setLines([blank(), blank()]);
      setMemo('');
      setShowForm(false);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>Accounting</h2>
        {user.role !== 'MEMBER' && !showForm && <button onClick={() => setShowForm(true)}>New journal entry</button>}
      </div>
      <AccountingTabs />
      {error && <p className="error">{error}</p>}

      {showForm && (
        <section className="card" style={{ marginBottom: 16 }}>
          <h3>New journal entry</h3>
          <p className="muted">For opening balances, owner's capital, bank charges, corrections and so on. Debits must equal credits.</p>
          <form onSubmit={save}>
            <div className="row">
              <div style={{ flex: '0 0 180px' }}><label>Date</label><input type="date" required value={date} onChange={(e) => setDate(e.target.value)} /></div>
              <div><label>Memo</label><input value={memo} onChange={(e) => setMemo(e.target.value)} /></div>
            </div>
            <table className="lines">
              <thead><tr><th>Account</th><th>Description</th><th className="num" style={{ width: 140 }}>Debit</th><th className="num" style={{ width: 140 }}>Credit</th><th style={{ width: 30 }}></th></tr></thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td>
                      <select value={l.accountId} onChange={(e) => setLine(i, { accountId: e.target.value })}>
                        <option value="">Choose…</option>
                        {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
                      </select>
                    </td>
                    <td><input value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} /></td>
                    <td><input className="num" type="number" min={0} step="0.01" value={l.debit} onChange={(e) => setLine(i, { debit: e.target.value, credit: e.target.value ? '' : l.credit })} /></td>
                    <td><input className="num" type="number" min={0} step="0.01" value={l.credit} onChange={(e) => setLine(i, { credit: e.target.value, debit: e.target.value ? '' : l.debit })} /></td>
                    <td><button type="button" className="link" onClick={() => setLines(lines.filter((_, j) => j !== i))}>✕</button></td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={2}><button type="button" className="secondary" onClick={() => setLines([...lines, blank()])}>Add line</button></td>
                  <td className="num"><strong>{money(dr)}</strong></td>
                  <td className="num"><strong>{money(cr)}</strong></td>
                  <td></td>
                </tr>
              </tbody>
            </table>
            {!balanced && dr + cr > 0 && <p className="error">Out of balance by {money(Math.abs(dr - cr), tenant.currency)}</p>}
            <div className="row">
              <button disabled={!balanced}>Post entry</button>
              <button type="button" className="secondary" onClick={() => setShowForm(false)}>Close</button>
            </div>
          </form>
        </section>
      )}

      <div className="row">
        <div><input placeholder="Search number, reference or memo" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></div>
        <div style={{ flex: '0 0 200px' }}>
          <select value={source} onChange={(e) => { setSource(e.target.value); setPage(1); }}>
            <option value="">All sources</option>
            {Object.entries(SOURCES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      </div>
      {data?.items.map((e) => (
        <section key={e.id} className="card entry">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div><strong>{e.number}</strong> · {day(e.date)} · {SOURCES[e.source] ?? e.source}{e.reference && ` · ${e.reference}`}</div>
            <div className="muted">{e.memo}</div>
          </div>
          <table>
            <tbody>
              {e.lines.map((l) => (
                <tr key={l.id}>
                  <td style={{ width: '45%' }}>{l.account.code} · {l.account.name}{l.contact && <span className="muted"> · {l.contact.name}</span>}</td>
                  <td className="num">{Number(l.debit) ? money(l.debit) : ''}</td>
                  <td className="num">{Number(l.credit) ? money(l.credit) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      {data && data.items.length === 0 && <p className="muted">No journal entries yet. They appear as you post invoices, bills, payments and stock moves.</p>}
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
