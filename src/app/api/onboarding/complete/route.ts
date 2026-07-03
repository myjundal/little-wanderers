import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { claimWaitlistForUser } from '@/lib/waitlist-claim';
import { US_CITIES_BY_STATE, type UsStateCode } from '@/lib/us-cities';
import { sendNewSignupNotification } from '@/lib/admin-notifications';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const genderSchema = z.enum(['female', 'male', 'non_binary', 'prefer_not_to_say']);
const childSchema = z.object({
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().optional(),
  gender: genderSchema,
  birthdate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const payloadSchema = z.object({
  adultFirstName: z.string().trim().min(1),
  adultLastName: z.string().trim().min(1),
  adultGender: genderSchema,
  children: z.array(childSchema).min(1),
  city: z.string().trim().min(1),
  state: z.string().trim().length(2),
  email: z.string().trim().email(),
  phone: z.string().trim().regex(/^\+1\d{10}$/),
});

function normalizeCityName(input: string) {
  return input.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ');
}

export async function POST(req: Request) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });
  }

  const parsed = payloadSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Please check the form and try again.' }, { status: 400 });
  }

  const input = parsed.data;
  const state = input.state as UsStateCode;
  const validCities = US_CITIES_BY_STATE[state] ?? [];
  const cityMatch = validCities.find((name) => normalizeCityName(name) === normalizeCityName(input.city));
  if (!cityMatch) {
    return NextResponse.json({ ok: false, error: 'Please choose a city from the suggestions for the selected state.' }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();
  const { data: memberships, error: memberError } = await admin
    .from('household_members')
    .select('household_id,created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1);

  if (memberError) {
    return NextResponse.json({ ok: false, error: 'Unable to find your family account.' }, { status: 500 });
  }

  const householdId = memberships?.[0]?.household_id as string | undefined;
  if (!householdId) {
    return NextResponse.json({ ok: false, error: 'We could not find your household. Please sign in again.' }, { status: 400 });
  }

  const parentName = `${input.adultFirstName} ${input.adultLastName}`.trim();
  const householdName = input.adultLastName ? `${input.adultLastName} Family` : parentName;

  const { error: householdError } = await admin
    .from('households')
    .update({
      name: householdName,
      email: input.email,
      phone: input.phone,
      city: cityMatch,
      state,
    })
    .eq('id', householdId);

  if (householdError) {
    return NextResponse.json({ ok: false, error: 'Something went wrong while saving your household information.' }, { status: 500 });
  }

  const { data: existingPeople, error: existingPeopleError } = await admin
    .from('people')
    .select('id')
    .eq('household_id', householdId)
    .limit(1);

  if (existingPeopleError) {
    return NextResponse.json({ ok: false, error: 'Unable to check your family members.' }, { status: 500 });
  }

  const insertedNewFamily = (existingPeople ?? []).length === 0;

  if (insertedNewFamily) {
    const peopleRows = [
      {
        household_id: householdId,
        role: 'adult',
        first_name: input.adultFirstName,
        last_name: input.adultLastName,
        gender: input.adultGender,
        birthdate: null,
      },
      ...input.children.map((child) => ({
        household_id: householdId,
        role: 'child',
        first_name: child.firstName,
        last_name: child.lastName || null,
        gender: child.gender,
        birthdate: child.birthdate,
      })),
    ];

    const { error: peopleError } = await admin.from('people').insert(peopleRows);
    if (peopleError) {
      return NextResponse.json({ ok: false, error: `Unable to save family members: ${peopleError.message}` }, { status: 500 });
    }
  }

  await claimWaitlistForUser(user).catch(() => null);
  if (insertedNewFamily) {
    try {
      const notification = await sendNewSignupNotification();

      if (!notification.ok) {
        logger.error(
          { action: 'signup_notification.failed', userId: user.id, householdId },
          new Error(notification.error)
        );
      }
    } catch (notificationError) {
      logger.error(
        { action: 'signup_notification.failed', userId: user.id, householdId },
        notificationError
      );
    }
  }

  return NextResponse.json({ ok: true });
}
