'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, Contact, day, money, Page, POS_METHOD_LABELS, PosMethod, PosOrder, PosProduct, PosSession } from '@/lib/api';
import { useSession } from '@/lib/session';

interface CartLine {
  product: PosProduct;
  quantity: number;
  discountPct: number;
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Same arithmetic as the API, for the live total. The API's numbers are what get saved. */
function lineTotals(l: CartLine, rate: number, inclusive: boolean) {
  const gross = l.quantity * Number(l.product.salePrice) * (100 - l.discountPct) / 100;
  if (inclusive) {
    const total = r2(gross);
    const subtotal = r2(total * 100 / (100 + rate));
    return { subtotal, tax: r2(total - subtotal), total };
  }
  const subtotal = r2(gross);
  const tax = r2(subtotal * rate / 100);
  return { subtotal, tax, total: r2(subtotal + tax) };
}

export default function Register() {
  const { id } = useParams<{ id: string }>();
  const { tenant } = useSession();
  const [session, setSession] = useState<PosSession>();
  const [tab, setTab] = useState<'sell' | 'orders' | 'close'>('sell');
  const [error, setError] = useState('');

  const load = useCallback(() => api<PosSession>(`/pos/sessions/${id}`).then(setSession).catch((e) => setError(e.message)), [id]);
  useEffect(() => void load(), [load]);

  if (!session) return error ? <p className="error">{error}</p> : <p>Loading…</p>;
  const cur = tenant.currency;

  if (session.status === 'CLOSED') {
    return (
      <div className="pos-report">
        <p><Link href="/app/pos">← Point of sale</Link></p>
        <h2>{session.number} · {session.register.name} <span className="badge">Closed</span></h2>
        <ShiftSummary session={session} currency={cur} />
        <h3>Orders</h3>
        <Orders sessionId={session.id} currency={cur} />
      </div>
    );
  }

  return (
    <>
      <div className="actions" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>{session.register.name} · {session.number}</h2>
        <div className="tabs">
          {(['sell', 'orders', 'close'] as const).map((t) => (
            <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => { setTab(t); void load(); }}>
              {{ sell: 'Sell', orders: 'Orders', close: 'Close shift' }[t]}
            </button>
          ))}
        </div>
      </div>
      {tab === 'sell' && <Sell session={session} currency={cur} onSold={load} />}
      {tab === 'orders' && <Orders sessionId={session.id} currency={cur} refundInto={session.id} onRefund={load} />}
      {tab === 'close' && <CloseShift session={session} currency={cur} onClosed={load} />}
    </>
  );
}

function Sell({ session, currency, onSold }: { session: PosSession; currency: string; onSold: () => void }) {
  const [q, setQ] = useState('');
  const [products, setProducts] = useState<PosProduct[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customers, setCustomers] = useState<Contact[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [method, setMethod] = useState<PosMethod>('CASH');
  const [tendered, setTendered] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<PosOrder>();
  const [refresh, setRefresh] = useState(0);
  const search = useRef<HTMLInputElement>(null);

  const rate = Number(session.register.tax?.rate ?? 0);
  const inclusive = session.register.pricesIncludeTax;

  useEffect(() => {
    const t = setTimeout(() => {
      api<PosProduct[]>(`/pos/sessions/${session.id}/products${q ? `?q=${encodeURIComponent(q)}` : ''}`).then(setProducts).catch((e) => setError(e.message));
    }, 150);
    return () => clearTimeout(t);
  }, [q, session.id, refresh]);
  useEffect(() => {
    api<Page<Contact>>('/contacts?pageSize=200').then((p) => setCustomers(p.items.filter((c) => c.isCustomer))).catch(() => {});
    search.current?.focus();
  }, []);

  const totals = useMemo(() => {
    const ls = cart.map((l) => lineTotals(l, rate, inclusive));
    return { subtotal: r2(ls.reduce((a, l) => a + l.subtotal, 0)), tax: r2(ls.reduce((a, l) => a + l.tax, 0)), total: r2(ls.reduce((a, l) => a + l.total, 0)) };
  }, [cart, rate, inclusive]);
  const paid = method === 'CASH' ? Number(tendered || totals.total) : totals.total;
  const change = method === 'CASH' ? r2(paid - totals.total) : 0;

  function add(p: PosProduct) {
    setDone(undefined);
    setCart((c) => {
      const i = c.findIndex((l) => l.product.id === p.id);
      if (i < 0) return [...c, { product: p, quantity: 1, discountPct: 0 }];
      return c.map((l, j) => (j === i ? { ...l, quantity: l.quantity + 1 } : l));
    });
  }
  const setLine = (i: number, patch: Partial<CartLine>) => setCart((c) => c.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  // A barcode scanner types the code and presses Enter.
  function onSearchKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const exact = products.find((p) => p.barcode === q.trim() || p.sku?.toLowerCase() === q.trim().toLowerCase());
    const pick = exact ?? (products.length === 1 ? products[0] : undefined);
    if (pick) {
      add(pick);
      setQ('');
    }
  }

  async function charge(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const order = await api<PosOrder>('/pos/orders', {
        method: 'POST',
        body: {
          sessionId: session.id,
          customerId: customerId || undefined,
          lines: cart.map((l) => ({ productId: l.product.id, quantity: l.quantity, discountPct: l.discountPct || undefined })),
          payments: [{ method, amount: paid, reference: reference || undefined }],
        },
      });
      setDone(order);
      setCart([]);
      setTendered('');
      setReference('');
      setCustomerId('');
      setQ('');
      setRefresh((n) => n + 1); // stock on the tiles changed
      onSold();
      search.current?.focus();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const quick = [...new Set([totals.total, Math.ceil(totals.total / 100) * 100, Math.ceil(totals.total / 500) * 500, Math.ceil(totals.total / 1000) * 1000, 5000].filter((v) => v >= totals.total))].slice(0, 5);

  return (
    <div className="pos">
      <div>
        <input ref={search} placeholder="Search or scan a barcode, then press Enter" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onSearchKey} />
        <div className="pos-tiles">
          {products.map((p) => {
            const out = p.onHand !== null && Number(p.onHand) <= 0;
            return (
              <button key={p.id} className="pos-tile" disabled={out} onClick={() => add(p)}>
                <strong>{p.name}</strong>
                <span>{money(p.salePrice, currency)}</span>
                <span>{p.onHand === null ? 'Service' : out ? 'Out of stock' : `${Number(p.onHand)} ${p.unit.code} in stock`}</span>
              </button>
            );
          })}
          {products.length === 0 && <p className="muted">No products match.</p>}
        </div>
      </div>

      <section className="card pos-cart">
        {done && (
          <div className="banner" style={{ margin: '-24px -24px 16px', borderRadius: '10px 10px 0 0', background: '#e5f6ea', borderColor: '#b7e2c4', color: '#1d5c30' }}>
            {done.number} paid. Change {money(done.change, currency)}.{' '}
            <a href={`/print/pos/${done.id}`} target="_blank" rel="noreferrer">Print receipt</a>
          </div>
        )}
        {cart.length === 0 ? (
          <p className="muted">Tap a product or scan a barcode to start a sale.</p>
        ) : (
          <table>
            <tbody>
              {cart.map((l, i) => (
                <tr key={l.product.id}>
                  <td>
                    {l.product.name}
                    <div className="muted" style={{ fontSize: 12 }}>
                      {money(l.product.salePrice)}
                      {l.discountPct > 0 && ` less ${l.discountPct}%`} ·{' '}
                      <button className="link" style={{ fontSize: 12 }} onClick={() => { const d = prompt('Discount %', String(l.discountPct)); if (d !== null) setLine(i, { discountPct: Math.min(100, Math.max(0, Number(d) || 0)) }); }}>discount</button>
                    </div>
                  </td>
                  <td><input className="qty" type="number" min={0.001} step="any" value={l.quantity} onChange={(e) => setLine(i, { quantity: Number(e.target.value) })} /></td>
                  <td className="num">{money(lineTotals(l, rate, inclusive).total)}</td>
                  <td><button className="link" aria-label="Remove" onClick={() => setCart(cart.filter((_, j) => j !== i))}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="muted" style={{ textAlign: 'right', marginTop: 8, fontSize: 13 }}>
          {rate > 0 && <>Tax {money(totals.tax)} {inclusive ? 'included' : 'added'} · </>}{cart.reduce((a, l) => a + l.quantity, 0)} items
        </div>
        <div className="pos-total">{money(totals.total, currency)}</div>

        <form onSubmit={charge}>
          <label>Customer</label>
          <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">Walk-in customer</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <label>Payment</label>
          <div className="pos-methods">
            {(Object.keys(POS_METHOD_LABELS) as PosMethod[]).map((m) => (
              <button type="button" key={m} className={method === m ? '' : 'secondary'} onClick={() => setMethod(m)}>{POS_METHOD_LABELS[m]}</button>
            ))}
          </div>
          {method === 'CASH' ? (
            <>
              <label>Cash received</label>
              <input type="number" min={0} step="0.01" value={tendered} onChange={(e) => setTendered(e.target.value)} placeholder={totals.total.toFixed(2)} />
              <div className="pos-quick">
                {cart.length > 0 && quick.map((v) => <button type="button" key={v} className="secondary" onClick={() => setTendered(String(v))}>{v === totals.total ? 'Exact' : money(v)}</button>)}
              </div>
              {change > 0 && <div className="pos-change">Change {money(change, currency)}</div>}
            </>
          ) : (
            <>
              <label>{method === 'CARD' ? 'Card approval code' : 'Wallet transaction ID'} (optional)</label>
              <input value={reference} onChange={(e) => setReference(e.target.value)} />
            </>
          )}
          <button className="big" disabled={busy || cart.length === 0 || cart.some((l) => !(l.quantity > 0)) || change < 0}>
            {busy ? 'Charging…' : `Charge ${money(totals.total, currency)}`}
          </button>
          {error && <p className="error">{error}</p>}
        </form>
      </section>
    </div>
  );
}

function Orders({ sessionId, currency, refundInto, onRefund }: { sessionId: string; currency: string; refundInto?: string; onRefund?: () => void }) {
  const { user } = useSession();
  const [orders, setOrders] = useState<PosOrder[]>();
  const [error, setError] = useState('');
  const load = useCallback(() => api<Page<PosOrder>>(`/pos/orders?sessionId=${sessionId}`).then((p) => setOrders(p.items)).catch((e) => setError(e.message)), [sessionId]);
  useEffect(() => void load(), [load]);

  async function refund(o: PosOrder) {
    if (!confirm(`Refund ${o.number} in full (${money(o.total, currency)})? The goods go back into stock.`)) return;
    setError('');
    try {
      await api(`/pos/orders/${o.id}/refund`, { method: 'POST', body: { sessionId: refundInto } });
      await load();
      onRefund?.();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <section className="card">
      {error && <p className="error">{error}</p>}
      <table>
        <thead><tr><th>Order</th><th>Time</th><th>Customer</th><th>Paid by</th><th className="num">Total</th><th></th></tr></thead>
        <tbody>
          {orders?.map((o) => (
            <tr key={o.id}>
              <td>{o.number} {o.status === 'REFUNDED' && <span className="badge cancelled">Refunded</span>}{Number(o.total) < 0 && <span className="badge">Refund</span>}</td>
              <td>{new Date(o.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
              <td>{o.customer?.name ?? 'Walk-in'}</td>
              <td>{o.payments.map((p) => POS_METHOD_LABELS[p.method]).join(', ')}</td>
              <td className="num">{money(o.total, currency)}</td>
              <td>
                <div className="actions">
                  <a href={`/print/pos/${o.id}`} target="_blank" rel="noreferrer">Receipt</a>
                  {refundInto && user.role !== 'MEMBER' && o.status === 'PAID' && Number(o.total) > 0 && <button className="link" onClick={() => refund(o)}>Refund</button>}
                </div>
              </td>
            </tr>
          ))}
          {orders?.length === 0 && <tr><td colSpan={6} className="muted">No orders yet.</td></tr>}
        </tbody>
      </table>
    </section>
  );
}

function ShiftSummary({ session, currency }: { session: PosSession; currency: string }) {
  const t = session.totals;
  return (
    <section className="card">
      <div className="facts" style={{ marginTop: 0 }}>
        <div><span>Opened</span>{day(session.openedAt)} {new Date(session.openedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
        <div><span>Sales</span>{t?.orders ?? 0} orders · {money(t?.sales ?? 0, currency)}</div>
        <div><span>Refunds</span>{t?.refunds ?? 0} · {money(t?.refunded ?? 0, currency)}</div>
        {(Object.keys(POS_METHOD_LABELS) as PosMethod[]).map((m) => (
          <div key={m}><span>{POS_METHOD_LABELS[m]} taken</span>{money(t?.byMethod[m] ?? 0, currency)}</div>
        ))}
        <div><span>Opening cash</span>{money(session.openingCash, currency)}</div>
        <div><span>Expected cash</span>{money(session.expectedCash ?? 0, currency)}</div>
        {session.status === 'CLOSED' && (
          <>
            <div><span>Counted cash</span>{money(session.countedCash ?? 0, currency)}</div>
            <div style={{ color: Number(session.difference) < 0 ? '#b42318' : undefined }}><span>Difference</span>{money(session.difference ?? 0, currency)}</div>
          </>
        )}
      </div>
      {session.closingNote && <p className="muted">Note: {session.closingNote}</p>}
    </section>
  );
}

function CloseShift({ session, currency, onClosed }: { session: PosSession; currency: string; onClosed: () => void }) {
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const diff = counted === '' ? null : r2(Number(counted) - Number(session.expectedCash ?? 0));

  async function close(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api(`/pos/sessions/${session.id}/close`, { method: 'POST', body: { countedCash: Number(counted), note: note || undefined } });
      onClosed();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <>
      <ShiftSummary session={session} currency={currency} />
      <section className="card" style={{ marginTop: 16, maxWidth: 520 }}>
        <h3 style={{ marginTop: 0 }}>Count the drawer</h3>
        <form onSubmit={close}>
          <label>Cash counted ({currency})</label>
          <input required type="number" min={0} step="0.01" value={counted} onChange={(e) => setCounted(e.target.value)} />
          {diff !== null && (
            <p className={diff < 0 ? 'error' : 'muted'}>
              {diff === 0 ? 'The drawer matches.' : diff < 0 ? `${money(-diff, currency)} short.` : `${money(diff, currency)} over.`}
            </p>
          )}
          <label>Note (optional)</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} />
          <button>Close shift</button>
          {error && <p className="error">{error}</p>}
        </form>
      </section>
    </>
  );
}
