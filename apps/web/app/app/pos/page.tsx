'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, day, money, PosRegister, PosSession, Tax, Warehouse } from '@/lib/api';
import { useSession } from '@/lib/session';

export default function Pos() {
  const { user, tenant } = useSession();
  const router = useRouter();
  const [registers, setRegisters] = useState<PosRegister[]>();
  const [sessions, setSessions] = useState<PosSession[]>([]);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<PosRegister | 'new' | null>(null);
  const isAdmin = user.role !== 'MEMBER';

  const load = useCallback(async () => {
    try {
      setRegisters(await api<PosRegister[]>('/pos/registers'));
      setSessions(await api<PosSession[]>('/pos/sessions'));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => void load(), [load]);

  async function open(r: PosRegister, float: string) {
    setError('');
    try {
      const s = await api<PosSession>('/pos/sessions', { method: 'POST', body: { registerId: r.id, openingCash: Number(float || 0) } });
      router.push(`/app/pos/${s.id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const active = registers?.filter((r) => !r.archived) ?? [];
  return (
    <>
      <h2>Point of sale</h2>
      {error && <p className="error">{error}</p>}
      {registers && active.length === 0 && <p className="muted">Add a warehouse first; a register sells from one.</p>}
      <div className="plans">
        {active.map((r) => (
          <RegisterCard key={r.id} r={r} currency={tenant.currency} onOpen={open} onEdit={isAdmin ? () => setEditing(r) : undefined} />
        ))}
      </div>
      {isAdmin && !editing && <button className="secondary" onClick={() => setEditing('new')}>Add register</button>}
      {editing && <RegisterForm register={editing === 'new' ? undefined : editing} onDone={async () => { setEditing(null); await load(); }} />}

      <h3>Recent shifts</h3>
      <section className="card">
        <table>
          <thead><tr><th>Shift</th><th>Register</th><th>Opened</th><th>Closed</th><th className="num">Expected cash</th><th className="num">Counted</th><th className="num">Difference</th></tr></thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id}>
                <td><Link href={`/app/pos/${s.id}`}>{s.number}</Link> {s.status === 'OPEN' && <span className="badge open">Open</span>}</td>
                <td>{s.register.name}</td>
                <td>{day(s.openedAt)}</td>
                <td>{day(s.closedAt)}</td>
                <td className="num">{s.expectedCash !== null ? money(s.expectedCash) : ''}</td>
                <td className="num">{s.countedCash !== null ? money(s.countedCash) : ''}</td>
                <td className={`num ${s.difference && Number(s.difference) < 0 ? 'error' : ''}`}>{s.difference !== null ? money(s.difference) : ''}</td>
              </tr>
            ))}
            {sessions.length === 0 && <tr><td colSpan={7} className="muted">No shifts yet.</td></tr>}
          </tbody>
        </table>
      </section>
    </>
  );
}

function RegisterCard({ r, currency, onOpen, onEdit }: { r: PosRegister; currency: string; onOpen: (r: PosRegister, float: string) => void; onEdit?: () => void }) {
  const [float, setFloat] = useState('');
  const openSession = r.sessions[0];
  return (
    <div className="plan">
      <h3>{r.name}</h3>
      <div className="muted">
        Sells from {r.warehouse.code}. {r.tax ? `${r.tax.name}, prices ${r.pricesIncludeTax ? 'include' : 'exclude'} tax.` : 'No tax.'}
      </div>
      <p />
      {openSession ? (
        <Link className="button" href={`/app/pos/${openSession.id}`} style={{ textAlign: 'center' }}>Continue {openSession.number}</Link>
      ) : (
        <form onSubmit={(e: FormEvent) => { e.preventDefault(); onOpen(r, float); }}>
          <label>Cash in drawer ({currency})</label>
          <input type="number" min={0} step="0.01" value={float} onChange={(e) => setFloat(e.target.value)} placeholder="0.00" />
          <button style={{ width: '100%' }}>Open shift</button>
        </form>
      )}
      {onEdit && <button className="link" style={{ marginTop: 8 }} onClick={onEdit}>Settings</button>}
    </div>
  );
}

function RegisterForm({ register, onDone }: { register?: PosRegister; onDone: () => void }) {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [taxes, setTaxes] = useState<Tax[]>([]);
  const [form, setForm] = useState({
    name: register?.name ?? '',
    warehouseId: register?.warehouseId ?? '',
    taxId: register?.taxId ?? '',
    pricesIncludeTax: register?.pricesIncludeTax ?? true,
    receiptFooter: register?.receiptFooter ?? '',
  });
  const [error, setError] = useState('');
  useEffect(() => {
    api<Warehouse[]>('/warehouses').then((w) => {
      const live = w.filter((x) => !x.archived);
      setWarehouses(live);
      setForm((f) => (f.warehouseId ? f : { ...f, warehouseId: live[0]?.id ?? '' }));
    }).catch(() => {});
    api<Tax[]>('/taxes').then((t) => setTaxes(t.filter((x) => !x.archived))).catch(() => {});
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError('');
    const body = { ...form, taxId: form.taxId || null, receiptFooter: form.receiptFooter || null };
    try {
      if (register) await api(`/pos/registers/${register.id}`, { method: 'PATCH', body });
      else await api('/pos/registers', { method: 'POST', body });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <section className="card" style={{ marginTop: 16 }}>
      <h3 style={{ marginTop: 0 }}>{register ? `${register.name} settings` : 'New register'}</h3>
      <form onSubmit={save}>
        <div className="row">
          <div><label>Name</label><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div>
            <label>Sells from</label>
            <select value={form.warehouseId} onChange={(e) => setForm({ ...form, warehouseId: e.target.value })}>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
            </select>
          </div>
          <div>
            <label>Tax</label>
            <select value={form.taxId} onChange={(e) => setForm({ ...form, taxId: e.target.value })}>
              <option value="">No tax</option>
              {taxes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label>Shelf prices</label>
            <select value={form.pricesIncludeTax ? 'inc' : 'exc'} onChange={(e) => setForm({ ...form, pricesIncludeTax: e.target.value === 'inc' })}>
              <option value="inc">Include tax</option>
              <option value="exc">Exclude tax</option>
            </select>
          </div>
        </div>
        <label>Receipt footer</label>
        <input value={form.receiptFooter} onChange={(e) => setForm({ ...form, receiptFooter: e.target.value })} placeholder="Thank you for shopping with us" />
        <div className="actions">
          <button>Save</button>
          <button type="button" className="secondary" onClick={onDone}>Cancel</button>
          {register && <button type="button" className="secondary" onClick={async () => { try { await api(`/pos/registers/${register.id}`, { method: 'PATCH', body: { archived: true } }); onDone(); } catch (e) { setError((e as Error).message); } }}>Archive</button>}
        </div>
        {error && <p className="error">{error}</p>}
      </form>
    </section>
  );
}
