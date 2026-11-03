import { NextResponse } from 'next/server';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getLatestHouseholdIdForUser } from '@/lib/households';
import { isFamilyManagerRole } from '@/lib/family-roles';
import { parseBirthdate } from '@/lib/birthdate';
import { membershipTerms, FOUNDING_TERMS_VERSION, easternDate, foundingMonthlyCents, type FoundingEnrollment } from '@/lib/founding-membership';
import { getMembershipOffer } from '@/lib/founding-offer';
import { cancelFounding, foundingCardConfig, storeFoundingCard } from '@/lib/founding-square';
import { squareEnvironment } from '@/lib/square-client';
import { US_CITIES_BY_STATE } from '@/lib/us-cities';
import { waitUntil } from '@vercel/functions';
import { sendDueMembershipNotifications } from '@/lib/membership-notifications';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'no-store, max-age=0' };
const gender = z.enum(['female', 'male', 'non_binary', 'prefer_not_to_say']);
const name = z.string().trim().min(1).max(80);
const schema = z.object({
  sourceId: z.string().min(1).max(512), consent: z.literal(true), termsVersion: z.literal(FOUNDING_TERMS_VERSION),
  pricingTier: z.enum(['waitlist', 'public', 'regular']),
  adultFirstName: name, adultLastName: name, adultGender: gender,
  email: z.string().trim().email().max(254), phone: z.string().regex(/^\+1\d{10}$/),
  city: z.string().trim().min(1).max(100), state: z.string().refine(value => value in US_CITIES_BY_STATE),
  birthdaysConfirmed: z.literal(true),
  children: z.array(z.object({ id: z.string().uuid(), firstName: name, lastName: z.string().trim().max(80), gender,
    birthdate: z.string().refine(value => parseBirthdate(value) !== null).transform(value => parseBirthdate(value)!),
  })).min(1).max(20),
});

async function context() {
  const server = await createServerSupabaseClient();
  const { data: { user } } = await server.auth.getUser();
  if (!user) return { response: NextResponse.json({ ok: false, error: 'Please sign in to continue.' }, { status: 401, headers }) };
  const admin = createAdminSupabaseClient();
  const householdId = await getLatestHouseholdIdForUser(admin, user.id);
  if (!householdId) return { response: NextResponse.json({ ok: false, error: 'Please finish creating your family account and try again.' }, { status: 400, headers }) };
  const member = await admin.from('household_members').select('role').eq('household_id', householdId).eq('user_id', user.id).single();
  if (member.error || !isFamilyManagerRole(member.data?.role)) return { response: NextResponse.json({ ok: false, error: 'A family caregiver must enroll or cancel.' }, { status: 403, headers }) };
  return { admin, user, householdId };
}

function publicEnrollment(row: FoundingEnrollment | null) {
  if (!row) return null;
  return { status: row.status, pricing_tier: row.pricing_tier, base_cents: row.base_cents, sibling_cents: row.sibling_cents, card_brand: row.card_brand, card_last4: row.card_last4, amount_cents: row.amount_cents, start_date: row.start_date, paid_through: row.paid_through };
}

export async function GET() {
  try {
    const ctx = await context();
    if (ctx.response) {
      if (ctx.response.status !== 401) return ctx.response;
      let offer = { phase: 'waitlist', tier: 'waitlist', can_enroll: false, base_cents: 5000, sibling_cents: 1000 };
      try { offer = await getMembershipOffer(createAdminSupabaseClient()); } catch { /* Show the initial waitlist offer before the migration is deployed. */ }
      return NextResponse.json({ ok: false, offer }, { status: 401, headers });
    }
    const { admin, householdId, user } = ctx;
    const [household, people, membership] = await Promise.all([
      admin.from('households').select('email,phone,city,state').eq('id', householdId).single(),
      admin.from('people').select('id,role,first_name,last_name,gender,birthdate,notes').eq('household_id', householdId).order('created_at'),
      admin.from('founding_memberships').select('*').eq('household_id', householdId).eq('environment', squareEnvironment()).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (household.error || people.error || membership.error) throw new Error('Unable to load family information.');
    const offer = await getMembershipOffer(admin, user.id, householdId);
    let config = null;
    try {
      const cardConfig = foundingCardConfig(offer.card_enrollment_enabled);
      if (offer.can_enroll) config = { applicationId: cardConfig.applicationId, locationId: cardConfig.locationId, environment: cardConfig.environment };
    } catch { /* The page stays readable while card registration is disabled. */ }
    const phone = user.phone ? `+${user.phone.replace(/\D/g, '')}` : household.data.phone;
    return NextResponse.json({ ok: true, account: { email: user.email || null, phone: user.phone ? phone : null }, household: { ...household.data, email: user.email || household.data.email, phone }, people: people.data, enrollment: publicEnrollment(membership.data), offer, config }, { headers });
  } catch {
    return NextResponse.json({ ok: false, error: 'Unable to load your membership. Please refresh and try again.' }, { status: 503, headers });
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await context();
    if (ctx.response) return ctx.response;
    const input = schema.safeParse(await req.json().catch(() => null));
    if (!input.success) return NextResponse.json({ ok: false, error: 'Complete your contact details, each child’s name, gender and real birthday, and both confirmations before saving your card.' }, { status: 400, headers });
    const profile = input.data;
    if (new Set(profile.children.map(child => child.id)).size !== profile.children.length) return NextResponse.json({ ok: false, error: 'Add each child only once.' }, { status: 400, headers });
    if (ctx.user.email && profile.email.toLowerCase() !== ctx.user.email.toLowerCase()) return NextResponse.json({ ok: false, error: 'Use the email address on your account.' }, { status: 400, headers });
    const offer = await getMembershipOffer(ctx.admin, ctx.user.id, ctx.householdId);
    if (!offer.can_enroll) return NextResponse.json({ ok: false, error: 'Wanderlist families have first access. Public founding membership will open next.' }, { status: 403, headers });
    if (profile.pricingTier !== offer.tier) return NextResponse.json({ ok: false, error: 'Your membership offer changed. Refresh to review the correct price before saving your card.' }, { status: 409, headers });
    foundingCardConfig(offer.card_enrollment_enabled);
    const amount = foundingMonthlyCents(profile.children.map(child => child.birthdate), easternDate(), offer.tier);
    const familyProfile = {
      adultFirstName: profile.adultFirstName, adultLastName: profile.adultLastName, adultGender: profile.adultGender,
      email: profile.email, phone: profile.phone, city: profile.city, state: profile.state, children: profile.children,
    };
    const prepared = await ctx.admin.rpc('prepare_founding_membership', {
      p_user: ctx.user.id, p_household: ctx.householdId, p_environment: squareEnvironment(), p_profile: familyProfile,
      p_terms: membershipTerms(offer.tier), p_version: FOUNDING_TERMS_VERSION, p_amount: amount, p_tier: offer.tier,
    });
    if (prepared.error || !prepared.data?.id) throw new Error('Unable to save your family profile.');
    if (['draft', 'saving_card'].includes(prepared.data.status) && !isDeepStrictEqual(prepared.data.profile_snapshot, familyProfile)) return NextResponse.json({ ok: false, error: 'Card setup already began with your saved family details. Refresh before retrying.' }, { status: 409, headers });
    const enrollment = await storeFoundingCard(ctx.admin, prepared.data, profile.sourceId, { email: profile.email, firstName: profile.adultFirstName, lastName: profile.adultLastName, phone: profile.phone }, offer.card_enrollment_enabled);
    waitUntil(sendDueMembershipNotifications(ctx.admin).catch(() => null));
    return NextResponse.json({ ok: true, enrollment: publicEnrollment(enrollment as FoundingEnrollment) }, { headers });
  } catch {
    return NextResponse.json({ ok: false, error: 'We could not finish saving your card. No payment was taken. Your family details are saved if registration began; please retry or contact us for help.' }, { status: 503, headers });
  }
}

export async function DELETE() {
  try {
    const ctx = await context();
    if (ctx.response) return ctx.response;
    const row = await ctx.admin.from('founding_memberships').select('*').eq('household_id', ctx.householdId).eq('environment', squareEnvironment()).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (row.error || !row.data) throw new Error('Membership not found.');
    await cancelFounding(ctx.admin, row.data);
    return NextResponse.json({ ok: true }, { headers });
  } catch {
    return NextResponse.json({ ok: false, error: 'Cancellation has not been confirmed. Please retry or contact us for help.' }, { status: 503, headers });
  }
}
