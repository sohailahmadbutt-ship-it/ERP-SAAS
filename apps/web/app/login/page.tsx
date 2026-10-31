'use client';
import { FormEvent, useEffect, useState } from 'react';
import { api, setToken, tenantSlug } from '@/lib/api';

export default function Login() {
  const [slug, setSlug] = useState<string>();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  useEffect(() => setSlug(tenantSlug()), []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const res = await api<{ token: string }>('/auth/login', { method: 'POST', body: { email, password } });
      setToken(res.token);
      window.location.href = '/app';
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (slug === undefined) {
    return (
      <main className="card narrow">
        <p>Sign in from your company address, for example acme.yourdomain/login.</p>
        <a href="/signup">Or create a new company</a>
      </main>
    );
  }

  return (
    <main className="card narrow">
      <h2>Sign in to {slug}</h2>
      <form onSubmit={submit}>
        <label>Email</label>
        <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <label>Password</label>
        <input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <button>Sign in</button>
        {error && <p className="error">{error}</p>}
      </form>
    </main>
  );
}
