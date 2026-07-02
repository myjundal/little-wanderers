import { requireStaffContext } from '@/lib/authz';
import { isOnOrAfterPartyBookingStart, PARTY_BOOKING_START_LABEL } from '@/lib/party-config';
import { normalizeWaitlistEmail } from '@/lib/waitlist';

export const dynamic = 'force-dynamic';

function isMissingColumnError(message: string) {
  return /column .* does not exist|Could not find the '.*' column/i.test(message);
}

function displayNameFromEmail(email: string) {
  const local = email.split('@')[0] ?? 'Family';
  return `${local.replace(/[._-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())} Family`;
}

export async function POST(req: Request) {
  const context = await requireStaffContext();
  if (!context.ok) return context.response;

  try {
    const body = (await req.json()) as {
      email?: string;
      household_name?: string;
      start_time?: string;
      end_time?: string;
      headcount_expected?: number | string | null;
      notes?: string | null;
      birthday_child_name?: string | null;
      birthday_age?: number | string | null;
    };

    const email = String(body.email ?? '').trim().toLowerCase();
    const normalizedEmail = normalizeWaitlistEmail(email);
    if (!normalizedEmail) {
      return Response.json({ ok: false, error: 'Enter a valid waitlist email.' }, { status: 400 });
    }

    const start = new Date(String(body.start_time ?? ''));
    const end = new Date(String(body.end_time ?? ''));
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      return Response.json({ ok: false, error: 'Choose a valid party date and time.' }, { status: 400 });
    }
    if (!isOnOrAfterPartyBookingStart(start)) {
      return Response.json({ ok: false, error: `Party bookings are available starting ${PARTY_BOOKING_START_LABEL}.` }, { status: 400 });
    }

    const admin = context.admin;
    const waitlist = await admin
      .from('waitlist_entries')
      .select('id,email,first_name,last_name')
      .eq('normalized_email', normalizedEmail)
      .maybeSingle();

    if (waitlist.error) throw new Error(waitlist.error.message);
    if (!waitlist.data) {
      return Response.json({ ok: false, error: 'This email is not on the waitlist yet.' }, { status: 404 });
    }

    const conflicts = await admin
      .from('party_bookings')
      .select('id,household_id')
      .lt('start_time', end.toISOString())
      .gt('end_time', start.toISOString())
      .neq('status', 'cancelled');

    if (conflicts.error) throw new Error(conflicts.error.message);

    const existingHousehold = await admin
      .from('households')
      .select('id,name,email')
      .ilike('email', normalizedEmail)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingHousehold.error) throw new Error(existingHousehold.error.message);

    let householdId = existingHousehold.data?.id as string | undefined;

    const conflictingOtherHousehold = (conflicts.data ?? []).find((item) => item.household_id !== householdId);
    if (conflictingOtherHousehold) {
      return Response.json({ ok: false, error: 'That party slot is already booked.' }, { status: 409 });
    }

    if (!householdId) {
      const waitlistName = [waitlist.data.first_name, waitlist.data.last_name].filter(Boolean).join(' ').trim();
      const householdName = String(body.household_name ?? '').trim() || (waitlistName ? `${waitlistName} Family` : displayNameFromEmail(email));
      const inserted = await admin
        .from('households')
        .insert({
          role: 'owner',
          name: householdName,
          email,
        })
        .select('id')
        .single();

      if (inserted.error) throw new Error(inserted.error.message);
      householdId = inserted.data.id as string;
    } else {
      const nextName = String(body.household_name ?? '').trim();
      if (nextName || !existingHousehold.data?.email) {
        const updated = await admin
          .from('households')
          .update({
            ...(nextName ? { name: nextName } : {}),
            email,
          })
          .eq('id', householdId);
        if (updated.error) throw new Error(updated.error.message);
      }
    }

    const headcount = body.headcount_expected == null || body.headcount_expected === ''
      ? null
      : Math.max(0, Number(body.headcount_expected) || 0);
    const birthdayAge = body.birthday_age == null || body.birthday_age === ''
      ? null
      : Math.max(0, Number(body.birthday_age) || 0);
    const notes = String(body.notes ?? '').trim() || null;
    const birthdayChildName = String(body.birthday_child_name ?? '').trim() || null;

    const bookingPayload = {
      household_id: householdId,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      headcount_expected: headcount,
      notes,
      status: 'confirmed',
      status_updated_at: new Date().toISOString(),
      created_by_user_id: context.user.id,
      created_by_role: 'owner',
      birthday_child_name: birthdayChildName,
      birthday_age: birthdayAge,
      occasion_details: 'Prebooked by staff for waitlist party access',
    };

    let booking = await admin.from('party_bookings').insert(bookingPayload).select('id').maybeSingle();

    if (booking.error && isMissingColumnError(booking.error.message)) {
      const fallbackPayload = {
        household_id: bookingPayload.household_id,
        start_time: bookingPayload.start_time,
        end_time: bookingPayload.end_time,
        headcount_expected: bookingPayload.headcount_expected,
        notes: bookingPayload.notes,
        status: bookingPayload.status,
        status_updated_at: bookingPayload.status_updated_at,
        created_by_user_id: bookingPayload.created_by_user_id,
        created_by_role: bookingPayload.created_by_role,
      };
      booking = await admin.from('party_bookings').insert(fallbackPayload).select('id').maybeSingle();
    }

    if (booking.error) throw new Error(booking.error.message);

    const contact = await admin
      .from('contacts')
      .upsert({
        email,
        normalized_email: normalizedEmail,
        first_name: waitlist.data.first_name ?? null,
        last_name: waitlist.data.last_name ?? null,
        source: 'waitlist',
        raw_metadata: { household_id: householdId, prebooked_party_booking_id: booking.data?.id ?? null },
      }, { onConflict: 'normalized_email' })
      .select('id')
      .maybeSingle();

    if (!contact.error && contact.data?.id) {
      await admin
        .from('contact_tags')
        .upsert([
          { contact_id: contact.data.id, tag: 'waitlist' },
          { contact_id: contact.data.id, tag: 'party_early_access' },
        ], { onConflict: 'contact_id,tag' });
    }

    return Response.json({ ok: true, household_id: householdId, booking_id: booking.data?.id ?? null });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown error';
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
