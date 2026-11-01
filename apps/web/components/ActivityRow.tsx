'use client';
import Link from 'next/link';
import { ACTIVITY_LABELS, api, CrmActivity, User } from '@/lib/api';

/** One activity with a done checkbox (notes are already done). */
export function ActivityRow({ a, users, onChange, showLead = false }: { a: CrmActivity; users: User[]; onChange: () => void; showLead?: boolean }) {
  const today = new Date().toISOString().slice(0, 10);
  const late = !a.doneAt && a.dueAt && a.dueAt.slice(0, 10) < today;
  const who = users.find((u) => u.id === a.assignedToId)?.name;
  async function toggle() {
    await api(`/crm/activities/${a.id}`, { method: 'PATCH', body: { done: !a.doneAt } });
    onChange();
  }
  return (
    <li className={a.doneAt ? 'done' : ''}>
      {a.type !== 'NOTE' && <input type="checkbox" checked={!!a.doneAt} onChange={toggle} aria-label="Done" />}
      <div className="what">
        <strong>{ACTIVITY_LABELS[a.type]}</strong> {a.summary}
        {showLead && a.lead && <div><Link href={`/app/crm/${a.lead.id}`}>{a.lead.title}</Link> <span className="muted">{a.lead.contact?.name ?? a.lead.companyName ?? ''}</span></div>}
        <div className={`muted due ${late ? 'late' : ''}`} style={{ fontSize: 12 }}>
          {a.doneAt ? `Done ${new Date(a.doneAt).toLocaleDateString()}` : a.dueAt ? `Due ${new Date(a.dueAt).toLocaleDateString()}${late ? ' (overdue)' : ''}` : 'No due date'}
          {who && ` · ${who}`}
        </div>
      </div>
    </li>
  );
}
