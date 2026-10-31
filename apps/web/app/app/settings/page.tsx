'use client';
import { FormEvent, useState } from 'react';
import { api } from '@/lib/api';
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
  );
}
