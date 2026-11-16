import { AGE_PRICING_START, underMonths } from '@/lib/open-play-age-pricing';
import { admissionIsPaid, admissionIsIncluded } from '@/lib/admission-payment-status';
import type { SupabaseClient } from '@supabase/supabase-js';
import { freeInfantSiblingIds, isInfantSibling } from '@/lib/infant-sibling-pricing';
import { getPartyDateKey, toPartyDateTimeIso } from '@/lib/party-config';
import { applyFoundingAdmissionCoverage } from '@/lib/founding-admission-coverage';

type Person = { id: string; household_id: string; role?: string; birthdate?: string | null };
type Visit = { id: string; person_id: string; price_cents: number; payment_status: string; checked_in_at: string; square_environment?: string | null };
export const infantAdmissionSelect = 'id,person_id,price_cents,payment_status,checked_in_at,square_environment,notes';

// Apply only to unpaid attendance, never a completed receipt or a checkout that
// has already frozen its amount. Capacity, signatures and attendance stay intact.
export function projectInfantSiblingAdmission<T extends Visit>(visits: T[], people: Person[], environment: string, frozen = new Set<string>()) {
  const peopleById = new Map(people.map(person => [person.id, person]));
  const groups = new Map<string, T[]>();
  for (const visit of [...visits].sort((a, b) => a.checked_in_at.localeCompare(b.checked_in_at) || a.id.localeCompare(b.id))) {
    const person = peopleById.get(visit.person_id);
    if (!person?.household_id || person.role !== 'child' || (visit.square_environment ?? 'production') !== environment) continue;
    const key = `${person.household_id}:${getPartyDateKey(new Date(visit.checked_in_at))}`;
    const group = groups.get(key) ?? []; group.push(visit); groups.set(key, group);
  }
  const freeVisits = new Set<string>();
  const infantRateVisits = new Set<string>();
  const standardVisits = new Set<string>();
  for (const group of groups.values()) {
    const date = getPartyDateKey(new Date(group[0].checked_in_at));
    const included = new Set(group.filter(visit => admissionIsPaid(visit.payment_status) || admissionIsIncluded(visit.payment_status)).map(visit => visit.person_id));
    const free = date >= AGE_PRICING_START
      ? new Set(group.filter(visit => underMonths(peopleById.get(visit.person_id)?.birthdate, date, 6)).map(visit => visit.person_id))
      : freeInfantSiblingIds(group.map(visit => peopleById.get(visit.person_id)!), date, included);
    if (date >= AGE_PRICING_START) {
      const older = group.filter(visit => !underMonths(peopleById.get(visit.person_id)?.birthdate, date, 12));
      const anchor = older[0];
      if (anchor && anchor.payment_status === 'due' && !frozen.has(anchor.id) && !group.some(visit => visit.id !== anchor.id && visit.price_cents >= 1600 && admissionIsPaid(visit.payment_status))) standardVisits.add(anchor.id);
    }
    for (const visit of group) {
      if (visit.payment_status !== 'due') continue;
      if (free.has(visit.person_id) && (!frozen.has(visit.id) || visit.price_cents === 0)) freeVisits.add(visit.id);
      else if (!frozen.has(visit.id) && visit.price_cents > 1000 && (date >= AGE_PRICING_START ? underMonths(peopleById.get(visit.person_id)?.birthdate, date, 12) : isInfantSibling(peopleById.get(visit.person_id)?.birthdate, date))) infantRateVisits.add(visit.id);
    }
  }
  return visits.map(visit => freeVisits.has(visit.id)
    ? { ...visit, price_cents: 0, payment_status: 'covered', infant_sibling_free: true }
    : standardVisits.has(visit.id) ? { ...visit, price_cents: 1600, infant_sibling_free: false }
    : infantRateVisits.has(visit.id) ? { ...visit, price_cents: 1000, infant_sibling_free: false } : { ...visit, infant_sibling_free: false });
}

export async function readInfantSiblingAdmission(admin: SupabaseClient, checkinIds: string[], environment: string) {
  const selected = await admin.from('checkins').select(infantAdmissionSelect).in('id', checkinIds);
  if (selected.error || selected.data?.length !== checkinIds.length) throw new Error('Unable to verify family admission. Refresh first.');
  const selectedPeople = await admin.from('people').select('id,household_id').in('id', selected.data.map(row => row.person_id));
  const families = [...new Set<string>((selectedPeople.data ?? []).map(person => person.household_id))];
  if (selectedPeople.error || families.length !== 1 || !families[0]) throw new Error('Choose one visiting family');
  const people = await admin.from('people').select('id,household_id,role,birthdate').eq('household_id', families[0]).limit(101);
  if (people.error || !people.data?.length || people.data.length > 100) throw new Error('Unable to verify children’s ages. Refresh first.');
  const today = getPartyDateKey(new Date());
  const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const rows = await admin.from('checkins').select(infantAdmissionSelect).in('person_id', people.data.map(person => person.id))
    .gte('checked_in_at', toPartyDateTimeIso(today, 0)).lt('checked_in_at', toPartyDateTimeIso(tomorrow, 0)).limit(101);
  if (rows.error || (rows.data?.length ?? 0) > 100) throw new Error('Unable to verify today’s admission. Refresh first.');
  const visits = rows.data ?? [];
  const covered = await applyFoundingAdmissionCoverage(admin, visits, people.data, environment);
  return { householdId: families[0], visits, priced: projectInfantSiblingAdmission(covered, people.data, environment) };
}
