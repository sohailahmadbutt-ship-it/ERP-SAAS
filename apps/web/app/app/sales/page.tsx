'use client';
import { DocList } from '@/components/DocList';

export default function Sales() {
  return (
    <DocList
      title="Sales"
      endpoint="/sales-orders"
      basePath="/app/sales"
      newLabel="New quotation"
      tabs={[
        { label: 'Quotations', status: 'QUOTATION' },
        { label: 'Sales orders', status: 'CONFIRMED' },
        { label: 'Cancelled', status: 'CANCELLED' },
        { label: 'All', status: '' },
      ]}
    />
  );
}
