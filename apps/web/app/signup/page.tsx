'use client';
import { FormEvent, useEffect, useState } from 'react';
import { api, Plan, tenantUrl, Tenant, User } from '@/lib/api';

export default function Signup() {
  const [form, setForm] = useState({ companyName: '', slug: '', name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [plan, setPlan] = useState('business');

  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get('plan');
    if (wanted) setPlan(wanted);
    api<Plan[]>('/plans').then(setPlans).catch(() => {});
  }, []);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await api<{ token: string; tenant: Tenant; user: User }>('/auth/signup', { method: 'POST', body: { ...form, plan } });
      // The token goes in the URL fragment, which is never sent to a server,
      // so the new subdomain can pick it up and store it.
      window.location.href = tenantUrl(res.tenant.slug, `/app#token=${encodeURIComponent(res.token)}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="card narrow">
      <h2>Create your company</h2>
      <form onSubmit={submit}>
        <label>Company name</label>
        <input required value={form.companyName} onChange={set('companyName')} />
        <label>Company address</label>
        <input required value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })} placeholder="acme" />
        <p className="muted">Your team will sign in at {form.slug || 'acme'}.yourdomain</p>
        <label>Your name</label>
        <input required value={form.name} onChange={set('name')} />
        <label>Email</label>
        <input required type="email" value={form.email} onChange={set('email')} />
        {plans.length > 0 && (
          <>
            <label>Plan to try (free for 14 days)</label>
            <select value={plan} onChange={(e) => setPlan(e.target.value)}>
              {plans.map((p) => (
                <option key={p.code} value={p.code}>{p.name}: {p.maxUsers === null ? 'unlimited users' : `up to ${p.maxUsers} users`}</option>
              ))}
            </select>
          </>
        )}
        <label>Password</label>
        <input required type="password" minLength={8} value={form.password} onChange={set('password')} />
        <button disabled={busy}>{busy ? 'Creating…' : 'Create company'}</button>
        {error && <p className="error">{error}</p>}
      </form>
    </main>
  );
}
