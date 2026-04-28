'use client';

import { useEffect, useState } from 'react';
import Script from 'next/script';

const GOOGLE_TAG_ID = 'G-RHZ3580FJ8';
const PRODUCTION_HOSTNAME = 'thelittlewanderers.com';

export default function GoogleAnalytics() {
  const [shouldLoadAnalytics, setShouldLoadAnalytics] = useState(false);

  useEffect(() => {
    setShouldLoadAnalytics(window.location.hostname === PRODUCTION_HOSTNAME);
  }, []);

  if (!shouldLoadAnalytics) {
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
gtag('js', new Date());
gtag('config', '${GOOGLE_TAG_ID}');`}
      </Script>
    </>
  );
}
