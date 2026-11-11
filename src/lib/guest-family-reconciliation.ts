import type { SupabaseClient } from '@supabase/supabase-js';
import { getStaffFamilySearchAliases } from '@/lib/staff-family-search';

export const identityName = (value: string | null | undefined) => (value ?? '').normalize('NFKD').replace(/\p{M}/gu, '').trim().replace(/\s+/g, ' ').toLowerCase();
const emailKey = (value: string | null | undefined) => (value ?? '').trim().toLowerCase();
const phoneKey = (value: string | null | undefined) => {
  const digits = (value ?? '').replace(/\D/g, '');
  return digits.length === 10 ? `1${digits}` : digits;
};
type Person = { id: string; household_id: string; role: string; first_name: string; last_name: string | null; birthdate: string | null };
type Family = { id: string; email: string | null; phone: string | null; created_at: string };
type Profile = { first_name: string; last_name: string; phone: string; children: Array<{ id?: string; first_name: string; last_name: string | null; birthdate: string | null }> };

/** Contact is corroboration for a signed waiver, never permission to read/claim an account. */
export function matchGuestFamily(profile: Profile, email: string, family: Family, people: Person[], verifiedEmails: string[]) {
  const verifiedEmail = verifiedEmails.some(value => emailKey(value) === emailKey(email));
  const emailMatches = verifiedEmail || (!!family.email && emailKey(family.email) === emailKey(email));
  const phoneMatches = !!phoneKey(family.phone) && phoneKey(family.phone) === phoneKey(profile.phone);
  if (!emailMatches && !phoneMatches) return null;
  if (!people.some(person => person.role === 'adult' && identityName(person.first_name) === identityName(profile.first_name)
    && identityName(person.last_name) === identityName(profile.last_name))) return null;
  const ids: string[] = [];
  for (const child of profile.children) {
    const matches = people.filter(person => person.role === 'child' && identityName(person.first_name) === identityName(child.first_name)
      && (!identityName(person.last_name) || identityName(person.last_name) === identityName(child.last_name))
      && (!person.birthdate || person.birthdate === child.birthdate)
      // A missing birthday needs verified caregiver email, or both contact fields.
      && (person.birthdate ? !!child.birthdate : (verifiedEmail || (emailMatches && phoneMatches)) && !!identityName(person.last_name)));
    if (matches.length !== 1 || ids.includes(matches[0].id)) return null;
    ids.push(matches[0].id);
  }
  return ids.length ? ids : null;
}

const checked = <T>(result: { data: T; error: unknown }) => {
  if (result.error) throw new Error('Unable to review family identity records.');
  return result.data as NonNullable<T>;
};

/** Idempotent, non-destructive reconciliation. Original people and signed snapshots stay intact.
 * Each waiver's household and covered IDs change in one database statement. The directory
 * alias is committed last, so an interrupted attempt stays visible and can safely retry.
 */
export async function reconcileGuestWaiverFamily(admin: SupabaseClient, waiverId: string, apply = true, reviewVisits = false) {
  if (apply && reviewVisits) throw new Error('Visited families require a separate, reviewed history migration.');
  const waiver = checked(await admin.from('waivers').select('id,household_id,source,signed_by_user_id,agreement_snapshot,covered_person_ids,email,phone').eq('id', waiverId).maybeSingle());
  if (!waiver || waiver.source !== 'guest_website' || waiver.signed_by_user_id || waiver.agreement_snapshot?.email_verified !== false) return { status: 'ineligible' };
  const savedLink = waiver.agreement_snapshot?.family_reconciliation;
  if (savedLink?.source_household_id && savedLink?.target_household_id === waiver.household_id) {
    // Finish an interrupted link before looking for a new match. The immutable
    // signed child snapshot and original covered IDs remain in the saved audit.
    if (apply) {
      checked(await admin.from('party_guest_waivers').update({ household_id: waiver.household_id }).eq('waiver_id', waiver.id).eq('household_id', savedLink.source_household_id));
      const remaining = checked(await admin.from('waivers').select('id').eq('household_id', savedLink.source_household_id).limit(1));
      if (!remaining.length) checked(await admin.from('staff_family_search_aliases').upsert({ alias_household_id: savedLink.source_household_id,
        canonical_household_id: waiver.household_id, reason: 'Guest waiver identity reconciled; original signed evidence retained.' }, { onConflict: 'alias_household_id', ignoreDuplicates: true }));
    }
    return { status: 'linked', source_id: savedLink.source_household_id, household_id: waiver.household_id };
  }
  const sourceId = waiver.household_id as string;
  const aliases = await getStaffFamilySearchAliases(admin);
  if (aliases.has(sourceId)) return { status: 'linked', household_id: aliases.get(sourceId) };
  const source = checked(await admin.from('households').select('id,email,phone,created_at').eq('id', sourceId).single()) as Family;
  const sourcePeople = checked(await admin.from('people').select('id,household_id,role,first_name,last_name,birthdate').eq('household_id', sourceId).limit(101)) as Person[];
  const adults = sourcePeople.filter(person => person.role === 'adult');
  const children = sourcePeople.filter(person => person.role === 'child');
  if (sourcePeople.length > 100 || adults.length !== 1 || !children.length) return { status: 'review' };
  // A guest-only source can be folded into an account; established accounts never move.
  const dependencies = await Promise.all([
    ...['household_members', 'memberships', 'party_bookings', 'open_play_reservations', 'class_series_sales', 'founding_memberships', 'guest_waiver_identities']
      .map(table => admin.from(table).select('household_id').eq('household_id', sourceId).limit(1)),
    ...(reviewVisits ? [] : [admin.from('checkins').select('person_id').in('person_id', sourcePeople.map(person => person.id)).limit(1)]),
    admin.from('class_registrations').select('person_id').in('person_id', sourcePeople.map(person => person.id)).limit(1),
  ]);
  if (dependencies.some(result => { if (result.error) throw new Error('Unable to review existing family history.'); return (result.data ?? []).length > 0; })) return { status: 'ineligible' };
  const sourceWaivers = checked(await admin.from('waivers').select('id,source,signed_by_user_id,covered_person_ids,agreement_snapshot,household_id').eq('household_id', sourceId).limit(101));
  if (sourceWaivers.length > 100 || sourceWaivers.some(row => row.source !== 'guest_website' || row.signed_by_user_id
    || row.agreement_snapshot?.email_verified !== false || !(row.covered_person_ids?.length)
    || row.covered_person_ids.some((id: string) => !children.some(child => child.id === id)))) return { status: 'review' };
  const adultRows = checked(await admin.from('people').select('id,household_id,role,first_name,last_name,birthdate').eq('role', 'adult').limit(2001)) as Person[];
  if (adultRows.length > 2000) throw new Error('Family directory requires a narrower review.');
  const candidateIds = [...new Set(adultRows.filter(person => person.household_id !== sourceId && !aliases.has(person.household_id)
    && identityName(person.first_name) === identityName(adults[0].first_name) && identityName(person.last_name) === identityName(adults[0].last_name)).map(person => person.household_id))];
  if (!candidateIds.length || candidateIds.length > 30) return { status: 'review' };
  const [families, people, members] = await Promise.all([
    admin.from('households').select('id,email,phone,created_at').in('id', candidateIds),
    admin.from('people').select('id,household_id,role,first_name,last_name,birthdate').in('household_id', candidateIds).limit(1001),
    admin.from('household_members').select('household_id,user_id,role').in('household_id', candidateIds).limit(101),
  ]);
  const familyRows = checked(families) as Family[], personRows = checked(people) as Person[], memberRows = checked(members);
  if (personRows.length > 1000 || memberRows.length > 100) return { status: 'review' };
  const users = new Map<string, string>();
  for (const userId of new Set<string>(memberRows.filter(row => ['primary_caregiver', 'caregiver', 'owner', 'admin'].includes(row.role)).map(row => row.user_id))) {
    const result = await admin.auth.admin.getUserById(userId);
    if (result.error) throw new Error('Unable to verify existing family contact.');
    if (result.data.user?.email_confirmed_at && result.data.user.email) users.set(userId, result.data.user.email);
  }
  const profile = { ...adults[0], last_name: adults[0].last_name ?? '', phone: waiver.phone || source.phone || '', children };
  const matches = familyRows.flatMap(family => {
    // Prefer an established account. Two guest-only submissions choose the oldest root.
    const hasAccount = memberRows.some(member => member.household_id === family.id);
    if (!hasAccount && (family.created_at > source.created_at || (family.created_at === source.created_at && family.id > sourceId))) return [];
    const targetIds = matchGuestFamily(profile, waiver.email || source.email || '', family, personRows.filter(person => person.household_id === family.id),
      memberRows.filter(member => member.household_id === family.id).map(member => users.get(member.user_id) || '').filter(Boolean));
    return targetIds ? [{ family, targetIds, hasAccount }] : [];
  });
  const established = matches.filter(match => match.hasAccount);
  const candidates = established.length ? established : matches;
  if (candidates.length !== 1) return { status: 'review' };
  const target = candidates[0];
  const idMap = new Map(children.map((child, index) => [child.id, target.targetIds[index]]));
  if (!apply) return { status: 'match', source_id: sourceId, household_id: target.family.id, waiver_ids: sourceWaivers.map(row => row.id), person_ids: Object.fromEntries(idMap) };
  for (const row of sourceWaivers) {
    checked(await admin.from('waivers').update({ household_id: target.family.id, covered_person_ids: row.covered_person_ids.map((id: string) => idMap.get(id)!),
      agreement_snapshot: { ...row.agreement_snapshot, family_reconciliation: { source_household_id: sourceId, target_household_id: target.family.id,
        original_covered_person_ids: row.covered_person_ids, person_ids: Object.fromEntries(idMap), linked_at: new Date().toISOString() } } })
      .eq('id', row.id).eq('household_id', sourceId));
    checked(await admin.from('party_guest_waivers').update({ household_id: target.family.id }).eq('waiver_id', row.id).eq('household_id', sourceId));
  }
  // No identity/access or personal details are changed. Preserve the signed child snapshot.
  checked(await admin.from('staff_family_search_aliases').upsert({ alias_household_id: sourceId, canonical_household_id: target.family.id,
    reason: 'Guest waiver reconciled: guardian name, contact and child identity matched; original records and signed evidence retained.' }, { onConflict: 'alias_household_id', ignoreDuplicates: true }));
  return { status: 'linked', source_id: sourceId, household_id: target.family.id, waiver_ids: sourceWaivers.map(row => row.id) };
}
