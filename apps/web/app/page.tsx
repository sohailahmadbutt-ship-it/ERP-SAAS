'use client';
import { useEffect, useState } from 'react';
import { api, money, Plan, tenantSlug } from '@/lib/api';

export default function Home() {
  const [plans, setPlans] = useState<Plan[]>([]);
  useEffect(() => {
    // On a company subdomain the root page is just the way in.
    if (tenantSlug()) window.location.replace('/app');
    else api<Plan[]>('/plans').then(setPlans).catch(() => {});
  }, []);
  return (
    <main className="wrap">
      <h1>Run your whole business in one place</h1>
      <p className="muted">Sales, purchasing, inventory and accounting for growing companies. Every company gets its own secure workspace.</p>
      <p>
        <a className="button" href="/signup">Start your free 14-day trial</a>
      </p>
      {plans.length > 0 && (
        <>
          <h2 style={{ marginTop: 40 }}>Pricing</h2>
          <div className="plans">
            {plans.map((p) => (
              <div key={p.code} className="plan">
                <h3>{p.name}</h3>
                <div className="price">{money(p.priceMonthly, p.currency)} <small>/ month</small></div>
                <div className="muted">{p.maxUsers === null ? 'Unlimited users' : `Up to ${p.maxUsers} users`}</div>
                <p>{p.description}</p>
                <a href={`/signup?plan=${p.code}`}>Try {p.name} free</a>
              </div>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
