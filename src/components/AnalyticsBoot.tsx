'use client';

import { useEffect } from 'react';
import { inject } from '@vercel/analytics';
import { shouldLoadAnalytics } from '@/components/analyticsGate';

export default function AnalyticsBoot() {
  useEffect(() => {
    if (!shouldLoadAnalytics()) return;
    inject();
  }, []);

  return null;
}
