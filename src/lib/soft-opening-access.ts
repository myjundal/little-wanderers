import type { User } from '@supabase/supabase-js';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { normalizeWaitlistEmail } from '@/lib/waitlist';

type AdminClient = ReturnType<typeof createAdminSupabaseClient>;

export type SoftOpeningAccess = {
  allowed: boolean;
  email: string | null;
  on_wanderlist: boolean;
  party_early_access: boolean;
  has_party_booking: boolean;
};

async function hasPartyEarlyAccessContact(admin: AdminClient, normalizedEmail: string) {
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

async function hasPartyBookingForUser(admin: AdminClient, userId: string) {
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

export async function getSoftOpeningAccessForUser(admin: AdminClient, user: Pick<User, 'id' | 'email'>): Promise<SoftOpeningAccess> {
  const normalizedEmail = normalizeWaitlistEmail(user.email ?? '');
  let onWanderlist = false;
  let partyEarlyAccess = false;

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

  const hasPartyBooking = await hasPartyBookingForUser(admin, user.id);

  return {
    allowed: onWanderlist || partyEarlyAccess || hasPartyBooking,
    email: user.email ?? null,
    on_wanderlist: onWanderlist,
    party_early_access: partyEarlyAccess,
    has_party_booking: hasPartyBooking,
  };
}
