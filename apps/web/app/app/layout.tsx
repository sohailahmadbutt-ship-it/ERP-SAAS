'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ReactNode, useCallback, useEffect, useState } from 'react';
import { api, ApiError, clearToken, setToken, Tenant, User } from '@/lib/api';
import { SessionContext } from '@/lib/session';

const NAV = [
  { href: '/app', label: 'Home' },
  { href: '/app/sales', label: 'Sales' },
  { href: '/app/invoices', label: 'Invoices' },
  { href: '/app/purchases', label: 'Purchases' },
  { href: '/app/bills', label: 'Bills' },
  { href: '/app/accounting', label: 'Accounting' },
  { href: '/app/contacts', label: 'Contacts' },
  { href: '/app/products', label: 'Products' },
  { href: '/app/inventory', label: 'Inventory' },
  { href: '/app/settings', label: 'Settings' },
];

export default function AppLayout({ children }: { children: ReactNode }) {
  const path = usePathname();
  const [me, setMe] = useState<{ tenant: Tenant; user: User }>();
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    setMe(await api<{ tenant: Tenant; user: User }>('/auth/me'));
  }, []);

  useEffect(() => {
    // After signup the token arrives in the URL fragment; store it and tidy the URL.
    const m = /token=([^&]+)/.exec(window.location.hash);
    if (m) {
      setToken(decodeURIComponent(m[1]));
      history.replaceState(null, '', window.location.pathname);
    }
    reload().catch((err) => {
      if (err instanceof ApiError && (err.status === 401 || err.status === 404)) window.location.href = '/login';
      else setError(err.message);
    });
  }, [reload]);

  if (!me) return <main className="wrap">{error ? <p className="error">{error}</p> : 'Loading…'}</main>;

  function logout() {
    clearToken();
    window.location.href = '/login';
  }

  return (
    <SessionContext.Provider value={{ ...me, reload }}>
      <header className="topbar">
        <nav className="nav">
          <strong>{me.tenant.name}</strong>
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={(n.href === '/app' ? path === n.href : path.startsWith(n.href)) ? 'active' : ''}>
              {n.label}
            </Link>
          ))}
        </nav>
        <span>
          {me.user.name} · <button className="link" onClick={logout}>Sign out</button>
        </span>
      </header>
      <main className="wrap">{children}</main>
    </SessionContext.Provider>
  );
}
