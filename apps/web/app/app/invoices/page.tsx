'use client';
import { DocList } from '@/components/DocList';

export default function Invoices() {
  return (
    <DocList
      title="Invoices"
      endpoint="/invoices"
      basePath="/app/invoices"
      newLabel="New invoice"
      tabs={[
        { label: 'Unpaid', status: 'POSTED' },
        { label: 'Drafts', status: 'DRAFT' },
        { label: 'Paid', status: 'PAID' },
        { label: 'Cancelled', status: 'CANCELLED' },
        { label: 'All', status: '' },
      ]}
    />
  );
}
