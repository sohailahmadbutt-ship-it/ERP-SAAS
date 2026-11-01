'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { FormEvent, ReactNode, useCallback, useEffect, useState } from 'react';
import { ApiError, clearPlatformToken, getPlatformToken, platformApi, setPlatformToken, tenantSlug } from '@/lib/api';
import { PlatformAdmin, PlatformContext } from '@/lib/platform';

const NAV = [
  { href: '/platform', label: 'Companies' },
  { href: '/platform/invoices', label: 'Invoices' },
  { href: '/platform/plans', label: 'Plans' },
];

/** The SaaS operator's console. It lives on the main domain, never on a company's subdomain. */
export default function PlatformLayout({ children }: { children: ReactNode }) {
  const path = usePathname();
  const [admin, setAdmin] = useState<PlatformAdmin | null>();
  const [error, setError] = useState('');
  const [onCompanyHost, setOnCompanyHost] = useState(false);

  const load = useCallback(async () => {
    if (!getPlatformToken()) return setAdmin(null);
    try {
      setAdmin(await platformApi<PlatformAdmin>('/me'));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        clearPlatformToken();
        setAdmin(null);
      } else setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (tenantSlug()) setOnCompanyHost(true);
    else void load();
  }, [load]);

  if (onCompanyHost) return <main className="card narrow">The platform console is only available on the main domain.</main>;
  if (admin === undefined) return <main className="wrap">{error ? <p className="error">{error}</p> : 'Loading…'}</main>;
  if (admin === null) return <Login onDone={load} />;

  function logout() {
    clearPlatformToken();
    setAdmin(null);
  }

  return (
    <PlatformContext.Provider value={admin}>
      <header className="topbar platform">
        <nav className="nav">
          <strong>Platform console</strong>
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={(n.href === '/platform' ? path === n.href || path.startsWith('/platform/companies') : path.startsWith(n.href)) ? 'active' : ''}>
              {n.label}
            </Link>
          ))}
        </nav>
        <span>
          {admin.name} · <button className="link" onClick={logout}>Sign out</button>
        </span>
      </header>
      <main className="wrap">{children}</main>
    </PlatformContext.Provider>
  );
}

function Login({ onDone }: { onDone: () => Promise<void> }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const res = await platformApi<{ token: string }>('/login', { method: 'POST', body: { email, password } });
      setPlatformToken(res.token);
      await onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <main className="card narrow">
      <h2>Platform console</h2>
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
