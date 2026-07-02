import { NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { normalizeWaitlistEmail } from '@/lib/waitlist';

export const dynamic = 'force-dynamic';

async function attachPrebookedHousehold(admin: ReturnType<typeof createAdminSupabaseClient>, user: { id: string; email?: string | null }, normalizedEmail: string) {
  const existingDirect = await admin
    .from('households')
    .select('id')
    .eq('user_id', user.id)
    .limit(1);

  if (existingDirect.error) throw new Error(existingDirect.error.message);
  if ((existingDirect.data ?? []).length > 0) return null;

  const existingMember = await admin
    .from('household_members')
    .select('household_id')
    .eq('user_id', user.id)
    .limit(1);

  if (existingMember.error) throw new Error(existingMember.error.message);
  if ((existingMember.data ?? []).length > 0) return null;

  const prebooked = await admin
    .from('households')
    .select('id,email,user_id')
    .ilike('email', normalizedEmail)
    .is('user_id', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (prebooked.error) throw new Error(prebooked.error.message);
  if (!prebooked.data?.id) return null;

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
      user_id: user.id,
      email: user.email ?? normalizedEmail,
      role: 'owner',
    })
    .eq('id', prebooked.data.id)
    .is('user_id', null);

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

export async function POST() {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user?.email) {
    return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });
  }

  const normalizedEmail = normalizeWaitlistEmail(user.email);
  if (!normalizedEmail) {
    return NextResponse.json({ ok: false, error: 'No waitlist email found for this account.' }, { status: 400 });
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

  if (error) {
    return NextResponse.json({ ok: false, error: 'Unable to mark waitlist access as claimed.' }, { status: 500 });
  }

  try {
    const householdId = await attachPrebookedHousehold(admin, user, normalizedEmail);
    return NextResponse.json({ ok: true, claimed: Boolean(data), household_id: householdId });
  } catch {
    return NextResponse.json({ ok: true, claimed: Boolean(data), household_id: null });
  }
}
