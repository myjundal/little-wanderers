import { requireStaffContext } from '@/lib/authz';

const PARTY_SELECT = 'id,household_id,start_time,end_time,room,headcount_expected,price_quote_cents,notes,status,status_updated_at,created_at,updated_at';
const PARTY_SELECT_FALLBACK = 'id,household_id,start_time,end_time,room,headcount_expected,price_quote_cents,notes,created_at,updated_at';

function isMissingColumnError(message: string) {
  return /column .* does not exist|Could not find the '.*' column/i.test(message);
}

export async function GET() {
  const context = await requireStaffContext();
  if (!context.ok) return context.response;

  try {
    const primary = await context.admin.from('party_bookings').select(PARTY_SELECT).order('start_time', { ascending: true });
    const data = !primary.error
      ? primary.data ?? []
      : isMissingColumnError(primary.error.message)
        ? (await context.admin.from('party_bookings').select(PARTY_SELECT_FALLBACK).order('start_time', { ascending: true })).data?.map((item) => ({
            ...item,
            status: 'pending',
            status_updated_at: item.created_at,
          })) ?? []
        : (() => {
            throw new Error(primary.error.message);
          })();

    const householdIds = [...new Set(data.map((item) => item.household_id))];
    let householdNames = new Map<string, string>();

    if (householdIds.length > 0) {
      const { data: households } = await context.admin.from('households').select('id,name').in('id', householdIds);
      householdNames = new Map((households ?? []).map((item) => [item.id, item.name ?? 'Household']));
    }

    let historyByBooking = new Map<string, Array<Record<string, unknown>>>();
    const ids = data.map((item) => item.id);
    if (ids.length > 0) {
      const events = await context.admin
        .from('party_booking_events')
        .select('id,party_booking_id,from_status,to_status,notes,created_at,changed_by')
        .in('party_booking_id', ids)
        .order('created_at', { ascending: false });

      if (!events.error) {
        historyByBooking = (events.data ?? []).reduce((map, item) => {
          const list = map.get(item.party_booking_id) ?? [];
          list.push(item as unknown as Record<string, unknown>);
          map.set(item.party_booking_id, list);
          return map;
        }, new Map<string, Array<Record<string, unknown>>>());
      }
    }

    const items = data.map((item) => ({
      ...item,
      household_name: householdNames.get(item.household_id) ?? 'Household',
      history: historyByBooking.get(item.id) ?? [],
    }));

    return Response.json({ ok: true, items });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown error';
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
