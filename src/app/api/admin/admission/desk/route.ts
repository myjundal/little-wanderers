import { requireStaffContext } from '@/lib/authz';
import { getPartyDateKey, toPartyDateTimeIso } from '@/lib/party-config';
import { isUuid } from '@/lib/open-play-reservations';
import { getWaiverStatus, WAIVER_STATUS_SELECT } from '@/lib/waivers';
import { getStaffFamilySearchAliases } from '@/lib/staff-family-search';
import { getReservationAdmissionStatuses } from '@/lib/reservation-admission-status';
import { squareEnvironment } from '@/lib/square-client';

export const dynamic = 'force-dynamic';
const familySelect = 'id,name,email,phone';
const personSelect = 'id,household_id,first_name,last_name,role,birthdate';
const reservationSelect = 'id,household_id,child_count,adult_count,child_ids,payment_status,payment_choice,payment_environment,amount_cents,slot:open_play_reservation_slots!inner(label,starts_at,ends_at)';

export async function GET(req: Request) {
  const c = await requireStaffContext();
  if (!c.ok) return c.response;
  const params = new URL(req.url).searchParams;
  const family = params.get('family');
  // Strip PostgREST operators; each search token is a literal name/contact fragment.
  const tokens = (params.get('q') ?? '').slice(0, 120).toLowerCase().replace(/[^\p{L}\p{N}@+.' -]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  const today = getPartyDateKey(new Date());
  const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
  try {
    let ids: string[] = [];
    let truncated = false;
    let reservations: Array<{ id: string; household_id: string; child_count: number; adult_count: number; slot: { label: string; starts_at: string; ends_at: string } }> = [];
    if (family) {
      if (!isUuid(family)) return Response.json({ ok: false, error: 'Invalid family.' }, { status: 400 });
      ids = [family];
    } else if (tokens.length) {
      const term = `*${tokens[0]}*`;
      // Search the database before limiting, so older families remain discoverable.
      const [households, people] = await Promise.all([
        c.admin.from('households').select('id').or(`name.ilike.${term},email.ilike.${term},phone.ilike.${term}`).order('id').limit(101),
        c.admin.from('people').select('household_id').or(`first_name.ilike.${term},last_name.ilike.${term}`).order('id').limit(301),
      ]);
      if (households.error || people.error) throw new Error('Unable to search families.');
      truncated = (households.data?.length ?? 0) > 100 || (people.data?.length ?? 0) > 300;
      ids = [...new Set([...(households.data ?? []).map(row => row.id), ...(people.data ?? []).map(row => row.household_id)].filter(Boolean))];
    } else {
      const [result, arrivals] = await Promise.all([c.admin.from('open_play_reservations')
        .select(reservationSelect)
        .neq('status', 'cancelled').gte('slot.starts_at', toPartyDateTimeIso(today, 0))
        .lt('slot.starts_at', toPartyDateTimeIso(tomorrow, 0)).order('created_at').limit(501),
      c.admin.from('checkins').select('person_id')
        .gte('checked_in_at', toPartyDateTimeIso(today, 0)).lt('checked_in_at', toPartyDateTimeIso(tomorrow, 0)).limit(501)]);
      if (result.error || arrivals.error) throw new Error('Unable to load today’s reservations and visitors.');
      truncated = (result.data?.length ?? 0) > 500 || (arrivals.data?.length ?? 0) > 500;
      reservations = (result.data ?? []).slice(0, 500).map(row => ({ ...row, slot: Array.isArray(row.slot) ? row.slot[0] : row.slot })) as typeof reservations;
      const visitorIds = [...new Set((arrivals.data ?? []).slice(0, 500).map(row => row.person_id).filter(Boolean))];
      // Legacy checkins have more than one relationship to people. Resolve the
      // actual person_id explicitly instead of relying on an ambiguous embed.
      const visitors = visitorIds.length ? await c.admin.from('people').select('household_id').in('id', visitorIds).limit(501) : { data: [], error: null };
      if (visitors.error) throw new Error('Unable to load visiting family details.');
      ids = [...new Set([...reservations.map(row => row.household_id), ...(visitors.data ?? []).map(row => row.household_id)].filter(Boolean))];
    }
    if (!ids.length) return Response.json({ ok: true, date: today, items: [], truncated });
    const aliases = await getStaffFamilySearchAliases(c.admin);
    const canonicalId = (id: string) => aliases.get(id) ?? id;
    // Include every confirmed alternate contact in search, but show the canonical family once.
    const matchedIds = ids;
    ids = [...new Set(ids.map(canonicalId))];
    const lookupIds = [...new Set([...matchedIds, ...ids, ...[...aliases.keys()].filter(id => ids.includes(canonicalId(id)))])];
    const [households, people, waivers, bookings] = await Promise.all([
      c.admin.from('households').select(familySelect).in('id', lookupIds).order('name').limit(1000),
      c.admin.from('people').select(personSelect).in('household_id', lookupIds).order('created_at').limit(1000),
      c.admin.from('waivers').select(`household_id,${WAIVER_STATUS_SELECT}`).in('household_id', ids).order('signed_at', { ascending: false }).limit(1000),
      family || tokens.length
        ? c.admin.from('open_play_reservations').select(reservationSelect)
          .in('household_id', lookupIds).neq('status', 'cancelled').order('created_at').limit(501)
        : Promise.resolve(null),
    ]);
    if (households.error || people.error || waivers.error) throw new Error('Unable to load family details.');
    if (bookings) {
      if (bookings.error) throw new Error('Unable to load family Open Play reservations.');
      if ((bookings.data?.length ?? 0) > 500) throw new Error('Too many matching reservations. Please search with a more specific name or email.');
      reservations = (bookings.data ?? []).map(row => ({ ...row, slot: Array.isArray(row.slot) ? row.slot[0] : row.slot })) as typeof reservations;
    }
    reservations.sort((a, b) => Date.parse(a.slot.starts_at) - Date.parse(b.slot.starts_at));
    const admission = await getReservationAdmissionStatuses(c.admin, reservations, squareEnvironment());
    if ((people.data?.length ?? 0) >= 1000 || (waivers.data?.length ?? 0) >= 1000) throw new Error('Too many matching records. Please search with a more specific name or email.');
    const foundItems = (households.data ?? []).filter(household => ids.includes(household.id)).map(household => {
      const members = (people.data ?? []).filter(person => person.household_id === household.id);
      return { ...household, people: members,
        waiver_status: getWaiverStatus((waivers.data ?? []).filter(row => row.household_id === household.id), new Date(), members.filter(person => person.role === 'child').map(person => person.id)).status,
        reservations: reservations.filter(row => canonicalId(row.household_id) === household.id).map(row => ({ ...row, admission_status: admission.get(row.id) })),
      };
    }).filter(item => {
      const related = (households.data ?? []).filter(row => canonicalId(row.id) === item.id);
      const searchText = [...related.flatMap(row => [row.name, row.email, row.phone]),
        ...(people.data ?? []).filter(person => canonicalId(person.household_id) === item.id).map(person => `${person.first_name ?? ''} ${person.last_name ?? ''}`)].join(' ').toLowerCase();
      return tokens.every(token => searchText.includes(token));
    });
    // Keep empty signup placeholders accessible by direct link. In search, show
    // the populated family sharing their contact instead; no account is changed.
    const contactKey = (value: string | null) => (value ?? '').trim().toLowerCase();
    const phoneKey = (value: string | null) => { const digits = (value ?? '').replace(/\D/g, ''); return digits.length === 10 ? `1${digits}` : digits; };
    const items = foundItems.filter(item => family || item.name !== 'My Household' || item.people.length || item.reservations.length
      || !foundItems.some(other => other.id !== item.id && other.people.length && (households.data ?? []).some(contact => canonicalId(contact.id) === other.id
        && ((contactKey(item.email) && contactKey(item.email) === contactKey(contact.email)) || (phoneKey(item.phone) && phoneKey(item.phone) === phoneKey(contact.phone))))));
    return Response.json({ ok: true, date: today, items, truncated });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Unable to load check-in desk.' }, { status: 503 });
  }
}
