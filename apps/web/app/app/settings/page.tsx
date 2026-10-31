'use client';
import { FormEvent, useEffect, useState } from 'react';
import { api, Tax } from '@/lib/api';
import { useSession } from '@/lib/session';

const FIELDS = [
  { key: 'name', label: 'Company name' },
  { key: 'taxId', label: 'Tax number (NTN / STRN)' },
  { key: 'currency', label: 'Currency (3-letter code, e.g. PKR)' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'address', label: 'Address' },
  { key: 'city', label: 'City' },
  { key: 'country', label: 'Country (2-letter code, e.g. PK)' },
] as const;
type Key = (typeof FIELDS)[number]['key'];

export default function Settings() {
  const { tenant, user, reload } = useSession();
  const [form, setForm] = useState<Record<Key, string>>(
    Object.fromEntries(FIELDS.map((f) => [f.key, tenant[f.key] ?? ''])) as Record<Key, string>,
  );
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const canEdit = user.role !== 'MEMBER';

  async function save(e: FormEvent) {
    e.preventDefault();
    setMsg('');
    setError('');
    // Send only filled-in fields; the API validates formats.
    const body = Object.fromEntries(Object.entries(form).filter(([, v]) => v.trim() !== ''));
    try {
      await api('/company', { method: 'PATCH', body });
      await reload();
      setMsg('Saved');
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <>
    <section className="card" style={{ maxWidth: 560 }}>
      <h2>Company settings</h2>
      <p className="muted">Your company address: {tenant.slug}</p>
      <form onSubmit={save}>
        {FIELDS.map((f) => (
          <div key={f.key}>
            <label>{f.label}</label>
            <input disabled={!canEdit} value={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
          </div>
        ))}
        {canEdit ? <button>Save</button> : <p className="muted">Only owners and admins can change these.</p>}
        {msg && <p>{msg}</p>}
        {error && <p className="error">{error}</p>}
      </form>
    </section>
    <Taxes canEdit={canEdit} />
    </>
  );
}

function Taxes({ canEdit }: { canEdit: boolean }) {
  const [taxes, setTaxes] = useState<Tax[]>([]);
  const [form, setForm] = useState({ name: '', rate: '' });
  const [error, setError] = useState('');
  const load = () => api<Tax[]>('/taxes').then(setTaxes);
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api('/taxes', { method: 'POST', body: { name: form.name, rate: Number(form.rate) } });
      setForm({ name: '', rate: '' });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function toggle(t: Tax) {
    try {
      await api(`/taxes/${t.id}`, { method: 'PATCH', body: { archived: !t.archived } });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <section className="card" style={{ maxWidth: 560, marginTop: 16 }}>
      <h3>Taxes</h3>
      <p className="muted">Rates offered on quotations and invoices. Changing a rate only affects new lines.</p>
      <table>
        <tbody>
          {taxes.map((t) => (
            <tr key={t.id} className={t.archived ? 'muted' : ''}>
              <td>{t.name}{t.archived && ' (archived)'}</td>
              <td className="num">{Number(t.rate)}%</td>
              <td className="num">{canEdit && <button className="link" onClick={() => toggle(t)}>{t.archived ? 'Restore' : 'Archive'}</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {canEdit && (
        <form onSubmit={add} className="row">
          <div><label>Name</label><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Reduced 5%" /></div>
          <div style={{ flex: '0 0 110px' }}><label>Rate %</label><input required type="number" min={0} max={100} step="0.001" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} /></div>
          <button>Add tax</button>
        </form>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
