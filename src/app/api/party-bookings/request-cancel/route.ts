import { createClient } from '@supabase/supabase-js';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getLatestHouseholdIdForUser } from '@/lib/households';
import { sendPartyCancellationNotification } from '@/lib/admin-notifications';
import { logger } from '@/lib/logger';

export const maxDuration = 60;

const admin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function getHouseholdIdForUser(userId: string) {
  return getLatestHouseholdIdForUser(admin(), userId);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const bookingId = body?.booking_id as string | undefined;

    if (!bookingId) {
      return Response.json({ ok: false, error: 'booking_id is required' }, { status: 400 });
    }

    const server = await createServerSupabaseClient();
    const {
      data: { user },
    } = await server.auth.getUser();

    if (!user) {
      return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }

    const householdId = await getHouseholdIdForUser(user.id);
    if (!householdId) {
      return Response.json({ ok: false, error: 'household not found' }, { status: 404 });
    }

    const supa = admin();
    const { data: booking, error: bookingErr } = await supa
      .from('party_bookings')
      .select('id,household_id,start_time,end_time,headcount_expected,notes,status')
      .eq('id', bookingId)
      .eq('household_id', householdId)
      .maybeSingle();

    if (bookingErr) return Response.json({ ok: false, error: bookingErr.message }, { status: 500 });
    if (!booking) return Response.json({ ok: false, error: 'booking not found' }, { status: 404 });
    if (booking.status === 'cancelled') return Response.json({ ok: true, already_cancelled: true });

    const now = Date.now();
    const startMs = new Date(booking.start_time).getTime();
    if (Number.isNaN(startMs) || startMs <= now) {
      return Response.json({ ok: false, error: 'Only upcoming bookings can request cancellation.' }, { status: 400 });
    }

    if ((booking.notes ?? '').includes('[Cancellation requested')) {
      return Response.json({ ok: true, already_requested: true });
    }

    const requestedAt = new Date().toISOString();
    const marker = `[Cancellation requested at ${requestedAt}]`;
    const mergedNotes = booking.notes ? `${booking.notes}\n\n${marker}` : marker;

    let update = supa
      .from('party_bookings')
      .update({ notes: mergedNotes })
      .eq('id', booking.id)
      .eq('household_id', householdId)
      .eq('status', booking.status);
    update = booking.notes == null ? update.is('notes', null) : update.eq('notes', booking.notes);
    const { data: saved, error: updateErr } = await update.select('id').maybeSingle();

    if (updateErr) return Response.json({ ok: false, error: updateErr.message }, { status: 500 });
    if (!saved) return Response.json({ ok: false, error: 'Booking changed. Please refresh and try again.' }, { status: 409 });

    const { data: household } = await supa.from('households').select('name,email').eq('id', householdId).maybeSingle();
    const emailResult = await sendPartyCancellationNotification({
      bookingId: booking.id,
      requestedAt,
      familyName: household?.name,
      familyEmail: household?.email || user.email,
      startTime: booking.start_time,
      endTime: booking.end_time,
      headcountExpected: booking.headcount_expected,
      notes: booking.notes,
    }).catch(error => ({ ok: false as const, error: error instanceof Error ? error.message : 'Unable to send cancellation notification.' }));

    if (!emailResult.ok) logger.error({ action: 'party.cancellation_notification_failed', bookingId: booking.id, householdId }, new Error(emailResult.error));

    return Response.json({ ok: true, email_sent: emailResult.ok });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown error';
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
