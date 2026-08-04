import { Fraunces, Poppins, Sacramento } from 'next/font/google';
import './globals.css';
import AnalyticsBoot from '@/components/AnalyticsBoot';
import GoogleAnalytics from '@/components/GoogleAnalytics';
import PwaBoot from '@/components/pwa/PwaBoot';
import AddToHomeScreenPrompt from '@/components/pwa/AddToHomeScreenPrompt';
import NotificationPrompt from '@/components/pwa/NotificationPrompt';

const SHOW_INSTALL_PROMPT = true;
const SHOW_PUSH_PROMPT = false;

const headingFont = Fraunces({
  variable: '--font-heading',
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  display: 'swap',
});

const scriptFont = Sacramento({
  variable: '--font-script',
  subsets: ['latin'],
  weight: ['400'],
  display: 'swap',
});

const bodyFont = Poppins({
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
  description: 'Little Wanderers Play Studio & Cafe is an indoor play cafe for kids and parents in West Hartford, CT.',
  keywords: [
    'Little Wanderers West Hartford',
    'Little Wanderers Play Studio',
    'Little Wanderers Play Cafe',
    'West Hartford play studio',
    'West Hartford play cafe',
    'kids indoor play West Hartford CT',
    'Bishop’s Corner West Hartford kids',
  ],
  openGraph: {
    title: 'Little Wanderers Play Studio & Cafe',
    description: 'Indoor play studio and cafe for families in West Hartford, CT.',
    url: process.env.NEXT_PUBLIC_SITE_URL,
    siteName: 'Little Wanderers',
    type: 'website',
  },
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'),
  other: {
    'geo.region': 'US-CT',
    'geo.placename': 'West Hartford',
    'business:contact_data:locality': 'West Hartford',
    'business:contact_data:region': 'CT',
    'business:contact_data:country_name': 'United States',
  },
  viewport: 'width=device-width, initial-scale=1',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${headingFont.variable} ${bodyFont.variable} ${scriptFont.variable}`}>
      <body className="antialiased">
        <GoogleAnalytics />
        {children}
        <PwaBoot />
        {SHOW_INSTALL_PROMPT && <AddToHomeScreenPrompt />}
        {SHOW_PUSH_PROMPT && <NotificationPrompt />}
        <AnalyticsBoot />
      </body>
    </html>
  );
}
