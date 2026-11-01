'use client';
import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { AccountingTabs } from '@/components/AccountingTabs';
import { Account, ACCOUNT_TYPE_LABELS, api, money } from '@/lib/api';
import { useSession } from '@/lib/session';

export default function ChartOfAccounts() {
  const { user } = useSession();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [form, setForm] = useState({ code: '', name: '', type: 'EXPENSE' });
  const [error, setError] = useState('');
  const canEdit = user.role !== 'MEMBER';
  const load = () => api<Account[]>('/accounts').then(setAccounts);

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api('/accounts', { method: 'POST', body: form });
      setForm({ code: '', name: '', type: form.type });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <>
      <h2>Accounting</h2>
      <AccountingTabs />
      {error && <p className="error">{error}</p>}
      {(Object.keys(ACCOUNT_TYPE_LABELS) as Account['type'][]).map((type) => (
        <section key={type} className="card" style={{ marginBottom: 16 }}>
          <h3>{ACCOUNT_TYPE_LABELS[type]}</h3>
          <table>
            <tbody>
              {accounts.filter((a) => a.type === type).map((a) => (
                <tr key={a.id} className={a.archived ? 'muted' : ''}>
                  <td style={{ width: 90 }}>{a.code}</td>
                  <td><Link href={`/app/accounting/ledger/${a.id}`}>{a.name}</Link>{a.archived && ' (archived)'}</td>
                  <td className="num">{money(a.balance ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      {canEdit && (
        <section className="card">
          <h3>Add an account</h3>
          <form onSubmit={add} className="row">
            <div style={{ flex: '0 0 120px' }}><label>Code</label><input required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></div>
            <div><label>Name</label><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div style={{ flex: '0 0 160px' }}>
              <label>Type</label>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {Object.entries(ACCOUNT_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <button>Add</button>
          </form>
        </section>
      )}
    </>
  );
}
