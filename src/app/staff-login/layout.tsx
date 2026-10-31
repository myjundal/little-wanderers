import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Staff iPad Login',
  manifest: '/staff.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'LW Staff',
    statusBarStyle: 'default',
  },
  icons: {
    apple: '/logo.png',
  },
};

export default function StaffLoginLayout({ children }: { children: ReactNode }) {
  return children;
}
