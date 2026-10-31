'use client';
import { useEffect } from 'react';
import { tenantSlug } from '@/lib/api';

export default function Home() {
  useEffect(() => {
    // On a company subdomain the root page is just the way in.
    if (tenantSlug()) window.location.replace('/app');
  }, []);
  return (
    <main className="wrap">
      <h1>Run your whole business in one place</h1>
      <p className="muted">Sales, purchasing, inventory and accounting for growing companies. Every company gets its own secure workspace.</p>
      <p>
        <a href="/signup">Start your company</a>
      </p>
    </main>
  );
}
