'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, CrmActivity, User } from '@/lib/api';
import { ActivityRow } from '@/components/ActivityRow';
import { CrmTabs } from '@/components/CrmTabs';

const SECTIONS = [
  { when: 'overdue', title: 'Overdue' },
  { when: 'today', title: 'Today' },
  { when: 'upcoming', title: 'Later' },
] as const;

export default function Activities() {
  const [lists, setLists] = useState<Record<string, CrmActivity[]>>({});
  const [users, setUsers] = useState<User[]>([]);
  const [everyone, setEveryone] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await Promise.all(SECTIONS.map((s) => api<CrmActivity[]>(`/crm/activities?when=${s.when}${everyone ? '' : '&mine=true'}`)));
      setLists(Object.fromEntries(SECTIONS.map((s, i) => [s.when, res[i]])));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [everyone]);
  useEffect(() => void load(), [load]);
  useEffect(() => {
    api<User[]>('/users').then(setUsers).catch(() => {});
  }, []);

  return (
    <>
      <CrmTabs />
      <div className="tabs" style={{ marginBottom: 12 }}>
        <button className={`tab ${everyone ? '' : 'active'}`} onClick={() => setEveryone(false)}>Mine</button>
        <button className={`tab ${everyone ? 'active' : ''}`} onClick={() => setEveryone(true)}>Everyone</button>
      </div>
      {error && <p className="error">{error}</p>}
      {SECTIONS.map((s) => (
        <section key={s.when} className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>{s.title} <span className="muted">{lists[s.when]?.length ?? ''}</span></h3>
          <ul className="timeline">
            {lists[s.when]?.map((a) => <ActivityRow key={a.id} a={a} users={users} onChange={load} showLead />)}
            {lists[s.when]?.length === 0 && <li className="muted">Nothing here.</li>}
          </ul>
        </section>
      ))}
    </>
  );
}
