'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, Page, Product } from '@/lib/api';
import { useSession } from '@/lib/session';

export default function Products() {
  const { tenant } = useSession();
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<Product>>();
  const [error, setError] = useState('');

  useEffect(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: '50' });
    if (q) params.set('q', q);
    if (type) params.set('type', type);
    if (archived) params.set('archived', 'true');
    const t = setTimeout(() => {
      api<Page<Product>>(`/products?${params}`).then(setData).catch((e) => setError(e.message));
    }, 200);
    return () => clearTimeout(t);
  }, [q, type, archived, page]);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>Products</h2>
        <Link href="/app/products/new" className="button">New product</Link>
      </div>
      <div className="row">
        <div><input placeholder="Search name, SKU or barcode" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></div>
        <div style={{ flex: '0 0 160px' }}>
          <select value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}>
            <option value="">All types</option>
            <option value="GOODS">Goods</option>
            <option value="SERVICE">Services</option>
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
            <tr><th>SKU</th><th>Name</th><th>Type</th><th className="num">Price ({tenant.currency})</th><th className="num">On hand</th></tr>
          </thead>
          <tbody>
            {data?.items.map((p) => (
              <tr key={p.id}>
                <td>{p.sku}</td>
                <td><Link href={`/app/products/${p.id}`}>{p.name}</Link></td>
                <td>{p.type === 'GOODS' ? 'Goods' : 'Service'}</td>
                <td className="num">{Number(p.salePrice).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                <td className="num">{p.onHand == null ? '' : `${Number(p.onHand).toLocaleString()} ${p.unit?.code ?? ''}`}</td>
              </tr>
            ))}
            {data && data.items.length === 0 && (
              <tr><td colSpan={5} className="muted">No products yet.</td></tr>
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
