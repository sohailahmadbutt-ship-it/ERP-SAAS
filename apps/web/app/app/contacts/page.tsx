'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, Contact, Page } from '@/lib/api';

export default function Contacts() {
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<Contact>>();
  const [error, setError] = useState('');

  useEffect(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: '50' });
    if (q) params.set('q', q);
    if (role) params.set('role', role);
    if (archived) params.set('archived', 'true');
    const t = setTimeout(() => {
      api<Page<Contact>>(`/contacts?${params}`).then(setData).catch((e) => setError(e.message));
    }, 200);
    return () => clearTimeout(t);
  }, [q, role, archived, page]);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>Contacts</h2>
        <Link href="/app/contacts/new" className="button">New contact</Link>
      </div>
      <div className="row">
        <div><input placeholder="Search name, email, phone, tax number" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></div>
        <div style={{ flex: '0 0 160px' }}>
          <select value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }}>
            <option value="">All</option>
            <option value="customer">Customers</option>
            <option value="vendor">Vendors</option>
          </select>
        </div>
        <label style={{ flex: '0 0 auto', margin: 0 }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={archived} onChange={(e) => { setArchived(e.target.checked); setPage(1); }} /> Archived
        </label>
      </div>
      {error && <p className="error">{error}</p>}
      <section className="card" style={{ marginTop: 16, padding: 0 }}>
        <table>
          <thead>
            <tr><th>Name</th><th>Company</th><th>Email</th><th>Phone</th><th>City</th><th>Type</th></tr>
          </thead>
          <tbody>
            {data?.items.map((c) => (
              <tr key={c.id}>
                <td><Link href={`/app/contacts/${c.id}`}>{c.name}</Link></td>
                <td>{c.parent?.name ?? ''}</td>
                <td>{c.email}</td>
                <td>{c.phone}</td>
                <td>{c.city}</td>
                <td>{[c.isCustomer && 'Customer', c.isVendor && 'Vendor'].filter(Boolean).join(', ')}</td>
              </tr>
            ))}
            {data && data.items.length === 0 && (
              <tr><td colSpan={6} className="muted">No contacts yet.</td></tr>
            )}
          </tbody>
        </table>
      </section>
      {data && pages > 1 && (
        <p>
          <button className="link" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
          {' '}Page {page} of {pages}{' '}
          <button className="link" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
        </p>
      )}
    </>
  );
}
