'use client';
import { useParams } from 'next/navigation';
import { useCallback } from 'react';
import { PrintDoc } from '@/components/PrintDoc';
import { api, Invoice } from '@/lib/api';

export default function PrintInvoice() {
  const { id } = useParams<{ id: string }>();
  const load = useCallback(async () => {
    const i = await api<Invoice>(`/invoices/${id}`);
    return {
      title: i.status === 'DRAFT' ? 'Draft invoice' : 'Invoice',
      number: i.number ?? 'DRAFT',
      date: i.invoiceDate,
      extraDate: { label: 'Due', value: i.dueDate },
      customer: i.customer,
      lines: i.lines ?? [],
      subtotal: i.subtotal,
      taxTotal: i.taxTotal,
      total: i.total,
      amountPaid: i.amountPaid,
      currency: i.currency,
      notes: i.notes,
    };
  }, [id]);
  return <PrintDoc load={load} />;
}
