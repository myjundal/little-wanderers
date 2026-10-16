'use client';

import { useEffect, useState } from 'react';

type StaffAccessResponse = {
  ok?: boolean;
  is_staff?: boolean;
  error?: string;
  role?: string | null;
  roles?: string[];
};

export function useOperatorAccess() {
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

  return { canUseOwnerDashboard, isStaff: role === 'staff', isInstructor: roles.includes('instructor'), role, roles };
}

export function useOwnerDashboardAccess() {
  return useOperatorAccess().canUseOwnerDashboard;
}
