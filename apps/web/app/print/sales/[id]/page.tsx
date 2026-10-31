'use client';
import { useParams } from 'next/navigation';
import { useCallback } from 'react';
import { PrintDoc } from '@/components/PrintDoc';
import { api, SalesOrder } from '@/lib/api';

export default function PrintSalesOrder() {
  const { id } = useParams<{ id: string }>();
  const load = useCallback(async () => {
    const o = await api<SalesOrder>(`/sales-orders/${id}`);
    return {
      title: o.status === 'QUOTATION' ? 'Quotation' : 'Sales order',
      number: o.number,
      date: o.orderDate,
      extraDate: { label: 'Valid until', value: o.status === 'QUOTATION' ? o.validUntil : null },
      customer: o.customer,
      lines: o.lines ?? [],
      subtotal: o.subtotal,
      taxTotal: o.taxTotal,
      total: o.total,
      currency: o.currency,
      notes: o.notes,
    };
  }, [id]);
  return <PrintDoc load={load} />;
}
