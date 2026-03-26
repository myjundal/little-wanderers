import { Quicksand, Nunito } from 'next/font/google';
import { Analytics } from '@vercel/analytics/next';
import './globals.css';

const headingFont = Quicksand({
  variable: '--font-heading',
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  display: 'swap',
});

const bodyFont = Nunito({
  variable: '--font-body',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

export const metadata = {
  title: {
    default: 'Little Wanderers',
    template: '%s — Little Wanderers',
  },
  description: 'Sensory & learning play adventure for kids and parents in West Hartford.',
  openGraph: {
    title: 'Little Wanderers',
    description: 'Play, learn, and wander in West Hartford.',
    url: process.env.NEXT_PUBLIC_SITE_URL,
    siteName: 'Little Wanderers',
    type: 'website',
  },
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'),
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${headingFont.variable} ${bodyFont.variable}`}>
      <body className="antialiased">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
