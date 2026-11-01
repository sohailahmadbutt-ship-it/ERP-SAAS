'use client';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { money, Plan, platformApi } from '@/lib/api';

type Row = Plan & { id: string; _count: { tenants: number } };
const blank = { code: '', name: '', priceMonthly: '', maxUsers: '', description: '' };

export default function Plans() {
  const [rows, setRows] = useState<Row[]>();
  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => platformApi<Row[]>('/plans').then(setRows).catch((e) => setError(e.message)), []);
  useEffect(() => void load(), [load]);

  const set = (k: keyof typeof blank) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  async function save(e: FormEvent) {
    e.preventDefault();
    setError('');
    const body = {
      name: form.name,
      priceMonthly: Number(form.priceMonthly),
      maxUsers: form.maxUsers ? Number(form.maxUsers) : null,
      description: form.description,
    };
    try {
      if (editing) await platformApi(`/plans/${editing}`, { method: 'PATCH', body });
      else await platformApi('/plans', { method: 'POST', body: { ...body, code: form.code, sortOrder: (rows?.length ?? 0) + 1 } });
      setForm(blank);
      setEditing(null);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function toggle(p: Row) {
    setError('');
    try {
      await platformApi(`/plans/${p.id}`, { method: 'PATCH', body: { active: !p.active } });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function edit(p: Row) {
    setEditing(p.id);
    setForm({ code: p.code, name: p.name, priceMonthly: String(Number(p.priceMonthly)), maxUsers: p.maxUsers === null ? '' : String(p.maxUsers), description: p.description ?? '' });
  }

  return (
    <>
      <h2>Plans</h2>
      <p className="muted">Price changes apply to invoices issued from now on. Retired plans stay with the companies on them but are no longer offered.</p>
      <section className="card">
        <table>
          <thead><tr><th>Plan</th><th>Code</th><th className="num">Price / month</th><th>Users</th><th className="num">Companies</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {rows?.map((p) => (
              <tr key={p.id}>
                <td>{p.name}<div className="muted">{p.description}</div></td>
                <td>{p.code}</td>
                <td className="num">{money(p.priceMonthly, p.currency)}</td>
                <td>{p.maxUsers ?? 'Unlimited'}</td>
                <td className="num">{p._count.tenants}</td>
                <td><span className={`badge ${p.active ? 'active' : 'void'}`}>{p.active ? 'Offered' : 'Retired'}</span></td>
                <td>
                  <div className="actions">
                    <button className="link" onClick={() => edit(p)}>Edit</button>
                    <button className="link" onClick={() => toggle(p)}>{p.active ? 'Retire' : 'Offer again'}</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <h3>{editing ? `Edit ${form.name}` : 'New plan'}</h3>
      <section className="card">
        <form onSubmit={save}>
          <div className="row">
            <div><label>Name</label><input required value={form.name} onChange={set('name')} /></div>
            <div><label>Code</label><input required disabled={!!editing} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })} placeholder="e.g. growth" /></div>
            <div><label>Price per month (PKR)</label><input required type="number" min={0} step="0.01" value={form.priceMonthly} onChange={set('priceMonthly')} /></div>
            <div><label>User limit</label><input type="number" min={1} value={form.maxUsers} onChange={set('maxUsers')} placeholder="Unlimited" /></div>
          </div>
          <label>Description</label>
          <input value={form.description} onChange={set('description')} />
          <div className="actions">
            <button>{editing ? 'Save plan' : 'Add plan'}</button>
            {editing && <button type="button" className="secondary" onClick={() => { setEditing(null); setForm(blank); }}>Cancel</button>}
          </div>
          {error && <p className="error">{error}</p>}
        </form>
      </section>
    </>
  );
}
