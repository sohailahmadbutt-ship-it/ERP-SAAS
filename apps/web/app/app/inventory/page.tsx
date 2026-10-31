'use client';
import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { StockMoveForm } from '@/components/StockMoveForm';
import { api, MOVE_LABELS, Page, Product, StockLevel, StockMove, Warehouse } from '@/lib/api';

export default function Inventory() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [levels, setLevels] = useState<StockLevel[]>([]);
  const [moves, setMoves] = useState<StockMove[]>([]);
  const [filterWh, setFilterWh] = useState('');
  const [q, setQ] = useState('');
  const [newWh, setNewWh] = useState({ code: '', name: '' });
  const [error, setError] = useState('');

  const loadStock = useCallback(async () => {
    const params = new URLSearchParams();
    if (filterWh) params.set('warehouseId', filterWh);
    if (q) params.set('q', q);
    const [l, m] = await Promise.all([
      api<StockLevel[]>(`/stock/levels?${params}`),
      api<Page<StockMove>>(`/stock/moves?pageSize=20${filterWh ? `&warehouseId=${filterWh}` : ''}`),
    ]);
    setLevels(l);
    setMoves(m.items);
  }, [filterWh, q]);

  const loadWarehouses = () => api<Warehouse[]>('/warehouses').then(setWarehouses);

  useEffect(() => {
    loadWarehouses().catch((e) => setError(e.message));
    api<Page<Product>>('/products?type=GOODS&pageSize=200').then((p) => setProducts(p.items)).catch(() => {});
  }, []);

  useEffect(() => {
    const t = setTimeout(() => loadStock().catch((e) => setError(e.message)), 200);
    return () => clearTimeout(t);
  }, [loadStock]);

  async function addWarehouse(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api('/warehouses', { method: 'POST', body: newWh });
      setNewWh({ code: '', name: '' });
      await loadWarehouses();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function toggleWarehouse(w: Warehouse) {
    try {
      await api(`/warehouses/${w.id}`, { method: 'PATCH', body: { archived: !w.archived } });
      await loadWarehouses();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <>
      <h2>Inventory</h2>
      {error && <p className="error">{error}</p>}

      <section className="card">
        <h3>Record a stock operation</h3>
        {warehouses.length > 0 && <StockMoveForm products={products} warehouses={warehouses} onDone={loadStock} />}
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3>Stock on hand</h3>
          <div className="row" style={{ flex: '0 1 480px' }}>
            <div><input placeholder="Search product or SKU" value={q} onChange={(e) => setQ(e.target.value)} /></div>
            <div>
              <select value={filterWh} onChange={(e) => setFilterWh(e.target.value)}>
                <option value="">All warehouses</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
              </select>
            </div>
          </div>
        </div>
        <table>
          <thead><tr><th>Product</th><th>Warehouse</th><th className="num">On hand</th></tr></thead>
          <tbody>
            {levels.map((l) => (
              <tr key={`${l.product.id}:${l.warehouse.id}`}>
                <td><Link href={`/app/products/${l.product.id}`}>{l.product.sku ? `[${l.product.sku}] ` : ''}{l.product.name}</Link></td>
                <td>{l.warehouse.code}</td>
                <td className={Number(l.quantity) < 0 ? 'num error' : 'num'}>{Number(l.quantity).toLocaleString()} {l.product.unit}</td>
              </tr>
            ))}
            {levels.length === 0 && <tr><td colSpan={3} className="muted">No stock yet. Record a receipt above.</td></tr>}
          </tbody>
        </table>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <h3>Recent moves</h3>
        <table>
          <thead><tr><th>Date</th><th>Product</th><th>Type</th><th>Warehouse</th><th className="num">Qty</th><th>Reference</th></tr></thead>
          <tbody>
            {moves.map((m) => (
              <tr key={m.id}>
                <td>{new Date(m.createdAt).toLocaleString()}</td>
                <td><Link href={`/app/products/${m.product.id}`}>{m.product.name}</Link></td>
                <td>{MOVE_LABELS[m.type]}</td>
                <td>{m.warehouse.code}</td>
                <td className="num">{Number(m.quantity) > 0 ? '+' : ''}{Number(m.quantity).toLocaleString()}</td>
                <td>{m.reference}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <h3>Warehouses</h3>
        <table>
          <thead><tr><th>Code</th><th>Name</th><th></th></tr></thead>
          <tbody>
            {warehouses.map((w) => (
              <tr key={w.id} className={w.archived ? 'muted' : ''}>
                <td>{w.code}</td>
                <td>{w.name}{w.archived && ' (archived)'}</td>
                <td className="num"><button className="link" onClick={() => toggleWarehouse(w)}>{w.archived ? 'Restore' : 'Archive'}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <form onSubmit={addWarehouse} className="row">
          <div style={{ flex: '0 0 120px' }}><label>Code</label><input required maxLength={10} value={newWh.code} onChange={(e) => setNewWh({ ...newWh, code: e.target.value })} /></div>
          <div><label>Name</label><input required value={newWh.name} onChange={(e) => setNewWh({ ...newWh, name: e.target.value })} /></div>
          <button>Add warehouse</button>
        </form>
      </section>
    </>
  );
}
