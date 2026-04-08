import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getLatestHouseholdIdForUser } from '@/lib/households';
export const dynamic = 'force-dynamic'; export const runtime = 'nodejs';

export async function POST() {
  const supa = createServerSupabaseClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.redirect('/landing/membership?error=unauthorized');

  const householdId = await getLatestHouseholdIdForUser(supa, user.id);
  if (!householdId) return NextResponse.redirect('/landing/membership?error=no-household');

  await supa.from('memberships').upsert({ household_id: householdId, renews_at: new Date().toISOString() }, { 
onConflict: 'household_id' });

  return NextResponse.redirect('/landing/membership?success=1');
}

