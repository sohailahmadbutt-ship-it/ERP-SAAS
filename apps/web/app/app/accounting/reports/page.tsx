'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AccountingTabs } from '@/components/AccountingTabs';
import { api, money } from '@/lib/api';
import { useSession } from '@/lib/session';

type Row = { account: { id: string; code: string; name: string }; amount: string };
type Section = { rows: Row[]; total: string };
interface PL { from: string; to: string; income: Section; expenses: Section; netProfit: string }
interface BS { asOf: string; assets: Section; liabilities: Section; equity: Section & { currentEarnings: string }; liabilitiesAndEquity: string }
interface TB { asOf: string; rows: { account: { id: string; code: string; name: string }; debit: string; credit: string }[]; totals: { debit: string; credit: string } }

const today = () => new Date().toISOString().slice(0, 10);
const yearStart = () => `${new Date().getFullYear()}-01-01`;

function Rows({ s }: { s: Section }) {
  return (
    <>
      {s.rows.map((r) => (
        <tr key={r.account.id}>
          <td style={{ paddingLeft: 24 }}><Link href={`/app/accounting/ledger/${r.account.id}`}>{r.account.code} · {r.account.name}</Link></td>
          <td className="num">{money(r.amount)}</td>
        </tr>
      ))}
    </>
  );
}

export default function Reports() {
  const { tenant } = useSession();
  const [report, setReport] = useState<'pl' | 'bs' | 'tb'>('pl');
  const [from, setFrom] = useState(yearStart());
  const [to, setTo] = useState(today());
  const [pl, setPl] = useState<PL>();
  const [bs, setBs] = useState<BS>();
  const [tb, setTb] = useState<TB>();
  const [error, setError] = useState('');

  useEffect(() => {
    setError('');
    const go = async () => {
      if (report === 'pl') setPl(await api<PL>(`/reports/profit-loss?from=${from}&to=${to}`));
      if (report === 'bs') setBs(await api<BS>(`/reports/balance-sheet?asOf=${to}`));
      if (report === 'tb') setTb(await api<TB>(`/reports/trial-balance?asOf=${to}`));
    };
    go().catch((e) => setError(e.message));
  }, [report, from, to]);

  return (
    <>
      <h2>Accounting</h2>
      <AccountingTabs />
      <div className="row">
        <div style={{ flex: '0 0 220px' }}>
          <label>Report</label>
          <select value={report} onChange={(e) => setReport(e.target.value as typeof report)}>
            <option value="pl">Profit and loss</option>
            <option value="bs">Balance sheet</option>
            <option value="tb">Trial balance</option>
          </select>
        </div>
        {report === 'pl' && <div style={{ flex: '0 0 180px' }}><label>From</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>}
        <div style={{ flex: '0 0 180px' }}><label>{report === 'pl' ? 'To' : 'As of'}</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <button type="button" className="secondary" onClick={() => window.print()}>Print</button>
      </div>
      {error && <p className="error">{error}</p>}

      <section className="card report" style={{ marginTop: 16 }}>
        {report === 'pl' && pl && (
          <>
            <h3>Profit and loss · {pl.from} to {pl.to}</h3>
            <table>
              <tbody>
                <tr><th colSpan={2}>Income</th></tr>
                <Rows s={pl.income} />
                <tr className="subtotal"><td>Total income</td><td className="num">{money(pl.income.total)}</td></tr>
                <tr><th colSpan={2}>Expenses</th></tr>
                <Rows s={pl.expenses} />
                <tr className="subtotal"><td>Total expenses</td><td className="num">{money(pl.expenses.total)}</td></tr>
                <tr className="grand"><td>{Number(pl.netProfit) >= 0 ? 'Net profit' : 'Net loss'}</td><td className="num">{money(pl.netProfit, tenant.currency)}</td></tr>
              </tbody>
            </table>
          </>
        )}
        {report === 'bs' && bs && (
          <>
            <h3>Balance sheet · as of {bs.asOf}</h3>
            <table>
              <tbody>
                <tr><th colSpan={2}>Assets</th></tr>
                <Rows s={bs.assets} />
                <tr className="grand"><td>Total assets</td><td className="num">{money(bs.assets.total, tenant.currency)}</td></tr>
                <tr><th colSpan={2}>Liabilities</th></tr>
                <Rows s={bs.liabilities} />
                <tr className="subtotal"><td>Total liabilities</td><td className="num">{money(bs.liabilities.total)}</td></tr>
                <tr><th colSpan={2}>Equity</th></tr>
                <Rows s={bs.equity} />
                <tr><td style={{ paddingLeft: 24 }}>Current earnings</td><td className="num">{money(bs.equity.currentEarnings)}</td></tr>
                <tr className="subtotal"><td>Total equity</td><td className="num">{money(bs.equity.total)}</td></tr>
                <tr className="grand"><td>Total liabilities and equity</td><td className="num">{money(bs.liabilitiesAndEquity, tenant.currency)}</td></tr>
              </tbody>
            </table>
          </>
        )}
        {report === 'tb' && tb && (
          <>
            <h3>Trial balance · as of {tb.asOf}</h3>
            <table>
              <thead><tr><th>Account</th><th className="num">Debit</th><th className="num">Credit</th></tr></thead>
              <tbody>
                {tb.rows.map((r) => (
                  <tr key={r.account.id}>
                    <td><Link href={`/app/accounting/ledger/${r.account.id}`}>{r.account.code} · {r.account.name}</Link></td>
                    <td className="num">{Number(r.debit) ? money(r.debit) : ''}</td>
                    <td className="num">{Number(r.credit) ? money(r.credit) : ''}</td>
                  </tr>
                ))}
                <tr className="grand"><td>Total</td><td className="num">{money(tb.totals.debit)}</td><td className="num">{money(tb.totals.credit)}</td></tr>
              </tbody>
            </table>
          </>
        )}
      </section>
    </>
  );
}
