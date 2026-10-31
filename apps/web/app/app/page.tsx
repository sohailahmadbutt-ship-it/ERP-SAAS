'use client';
import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError, clearToken, setToken, Tenant, User } from '@/lib/api';

const MODULES = ['Sales', 'Purchase', 'Inventory', 'Accounting', 'Point of Sale', 'CRM'];

export default function Dashboard() {
  const [me, setMe] = useState<{ tenant: Tenant; user: User }>();
  const [users, setUsers] = useState<User[]>([]);
  const [invite, setInvite] = useState({ name: '', email: '', password: '', role: 'MEMBER' });
  const [error, setError] = useState('');

  useEffect(() => {
    const m = /token=([^&]+)/.exec(window.location.hash);
    if (m) {
      setToken(decodeURIComponent(m[1]));
      history.replaceState(null, '', '/app');
    }
    load().catch((err) => {
      if (err instanceof ApiError && (err.status === 401 || err.status === 404)) window.location.href = '/login';
      else setError(err.message);
    });
  }, []);

  async function load() {
    const [meRes, usersRes] = await Promise.all([
      api<{ tenant: Tenant; user: User }>('/auth/me'),
      api<User[]>('/users'),
    ]);
    setMe(meRes);
    setUsers(usersRes);
  }

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

  function logout() {
    clearToken();
    window.location.href = '/login';
  }

  if (!me) return <main className="wrap">{error ? <p className="error">{error}</p> : 'Loading…'}</main>;
  const canManage = me.user.role !== 'MEMBER';

  return (
    <>
      <header className="topbar">
        <strong>{me.tenant.name}</strong>
        <span>
          {me.user.name} · <button className="link" onClick={logout}>Sign out</button>
        </span>
      </header>
      <main className="wrap">
        <h2>Apps</h2>
        <div className="grid">
          {MODULES.map((m) => (
            <div key={m} className="tile">
              {m}
              <br />
              <small>Coming soon</small>
            </div>
          ))}
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
          {canManage && (
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
      </main>
    </>
  );
}
