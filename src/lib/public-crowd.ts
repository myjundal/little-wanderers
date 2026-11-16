import type { SupabaseClient } from '@supabase/supabase-js';
import type { CrowdLevel } from '@/lib/occupancy';
import { getPartyDateKey, toPartyDateTimeIso } from '@/lib/party-config';
import { overlapsPrivateParty, readPrivatePartyDays } from '@/lib/private-party-open-play';

export type PublicCrowdStatus = 'welcome' | 'busy' | 'very_busy' | 'closing' | 'closed' | 'unavailable';
export type PublicCrowdPayload = { ok: boolean; status: PublicCrowdStatus; label: string; description: string };

const MESSAGES = {
  welcome: { label: 'Come on in!', description: 'There’s room to play. Come join us!' },
  busy: { label: 'Getting Busy', description: 'We’re filling up, but there’s still room to play.' },
  very_busy: { label: 'Very Busy', description: 'We’re feeling the love! Please check back in a little while.' },
  closing: { label: 'We close at 6pm', description: 'Last entry was at 5pm. Guests already here can stay and play until 6pm.' },
  closed: { label: 'Closed right now', description: 'Check our hours and plan your next visit.' },
  unavailable: { label: 'Check before visiting', description: 'Our crowd update is unavailable. Please check availability before heading over.' },
} as const;

export function publicCrowdMessage(status: PublicCrowdStatus): PublicCrowdPayload {
  return { ok: status !== 'unavailable', status, ...MESSAGES[status] };
}

export function publicCrowdStatus(level: CrowdLevel): PublicCrowdStatus {
  if (level === 'near_capacity') return 'very_busy';
  if (level === 'busy') return 'busy';
  // Calm and Comfortable intentionally share the same public message.
  return 'welcome';
}

export async function getPublicOpenPlayPhase(admin: SupabaseClient, now = new Date()): Promise<'open' | 'closing' | 'closed'> {
  const date = getPartyDateKey(now);
  const next = new Date(`${date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const { data, error } = await admin.from('open_play_reservation_slots')
    .select('id,starts_at,ends_at,status').eq('is_soft_opening', true)
    .gte('starts_at', toPartyDateTimeIso(date, 0))
    .lt('starts_at', toPartyDateTimeIso(next.toISOString().slice(0, 10), 0))
    .order('starts_at').limit(100);
  if (error || !data || data.length >= 100) throw new Error('Unable to verify Open Play hours.');
  const windows = data.filter(slot => slot.status === 'open');
  const privateDays = await readPrivatePartyDays(admin, windows);
  // Arrival windows end at 5pm; existing guests can keep playing until 6pm.
  // Only extend a scheduled final arrival window, so closures remain authoritative.
  const lastEntry = toPartyDateTimeIso(date, 17);
  const closingWindow = { starts_at: lastEntry, ends_at: toPartyDateTimeIso(date, 18) };
  if (date >= '2026-11-16' && now.getTime() >= Date.parse(lastEntry)
    && now.getTime() < Date.parse(closingWindow.ends_at)) {
    const hadFinalArrival = windows.some(slot => Date.parse(slot.ends_at) === Date.parse(lastEntry)
      && Date.parse(slot.starts_at) < Date.parse(lastEntry) && !overlapsPrivateParty(slot, privateDays));
    return hadFinalArrival && !overlapsPrivateParty(closingWindow, privateDays) ? 'closing' : 'closed';
  }
  return windows.some(slot => Date.parse(slot.starts_at) <= now.getTime()
    && now.getTime() < Date.parse(slot.ends_at) && !overlapsPrivateParty(slot, privateDays)) ? 'open' : 'closed';
}
