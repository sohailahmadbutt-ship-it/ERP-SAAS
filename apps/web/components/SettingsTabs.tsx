'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/app/settings', label: 'Company' },
  { href: '/app/settings/billing', label: 'Billing' },
];

export function SettingsTabs() {
  const path = usePathname();
  return (
    <div className="status-tabs">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} className={path === t.href ? 'tab active' : 'tab'}>{t.label}</Link>
      ))}
    </div>
  );
}
