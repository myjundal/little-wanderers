import { NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { FAMILY_PRIMARY_CAREGIVER_ROLE } from '@/lib/family-roles';
import { getLatestHouseholdIdForUser } from '@/lib/households';

export const dynamic = 'force-dynamic';

function splitName(input: string) {
  const cleaned = input.trim().replace(/\s+/g, ' ');
  const [firstName, ...rest] = cleaned.split(' ');
  return {
    firstName: firstName ?? '',
    lastName: rest.join(' ') || null,
  };
}

function approximateBirthdateFromAge(ageYears: number) {
  const ageMonths = Math.round(ageYears * 12);
  const today = new Date();
  const approximate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  approximate.setUTCMonth(approximate.getUTCMonth() - ageMonths);
  return approximate.toISOString().slice(0, 10);
}

function parseAgeYears(value: unknown) {
  const age = Number(value);
  if (!Number.isFinite(age) || age < 0 || age > 12) return null;
  return Math.round(age * 2) / 2;
}

async function ensureHouseholdForSignedInUser(user: { id: string; email?: string | null }) {
  const admin = createAdminSupabaseClient();
  const existingHouseholdId = await getLatestHouseholdIdForUser(admin, user.id);
  if (existingHouseholdId) return existingHouseholdId;

  const { data: household, error: householdError } = await admin
    .from('households')
    .insert({
      user_id: user.id,
      role: FAMILY_PRIMARY_CAREGIVER_ROLE,
      name: user.email?.split('@')[0] || 'My Household',
      email: user.email ?? null,
    })
    .select('id')
    .single();

  if (householdError) throw new Error(householdError.message);

  const { error: memberError } = await admin
    .from('household_members')
    .upsert({
      household_id: household.id,
      user_id: user.id,
      role: FAMILY_PRIMARY_CAREGIVER_ROLE,
    }, { onConflict: 'household_id,user_id' });

  if (memberError) throw new Error(memberError.message);
  return household.id as string;
}

export async function POST(req: Request) {
  const server = createServerSupabaseClient();
  const {
    data: { user },
    error: userError,
  } = await server.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as { name?: string; age_years?: number } | null;
  const name = String(body?.name ?? '').trim();
  const ageYears = parseAgeYears(body?.age_years);
  if (name.length < 1) {
    return NextResponse.json({ ok: false, error: 'Please enter your child’s name.' }, { status: 400 });
  }
  if (name.length > 80) {
    return NextResponse.json({ ok: false, error: 'Please use a shorter child name.' }, { status: 400 });
  }
  if (ageYears == null) {
    return NextResponse.json({ ok: false, error: 'Please enter your child’s age.' }, { status: 400 });
  }

  try {
    const householdId = await ensureHouseholdForSignedInUser(user);
    const { firstName, lastName } = splitName(name);
    const admin = createAdminSupabaseClient();
    const { data: child, error } = await admin
      .from('people')
      .insert({
        household_id: householdId,
        role: 'child',
        first_name: firstName,
        last_name: lastName,
        gender: null,
        birthdate: approximateBirthdateFromAge(ageYears),
        notes: `Approximate age ${ageYears} entered during class pre-registration. Birthday can be updated in My People.`,
      })
      .select('id,first_name,last_name,birthdate')
      .maybeSingle();

    if (error) {
      return NextResponse.json({ ok: false, error: 'Unable to save your child right now.' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, child });
  } catch {
    return NextResponse.json({ ok: false, error: 'Unable to prepare your family account right now.' }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const server = createServerSupabaseClient();
  const {
    data: { user },
    error: userError,
  } = await server.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as { person_id?: string; age_years?: number } | null;
  const personId = String(body?.person_id ?? '').trim();
  const ageYears = parseAgeYears(body?.age_years);
  if (!personId) {
    return NextResponse.json({ ok: false, error: 'Please choose a child.' }, { status: 400 });
  }
  if (ageYears == null) {
    return NextResponse.json({ ok: false, error: 'Please enter your child’s age.' }, { status: 400 });
  }

  try {
    const householdId = await ensureHouseholdForSignedInUser(user);
    const admin = createAdminSupabaseClient();
    const { data: child, error } = await admin
      .from('people')
      .update({
        birthdate: approximateBirthdateFromAge(ageYears),
        notes: `Approximate age ${ageYears} entered during class pre-registration. Birthday can be updated in My People.`,
      })
      .eq('id', personId)
      .eq('household_id', householdId)
      .eq('role', 'child')
      .select('id,first_name,last_name,birthdate')
      .maybeSingle();

    if (error || !child) {
      return NextResponse.json({ ok: false, error: 'Unable to save your child’s age right now.' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, child });
  } catch {
    return NextResponse.json({ ok: false, error: 'Unable to prepare your family account right now.' }, { status: 500 });
  }
}
