'use client';
import { useParams } from 'next/navigation';
import { useCallback } from 'react';
import { PrintDoc } from '@/components/PrintDoc';
import { api, Bill } from '@/lib/api';

export default function PrintBill() {
  const { id } = useParams<{ id: string }>();
  const load = useCallback(async () => {
    const b = await api<Bill>(`/bills/${id}`);
    return {
      title: b.status === 'DRAFT' ? 'Draft vendor bill' : 'Vendor bill',
      number: `${b.number ?? 'DRAFT'}${b.vendorRef ? ` (vendor ${b.vendorRef})` : ''}`,
      date: b.billDate,
      extraDate: { label: 'Due', value: b.dueDate },
      customer: b.vendor,
      partyLabel: 'Vendor',
      lines: b.lines ?? [],
      subtotal: b.subtotal,
      taxTotal: b.taxTotal,
      total: b.total,
      amountPaid: b.amountPaid,
      currency: b.currency,
      notes: b.notes,
    };
  }, [id]);
  return <PrintDoc load={load} />;
}
