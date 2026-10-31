'use client';
import { DocList } from '@/components/DocList';

export default function Bills() {
  return (
    <DocList
      title="Vendor bills"
      endpoint="/bills"
      basePath="/app/bills"
      newLabel="New bill"
      partyLabel="Vendor"
      purchase
      tabs={[
        { label: 'To pay', status: 'POSTED' },
        { label: 'Drafts', status: 'DRAFT' },
        { label: 'Paid', status: 'PAID' },
        { label: 'Cancelled', status: 'CANCELLED' },
        { label: 'All', status: '' },
      ]}
    />
  );
}
