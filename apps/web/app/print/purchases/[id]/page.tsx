'use client';
import { useParams } from 'next/navigation';
import { useCallback } from 'react';
import { PrintDoc } from '@/components/PrintDoc';
import { api, PurchaseOrder } from '@/lib/api';

export default function PrintPurchaseOrder() {
  const { id } = useParams<{ id: string }>();
  const load = useCallback(async () => {
    const o = await api<PurchaseOrder>(`/purchase-orders/${id}`);
    return {
      title: o.status === 'RFQ' ? 'Request for quotation' : 'Purchase order',
      number: o.number,
      date: o.orderDate,
      extraDate: { label: 'Expected', value: o.expectedDate },
      customer: o.vendor,
      partyLabel: 'Vendor',
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
