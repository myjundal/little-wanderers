'use client';

import { useEffect, useState } from 'react';

type StaffAccessResponse = {
  ok?: boolean;
  is_staff?: boolean;
  error?: string;
};

export function useOwnerDashboardAccess() {
  const [canUseOwnerDashboard, setCanUseOwnerDashboard] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch('/api/auth/staff', { cache: 'no-store' });
        const json = (await response.json()) as StaffAccessResponse;

        if (!response.ok || !json.ok) {
          console.warn('Unable to check owner dashboard access.', json.error ?? response.statusText);
          return;
        }

        if (!cancelled) {
          setCanUseOwnerDashboard(json.is_staff === true);
        }
      } catch (error) {
        console.warn('Unable to check owner dashboard access.', error);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  return canUseOwnerDashboard;
}
