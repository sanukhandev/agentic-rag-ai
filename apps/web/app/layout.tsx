import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Grounded Sales Assistant', description: 'Tenant-scoped source-grounded customer chat' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
