import type { SupabaseClient } from '@supabase/supabase-js';
import { easternDate, type MembershipTier } from '@/lib/founding-membership';

export const MEMBERSHIP_MANAGEMENT_LABELS = { waitlist: 'Wanderlist Founding', public: 'General Founding', regular: 'General' } as const;
type Enrollment = { household_id: string; pricing_tier: MembershipTier; status: string; child_ids: string[]; created_at: string; paid_through?: string | null };
type GeneralMembership = { household_id: string | null; person_id?: string | null; renews_at: string | null; square_environment?: string | null };
type Child = { id: string; household_id: string; role?: string };
export type MembershipSummary = Record<MembershipTier | 'total', { memberships: number; children: number }> & { unverifiedGeneral: number };

/** Count family enrollments, not login accounts or historical membership rows. */
export function summarizeMemberships(enrollments: Enrollment[], general: GeneralMembership[], children: Child[], environment: string, now = new Date()): MembershipSummary {
  const families = new Map<string, { tier: MembershipTier; children: Set<string> }>();
  const date = easternDate(now);
  for (const row of [...enrollments].sort((a, b) => b.created_at.localeCompare(a.created_at))) {
    const current = ['pending', 'activating', 'scheduled', 'active'].includes(row.status) || (row.status === 'canceling' && Boolean(row.paid_through && row.paid_through >= date));
    if (!current || families.has(row.household_id)) continue;
    families.set(row.household_id, { tier: row.pricing_tier, children: new Set(row.child_ids) });
  }
  const currentGeneral = general.filter(row => !row.renews_at || new Date(row.renews_at) > now);
  const people = new Map(children.map(person => [person.id, person]));
  for (const row of currentGeneral) {
    if (row.square_environment !== environment) continue;
    const person = row.person_id ? people.get(row.person_id) : undefined;
    const householdId = row.household_id || person?.household_id;
    if (!householdId) continue;
    const coveredChildren = row.household_id
      ? children.filter(p => p.household_id === householdId && (!p.role || p.role === 'child')).map(p => p.id)
      : person && (!person.role || person.role === 'child') ? [person.id] : [];
    const family = families.get(householdId);
    if (family) {
      for (const child of coveredChildren) family.children.add(child);
    } else families.set(householdId, { tier: 'regular', children: new Set(coveredChildren) });
  }
  const result: MembershipSummary = { waitlist: { memberships: 0, children: 0 }, public: { memberships: 0, children: 0 }, regular: { memberships: 0, children: 0 }, total: { memberships: 0, children: 0 }, unverifiedGeneral: currentGeneral.filter(row => !['production', 'sandbox'].includes(row.square_environment || '')).length };
  for (const family of families.values()) {
    result[family.tier].memberships++; result[family.tier].children += family.children.size;
    result.total.memberships++; result.total.children += family.children.size;
  }
  return result;
}

export async function loadMembershipSummary(admin: SupabaseClient, environment: string) {
  const enrollments: Enrollment[] = [], general: GeneralMembership[] = [], children: Child[] = [];
  const now = new Date();
  // Page explicitly so totals do not silently stop at PostgREST's row limit.
  for (let offset = 0; ; offset += 500) {
    const result = await admin.from('founding_memberships').select('id,household_id,pricing_tier,status,child_ids,created_at,paid_through').eq('environment', environment).order('id').range(offset, offset + 499);
    if (result.error) throw new Error('Unable to count memberships.');
    enrollments.push(...result.data); if (result.data.length < 500) break;
  }
  for (let offset = 0; ; offset += 500) {
    const result = await admin.from('memberships').select('*').order('id').range(offset, offset + 499);
    if (result.error) throw new Error('Unable to count general memberships.');
    general.push(...result.data); if (result.data.length < 500) break;
  }
  const householdIds = [...new Set(general.filter(row => row.household_id && row.square_environment === environment && (!row.renews_at || new Date(row.renews_at) > now)).map(row => row.household_id!))];
  for (let index = 0; index < householdIds.length; index += 100) {
    for (let offset = 0; ; offset += 500) {
      const result = await admin.from('people').select('id,household_id,role').eq('role', 'child').in('household_id', householdIds.slice(index, index + 100)).order('id').range(offset, offset + 499);
      if (result.error) throw new Error('Unable to count enrolled children.');
      children.push(...result.data); if (result.data.length < 500) break;
    }
  }
  const personIds = [...new Set(general.filter(row => row.person_id && row.square_environment === environment && (!row.renews_at || new Date(row.renews_at) > now)).map(row => row.person_id!))];
  for (let index = 0; index < personIds.length; index += 100) {
    const result = await admin.from('people').select('id,household_id,role').in('id', personIds.slice(index, index + 100));
    if (result.error) throw new Error('Unable to count individual memberships.');
    children.push(...result.data);
  }
  return summarizeMemberships(enrollments, general, children, environment, now);
}
