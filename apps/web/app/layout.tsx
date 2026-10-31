import './globals.css';
import type { ReactNode } from 'react';

export const metadata = { title: 'ERP SaaS', description: 'Cloud ERP for growing businesses' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
