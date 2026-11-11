import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getPartyDateKey, toPartyDateTimeIso } from '@/lib/party-config';

const CHECKOUT_SOURCE = 'admission_checkout_v1';

// One durable departure per check-in. The existing event primary key makes
// retries and simultaneous operators safe without a separate occupancy write.
export function checkoutEventId(checkinId: string) {
  const hex = createHash('sha256').update(`${CHECKOUT_SOURCE}:${checkinId}`).digest('hex').slice(0, 32).split('');
  hex[12] = '5';
  hex[16] = '8';
  const value = hex.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

type Checkin = { id: string; checked_in_at: string };

export async function getAdmissionCheckouts(admin: SupabaseClient, checkins: Checkin[]) {
  const checkouts = new Map<string, string>();
  for (let offset = 0; offset < checkins.length; offset += 150) {
    const batch = checkins.slice(offset, offset + 150);
    const expected = new Map(batch.map(row => [checkoutEventId(row.id), row]));
    const { data, error } = await admin.from('occupancy_events').select('id,created_at,metadata')
      .in('id', [...expected.keys()]).limit(151);
    if (error) throw new Error('Unable to load departures. Please refresh before checking out.');
    for (const event of data ?? []) {
      const checkin = expected.get(event.id);
      if (!checkin || event.metadata?.source !== CHECKOUT_SOURCE || event.metadata?.checkin_id !== checkin.id
        || !Number.isFinite(Date.parse(event.created_at)) || Date.parse(event.created_at) < Date.parse(checkin.checked_in_at)) {
        throw new Error('A departure record needs review. Please contact the owner.');
      }
      checkouts.set(checkin.id, event.created_at);
    }
  }
  return checkouts;
}

export async function checkoutAdmission(admin: SupabaseClient, ids: string[], householdId: string, staffId: string, now = new Date()) {
  const today = getPartyDateKey(now);
  const { data, error } = await admin.from('checkins').select('id,person_id,household_id,checked_in_at')
    .in('id', ids).limit(101);
  if (error) throw new Error('Unable to load visiting family.');
  if (data?.length !== ids.length) throw new Error('Visitor list changed. Refresh before checking out.');
  const { data: people, error: peopleError } = await admin.from('people').select('id,household_id')
    .in('id', data.map(row => row.person_id)).limit(101);
  if (peopleError) throw new Error('Unable to confirm visiting family.');
  for (const row of data) {
    const family = row.household_id ?? people?.find(person => person.id === row.person_id)?.household_id;
    if (family !== householdId || !Number.isFinite(Date.parse(row.checked_in_at))
      || getPartyDateKey(new Date(row.checked_in_at)) !== today || Date.parse(row.checked_in_at) > now.getTime()) {
      throw new Error('Choose visitors from one family checked in today.');
    }
  }
  // Read first so an uncertain response can be retried without changing its time.
  const existing = await getAdmissionCheckouts(admin, data);
  const remaining = data.filter(row => !existing.has(row.id));
  if (remaining.length) {
    const { data: occupancy, error: occupancyError } = await admin.from('occupancy_status').select('effective_date').limit(1).maybeSingle();
    if (occupancyError || !occupancy?.effective_date) throw new Error('Unable to confirm the crowd-count date.');
    const occupancyDate = occupancy.effective_date;
    const { data: reset, error: resetError } = await admin.from('occupancy_events').select('created_at')
      .eq('effective_date', occupancyDate).eq('event_type', 'reset').order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (resetError) throw new Error('Unable to confirm current occupancy.');
    const rows = remaining.map(row => ({
      id: checkoutEventId(row.id), event_type: 'manual_decrement',
      // A reset already removed earlier arrivals from the crowd count.
      delta: reset && Date.parse(row.checked_in_at) <= Date.parse(reset.created_at) ? 0 : -1,
      effective_date: occupancyDate, created_by: staffId, created_at: now.toISOString(),
      notes: 'Family check-out',
      metadata: { source: CHECKOUT_SOURCE, checkin_id: row.id, household_id: householdId, checked_in_at: row.checked_in_at },
    }));
    const { error: writeError } = await admin.from('occupancy_events').upsert(rows, { onConflict: 'id', ignoreDuplicates: true });
    if (writeError) throw new Error('Unable to record checkout. Refresh and retry; saved departures will not be counted twice.');
  }
  const saved = await getAdmissionCheckouts(admin, data);
  if (saved.size !== data.length) throw new Error('Unable to confirm every departure. Refresh and retry.');
  return { checkouts: data.map(row => ({ id: row.id, checked_out_at: saved.get(row.id)! })), checked_out_count: remaining.length };
}

export function admissionDayRange(start: string, end: string) {
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (![start, end].every(value => datePattern.test(value) && Number.isFinite(Date.parse(`${value}T12:00:00Z`))
    && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value)) throw new Error('Choose valid start and end dates.');
  const days = (Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86400000;
  if (days < 0 || days > 92) throw new Error('Choose a date range of up to 93 days.');
  const next = new Date(Date.parse(`${end}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
  return { start: toPartyDateTimeIso(start, 0), end: toPartyDateTimeIso(next, 0) };
}
