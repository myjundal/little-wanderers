import { readPosMembershipReceipts, posAdmissionTerms } from '@/lib/pos-memberships';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getPartyDateKey } from '@/lib/party-config';
import { membershipCoversAdmission } from '@/lib/membership-admission-coverage';

type Visit = { id: string; person_id: string; payment_status: string; price_cents: number; checked_in_at: string; square_environment?: string | null };
type Person = { id: string; household_id: string; role?: string };
export type AdmissionEnrollment = { household_id: string; environment: string; status: string; child_ids: string[]; square_card_id: string | null; square_subscription_id?: string | null; start_date: string | null; paid_through: string | null; created_at: string };

export function projectFoundingAdmission<T extends Visit>(visits: T[], people: Person[], enrollments: AdmissionEnrollment[], environment: string, frozen = new Set<string>()) {
  const members = new Map(people.map(person => [person.id, person]));
  return visits.map(visit => {
    const person = members.get(visit.person_id);
    const day = getPartyDateKey(new Date(visit.checked_in_at));
    const included = visit.payment_status === 'due' && !frozen.has(visit.id) && person?.role === 'child'
      && (visit.square_environment ?? 'production') === environment && enrollments.some(enrollment => {
        if (enrollment.environment !== environment || enrollment.household_id !== person.household_id || !enrollment.child_ids.includes(person.id)
          || day < getPartyDateKey(new Date(enrollment.created_at))) return false;
        // Saving a card reserves first-visit coverage; activation is a separate,
        // owner-confirmed billing action and must never become a second entry fee.
        if (['pending', 'activating', 'scheduled'].includes(enrollment.status)) return Boolean(enrollment.square_card_id);
        return membershipCoversAdmission(enrollment, day);
      });
    return included ? { ...visit, price_cents: 0, payment_status: 'covered', founding_membership_applied: true }
      : { ...visit, founding_membership_applied: false };
  });
}

export async function applyFoundingAdmissionCoverage<T extends Visit>(admin: SupabaseClient, visits: T[], people: Person[], environment: string, frozen = new Set<string>()) {
  const candidates = new Set(visits.filter(visit => visit.payment_status === 'due' && !frozen.has(visit.id)).map(visit => visit.person_id));
  const familyIds = [...new Set(people.filter(person => person.role === 'child' && candidates.has(person.id)).map(person => person.household_id))];
  if (!familyIds.length) return projectFoundingAdmission(visits, people, [], environment, frozen);
  const result = await admin.from('founding_memberships').select('household_id,environment,status,child_ids,square_card_id,square_subscription_id,start_date,paid_through,created_at')
    .in('household_id', familyIds).eq('environment', environment).in('status', ['pending', 'activating', 'scheduled', 'active', 'canceling', 'canceled']);
  if (result.error) throw new Error('Unable to verify membership coverage. Refresh before collecting admission.');
  const paid = posAdmissionTerms(await readPosMembershipReceipts(admin, environment, familyIds));
  return projectFoundingAdmission(visits, people, [...(result.data ?? []) as AdmissionEnrollment[], ...paid], environment, frozen);
}
