import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
export const dynamic = 'force-dynamic'; export const runtime = 'nodejs';

export async function POST() {
  const supa = createServerSupabaseClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.redirect('/landing/membership?error=unauthorized');

  // find household
  const { data: hh } = await supa.from('households')
    .select('id').eq('owner_user_id', user.id).order('created_at', { ascending: false }).limit(1);
  const householdId = hh?.[0]?.id ?? null;
  if (!householdId) return NextResponse.redirect('/landing/membership?error=no-household');

  // TEMP local update (simulate Square pause)
  await supa.from('memberships').upsert({ household_id: householdId, status: 'paused' }, { 
onConflict: 'household_id' });

  return NextResponse.redirect('/landing/membership?success=1');
}

