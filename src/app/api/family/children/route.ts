import { NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { FAMILY_PRIMARY_CAREGIVER_ROLE } from '@/lib/family-roles';
import { ensureGuardianProfile, parseGuardianName } from '@/lib/family-profile';
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

type AgeUnit = 'months' | 'years';

function approximateBirthdateFromAgeMonths(ageMonths: number) {
  const today = new Date();
  const approximate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  approximate.setUTCMonth(approximate.getUTCMonth() - ageMonths);
  return approximate.toISOString().slice(0, 10);
}

function parseAge(value: unknown, unitValue: unknown): { months: number; label: string } | null {
  const age = Number(value);
  const unit: AgeUnit | null =
    unitValue === undefined || unitValue === null
      ? 'years'
      : unitValue === 'months' || unitValue === 'years'
      ? unitValue
      : null;
  if (!unit) return null;
  if (!Number.isFinite(age) || age < 0) return null;
  if (unit === 'months') {
    const months = Math.round(age);
    if (months > 144) return null;
    return { months, label: `${months} ${months === 1 ? 'month' : 'months'}` };
  }
  const roundedYears = Math.round(age * 2) / 2;
  if (roundedYears > 12) return null;
  const months = Math.round(roundedYears * 12);
  return { months, label: `${roundedYears} ${roundedYears === 1 ? 'year' : 'years'}` };
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

  const body = (await req.json().catch(() => null)) as { name?: string; age_years?: number; age_unit?: AgeUnit; guardian_first_name?: string; guardian_last_name?: string; require_age?: boolean } | null;
  const name = String(body?.name ?? '').trim();
  const age = parseAge(body?.age_years, body?.age_unit);
  const requireAge = body?.require_age !== false;
  const guardian = parseGuardianName(body);
  if (name.length < 1) {
    return NextResponse.json({ ok: false, error: 'Please enter your child’s name.' }, { status: 400 });
  }
  if (name.length > 80) {
    return NextResponse.json({ ok: false, error: 'Please use a shorter child name.' }, { status: 400 });
  }
  if (requireAge && age == null) {
    return NextResponse.json({ ok: false, error: 'Please enter your child’s age.' }, { status: 400 });
  }

  try {
    const householdId = await ensureHouseholdForSignedInUser(user);
    const admin = createAdminSupabaseClient();
    await ensureGuardianProfile({
      admin,
      householdId,
      userId: user.id,
      email: user.email,
      firstName: guardian.firstName,
      lastName: guardian.lastName,
    });
    const { firstName, lastName } = splitName(name);
    const { data: child, error } = await admin
      .from('people')
      .insert({
        household_id: householdId,
        role: 'child',
        first_name: firstName,
        last_name: lastName,
        gender: null,
        birthdate: age == null ? null : approximateBirthdateFromAgeMonths(age.months),
        notes: age == null
          ? 'Added during class pre-registration. Birthday can be updated in My Info/People.'
          : `Approximate age ${age.label} entered during class pre-registration. Birthday can be updated in My Info/People.`,
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

  const body = (await req.json().catch(() => null)) as { person_id?: string; age_years?: number; age_unit?: AgeUnit; guardian_first_name?: string; guardian_last_name?: string } | null;
  const personId = String(body?.person_id ?? '').trim();
  const age = parseAge(body?.age_years, body?.age_unit);
  const guardian = parseGuardianName(body);
  if (!personId) {
    return NextResponse.json({ ok: false, error: 'Please choose a child.' }, { status: 400 });
  }
  if (age == null) {
    return NextResponse.json({ ok: false, error: 'Please enter your child’s age.' }, { status: 400 });
  }

  try {
    const householdId = await ensureHouseholdForSignedInUser(user);
    const admin = createAdminSupabaseClient();
    await ensureGuardianProfile({
      admin,
      householdId,
      userId: user.id,
      email: user.email,
      firstName: guardian.firstName,
      lastName: guardian.lastName,
    });
    const { data: child, error } = await admin
      .from('people')
      .update({
        birthdate: approximateBirthdateFromAgeMonths(age.months),
        notes: `Approximate age ${age.label} entered during class pre-registration. Birthday can be updated in My Info/People.`,
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
