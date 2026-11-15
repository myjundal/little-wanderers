import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { identityName, reconcileGuestWaiverFamily } from '@/lib/guest-family-reconciliation';
import { admissionIsPaid, admissionIsIncluded } from '@/lib/admission-payment-status';
import { getPartyDateKey } from '@/lib/party-config';
import { squareEnvironment } from '@/lib/square-client';

type Row = Record<string, unknown> & { id: string };
type Person = Row & { household_id: string; role: string; first_name: string; last_name: string | null; birthdate: string | null };
type Visit = Row & { person_id: string; household_id: string | null; child_id: string | null; checked_in_at: string; payment_status: string; price_cents: number; square_order_id: string | null; square_environment: string | null };
type Waiver = Row & { household_id: string; covered_person_ids: string[]; agreement_snapshot: Record<string, unknown> };
type Customer = Row & { household_id: string; square_customer_id: string };
type Audit = { version: 1; source: string; target: string; environment: string; state: 'ready' | 'applying' | 'complete' | 'review'; lease_until: number;
  target_members: Array<{ user_id: string | null; role: string }>; person_ids: Record<string, string>; people: Person[]; waivers: Waiver[]; visits: Visit[]; customers: Customer[]; actor: string };
export type FamilyLinkResult = { status: 'linked' | 'none' | 'review' | 'pending'; household_id: string };
class ReviewRequired extends Error {}
const checked = <T>(result: { data: T; error: unknown }) => { if (result.error) throw new Error('Family linking could not finish. Retry Payment confirmed.'); return result.data as NonNullable<T>; };
export function paidFamilyLinkEventId(source: string) {
  const value = createHash('sha256').update(`paid-family-link-v1:${source}`).digest('hex').slice(0, 32).split(''); value[12] = '5'; value[16] = '8';
  const hex = value.join(''); return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
const same = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const left = Object.keys(a).sort(), right = Object.keys(b).sort();
  return left.length === right.length && left.every((key, index) => key === right[index] && same((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
};
function preserve(original: Row, current: Row | undefined, mutable: string[]) {
  if (!current || Object.keys(original).some(key => !mutable.includes(key) && !same(original[key], current[key]))) throw new ReviewRequired('A saved record changed.');
}
const day = (visit: Visit) => getPartyDateKey(new Date(visit.checked_in_at));
function verifyVisits(visits: Visit[], targetVisits: Visit[], personIds: Record<string, string>, environment: string) {
  for (const visit of visits) {
    if (!personIds[visit.person_id] || (visit.child_id && !personIds[visit.child_id]) || !Number.isFinite(Date.parse(visit.checked_in_at)) || (visit.square_environment ?? 'production') !== environment
      || (!admissionIsPaid(visit.payment_status) && !admissionIsIncluded(visit.payment_status))) throw new ReviewRequired('An admission needs review.');
    if (visits.some(other => other.id !== visit.id && other.person_id === visit.person_id && day(other) === day(visit) && (other.square_environment ?? 'production') === environment)) throw new ReviewRequired('The guest record has duplicate attendance.');
    if (targetVisits.some(other => other.id !== visit.id && other.person_id === personIds[visit.person_id] && day(other) === day(visit)
      && (other.square_environment ?? 'production') === environment)) throw new ReviewRequired('Both records have attendance for the same day.');
  }
}

/** A staff-only, audited retry workflow. It never edits amounts, receipts, signatures,
 * account access, subscriptions, attendance times, or the number of visitors. */
export async function reconcilePaidFamily(admin: SupabaseClient, source: string, actor: string, now = new Date(), resumeOnly = false, expectedTarget?: string): Promise<FamilyLinkResult | null> {
  const eventId = paidFamilyLinkEventId(source);
  const snapshotId = paidFamilyLinkEventId(`${source}:snapshot`);
  const records = checked(await admin.from('membership_events').select('id,notes').in('id', [eventId, snapshotId]));
  let record = records.find(row => row.id === eventId);
  const saved = records.find(row => row.id === snapshotId);
  if (record && !saved) return { status: 'review', household_id: source };
  let audit: Audit;
  if (saved) audit = JSON.parse(saved.notes) as Audit;
  else {
    if (resumeOnly) return null;
    const members = checked(await admin.from('household_members').select('id').eq('household_id', source).limit(1));
    if (members.length) return { status: 'none', household_id: source };
    for (const table of ['memberships', 'founding_memberships']) if (checked(await admin.from(table).select('id').eq('household_id', source).limit(1)).length) return { status: 'none', household_id: source };
    const signed = checked(await admin.from('waivers').select('id').eq('household_id', source).limit(11));
    if (!signed.length) return { status: 'none', household_id: source };
    if (signed.length > 10) return { status: 'review', household_id: source };
    const plan = await reconcileGuestWaiverFamily(admin, signed[0].id, false, true);
    if (plan.status !== 'match' || !('person_ids' in plan) || !plan.person_ids || !('household_id' in plan) || !plan.household_id)
      return { status: plan.status === 'linked' ? 'linked' : 'review', household_id: ('household_id' in plan && plan.household_id) || source };
    const target = plan.household_id;
    if (expectedTarget && target !== expectedTarget) return { status: 'review', household_id: source };
    const [peopleResult, waiversResult, visitsResult, customersResult, targetCustomersResult] = await Promise.all([
      admin.from('people').select('*').in('household_id', [source, target]).limit(101),
      admin.from('waivers').select('*').eq('household_id', source).limit(11),
      admin.from('checkins').select('*').eq('household_id', source).limit(51),
      admin.from('square_customers').select('*').eq('household_id', source).limit(3),
      admin.from('square_customers').select('*').eq('household_id', target).limit(3),
    ]);
    const people = checked(peopleResult) as Person[], waivers = checked(waiversResult) as Waiver[], visits = checked(visitsResult) as Visit[], customers = checked(customersResult) as Customer[];
    const targetCustomers = checked(targetCustomersResult) as Customer[];
    // Only the original signed child snapshot can complete account details.
    for (const child of people.filter(row => row.household_id === source && row.role === 'child')) {
      const signedChild = waivers.some(waiver => waiver.covered_person_ids.includes(child.id) && Array.isArray(waiver.agreement_snapshot.children)
        && (waiver.agreement_snapshot.children as Person[]).some(signed => signed.id === child.id && identityName(signed.first_name) === identityName(child.first_name)
          && identityName(signed.last_name) === identityName(child.last_name) && signed.birthdate === child.birthdate));
      if (!signedChild) return { status: 'review', household_id: source };
    }
    if (waivers.some(row => row.agreement_snapshot.payment_family_reconciliation)) return { status: 'review', household_id: source };
    const targetMembers = checked(await admin.from('household_members').select('user_id,role').eq('household_id', target).limit(11));
    if (targetMembers.length > 10) return { status: 'review', household_id: source };

    if (people.length > 100 || waivers.length > 10 || visits.length > 50 || customers.length > 1
      || (customers.length && targetCustomers.some(row => row.square_customer_id !== customers[0].square_customer_id))) return { status: 'review', household_id: source };
    // Do not pull a guest's other purchases, invites or passes into an account.
    for (const table of ['square_checkout_attempts', 'admission_passes', 'household_invites']) {
      if (checked(await admin.from(table).select('household_id').eq('household_id', source).limit(1)).length) return { status: 'review', household_id: source };
    }
    const personIds = { ...plan.person_ids } as Record<string, string>;
    for (const adult of people.filter(row => row.household_id === source && row.role === 'adult')) {
      const matches = people.filter(row => row.household_id === target && row.role === 'adult'
        && identityName(row.first_name) === identityName(adult.first_name) && identityName(row.last_name) === identityName(adult.last_name));
      if (matches.length !== 1) return { status: 'review', household_id: source };
      personIds[adult.id] = matches[0].id;
    }
    // Legacy attendance can omit household_id. Include it by its actual person IDs.
    const sourceIds = people.filter(row => row.household_id === source).map(row => row.id);
    const sourceVisits = checked(await admin.from('checkins').select('*').in('person_id', sourceIds).limit(51)) as Visit[];
    if (sourceVisits.length > 50 || sourceVisits.some(row => row.household_id && row.household_id !== source)) return { status: 'review', household_id: source };
    const targetVisits = checked(await admin.from('checkins').select('*').in('person_id', Object.values(personIds)).limit(501)) as Visit[];
    if (targetVisits.length > 500) return { status: 'review', household_id: source };
    try { verifyVisits(sourceVisits, targetVisits, personIds, squareEnvironment()); } catch (error) { if (error instanceof ReviewRequired) return { status: 'review', household_id: source }; throw error; }
    if (!sourceVisits.some(row => admissionIsPaid(row.payment_status) && row.square_order_id)) return { status: 'none', household_id: source };
    audit = { version: 1, source, target, environment: squareEnvironment(), state: 'ready', lease_until: 0, target_members: targetMembers.map(row => ({ user_id: row.user_id, role: row.role })), person_ids: personIds, people, waivers, visits: sourceVisits, customers, actor };
    const notes = JSON.stringify(audit);
    const inserted = await admin.from('membership_events').insert({ id: snapshotId, household_id: source, action: 'paid_family_reconciliation_snapshot', notes, created_by_user_id: actor, created_by_role: 'staff' });
    if (inserted.error && inserted.error.code !== '23505') throw new Error('Unable to save the family link audit. Retry Payment confirmed.');
    const snapshot = checked(await admin.from('membership_events').select('id,notes').eq('id', snapshotId).single());
    audit = JSON.parse(snapshot.notes) as Audit;
  }
  if (audit.version !== 1 || audit.source !== source || audit.environment !== squareEnvironment() || (expectedTarget && audit.target !== expectedTarget)) return { status: 'review', household_id: source };
  // Keep the compare-and-set token small. Signed snapshots are immutable in a
  // separate row, so PostgREST's filter URL never contains a large legal document.
  if (!record) {
    const inserted = await admin.from('membership_events').insert({ id: eventId, household_id: source, action: 'paid_family_reconciliation', notes: auditHeader(audit), created_by_user_id: actor, created_by_role: 'staff' });
    if (inserted.error && inserted.error.code !== '23505') throw new Error('Unable to save the family link journal.');
    record = checked(await admin.from('membership_events').select('id,notes').eq('id', eventId).single());
  }
  const header = JSON.parse(record!.notes);
  if (header.snapshot_id !== snapshotId || header.source !== source || header.target !== audit.target || header.environment !== audit.environment) return { status: 'review', household_id: source };
  audit = { ...audit, state: header.state, lease_until: header.lease_until };
  if (audit.state === 'complete') return { status: 'linked', household_id: audit.target };
  if (audit.state === 'review') return { status: 'review', household_id: source };
  if (audit.state === 'applying' && audit.lease_until > now.getTime()) return { status: 'pending', household_id: source };
  const claimed = { ...audit, state: 'applying' as const, lease_until: now.getTime() + 120000 };
  const lease = checked(await admin.from('membership_events').update({ notes: auditHeader(claimed) }).eq('id', eventId).eq('notes', record!.notes).select('id').maybeSingle());
  if (!lease) return { status: 'pending', household_id: source };
  audit = claimed;
  let targetLease: { id: string; notes: string } | null = null;
  try {
    targetLease = await claimTarget(admin, audit.target, eventId, actor, now);
    if (!targetLease) {
      checked(await admin.from('membership_events').update({ notes: auditHeader({ ...audit, state: 'ready', lease_until: 0 }) }).eq('id', eventId));
      return { status: 'pending', household_id: source };
    }
    await applyLink(admin, audit, eventId);
    checked(await admin.from('membership_events').update({ notes: auditHeader({ ...audit, state: 'complete', lease_until: 0 }) }).eq('id', eventId));
    return { status: 'linked', household_id: audit.target };
  } catch (error) {
    // A lost connection can retry the exact saved mapping. Conflicting data must
    // stay visible for owner review instead of guessing another destination.
    const review = error instanceof ReviewRequired;
    await admin.from('membership_events').update({ notes: auditHeader({ ...audit, state: review ? 'review' : 'ready', lease_until: 0 }) }).eq('id', eventId);
    if (review) return { status: 'review', household_id: source };
    throw error;
  } finally {
    if (targetLease) await admin.from('membership_events').update({ notes: JSON.stringify({ owner_event_id: null, lease_until: 0 }) }).eq('id', targetLease.id).eq('notes', targetLease.notes);
  }
}

async function claimTarget(admin: SupabaseClient, target: string, eventId: string, actor: string, now: Date) {
  const id = paidFamilyLinkEventId(`target-lock:${target}`);
  let record = checked(await admin.from('membership_events').select('id,notes').eq('id', id).maybeSingle());
  if (!record) {
    const inserted = await admin.from('membership_events').insert({ id, household_id: target, action: 'paid_family_reconciliation_lock',
      notes: JSON.stringify({ owner_event_id: null, lease_until: 0 }), created_by_user_id: actor, created_by_role: 'staff' });
    if (inserted.error && inserted.error.code !== '23505') throw new Error('Unable to reserve the family link.');
    record = checked(await admin.from('membership_events').select('id,notes').eq('id', id).single());
  }
  const previous = JSON.parse(record.notes);
  if (previous.lease_until > now.getTime() && previous.owner_event_id !== eventId) return null;
  const notes = JSON.stringify({ owner_event_id: eventId, lease_until: now.getTime() + 120000 });
  const saved = checked(await admin.from('membership_events').update({ notes }).eq('id', id).eq('notes', record.notes).select('id').maybeSingle());
  return saved ? { id, notes } : null;
}

function auditHeader(audit: Audit) {
  return JSON.stringify({ version: 1, source: audit.source, target: audit.target, environment: audit.environment,
    state: audit.state, lease_until: audit.lease_until, snapshot_id: paidFamilyLinkEventId(`${audit.source}:snapshot`) });
}

async function applyLink(admin: SupabaseClient, audit: Audit, eventId: string) {
  const { source, target, person_ids: map } = audit;
  const people = checked(await admin.from('people').select('*').in('id', [...Object.keys(map), ...Object.values(map)])) as Person[];
  const sourceMembers = checked(await admin.from('household_members').select('id').eq('household_id', source).limit(1));
  if (sourceMembers.length) throw new ReviewRequired('The guest record now has an account.');
  const targetMembers = checked(await admin.from('household_members').select('user_id,role').eq('household_id', target).limit(11));
  const membershipKeys = (rows: Array<{ user_id: string | null; role: string }>) => rows.map(row => `${row.user_id ?? ''}:${row.role}`).sort();
  if (!same(membershipKeys(targetMembers), membershipKeys(audit.target_members))) throw new ReviewRequired('Account access changed.');
  const targetCustomers = checked(await admin.from('square_customers').select('square_customer_id').eq('household_id', target).limit(3));
  if (audit.customers.length && targetCustomers.some(row => row.square_customer_id !== audit.customers[0].square_customer_id)) throw new ReviewRequired('Square customer mapping changed.');

  for (const original of audit.people.filter(row => row.household_id === source)) {
    const current = people.find(row => row.id === original.id), destination = people.find(row => row.id === map[original.id]);
    preserve(original, current, ['updated_at']);
    if (!destination || destination.household_id !== target || destination.role !== original.role
      || identityName(destination.first_name) !== identityName(original.first_name)
      || (destination.last_name && identityName(destination.last_name) !== identityName(original.last_name))
      || (original.birthdate && destination.birthdate && destination.birthdate !== original.birthdate)) throw new ReviewRequired('Family identity changed.');
    if (original.role === 'child') {
      if (!destination.birthdate && original.birthdate) checked(await admin.from('people').update({ birthdate: original.birthdate }).eq('id', destination.id).is('birthdate', null));
      if (!destination.last_name && original.last_name) {
        let query = admin.from('people').update({ last_name: original.last_name }).eq('id', destination.id);
        query = destination.last_name === null ? query.is('last_name', null) : query.eq('last_name', destination.last_name);
        checked(await query);
      }
    }
  }
  const completedPeople = checked(await admin.from('people').select('*').in('id', Object.values(map))) as Person[];
  for (const original of audit.people.filter(row => row.household_id === source && row.role === 'child')) {
    const destination = completedPeople.find(row => row.id === map[original.id]);
    if (!destination || destination.birthdate !== original.birthdate || identityName(destination.last_name) !== identityName(original.last_name)) throw new ReviewRequired('Child details changed during linking.');
  }
  const visits = checked(await admin.from('checkins').select('*').in('person_id', Object.values(map)).limit(501)) as Visit[];
  if (visits.length > 500) throw new ReviewRequired('Too much attendance history.');
  verifyVisits(audit.visits, visits, map, audit.environment);
  const open = checked(await admin.from('admission_pos_sales').select('checkin_ids').eq('environment', audit.environment).eq('status', 'open').limit(101));
  if (open.length > 100 || open.some(row => row.checkin_ids?.some((id: string) => audit.visits.some(visit => visit.id === id)))) throw new ReviewRequired('A Square checkout is open.');
  for (const original of audit.waivers) {
    const current = checked(await admin.from('waivers').select('*').eq('id', original.id).single()) as Waiver;
    const snapshot = { ...current.agreement_snapshot }; delete snapshot.payment_family_reconciliation;
    preserve(original, { ...current, agreement_snapshot: snapshot }, ['household_id', 'covered_person_ids', 'updated_at']);
    const covered = original.covered_person_ids.map(id => map[id]);
    if (covered.some(id => !id) || ![source, target].includes(current.household_id)) throw new ReviewRequired('Signed child mapping changed.');
    if (current.household_id === source) checked(await admin.from('waivers').update({ household_id: target, covered_person_ids: covered,
      agreement_snapshot: { ...original.agreement_snapshot, payment_family_reconciliation: { audit_event_id: eventId, source_household_id: source, target_household_id: target,
        original_covered_person_ids: original.covered_person_ids, person_ids: map } } }).eq('id', original.id).eq('household_id', source).select('id').single());
    else if (!same(current.covered_person_ids, covered) || (current.agreement_snapshot.payment_family_reconciliation as { audit_event_id?: string })?.audit_event_id !== eventId) throw new ReviewRequired('Waiver link needs review.');
    checked(await admin.from('party_guest_waivers').update({ household_id: target }).eq('waiver_id', original.id).eq('household_id', source));
  }
  for (const original of audit.visits) {
    const current = checked(await admin.from('checkins').select('*').eq('id', original.id).single()) as Visit;
    preserve(original, current, ['household_id', 'person_id', 'child_id', 'updated_at']);
    if (current.person_id === map[original.person_id] && current.household_id === target) continue;
    if (current.person_id !== original.person_id || current.household_id !== original.household_id) throw new ReviewRequired('Attendance link changed.');
    let query = admin.from('checkins').update({ household_id: target, person_id: map[original.person_id], child_id: original.child_id ? map[original.child_id] : null })
      .eq('id', original.id).eq('person_id', original.person_id).eq('payment_status', original.payment_status).eq('price_cents', original.price_cents);
    query = original.square_order_id ? query.eq('square_order_id', original.square_order_id) : query.is('square_order_id', null);
    checked(await query.select('id').single());
  }
  for (const original of audit.customers) {
    const current = checked(await admin.from('square_customers').select('*').eq('id', original.id).single()) as Customer;
    preserve(original, current, ['household_id', 'updated_at']);
    if (![source, target].includes(current.household_id)) throw new ReviewRequired('Square customer link changed.');
    checked(await admin.from('square_customers').update({ household_id: target }).eq('id', original.id).eq('household_id', current.household_id));
  }
  // A concurrently added visit or waiver must remain visible. Never hide an
  // unfinished family behind its directory alias.
  const remainingVisits = checked(await admin.from('checkins').select('id').in('person_id', Object.keys(map)).limit(1));
  const remainingWaivers = checked(await admin.from('waivers').select('id').eq('household_id', source).limit(1));
  if (remainingVisits.length || remainingWaivers.length) throw new ReviewRequired('The guest family gained new records.');
  const finalVisits = checked(await admin.from('checkins').select('*').in('person_id', Object.values(map)).limit(501)) as Visit[];
  verifyVisits(audit.visits, finalVisits, map, audit.environment);
  for (const original of audit.visits) preserve(original, finalVisits.find(row => row.id === original.id), ['household_id', 'person_id', 'child_id', 'updated_at']);
  const aliases = checked(await admin.from('staff_family_search_aliases').select('alias_household_id,canonical_household_id').limit(1001));
  if (aliases.length > 1000 || aliases.some(row => row.alias_household_id === target || row.canonical_household_id === source
    || (row.alias_household_id === source && row.canonical_household_id !== target))) throw new ReviewRequired('A directory link changed.');
  checked(await admin.from('staff_family_search_aliases').upsert({ alias_household_id: source, canonical_household_id: target,
    reason: `Staff Payment confirmed; verified caregiver email, guardian and children matched. Signed waiver and settled visits linked with original receipt/amount/time preserved. Audit ${eventId}.` }, { onConflict: 'alias_household_id', ignoreDuplicates: true }));
}
