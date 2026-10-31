'use client';
import { FormEvent, useState } from 'react';
import { api, Product, Warehouse } from '@/lib/api';

type Kind = 'RECEIPT' | 'DELIVERY' | 'TRANSFER' | 'COUNT';
const KINDS: { value: Kind; label: string }[] = [
  { value: 'RECEIPT', label: 'Receive' },
  { value: 'DELIVERY', label: 'Deliver' },
  { value: 'TRANSFER', label: 'Transfer' },
  { value: 'COUNT', label: 'Count' },
];

/** Records a stock operation. Pass `product` to fix the product (product page). */
export function StockMoveForm({
  products,
  product,
  warehouses,
  onDone,
}: {
  products?: Product[];
  product?: Product;
  warehouses: Warehouse[];
  onDone: () => void;
}) {
  const active = warehouses.filter((w) => !w.archived);
  const [kind, setKind] = useState<Kind>('RECEIPT');
  const [productId, setProductId] = useState(product?.id ?? '');
  const [warehouseId, setWarehouseId] = useState(active[0]?.id ?? '');
  const [toWarehouseId, setToWarehouseId] = useState(active[1]?.id ?? '');
  const [quantity, setQuantity] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [reference, setReference] = useState('');
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setMsg('');
    const body: Record<string, unknown> = { kind, productId, warehouseId, reference: reference || undefined };
    if (kind === 'COUNT') body.countedQuantity = Number(quantity);
    else body.quantity = Number(quantity);
    if (kind === 'TRANSFER') body.toWarehouseId = toWarehouseId;
    if (kind === 'RECEIPT' && unitCost) body.unitCost = Number(unitCost);
    try {
      const moves = await api<unknown[]>('/stock/moves', { method: 'POST', body });
      setMsg(moves.length ? 'Recorded' : 'Count matches stock; nothing to adjust');
      setQuantity('');
      setUnitCost('');
      setReference('');
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="tabs">
        {KINDS.map((k) => (
          <button type="button" key={k.value} className={kind === k.value ? 'tab active' : 'tab'} onClick={() => setKind(k.value)}>
            {k.label}
          </button>
        ))}
      </div>
      <div className="row">
        {!product && (
          <div style={{ flex: 2 }}>
            <label>Product</label>
            <select required value={productId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">Choose…</option>
              {products?.filter((p) => p.type === 'GOODS').map((p) => (
                <option key={p.id} value={p.id}>{p.sku ? `[${p.sku}] ` : ''}{p.name}</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label>{kind === 'TRANSFER' ? 'From' : 'Warehouse'}</label>
          <select
            value={warehouseId}
            onChange={(e) => {
              setWarehouseId(e.target.value);
              // Keep the destination different from the source.
              if (e.target.value === toWarehouseId) setToWarehouseId(active.find((w) => w.id !== e.target.value)?.id ?? '');
            }}
          >
            {active.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
          </select>
        </div>
        {kind === 'TRANSFER' && (
          <div>
            <label>To</label>
            <select value={toWarehouseId} onChange={(e) => setToWarehouseId(e.target.value)}>
              {active.filter((w) => w.id !== warehouseId).map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
            </select>
          </div>
        )}
        <div>
          <label>{kind === 'COUNT' ? 'Counted quantity' : 'Quantity'}</label>
          <input required type="number" step="0.001" min={kind === 'COUNT' ? 0 : 0.001} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </div>
        {kind === 'RECEIPT' && (
          <div>
            <label>Unit cost</label>
            <input type="number" step="0.01" min={0} value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
          </div>
        )}
        <div>
          <label>Reference</label>
          <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. PO-12" />
        </div>
        <button>Record</button>
      </div>
      {msg && <p>{msg}</p>}
      {error && <p className="error">{error}</p>}
    </form>
  );
}
