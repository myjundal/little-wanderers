import { createClient } from '@supabase/supabase-js';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getLatestHouseholdIdForUser } from '@/lib/households';

const admin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

type ReschedulePayload = {
  booking_id?: string;
  start_time?: string;
  end_time?: string;
  slot?: '11:00' | '15:00';
};

function isWeekendSlot(start: Date, end: Date, slot?: string) {
  const day = start.getUTCDay();
  const isWeekend = day === 0 || day === 6;
  const durationHours = (end.getTime() - start.getTime()) / 3_600_000;
  return isWeekend && (slot === '11:00' || slot === '15:00') && durationHours === 3;
}

async function getHouseholdIdForUser(userId: string) {
  return getLatestHouseholdIdForUser(admin(), userId);
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ReschedulePayload;
    const bookingId = body.booking_id;
    const startTime = body.start_time;
    const endTime = body.end_time;
    const slot = body.slot;

    if (!bookingId || !startTime || !endTime) {
      return Response.json({ ok: false, error: 'booking_id, start_time, and end_time are required' }, { status: 400 });
    }

    const start = new Date(startTime);
    const end = new Date(endTime);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      return Response.json({ ok: false, error: 'invalid time range' }, { status: 400 });
    }
    if (!isWeekendSlot(start, end, slot)) {
      return Response.json({ ok: false, error: 'Reschedule is only available for weekend 11:00 AM or 3:00 PM slots.' }, { status: 400 });
    }

    const server = createServerSupabaseClient();
    const {
      data: { user },
    } = await server.auth.getUser();
    if (!user) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });

    const householdId = await getHouseholdIdForUser(user.id);
    if (!householdId) return Response.json({ ok: false, error: 'household not found' }, { status: 404 });

    const supa = admin();
    const { data: booking } = await supa
      .from('party_bookings')
      .select('id,start_time,notes,status')
      .eq('id', bookingId)
      .eq('household_id', householdId)
      .maybeSingle();

    if (!booking) return Response.json({ ok: false, error: 'booking not found' }, { status: 404 });
    if (booking.status === 'cancelled') return Response.json({ ok: false, error: 'booking is cancelled' }, { status: 409 });
    if ((booking.notes ?? '').includes('[Rescheduled once')) {
      return Response.json({ ok: false, error: 'This booking has already been rescheduled once.' }, { status: 409 });
    }

    const daysUntilStart = (new Date(booking.start_time).getTime() - Date.now()) / 86_400_000;
    if (daysUntilStart < 7) {
      return Response.json({ ok: false, error: 'Reschedule is only allowed up to 7 days before the party.' }, { status: 409 });
    }

    const { data: conflicts } = await supa
      .from('party_bookings')
      .select('id')
      .neq('id', bookingId)
      .lt('start_time', end.toISOString())
      .gt('end_time', start.toISOString())
      .neq('status', 'cancelled');

    if ((conflicts ?? []).length > 0) {
      return Response.json({ ok: false, error: 'That new slot is not available.' }, { status: 409 });
    }

    const updatedNotes = `${booking.notes ?? ''}\n[Rescheduled once at ${new Date().toISOString()}]`.trim();
    const { error } = await supa
      .from('party_bookings')
      .update({
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        notes: updatedNotes,
        status_updated_at: new Date().toISOString(),
      })
      .eq('id', bookingId);

    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
    return Response.json({ ok: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown error';
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
