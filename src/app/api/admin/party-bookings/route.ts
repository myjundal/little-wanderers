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

    let data = primary.data ?? [];
    if (primary.error) {
      if (!isMissingColumnError(primary.error.message)) {
        return Response.json({ ok: false, error: primary.error.message }, { status: 500 });
      }

      const fallback = await context.admin.from('party_bookings').select(PARTY_SELECT_FALLBACK).order('start_time', { ascending: true });
      if (fallback.error) {
        return Response.json({ ok: false, error: fallback.error.message }, { status: 500 });
      }

      data = (fallback.data ?? []).map((item) => ({
        ...item,
        status: 'pending',
        status_updated_at: item.created_at,
      }));
    }

    const householdIds = [...new Set(data.map((item) => item.household_id))];
    let householdNames = new Map<string, string>();

    if (householdIds.length > 0) {
      const { data: households } = await context.admin.from('households').select('id,name').in('id', householdIds);
      householdNames = new Map((households ?? []).map((item) => [item.id, item.name ?? 'Household']));
    }

    const items = data.map((item) => ({
      ...item,
      household_name: householdNames.get(item.household_id) ?? 'Household',
    }));

    return Response.json({ ok: true, items });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown error';
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
