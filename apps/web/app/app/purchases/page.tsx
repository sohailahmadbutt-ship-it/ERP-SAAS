'use client';
import { DocList } from '@/components/DocList';

export default function Purchases() {
  return (
    <DocList
      title="Purchases"
      endpoint="/purchase-orders"
      basePath="/app/purchases"
      newLabel="New request for quotation"
      partyLabel="Vendor"
      purchase
      tabs={[
        { label: 'Requests for quotation', status: 'RFQ' },
        { label: 'Purchase orders', status: 'CONFIRMED' },
        { label: 'Cancelled', status: 'CANCELLED' },
        { label: 'All', status: '' },
      ]}
    />
  );
}
