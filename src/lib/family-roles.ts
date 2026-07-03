export const FAMILY_PRIMARY_CAREGIVER_ROLE = 'primary_caregiver';
export const FAMILY_CAREGIVER_ROLE = 'caregiver';
export const FAMILY_MEMBER_ROLE = 'member';

export const FAMILY_MANAGER_ROLES = [
  FAMILY_PRIMARY_CAREGIVER_ROLE,
  FAMILY_CAREGIVER_ROLE,
  'owner',
  'admin',
];

export function isFamilyManagerRole(role: string | null | undefined) {
  return FAMILY_MANAGER_ROLES.includes(role ?? '');
}

export function normalizeFamilyInviteRole(input: unknown): typeof FAMILY_CAREGIVER_ROLE | typeof FAMILY_MEMBER_ROLE {
  return input === FAMILY_CAREGIVER_ROLE || input === 'admin' ? FAMILY_CAREGIVER_ROLE : FAMILY_MEMBER_ROLE;
}
