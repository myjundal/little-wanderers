'use client';

import { useEffect } from 'react';
import { inject } from '@vercel/analytics';

export default function AnalyticsBoot() {
  useEffect(() => {
    inject();
  }, []);

  return null;
}
