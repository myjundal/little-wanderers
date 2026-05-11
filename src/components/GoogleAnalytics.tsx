'use client';

import { useEffect, useState } from 'react';
import Script from 'next/script';
import { usePathname, useSearchParams } from 'next/navigation';
import { shouldLoadAnalytics } from '@/components/analyticsGate';

const GOOGLE_TAG_ID = 'G-RHZ3580FJ8';

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

export default function GoogleAnalytics() {
  const [analyticsEnabled, setAnalyticsEnabled] = useState(false);
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    setAnalyticsEnabled(shouldLoadAnalytics());
  }, []);

  useEffect(() => {
    if (!analyticsEnabled || !window.gtag) return;

    const query = searchParams.toString();
    const pagePath = query ? `${pathname}?${query}` : pathname;
    window.gtag('config', GOOGLE_TAG_ID, { page_path: pagePath });
  }, [analyticsEnabled, pathname, searchParams]);

  if (!analyticsEnabled) {
    return null;
  }

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${GOOGLE_TAG_ID}`}
        strategy="afterInteractive"
      />
      <Script id="google-tag-manager" strategy="afterInteractive">
        {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
window.gtag = gtag;
gtag('js', new Date());
gtag('config', '${GOOGLE_TAG_ID}');`}
      </Script>
    </>
  );
}
