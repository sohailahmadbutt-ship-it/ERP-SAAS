'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/app/crm', label: 'Pipeline' },
  { href: '/app/crm/activities', label: 'My to-dos' },
];

export function CrmTabs() {
  const path = usePathname();
  return (
    <div className="status-tabs">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} className={path === t.href ? 'tab active' : 'tab'}>{t.label}</Link>
      ))}
    </div>
  );
}
