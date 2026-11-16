import type { SupabaseClient } from '@supabase/supabase-js';
import { getStaffFamilySearchAliases } from '@/lib/staff-family-search';
import { squareEnvironment } from '@/lib/square-client';
import { refreshAdmissionPosSales, type PosSale } from '@/lib/square-admission-pos';
import { getAdmissionPrepayments } from '@/lib/admission-prepayments';
import { projectInfantSiblingAdmission } from '@/lib/infant-sibling-admission';
import { applyFoundingAdmissionCoverage } from '@/lib/founding-admission-coverage';
import { admissionIsIncluded, admissionIsPaid } from '@/lib/admission-payment-status';
import { getPartyDateKey, toPartyDateTimeIso } from '@/lib/party-config';
import { reconcilePaidFamily, type FamilyLinkResult } from '@/lib/paid-family-reconciliation';

const checked = <T>(result: { data: T; error: unknown }) => { if (result.error) throw new Error('Unable to confirm family payment. Refresh and retry.'); return result.data as NonNullable<T>; };
export async function confirmFamilyPayment(admin: SupabaseClient, requestedId: string, actor: string, now = new Date(), allowIncoming = true, expectedTarget?: string): Promise<{ status: string; family_link: string; household_id: string; payment_status?: string }> {
  // A saved journal can finish an interrupted link even after its last visit
  // moved away from the old family. It rechecks all signed and paid evidence.
  const resumed = await reconcilePaidFamily(admin, requestedId, actor, now, true, expectedTarget);
  if (resumed && resumed.status !== 'linked') return { status: resumed.status, family_link: resumed.status, household_id: resumed.household_id };
  const aliases = await getStaffFamilySearchAliases(admin);
  const householdId = aliases.get(requestedId) ?? requestedId;
  const environment = squareEnvironment();
  const today = getPartyDateKey(now), tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const people = checked(await admin.from('people').select('id,household_id,role,birthdate').eq('household_id', householdId).limit(101));
  if (!people.length || people.length > 100) return { status: 'review', family_link: 'none', household_id: householdId };
  const readVisits = async () => checked(await admin.from('checkins').select('*').in('person_id', people.map(row => row.id))
    .gte('checked_in_at', toPartyDateTimeIso(today, 0)).lt('checked_in_at', toPartyDateTimeIso(tomorrow, 0)).limit(101));
  let visits = await readVisits();
  if (visits.length > 100) return { status: 'review', family_link: 'none', household_id: householdId };
  const pending = checked(await admin.from('admission_pos_sales').select('*').eq('environment', environment).eq('status', 'open').limit(101));
  if (pending.length > 100) throw new Error('Payment history needs review. Do not collect again.');
  const sales = pending.filter(row => row.checkin_ids?.some((id: string) => visits.some(visit => visit.id === id))) as PosSale[];
  if (sales.length) {
    const settled = await refreshAdmissionPosSales(admin, sales);
    if ([...settled.values()].includes('review')) return { status: 'review', family_link: 'none', household_id: householdId };
    if ([...settled.values()].some(status => status !== 'paid')) return { status: 'pending', family_link: 'none', household_id: householdId };
    visits = await readVisits();
  }
  const children = new Set(people.filter(row => row.role === 'child').map(row => row.id));
  const attendance = visits.filter(visit => children.has(visit.person_id));
  if (!attendance.length) {
    // Staff may have selected the existing reservation while today's paid visit
    // is still under its guest duplicate. Search only verified caregiver emails.
    if (allowIncoming) {
      const incoming = await incomingPaidFamily(admin, householdId, actor, now, aliases);
      if (incoming) return incoming;
    }
    return { status: 'pending', family_link: 'none', household_id: householdId };
  }
  if (visits.some(visit => (visit.household_id && visit.household_id !== householdId) || (visit.square_environment ?? 'production') !== environment))
    return { status: 'review', family_link: 'none', household_id: householdId };
  const prepaid = await getAdmissionPrepayments(admin, visits.map(visit => ({ ...visit, household_id: householdId })), environment);
  const covered = await applyFoundingAdmissionCoverage(admin, prepaid, people, environment);
  const priced = projectInfantSiblingAdmission(covered, people, environment).filter(visit => children.has(visit.person_id));
  if (priced.some(visit => visit.payment_status === 'review')) return { status: 'review', family_link: 'none', household_id: householdId };
  if (priced.some(visit => !admissionIsPaid(visit.payment_status) && !admissionIsIncluded(visit.payment_status)))
    return { status: 'pending', family_link: 'none', household_id: householdId };
  if (resumed?.status === 'linked' || aliases.has(requestedId)) return { status: 'confirmed', family_link: 'linked', household_id: householdId };
  let link: FamilyLinkResult | null;
  try { link = await reconcilePaidFamily(admin, householdId, actor, now, false, expectedTarget); }
  catch { return { status: 'confirmed', family_link: 'pending', household_id: householdId }; }
  return { status: 'confirmed', family_link: link?.status ?? 'none', household_id: link?.household_id ?? householdId,
    payment_status: priced.some(visit => admissionIsPaid(visit.payment_status)) ? 'paid' : 'included' };
}

async function incomingPaidFamily(admin: SupabaseClient, householdId: string, actor: string, now: Date, aliases: Map<string, string>) {
  const members = checked(await admin.from('household_members').select('user_id,role').eq('household_id', householdId).limit(11));
  if (members.length > 10) return { status: 'review', family_link: 'review', household_id: householdId };
  const emails = new Set<string>();
  for (const member of members) {
    if (!member.user_id || !['owner', 'admin', 'caregiver', 'primary_caregiver'].includes(member.role)) continue;
    const result = await admin.auth.admin.getUserById(member.user_id);
    if (result.error) throw new Error('Unable to verify family contact.');
    if (result.data.user?.email_confirmed_at && result.data.user.email) emails.add(result.data.user.email.trim().toLowerCase());
  }
  const candidateIds = new Set<string>();
  for (const email of emails) {
    const waivers = checked(await admin.from('waivers').select('household_id').eq('source', 'guest_website').eq('email', email)
      .gte('waiver_expires_at', now.toISOString()).limit(21));
    if (waivers.length > 20) return { status: 'review', family_link: 'review', household_id: householdId };
    for (const waiver of waivers) if (waiver.household_id !== householdId && !aliases.has(waiver.household_id)) candidateIds.add(waiver.household_id);
  }
  if (!candidateIds.size) return null;
  const today = getPartyDateKey(now), tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const visits = checked(await admin.from('checkins').select('household_id,payment_status,square_order_id,square_environment').in('household_id', [...candidateIds])
    .gte('checked_in_at', toPartyDateTimeIso(today, 0)).lt('checked_in_at', toPartyDateTimeIso(tomorrow, 0)).limit(101));
  if (visits.length > 100) return { status: 'review', family_link: 'review', household_id: householdId };
  const paidFamilies = [...new Set<string>(visits.filter(visit => admissionIsPaid(visit.payment_status) && visit.square_order_id && visit.square_environment === squareEnvironment()).map(visit => visit.household_id))];
  if (!paidFamilies.length) return null;
  if (paidFamilies.length !== 1) return { status: 'review', family_link: 'review', household_id: householdId };
  const result = await confirmFamilyPayment(admin, paidFamilies[0], actor, now, false, householdId);
  return result.status === 'confirmed' && result.family_link === 'linked' ? result
    : { status: result.status === 'pending' ? 'pending' : 'review', family_link: result.family_link, household_id: householdId };
}
