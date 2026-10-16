'use client';

import { useEffect, useState } from 'react';

type StaffAccessResponse = {
  ok?: boolean;
  is_staff?: boolean;
  error?: string;
  role?: string | null;
  roles?: string[];
  is_kiosk?: boolean;
};

export function useOperatorAccess() {
  const [isLoading, setIsLoading] = useState(true);
  const [isKiosk, setIsKiosk] = useState(false);
  const [roles, setRoles] = useState<string[]>([]);
  const [role, setRole] = useState<string | null>(null);
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
          setRole(json.role ?? null);
          setRoles(json.roles ?? []);
          setIsKiosk(json.is_kiosk === true);
        }
      } catch (error) {
        console.warn('Unable to check owner dashboard access.', error);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  return { isLoading, canUseOwnerDashboard, isStaff: role === 'staff', isInstructor: roles.includes('instructor'), role, roles, isKiosk };
}

export function useOwnerDashboardAccess() {
  return useOperatorAccess().canUseOwnerDashboard;
}
