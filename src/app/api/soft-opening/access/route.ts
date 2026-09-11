import { NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { normalizeWaitlistEmail } from '@/lib/waitlist';

export const dynamic = 'force-dynamic';

const NO_STORE_HEADERS = { 'cache-control': 'no-store, max-age=0' };

async function hasPartyEarlyAccessContact(admin: ReturnType<typeof createAdminSupabaseClient>, normalizedEmail: string) {
  const { data: contact, error: contactError } = await admin
    .from('contacts')
    .select('id')
    .eq('normalized_email', normalizedEmail)
    .maybeSingle();

  if (contactError) throw new Error(contactError.message);
  if (!contact?.id) return false;

  const { data: tag, error: tagError } = await admin
    .from('contact_tags')
    .select('contact_id')
    .eq('contact_id', contact.id)
    .eq('tag', 'party_early_access')
    .maybeSingle();

  if (tagError) throw new Error(tagError.message);
  return Boolean(tag);
}

async function hasPartyBookingForUser(admin: ReturnType<typeof createAdminSupabaseClient>, userId: string) {
  const { data: memberships, error: memberError } = await admin
    .from('household_members')
    .select('household_id')
    .eq('user_id', userId)
    .limit(25);

  if (memberError) throw new Error(memberError.message);

  const householdIds = [...new Set((memberships ?? []).map((item) => item.household_id as string).filter(Boolean))];
  if (householdIds.length === 0) return false;

  const { data: booking, error: bookingError } = await admin
    .from('party_bookings')
    .select('id')
    .in('household_id', householdIds)
    .neq('status', 'cancelled')
    .limit(1)
    .maybeSingle();

  if (bookingError) throw new Error(bookingError.message);
  return Boolean(booking);
}

export async function GET() {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ ok: false, allowed: false, error: 'Please sign in to view soft opening access.' }, { status: 401, headers: NO_STORE_HEADERS });
  }

  const normalizedEmail = normalizeWaitlistEmail(user.email ?? '');
  const admin = createAdminSupabaseClient();

  try {
    let onWanderlist = false;
    let partyEarlyAccess = false;
    let hasPartyBooking = false;

    if (normalizedEmail) {
      const { data: waitlist, error: waitlistError } = await admin
        .from('waitlist_entries')
        .select('id')
        .eq('normalized_email', normalizedEmail)
        .maybeSingle();

      if (waitlistError) throw new Error(waitlistError.message);

      onWanderlist = Boolean(waitlist);
      partyEarlyAccess = await hasPartyEarlyAccessContact(admin, normalizedEmail);
    }

    hasPartyBooking = await hasPartyBookingForUser(admin, user.id);

    return NextResponse.json({
      ok: true,
      allowed: onWanderlist || partyEarlyAccess || hasPartyBooking,
      access: {
        on_wanderlist: onWanderlist,
        party_early_access: partyEarlyAccess,
        has_party_booking: hasPartyBooking,
      },
      email: user.email ?? null,
    }, { headers: NO_STORE_HEADERS });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unable to check soft opening access right now.';
    return NextResponse.json({ ok: false, allowed: false, error: message }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
