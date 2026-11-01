'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Access, day, money, Plan, platformApi, PlatformInvoice, STATE_LABELS, Tenant, User } from '@/lib/api';
import { InvoiceTable } from '@/components/PlatformInvoiceTable';

type Detail = Tenant & Access & { planRef: Plan; users: (User & { createdAt: string })[]; platformInvoices: PlatformInvoice[] };
const toInput = (d: string | null) => (d ? d.slice(0, 10) : '');

export default function Company() {
  const { id } = useParams<{ id: string }>();
  const [t, setT] = useState<Detail>();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(() => platformApi<Detail>(`/tenants/${id}`).then(setT).catch((e) => setError(e.message)), [id]);
  useEffect(() => {
    void load();
    platformApi<Plan[]>('/plans').then(setPlans).catch(() => {});
  }, [load]);

  async function act(fn: () => Promise<unknown>, done: string) {
    setError('');
    setMsg('');
    try {
      await fn();
      await load();
      setMsg(done);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const update = (body: object, done: string) => act(() => platformApi(`/tenants/${id}`, { method: 'PATCH', body }), done);

  if (!t) return error ? <p className="error">{error}</p> : <p>Loading…</p>;

  return (
    <>
      <p><Link href="/platform">← Companies</Link></p>
      <h2>
        {t.name} <span className={`badge ${t.state}`}>{STATE_LABELS[t.state]}</span>
      </h2>
      <section className="card">
        <div className="facts" style={{ marginTop: 0 }}>
          <div><span>Address</span>{t.slug}</div>
          <div><span>Plan</span>{t.planRef.name} ({money(t.planRef.priceMonthly, t.planRef.currency)} / month)</div>
          <div><span>Users</span>{t.users.length}{t.planRef.maxUsers !== null && ` of ${t.planRef.maxUsers}`}</div>
          <div><span>Trial ends</span>{day(t.trialEndsAt) || '-'}</div>
          <div><span>Paid until</span>{day(t.currentPeriodEnd) || '-'}</div>
          <div><span>Signed up</span>{day(t.createdAt)}</div>
          <div><span>Email</span>{t.email || '-'}</div>
          <div><span>Phone</span>{t.phone || '-'}</div>
        </div>
        {t.statusNote && <p className="error">Note: {t.statusNote}</p>}
      </section>

      {msg && <p>{msg}</p>}
      {error && <p className="error">{error}</p>}

      <h3>Subscription</h3>
      <section className="card">
        <div className="row">
          <PlanPicker current={t.plan} plans={plans} onSave={(plan) => update({ plan }, 'Plan changed.')} />
          <DateField label="Trial ends" value={toInput(t.trialEndsAt)} onSave={(v) => update({ trialEndsAt: v, ...(t.status === 'TRIALING' ? {} : { status: 'TRIALING' }) }, 'Trial updated.')} />
          <DateField label="Paid until" value={toInput(t.currentPeriodEnd)} onSave={(v) => update({ currentPeriodEnd: v }, 'Paid-until date updated.')} />
        </div>
        <div className="actions" style={{ marginTop: 18 }}>
          {t.status === 'SUSPENDED' || t.status === 'CANCELED' ? (
            <button onClick={() => update({ status: t.currentPeriodEnd ? 'ACTIVE' : 'TRIALING', statusNote: null }, 'Company reinstated.')}>Reinstate</button>
          ) : (
            <>
              <button
                className="secondary"
                onClick={() => {
                  const note = prompt('Reason shown to the company (optional)');
                  if (note !== null) void update({ status: 'SUSPENDED', statusNote: note || null }, 'Company suspended. It is now read-only.');
                }}
              >
                Suspend
              </button>
              <button className="secondary" onClick={() => confirm(`Cancel ${t.name}'s subscription? The company becomes read-only.`) && update({ status: 'CANCELED' }, 'Subscription canceled.')}>Cancel subscription</button>
            </>
          )}
          <button className="secondary" onClick={() => act(() => platformApi('/invoices', { method: 'POST', body: { tenantId: t.id } }), 'Invoice issued.')}>Issue invoice</button>
        </div>
      </section>

      <h3>Invoices</h3>
      <section className="card">
        <InvoiceTable invoices={t.platformInvoices} onChange={load} />
      </section>

      <h3>Users</h3>
      <section className="card">
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Added</th></tr></thead>
          <tbody>
            {t.users.map((u) => (
              <tr key={u.id}><td>{u.name}</td><td>{u.email}</td><td>{u.role.toLowerCase()}</td><td>{day(u.createdAt)}</td></tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

function PlanPicker({ current, plans, onSave }: { current: string; plans: Plan[]; onSave: (code: string) => void }) {
  const [v, setV] = useState(current);
  useEffect(() => setV(current), [current]);
  return (
    <div>
      <label>Plan</label>
      <div className="actions">
        <select value={v} onChange={(e) => setV(e.target.value)} style={{ flex: 1 }}>
          {plans.map((p) => <option key={p.code} value={p.code}>{p.name}{p.active ? '' : ' (retired)'}</option>)}
        </select>
        <button className="secondary" disabled={v === current} onClick={() => onSave(v)}>Save</button>
      </div>
    </div>
  );
}

function DateField({ label, value, onSave }: { label: string; value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSave(new Date(`${v}T23:59:59`).toISOString());
  };
  return (
    <form onSubmit={submit}>
      <label>{label}</label>
      <div className="actions">
        <input type="date" required value={v} onChange={(e) => setV(e.target.value)} style={{ flex: 1 }} />
        <button className="secondary" disabled={!v || v === value}>Save</button>
      </div>
    </form>
  );
}
