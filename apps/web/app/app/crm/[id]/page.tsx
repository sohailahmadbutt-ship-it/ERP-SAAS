'use client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { ACTIVITY_LABELS, api, Contact, CrmActivityType, CrmLead, CrmStage, leadParty, money, Page, User } from '@/lib/api';
import { useSession } from '@/lib/session';
import { ActivityRow } from '@/components/ActivityRow';

const FIELDS = ['title', 'companyName', 'personName', 'email', 'phone', 'source', 'expectedRevenue', 'expectedClose', 'notes'] as const;
type Field = (typeof FIELDS)[number];

export default function Lead() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { tenant } = useSession();
  const [lead, setLead] = useState<CrmLead>();
  const [stages, setStages] = useState<CrmStage[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [form, setForm] = useState<Record<Field, string>>();
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const fill = (l: CrmLead) => {
    setLead(l);
    setForm({
      title: l.title,
      companyName: l.companyName ?? '',
      personName: l.personName ?? '',
      email: l.email ?? '',
      phone: l.phone ?? '',
      source: l.source ?? '',
      expectedRevenue: String(Number(l.expectedRevenue)),
      expectedClose: l.expectedClose?.slice(0, 10) ?? '',
      notes: l.notes ?? '',
    });
  };
  const load = useCallback(() => api<CrmLead>(`/crm/leads/${id}`).then(fill).catch((e) => setError(e.message)), [id]);
  const loadContacts = () => api<Page<Contact>>('/contacts?pageSize=200').then((p) => setContacts(p.items)).catch(() => {});
  useEffect(() => {
    void load();
    api<CrmStage[]>('/crm/stages').then((s) => setStages(s.filter((x) => !x.archived))).catch(() => {});
    api<User[]>('/users').then(setUsers).catch(() => {});
    void loadContacts();
  }, [load]);

  async function act(fn: () => Promise<CrmLead>, done = '') {
    setError('');
    setMsg('');
    try {
      fill(await fn());
      setMsg(done);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const patch = (body: object, done = 'Saved.') => act(() => api<CrmLead>(`/crm/leads/${id}`, { method: 'PATCH', body }), done);

  if (!lead || !form) return error ? <p className="error">{error}</p> : <p>Loading…</p>;
  const stage = lead.stage!;
  const closed = stage.isWon || stage.isLost;

  function save(e: FormEvent) {
    e.preventDefault();
    const f = form!;
    const opt = (v: string) => (v.trim() === '' ? null : v.trim());
    void patch({
      title: f.title,
      companyName: opt(f.companyName),
      personName: opt(f.personName),
      email: opt(f.email),
      phone: opt(f.phone),
      source: opt(f.source),
      expectedRevenue: Number(f.expectedRevenue || 0),
      expectedClose: opt(f.expectedClose),
      notes: opt(f.notes),
    });
  }
  const input = (k: Field, label: string, type = 'text') => (
    <div><label>{label}</label><input type={type} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} /></div>
  );

  return (
    <>
      <p><Link href="/app/crm">← Pipeline</Link></p>
      <div className="actions" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>
          {lead.title}{' '}
          <span className={`badge ${stage.isWon ? 'paid' : stage.isLost ? 'cancelled' : 'open'}`}>{stage.name}</span>
        </h2>
        <div className="actions">
          {!closed && <button onClick={() => act(() => api(`/crm/leads/${id}/won`, { method: 'POST' }), 'Marked as won.')}>Won</button>}
          {!closed && (
            <button className="secondary" onClick={() => { const r = prompt('Why was it lost? (optional)'); if (r !== null) void act(() => api(`/crm/leads/${id}/lost`, { method: 'POST', body: { reason: r || undefined } }), 'Marked as lost.'); }}>
              Lost
            </button>
          )}
          {lead.salesOrder ? (
            <Link className="button secondary-link" href={`/app/sales/${lead.salesOrder.id}`}>Quotation {lead.salesOrder.number}</Link>
          ) : (
            <button className="secondary" onClick={() => act(async () => { const l = await api<CrmLead>(`/crm/leads/${id}/quotation`, { method: 'POST' }); await loadContacts(); return l; }, 'Quotation created. Add the products on it.')}>Create quotation</button>
          )}
        </div>
      </div>
      <p className="muted">
        {leadParty(lead) || 'No customer yet'} · {money(lead.expectedRevenue, tenant.currency)}
        {lead.lostReason && ` · Lost: ${lead.lostReason}`}
      </p>
      {msg && <p>{msg}{msg.startsWith('Quotation') && lead.salesOrder && <> <Link href={`/app/sales/${lead.salesOrder.id}`}>Open {lead.salesOrder.number}</Link></>}</p>}
      {error && <p className="error">{error}</p>}

      <div className="row" style={{ alignItems: 'flex-start' }}>
        <section className="card" style={{ flex: 3 }}>
          <div className="row">
            <div>
              <label>Stage</label>
              <select value={lead.stageId} onChange={(e) => {
                const to = stages.find((s) => s.id === e.target.value)!;
                if (to.isLost) { const r = prompt('Why was it lost? (optional)'); if (r !== null) void act(() => api(`/crm/leads/${id}/lost`, { method: 'POST', body: { reason: r || undefined } }), 'Marked as lost.'); return; }
                void patch({ stageId: to.id }, `Moved to ${to.name}.`);
              }}>
                {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label>Salesperson</label>
              <select value={lead.ownerId ?? ''} onChange={(e) => patch({ ownerId: e.target.value || null })}>
                <option value="">Nobody</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
            <div>
              <label>Priority</label>
              <select value={lead.priority} onChange={(e) => patch({ priority: Number(e.target.value) })}>
                {[0, 1, 2, 3].map((p) => <option key={p} value={p}>{p ? '★'.repeat(p) : 'Normal'}</option>)}
              </select>
            </div>
            <div>
              <label>Customer</label>
              <select value={lead.contactId ?? ''} onChange={(e) => patch({ contactId: e.target.value || null })}>
                <option value="">Not linked (prospect)</option>
                {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>
          <form onSubmit={save}>
            <div className="row">{input('title', 'Opportunity')}{input('expectedRevenue', 'Expected revenue', 'number')}{input('expectedClose', 'Expected close', 'date')}</div>
            <div className="row">{input('companyName', 'Company')}{input('personName', 'Contact person')}{input('email', 'Email', 'email')}{input('phone', 'Phone')}{input('source', 'Source')}</div>
            <label>Notes</label>
            <textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            <div className="actions">
              <button>Save</button>
              <button type="button" className="secondary" onClick={async () => { if (confirm('Archive this lead?')) { await api(`/crm/leads/${id}`, { method: 'PATCH', body: { archived: true } }); router.push('/app/crm'); } }}>Archive</button>
            </div>
          </form>
        </section>
        <section className="card" style={{ flex: 2 }}>
          <h3 style={{ marginTop: 0 }}>Activities</h3>
          <AddActivity leadId={id} users={users} onAdded={load} />
          <ul className="timeline">
            {lead.activities.map((a) => <ActivityRow key={a.id} a={a} users={users} onChange={load} />)}
            {lead.activities.length === 0 && <li className="muted">Nothing planned yet.</li>}
          </ul>
        </section>
      </div>
    </>
  );
}

function AddActivity({ leadId, users, onAdded }: { leadId: string; users: User[]; onAdded: () => void }) {
  const { user } = useSession();
  const [type, setType] = useState<CrmActivityType>('CALL');
  const [summary, setSummary] = useState('');
  const [due, setDue] = useState('');
  const [assignee, setAssignee] = useState(user.id);
  const [error, setError] = useState('');

  async function add(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api(`/crm/leads/${leadId}/activities`, { method: 'POST', body: { type, summary, dueAt: type !== 'NOTE' && due ? new Date(`${due}T09:00:00`).toISOString() : undefined, assignedToId: assignee || null } });
      setSummary('');
      setDue('');
      onAdded();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <form onSubmit={add} style={{ marginBottom: 12 }}>
      <div className="tabs" style={{ flexWrap: 'wrap' }}>
        {(Object.keys(ACTIVITY_LABELS) as CrmActivityType[]).map((t) => (
          <button type="button" key={t} className={`tab ${type === t ? 'active' : ''}`} onClick={() => setType(t)}>{ACTIVITY_LABELS[t]}</button>
        ))}
      </div>
      <input required style={{ marginTop: 8 }} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder={type === 'NOTE' ? 'What happened?' : 'What needs doing?'} />
      {type !== 'NOTE' && (
        <div className="row">
          <div><label>Due</label><input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></div>
          <div>
            <label>Assigned to</label>
            <select value={assignee} onChange={(e) => setAssignee(e.target.value)}>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
          </div>
        </div>
      )}
      <button>{type === 'NOTE' ? 'Log note' : 'Schedule'}</button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
