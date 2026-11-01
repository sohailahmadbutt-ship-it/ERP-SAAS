'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Account, api, day, money } from '@/lib/api';

interface Ledger {
  account: Account;
  openingBalance: string;
  closingBalance: string;
  lines: {
    id: string;
    date: string;
    debit: string;
    credit: string;
    balance: string;
    description: string | null;
    entry: { id: string; number: string; memo: string | null; reference: string | null };
    contact: { id: string; name: string } | null;
  }[];
}

export default function LedgerPage() {
  const { id } = useParams<{ id: string }>();
  const [from, setFrom] = useState(`${new Date().getFullYear()}-01-01`);
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<Ledger>();
  const [error, setError] = useState('');

  useEffect(() => {
    api<Ledger>(`/reports/ledger?accountId=${id}&from=${from}&to=${to}`).then(setData).catch((e) => setError(e.message));
  }, [id, from, to]);

  return (
    <>
      <p><Link href="/app/accounting">← Chart of accounts</Link></p>
      <h2>{data ? `${data.account.code} · ${data.account.name}` : 'Ledger'}</h2>
      <div className="row">
        <div style={{ flex: '0 0 180px' }}><label>From</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div style={{ flex: '0 0 180px' }}><label>To</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
      </div>
      {error && <p className="error">{error}</p>}
      {data && (
        <section className="card" style={{ marginTop: 16 }}>
          <table>
            <thead><tr><th>Date</th><th>Entry</th><th>Details</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th></tr></thead>
            <tbody>
              <tr className="muted"><td colSpan={5}>Opening balance</td><td className="num">{money(data.openingBalance)}</td></tr>
              {data.lines.map((l) => (
                <tr key={l.id}>
                  <td>{day(l.date)}</td>
                  <td>{l.entry.number}</td>
                  <td>{l.entry.memo}{l.contact && <span className="muted"> · {l.contact.name}</span>}</td>
                  <td className="num">{Number(l.debit) ? money(l.debit) : ''}</td>
                  <td className="num">{Number(l.credit) ? money(l.credit) : ''}</td>
                  <td className="num">{money(l.balance)}</td>
                </tr>
              ))}
              <tr className="grand"><td colSpan={5}>Closing balance</td><td className="num">{money(data.closingBalance)}</td></tr>
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
