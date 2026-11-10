import type { SupabaseClient } from '@supabase/supabase-js';
import { easternDate, type MembershipTier } from '@/lib/founding-membership';

export const MEMBERSHIP_MANAGEMENT_LABELS = { waitlist: 'Wanderlist Founding', public: 'General Founding', regular: 'General' } as const;
type Enrollment = { household_id: string; pricing_tier: MembershipTier; status: string; child_ids: string[]; created_at: string; paid_through?: string | null };
type GeneralMembership = { household_id: string | null; renews_at: string | null; square_environment?: string | null };
type Child = { id: string; household_id: string };
export type MembershipSummary = Record<MembershipTier | 'total', { memberships: number; children: number }>;

/** Count family enrollments, not login accounts or historical membership rows. */
export function summarizeMemberships(enrollments: Enrollment[], general: GeneralMembership[], children: Child[], environment: string, now = new Date()): MembershipSummary {
  const families = new Map<string, { tier: MembershipTier; children: Set<string> }>();
  const date = easternDate(now);
  for (const row of [...enrollments].sort((a, b) => b.created_at.localeCompare(a.created_at))) {
    const current = ['pending', 'activating', 'scheduled', 'active'].includes(row.status) || (row.status === 'canceling' && Boolean(row.paid_through && row.paid_through >= date));
    if (!current || families.has(row.household_id)) continue;
    families.set(row.household_id, { tier: row.pricing_tier, children: new Set(row.child_ids) });
  }
  for (const row of general) {
    if (!row.household_id || families.has(row.household_id) || (row.square_environment || 'production') !== environment || (row.renews_at && new Date(row.renews_at) <= now)) continue;
    families.set(row.household_id, { tier: 'regular', children: new Set(children.filter(p => p.household_id === row.household_id).map(p => p.id)) });
  }
  const result: MembershipSummary = { waitlist: { memberships: 0, children: 0 }, public: { memberships: 0, children: 0 }, regular: { memberships: 0, children: 0 }, total: { memberships: 0, children: 0 } };
  for (const family of families.values()) {
    result[family.tier].memberships++; result[family.tier].children += family.children.size;
    result.total.memberships++; result.total.children += family.children.size;
  }
  return result;
}

export async function loadMembershipSummary(admin: SupabaseClient, environment: string) {
  const enrollments: Enrollment[] = [], general: GeneralMembership[] = [], children: Child[] = [];
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
  const householdIds = [...new Set(general.filter(row => row.household_id && (row.square_environment || 'production') === environment && (!row.renews_at || new Date(row.renews_at) > new Date())).map(row => row.household_id!))];
  for (let index = 0; index < householdIds.length; index += 100) {
    for (let offset = 0; ; offset += 500) {
      const result = await admin.from('people').select('id,household_id').eq('role', 'child').in('household_id', householdIds.slice(index, index + 100)).order('id').range(offset, offset + 499);
      if (result.error) throw new Error('Unable to count enrolled children.');
      children.push(...result.data); if (result.data.length < 500) break;
    }
  }
  return summarizeMemberships(enrollments, general, children, environment);
}
