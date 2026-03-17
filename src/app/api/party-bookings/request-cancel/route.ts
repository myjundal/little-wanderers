import { createClient } from '@supabase/supabase-js';
import { createServerSupabaseClient } from '@/lib/supabase/server';

const admin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function getHouseholdIdForUser(userId: string) {
  const supa = admin();
  const { data } = await supa
    .from('households')
    .select('id')
    .eq('owner_user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1);

  return data?.[0]?.id ?? null;
}

async function sendCancellationEmail(input: {
  bookingId: string;
  householdId: string;
  startTime: string;
  endTime: string;
  headcountExpected: number | null;
  notes: string | null;
}) {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    return { ok: false, reason: 'RESEND_API_KEY is not configured' };
  }

  const from = process.env.RESEND_FROM_EMAIL ?? 'Little Wanderers <onboarding@resend.dev>';
  const to = process.env.OWNER_EMAIL;
  if (!to) {
    return { ok: false, reason: 'OWNER_EMAIL is not configured' };
  }

  const html = `
    <h2>Party Booking Cancellation Requested</h2>
    <p><b>Booking ID:</b> ${input.bookingId}</p>
    <p><b>Household ID:</b> ${input.householdId}</p>
    <p><b>Start:</b> ${new Date(input.startTime).toLocaleString()}</p>
    <p><b>End:</b> ${new Date(input.endTime).toLocaleString()}</p>
    <p><b>Expected guests:</b> ${input.headcountExpected ?? '-'}</p>
    <p><b>Notes:</b> ${input.notes ?? '-'}</p>
  `;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: '[Little Wanderers] Party cancellation request',
      html,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    return { ok: false, reason: text || 'Failed to send email' };
  }

  return { ok: true as const };
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const bookingId = body?.booking_id as string | undefined;

    if (!bookingId) {
      return Response.json({ ok: false, error: 'booking_id is required' }, { status: 400 });
    }

    const server = createServerSupabaseClient();
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
      .select('id,household_id,start_time,end_time,headcount_expected,notes')
      .eq('id', bookingId)
      .eq('household_id', householdId)
      .maybeSingle();

    if (bookingErr) return Response.json({ ok: false, error: bookingErr.message }, { status: 500 });
    if (!booking) return Response.json({ ok: false, error: 'booking not found' }, { status: 404 });

    const now = Date.now();
    const startMs = new Date(booking.start_time).getTime();
    if (Number.isNaN(startMs) || startMs <= now) {
      return Response.json({ ok: false, error: 'Only upcoming bookings can request cancellation.' }, { status: 400 });
    }

    if ((booking.notes ?? '').includes('[Cancellation requested')) {
      return Response.json({ ok: true, already_requested: true });
    }

    const marker = `[Cancellation requested at ${new Date().toISOString()}]`;
    const mergedNotes = booking.notes ? `${booking.notes}\n\n${marker}` : marker;

    const { error: updateErr } = await supa
      .from('party_bookings')
      .update({ notes: mergedNotes })
      .eq('id', booking.id)
      .eq('household_id', householdId);

    if (updateErr) return Response.json({ ok: false, error: updateErr.message }, { status: 500 });

    const emailResult = await sendCancellationEmail({
      bookingId: booking.id,
      householdId,
      startTime: booking.start_time,
      endTime: booking.end_time,
      headcountExpected: booking.headcount_expected,
      notes: booking.notes,
    });

    return Response.json({ ok: true, email_sent: emailResult.ok, email_error: emailResult.ok ? null : emailResult.reason });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown error';
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
