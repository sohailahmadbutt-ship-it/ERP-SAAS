'use client';
import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { api, User } from '@/lib/api';
import { useSession } from '@/lib/session';

const MODULES: { name: string; href?: string }[] = [
  { name: 'Contacts', href: '/app/contacts' },
  { name: 'Sales', href: '/app/sales' },
  { name: 'Invoices', href: '/app/invoices' },
  { name: 'Purchase' },
  { name: 'Products', href: '/app/products' },
  { name: 'Inventory', href: '/app/inventory' },
  { name: 'Accounting' },
  { name: 'Point of Sale' },
  { name: 'CRM' },
];

export default function Home() {
  const { user } = useSession();
  const [users, setUsers] = useState<User[]>([]);
  const [invite, setInvite] = useState({ name: '', email: '', password: '', role: 'MEMBER' });
  const [error, setError] = useState('');

  const load = () => api<User[]>('/users').then(setUsers);
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  async function addUser(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api('/users', { method: 'POST', body: invite });
      setInvite({ name: '', email: '', password: '', role: 'MEMBER' });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <>
      <h2>Apps</h2>
      <div className="grid">
        {MODULES.map((m) =>
          m.href ? (
            <Link key={m.name} href={m.href} className="tile live">{m.name}</Link>
          ) : (
            <div key={m.name} className="tile">
              {m.name}
              <br />
              <small>Coming soon</small>
            </div>
          ),
        )}
      </div>

      <section className="card">
        <h3>Team</h3>
        <table>
          <thead>
            <tr><th>Name</th><th>Email</th><th>Role</th></tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}><td>{u.name}</td><td>{u.email}</td><td>{u.role}</td></tr>
            ))}
          </tbody>
        </table>
        {user.role !== 'MEMBER' && (
          <form onSubmit={addUser} className="row">
            <div><label>Name</label><input required value={invite.name} onChange={(e) => setInvite({ ...invite, name: e.target.value })} /></div>
            <div><label>Email</label><input required type="email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} /></div>
            <div><label>Temporary password</label><input required minLength={8} type="password" value={invite.password} onChange={(e) => setInvite({ ...invite, password: e.target.value })} /></div>
            <div>
              <label>Role</label>
              <select value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value })}>
                <option value="MEMBER">Member</option>
                <option value="ADMIN">Admin</option>
              </select>
            </div>
            <button>Add user</button>
          </form>
        )}
        {error && <p className="error">{error}</p>}
      </section>
    </>
  );
}
