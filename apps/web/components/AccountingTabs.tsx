'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/app/accounting', label: 'Chart of accounts' },
  { href: '/app/accounting/journal', label: 'Journal' },
  { href: '/app/accounting/reports', label: 'Reports' },
];

export function AccountingTabs() {
  const path = usePathname();
  return (
    <div className="status-tabs">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} className={path === t.href ? 'tab active' : 'tab'}>{t.label}</Link>
      ))}
    </div>
  );
}
