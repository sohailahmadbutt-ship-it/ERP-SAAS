'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ReactNode, useCallback, useEffect, useState } from 'react';
import { Access, api, ApiError, clearToken, setToken, Tenant, User } from '@/lib/api';
import { SessionContext } from '@/lib/session';

const NAV = [
  { href: '/app', label: 'Home' },
  { href: '/app/pos', label: 'POS' },
  { href: '/app/crm', label: 'CRM' },
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

type Me = { tenant: Tenant; user: User; subscription: Access };

export default function AppLayout({ children }: { children: ReactNode }) {
  const path = usePathname();
  const [me, setMe] = useState<Me>();
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    setMe(await api<Me>('/auth/me'));
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
      <SubscriptionBanner sub={me.subscription} note={me.tenant.statusNote} />
      <main className="wrap">{children}</main>
    </SessionContext.Provider>
  );
}

/** Tells people when the trial is ending or the company has gone read-only. */
function SubscriptionBanner({ sub, note }: { sub: Access; note: string | null }) {
  const link = <Link href="/app/settings/billing">Billing</Link>;
  const plural = (n: number | null) => `${n} day${n === 1 ? '' : 's'}`;
  switch (sub.state) {
    case 'trial':
      return sub.daysLeft !== null && sub.daysLeft <= 7 ? (
        <div className="banner">Your free trial ends in {plural(sub.daysLeft)}. Choose a plan in {link} to keep going.</div>
      ) : null;
    case 'past_due':
      return <div className="banner">Your subscription payment is overdue. You have {plural(sub.daysLeft)} before the company becomes read-only. Pay in {link}.</div>;
    case 'trial_expired':
      return <div className="banner danger">Your free trial has ended, so the company is read-only. Choose a plan in {link} to keep making changes.</div>;
    case 'expired':
      return <div className="banner danger">Your subscription has expired, so the company is read-only. Pay the open invoice in {link}.</div>;
    case 'canceled':
      return <div className="banner danger">This subscription was canceled, so the company is read-only. Choose a plan in {link} to reactivate it.</div>;
    case 'suspended':
      return <div className="banner danger">This company has been suspended{note ? `: ${note}` : ''}. Contact support.</div>;
    default:
      return null;
  }
}
