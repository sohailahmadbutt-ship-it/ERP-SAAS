'use client';
import Link from 'next/link';
import { DragEvent, FormEvent, useCallback, useEffect, useState } from 'react';
import { api, CrmLead, CrmStage, leadParty, money, User } from '@/lib/api';
import { useSession } from '@/lib/session';
import { CrmTabs } from '@/components/CrmTabs';

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

interface Summary {
  open: { count: number; value: string; weighted: string };
  wonThisMonth: { count: number; value: string };
  lostThisMonth: { count: number; value: string };
}

export default function Pipeline() {
  const { tenant, user } = useSession();
  const [stages, setStages] = useState<CrmStage[]>([]);
  const [leads, setLeads] = useState<CrmLead[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [summary, setSummary] = useState<Summary>();
  const [q, setQ] = useState('');
  const [mine, setMine] = useState(false);
  const [adding, setAdding] = useState(false);
  const [dragging, setDragging] = useState<string>();
  const [over, setOver] = useState<string>();
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ status: 'all', ...(q ? { q } : {}), ...(mine ? { ownerId: user.id } : {}) });
      const [s, l, sum] = await Promise.all([api<CrmStage[]>('/crm/stages'), api<CrmLead[]>(`/crm/leads?${params}`), api<Summary>('/crm/summary')]);
      setStages(s.filter((x) => !x.archived));
      setLeads(l);
      setSummary(sum);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [q, mine, user.id]);
  useEffect(() => {
    const t = setTimeout(() => void load(), 200);
    return () => clearTimeout(t);
  }, [load]);
  useEffect(() => {
    api<User[]>('/users').then(setUsers).catch(() => {});
  }, []);

  async function drop(e: DragEvent, stage: CrmStage) {
    e.preventDefault();
    setOver(undefined);
    const id = dragging;
    setDragging(undefined);
    const lead = leads.find((l) => l.id === id);
    if (!lead || lead.stageId === stage.id) return;
    let body: object = { stageId: stage.id };
    let path = `/crm/leads/${lead.id}`;
    let method = 'PATCH';
    if (stage.isLost) {
      const reason = prompt(`Why was "${lead.title}" lost? (optional)`);
      if (reason === null) return;
      body = { reason: reason || undefined };
      path += '/lost';
      method = 'POST';
    }
    setLeads((ls) => ls.map((l) => (l.id === lead.id ? { ...l, stageId: stage.id } : l)));
    try {
      await api(path, { method, body });
    } catch (err) {
      setError((err as Error).message);
    }
    await load();
  }

  const ownerName = (id: string | null) => users.find((u) => u.id === id)?.name;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <CrmTabs />
      {summary && (
        <div className="grid" style={{ marginTop: 0 }}>
          <div className="tile">Open pipeline<div className="stat">{money(summary.open.value, tenant.currency)}</div>{plural(summary.open.count, 'lead')}</div>
          <div className="tile">Weighted forecast<div className="stat">{money(summary.open.weighted, tenant.currency)}</div>by stage probability</div>
          <div className="tile">Won this month<div className="stat">{money(summary.wonThisMonth.value, tenant.currency)}</div>{plural(summary.wonThisMonth.count, 'lead')}</div>
          <div className="tile">Lost this month<div className="stat">{summary.lostThisMonth.count}</div>{money(summary.lostThisMonth.value)}</div>
        </div>
      )}
      <div className="row" style={{ marginBottom: 12 }}>
        <div><input placeholder="Search leads, companies, people" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div style={{ flex: '0 0 auto' }}>
          <div className="tabs">
            <button className={`tab ${mine ? '' : 'active'}`} onClick={() => setMine(false)}>Everyone</button>
            <button className={`tab ${mine ? 'active' : ''}`} onClick={() => setMine(true)}>Mine</button>
          </div>
        </div>
        <div style={{ flex: '0 0 auto' }}>{!adding && <button style={{ margin: 0 }} onClick={() => setAdding(true)}>New lead</button>}</div>
      </div>
      {adding && <NewLead stages={stages} onDone={async () => { setAdding(false); await load(); }} />}
      {error && <p className="error">{error}</p>}

      <div className="board">
        {stages.map((s) => {
          const col = leads.filter((l) => l.stageId === s.id);
          const total = col.reduce((a, l) => a + Number(l.expectedRevenue), 0);
          return (
            <div
              key={s.id}
              className={`board-col ${s.isWon ? 'won' : ''} ${s.isLost ? 'lost' : ''} ${over === s.id ? 'drop' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setOver(s.id); }}
              onDragLeave={() => setOver(undefined)}
              onDrop={(e) => drop(e, s)}
              data-stage={s.name}
            >
              <h4><span>{s.name}</span><span className="muted">{col.length}</span></h4>
              <div className="sum">{money(total)}{!s.isWon && !s.isLost && ` · ${s.probability}%`}</div>
              {col.map((l) => {
                const next = l.activities[0];
                const late = next?.dueAt && next.dueAt.slice(0, 10) < today;
                return (
                  <Link key={l.id} href={`/app/crm/${l.id}`} className="lead-card" draggable onDragStart={() => setDragging(l.id)}>
                    <strong>{l.title}</strong>
                    <div className="muted">{leadParty(l)}</div>
                    <div className="actions" style={{ justifyContent: 'space-between', marginTop: 4 }}>
                      <span>{money(l.expectedRevenue)}</span>
                      <span className="stars">{'★'.repeat(l.priority)}</span>
                    </div>
                    {next && !s.isWon && !s.isLost && (
                      <div className={`muted due ${late ? 'late' : ''}`}>
                        {next.summary}{next.dueAt && ` · ${new Date(next.dueAt).toLocaleDateString()}`}
                      </div>
                    )}
                    {ownerName(l.ownerId) && <div className="muted">{ownerName(l.ownerId)}</div>}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </div>
    </>
  );
}

function NewLead({ stages, onDone }: { stages: CrmStage[]; onDone: () => void }) {
  const open = stages.filter((s) => !s.isWon && !s.isLost);
  const [form, setForm] = useState({ title: '', companyName: '', personName: '', email: '', phone: '', expectedRevenue: '', source: '', stageId: open[0]?.id ?? '' });
  const [error, setError] = useState('');
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  async function save(e: FormEvent) {
    e.preventDefault();
    setError('');
    const body = Object.fromEntries(Object.entries(form).filter(([, v]) => v.trim() !== ''));
    try {
      await api('/crm/leads', { method: 'POST', body: { ...body, expectedRevenue: form.expectedRevenue ? Number(form.expectedRevenue) : undefined } });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <form onSubmit={save}>
        <div className="row">
          <div style={{ flex: 2 }}><label>What is the opportunity?</label><input required value={form.title} onChange={set('title')} placeholder="e.g. 50 laptops for the Lahore office" /></div>
          <div><label>Expected revenue</label><input type="number" min={0} step="0.01" value={form.expectedRevenue} onChange={set('expectedRevenue')} /></div>
          <div>
            <label>Stage</label>
            <select value={form.stageId} onChange={set('stageId')}>{open.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          </div>
        </div>
        <div className="row">
          <div><label>Company</label><input value={form.companyName} onChange={set('companyName')} /></div>
          <div><label>Contact person</label><input value={form.personName} onChange={set('personName')} /></div>
          <div><label>Email</label><input type="email" value={form.email} onChange={set('email')} /></div>
          <div><label>Phone</label><input value={form.phone} onChange={set('phone')} /></div>
          <div><label>Source</label><input value={form.source} onChange={set('source')} placeholder="Website, referral…" /></div>
        </div>
        <div className="actions">
          <button>Add lead</button>
          <button type="button" className="secondary" onClick={onDone}>Cancel</button>
        </div>
        {error && <p className="error">{error}</p>}
      </form>
    </section>
  );
}
