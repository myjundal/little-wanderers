import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { normalizeWaitlistEmail } from '@/lib/waitlist';

type WaitlistUser = { id: string; email?: string | null };

async function attachPrebookedHousehold(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  user: WaitlistUser,
  normalizedEmail: string
) {
  const existingMember = await admin
    .from('household_members')
    .select('household_id')
    .eq('user_id', user.id)
    .limit(1);

  if (existingMember.error) throw new Error(existingMember.error.message);
  if ((existingMember.data ?? []).length > 0) return null;

  const prebooked = await admin
    .from('households')
    .select('id,email')
    .ilike('email', normalizedEmail)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (prebooked.error) throw new Error(prebooked.error.message);
  if (!prebooked.data?.id) return null;

  const linkedMember = await admin
    .from('household_members')
    .select('user_id')
    .eq('household_id', prebooked.data.id)
    .not('user_id', 'is', null)
    .limit(1);

  if (linkedMember.error) throw new Error(linkedMember.error.message);
  if ((linkedMember.data ?? []).length > 0) return null;

  const hasParty = await admin
    .from('party_bookings')
    .select('id')
    .eq('household_id', prebooked.data.id)
    .neq('status', 'cancelled')
    .limit(1);

  if (hasParty.error) throw new Error(hasParty.error.message);
  if ((hasParty.data ?? []).length === 0) return null;

  const update = await admin
    .from('households')
    .update({
      email: user.email ?? normalizedEmail,
      role: 'owner',
    })
    .eq('id', prebooked.data.id);

  if (update.error) throw new Error(update.error.message);

  const member = await admin
    .from('household_members')
    .upsert({
      household_id: prebooked.data.id,
      user_id: user.id,
      role: 'owner',
    }, { onConflict: 'household_id,user_id' });

  if (member.error) throw new Error(member.error.message);

  return prebooked.data.id as string;
}

export async function claimWaitlistForUser(user: WaitlistUser) {
  const normalizedEmail = normalizeWaitlistEmail(user.email ?? '');
  if (!normalizedEmail) {
    return { claimed: false, householdId: null };
  }

  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from('waitlist_entries')
    .update({
      claimed_user_id: user.id,
      claimed_at: new Date().toISOString(),
    })
    .eq('normalized_email', normalizedEmail)
    .select('id')
    .maybeSingle();

  if (error) throw error;

  try {
    const householdId = await attachPrebookedHousehold(admin, user, normalizedEmail);
    return { claimed: Boolean(data), householdId };
  } catch {
    return { claimed: Boolean(data), householdId: null };
  }
}
