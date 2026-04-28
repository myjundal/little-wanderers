import { requireStaffContext } from '@/lib/authz';

export const dynamic = 'force-dynamic';

const PARTY_SELECT = 'id,household_id,start_time,end_time,room,headcount_expected,price_quote_cents,notes,status,status_updated_at,created_at,updated_at,current_child_count,current_adult_count,final_child_count,final_adult_count,final_total_count,attendance_finalized_at,attendance_recorded_by,attendance_notes';
const PARTY_SELECT_FALLBACK = 'id,household_id,start_time,end_time,room,headcount_expected,price_quote_cents,notes,status,status_updated_at,created_at,updated_at';

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
        status: item.status ?? 'pending',
        status_updated_at: item.status_updated_at ?? item.created_at,
        current_child_count: 0,
        current_adult_count: 0,
        final_child_count: null,
        final_adult_count: null,
        final_total_count: null,
        attendance_finalized_at: null,
        attendance_recorded_by: null,
        attendance_notes: null,
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
