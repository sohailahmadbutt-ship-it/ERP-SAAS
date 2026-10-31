'use client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { StockMoveForm } from '@/components/StockMoveForm';
import { api, MOVE_LABELS, Page, Product, StockMove, Unit, Warehouse } from '@/lib/api';

type Form = { name: string; sku: string; barcode: string; type: 'GOODS' | 'SERVICE'; unitId: string; salePrice: string; cost: string; description: string };
const EMPTY: Form = { name: '', sku: '', barcode: '', type: 'GOODS', unitId: '', salePrice: '0', cost: '0', description: '' };

const toForm = (p: Product): Form => ({
  name: p.name, sku: p.sku ?? '', barcode: p.barcode ?? '', type: p.type, unitId: p.unitId,
  salePrice: p.salePrice, cost: p.cost, description: p.description ?? '',
});

const toBody = (f: Form) => ({
  ...f,
  sku: f.sku || null, barcode: f.barcode || null, description: f.description || null,
  salePrice: Number(f.salePrice || 0), cost: Number(f.cost || 0),
});

export default function ProductPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const isNew = id === 'new';
  const [form, setForm] = useState<Form>(EMPTY);
  const [product, setProduct] = useState<Product>();
  const [units, setUnits] = useState<Unit[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [moves, setMoves] = useState<StockMove[]>([]);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    if (isNew) return;
    const [p, m] = await Promise.all([api<Product>(`/products/${id}`), api<Page<StockMove>>(`/stock/moves?productId=${id}&pageSize=20`)]);
    setProduct(p);
    setForm(toForm(p));
    setMoves(m.items);
  }, [id, isNew]);

  useEffect(() => {
    api<Unit[]>('/units').then((u) => {
      setUnits(u);
      if (isNew) setForm((f) => ({ ...f, unitId: f.unitId || u.find((x) => x.code === 'pcs')?.id || u[0]?.id || '' }));
    });
    api<Warehouse[]>('/warehouses').then(setWarehouses);
    load().catch((e) => setError(e.message));
  }, [isNew, load]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm({ ...form, [k]: v });

  async function save(e: FormEvent) {
    e.preventDefault();
    setError('');
    setMsg('');
    try {
      if (isNew) {
        const p = await api<Product>('/products', { method: 'POST', body: toBody(form) });
        router.replace(`/app/products/${p.id}`);
      } else {
        await api(`/products/${id}`, { method: 'PATCH', body: toBody(form) });
        await load();
        setMsg('Saved');
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function toggleArchive() {
    if (!product) return;
    try {
      await api(`/products/${id}`, { method: 'PATCH', body: { archived: !product.archived } });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const unitCode = units.find((u) => u.id === form.unitId)?.code ?? '';

  return (
    <>
      <p><Link href="/app/products">← Products</Link></p>
      <section className="card" style={{ maxWidth: 820 }}>
        <h2>{isNew ? 'New product' : form.name}{product?.archived && <span className="muted"> (archived)</span>}</h2>
        <form onSubmit={save}>
          <div className="row">
            <div style={{ flex: 2 }}><label>Name</label><input required value={form.name} onChange={(e) => set('name', e.target.value)} /></div>
            <div><label>SKU</label><input value={form.sku} onChange={(e) => set('sku', e.target.value)} /></div>
            <div><label>Barcode</label><input value={form.barcode} onChange={(e) => set('barcode', e.target.value)} /></div>
          </div>
          <div className="row">
            <div>
              <label>Type</label>
              <select value={form.type} onChange={(e) => set('type', e.target.value as Form['type'])}>
                <option value="GOODS">Goods (tracked in stock)</option>
                <option value="SERVICE">Service</option>
              </select>
            </div>
            <div>
              <label>Unit</label>
              <select value={form.unitId} onChange={(e) => set('unitId', e.target.value)}>
                {units.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.code})</option>)}
              </select>
            </div>
            <div><label>Sale price</label><input type="number" step="0.01" min={0} value={form.salePrice} onChange={(e) => set('salePrice', e.target.value)} /></div>
            <div><label>Cost</label><input type="number" step="0.01" min={0} value={form.cost} onChange={(e) => set('cost', e.target.value)} /></div>
          </div>
          <label>Description</label>
          <textarea rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} />
          <div className="row">
            <button>{isNew ? 'Create' : 'Save'}</button>
            {product && <button type="button" className="secondary" onClick={toggleArchive}>{product.archived ? 'Restore' : 'Archive'}</button>}
          </div>
          {msg && <p>{msg}</p>}
          {error && <p className="error">{error}</p>}
        </form>
      </section>

      {product?.type === 'GOODS' && (
        <section className="card" style={{ maxWidth: 820, marginTop: 16 }}>
          <h3>Stock</h3>
          <table>
            <thead><tr><th>Warehouse</th><th className="num">On hand</th></tr></thead>
            <tbody>
              {product.stock?.map((s) => (
                <tr key={s.warehouse.id}><td>{s.warehouse.code} · {s.warehouse.name}</td><td className="num">{Number(s.quantity).toLocaleString()} {unitCode}</td></tr>
              ))}
            </tbody>
          </table>
          {!product.archived && warehouses.length > 0 && (
            <div style={{ marginTop: 16 }}><StockMoveForm product={product} warehouses={warehouses} onDone={load} /></div>
          )}
          {moves.length > 0 && (
            <>
              <h4>Recent moves</h4>
              <table>
                <thead><tr><th>Date</th><th>Type</th><th>Warehouse</th><th className="num">Qty</th><th>Reference</th></tr></thead>
                <tbody>
                  {moves.map((m) => (
                    <tr key={m.id}>
                      <td>{new Date(m.createdAt).toLocaleString()}</td>
                      <td>{MOVE_LABELS[m.type]}</td>
                      <td>{m.warehouse.code}</td>
                      <td className="num">{Number(m.quantity) > 0 ? '+' : ''}{Number(m.quantity).toLocaleString()}</td>
                      <td>{m.reference}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>
      )}
    </>
  );
}
