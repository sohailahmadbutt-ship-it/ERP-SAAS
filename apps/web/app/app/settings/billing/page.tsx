'use client';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, BillingOverview, day, money, Plan, PlatformInvoice, STATE_LABELS } from '@/lib/api';
import { useSession } from '@/lib/session';
import { SettingsTabs } from '@/components/SettingsTabs';
import { InvoiceBadge } from '@/components/InvoiceBadge';

export default function Billing() {
  const { user, reload } = useSession();
  const [data, setData] = useState<BillingOverview>();
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const isOwner = user.role === 'OWNER';

  const load = useCallback(() => api<BillingOverview>('/billing').then(setData).catch((e) => setError(e.message)), []);
  useEffect(() => void load(), [load]);

  async function act(fn: () => Promise<unknown>, done: string) {
    setError('');
    setMsg('');
    try {
      await fn();
      await Promise.all([load(), reload()]);
      setMsg(done);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!data) return <><SettingsTabs />{error ? <p className="error">{error}</p> : <p>Loading…</p>}</>;

  const inTrial = data.state === 'trial';
  const open = data.invoices.find((i) => i.status === 'OPEN');
  const seats = data.plan.maxUsers === null ? `${data.userCount} (unlimited)` : `${data.userCount} of ${data.plan.maxUsers}`;

  function planButton(p: Plan) {
    if (!isOwner) return null;
    const tooSmall = p.maxUsers !== null && data!.userCount > p.maxUsers;
    if (tooSmall) return <button disabled title={`You have ${data!.userCount} users`}>Too few users</button>;
    if (inTrial && p.code !== data!.plan.code) {
      return <button className="secondary" onClick={() => act(() => api('/billing/plan', { method: 'PATCH', body: { planCode: p.code } }), `You're now trying ${p.name}.`)}>Try this plan</button>;
    }
    const label = open?.planCode === p.code ? 'New invoice' : p.code === data!.plan.code && !inTrial ? 'Renew' : 'Subscribe';
    return <button onClick={() => act(() => api('/billing/checkout', { method: 'POST', body: { planCode: p.code } }), `Invoice issued for ${p.name}. Pay it below to activate.`)}>{label}</button>;
  }

  return (
    <>
      <SettingsTabs />
      <section className="card">
        <h2 style={{ marginTop: 0 }}>
          {data.plan.name} plan <span className={`badge ${data.state}`}>{STATE_LABELS[data.state]}</span>
        </h2>
        {data.statusNote && <p className="error">{data.statusNote}</p>}
        <div className="facts">
          <div><span>Price</span>{money(data.plan.priceMonthly, data.plan.currency)} / month</div>
          <div><span>Users</span>{seats}</div>
          {data.status === 'TRIALING' && <div><span>Trial ends</span>{day(data.trialEndsAt)}{data.daysLeft !== null && inTrial ? ` (${data.daysLeft} days left)` : ''}</div>}
          {data.currentPeriodEnd && <div><span>Paid until</span>{day(data.currentPeriodEnd)}</div>}
          {data.state === 'past_due' && <div><span>Read-only in</span>{data.daysLeft} days</div>}
        </div>
        {!isOwner && <p className="muted">Only the company owner can change the plan.</p>}
      </section>

      {open && <OpenInvoice inv={open} instructions={data.paymentInstructions} onReport={(ref) => act(() => api(`/billing/invoices/${open.id}/payment`, { method: 'POST', body: { reference: ref } }), 'Thanks. We will confirm your payment shortly.')} />}

      {msg && <p>{msg}</p>}
      {error && <p className="error">{error}</p>}

      <h3>Plans</h3>
      <p className="muted">{inTrial ? 'Try any plan during your trial. Subscribe when you are ready; paid time starts when the trial ends.' : 'Subscribing issues an invoice for one month. The plan starts once it is paid.'}</p>
      <div className="plans">
        {data.plans.map((p) => (
          <div key={p.code} className={`plan ${p.code === data.plan.code ? 'current' : ''}`}>
            <h3>{p.name}</h3>
            <div className="price">{money(p.priceMonthly, p.currency)} <small>/ month</small></div>
            <div className="muted">{p.maxUsers === null ? 'Unlimited users' : `Up to ${p.maxUsers} users`}</div>
            <p>{p.description}</p>
            {p.code === data.plan.code && <span className="muted">Current plan</span>}
            {planButton(p)}
          </div>
        ))}
      </div>

      <h3>Invoices</h3>
      <section className="card">
        {data.invoices.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>No invoices yet.</p>
        ) : (
          <table>
            <thead><tr><th>Number</th><th>Plan</th><th>Period</th><th>Due</th><th className="num">Amount</th><th>Status</th></tr></thead>
            <tbody>
              {data.invoices.map((i) => (
                <tr key={i.id}>
                  <td>{i.number}</td>
                  <td>{i.planName}</td>
                  <td>{day(i.periodStart)} to {day(i.periodEnd)}</td>
                  <td>{day(i.dueDate)}</td>
                  <td className="num">{money(i.amount, i.currency)}</td>
                  <td><InvoiceBadge inv={i} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

function OpenInvoice({ inv, instructions, onReport }: { inv: PlatformInvoice; instructions: string; onReport: (ref: string) => void }) {
  const [ref, setRef] = useState(inv.paymentReference ?? '');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onReport(ref);
  };
  return (
    <section className="card" style={{ marginTop: 16 }}>
      <h3 style={{ marginTop: 0 }}>Invoice {inv.number} is open: {money(inv.amount, inv.currency)}</h3>
      <p>{inv.planName} plan, {day(inv.periodStart)} to {day(inv.periodEnd)}. Due {day(inv.dueDate)}.</p>
      <p className="muted" style={{ whiteSpace: 'pre-line' }}>{instructions}</p>
      <form onSubmit={submit} className="row">
        <div>
          <label>Payment reference</label>
          <input required minLength={3} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Bank transfer or wallet transaction ID" />
        </div>
        <div style={{ flex: '0 0 auto' }}><button>{inv.reportedAt ? 'Update reference' : 'I have paid'}</button></div>
      </form>
      {inv.reportedAt && <p className="muted">Reported {day(inv.reportedAt)}. We will mark it paid once the money arrives.</p>}
    </section>
  );
}
