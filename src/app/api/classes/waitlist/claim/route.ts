import { createClient } from '@supabase/supabase-js';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getLatestHouseholdIdForUser } from '@/lib/households';
import { countConfirmedClassRegistrations, hasActiveWaitlistOffer } from '@/lib/class-waitlist';

const admin = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { token?: string };
    const token = typeof body.token === 'string' ? body.token.trim() : '';
    if (!token) return Response.json({ ok: false, error: 'token is required' }, { status: 400 });

    const server = createServerSupabaseClient();
    const {
      data: { user },
    } = await server.auth.getUser();

    if (!user) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });

    const supa = admin();
    const householdId = await getLatestHouseholdIdForUser(supa, user.id);
    if (!householdId) return Response.json({ ok: false, error: 'household not found' }, { status: 404 });

    const { data: reg, error: regError } = await supa
      .from('class_registrations')
      .select('id,class_id,person_id,status,waitlist_offer_expires_at')
      .eq('waitlist_offer_token', token)
      .maybeSingle();

    if (regError) return Response.json({ ok: false, error: regError.message }, { status: 500 });
    if (!reg) return Response.json({ ok: false, error: 'waitlist offer not found' }, { status: 404 });
    if (reg.status !== 'waitlist') return Response.json({ ok: false, error: 'waitlist offer is no longer available' }, { status: 409 });
    if (!reg.waitlist_offer_expires_at || new Date(reg.waitlist_offer_expires_at).getTime() <= Date.now()) {
      return Response.json({ ok: false, error: 'waitlist offer has expired' }, { status: 409 });
    }

    const { data: person, error: personError } = await supa
      .from('people')
      .select('id,first_name,last_name,household_id')
      .eq('id', reg.person_id)
      .maybeSingle();

    if (personError) return Response.json({ ok: false, error: personError.message }, { status: 500 });
    if (!person || person.household_id !== householdId) {
      return Response.json({ ok: false, error: 'forbidden' }, { status: 403 });
    }

    const { data: klass, error: classError } = await supa
      .from('classes')
      .select('id,capacity,status')
      .eq('id', reg.class_id)
      .maybeSingle();

    if (classError) return Response.json({ ok: false, error: classError.message }, { status: 500 });
    if (!klass || klass.status !== 'scheduled') return Response.json({ ok: false, error: 'class is not open' }, { status: 409 });

    const booked = await countConfirmedClassRegistrations(supa, reg.class_id);
    if (klass.capacity != null && booked >= klass.capacity) {
      return Response.json({ ok: false, error: 'class is full' }, { status: 409 });
    }

    const otherOfferPending = await hasActiveWaitlistOffer(supa, reg.class_id, reg.id);
    if (otherOfferPending) {
      return Response.json({ ok: false, error: 'another waitlist offer is pending' }, { status: 409 });
    }

    const { error: updateError } = await supa
      .from('class_registrations')
      .update({
        status: 'scheduled',
        waitlist_offer_token: null,
        waitlist_offer_expires_at: null,
        waitlist_offered_at: null,
      })
      .eq('id', reg.id)
      .eq('status', 'waitlist');

    if (updateError) return Response.json({ ok: false, error: updateError.message }, { status: 500 });

    const personName = [person.first_name, person.last_name].filter(Boolean).join(' ').trim();
    return Response.json({ ok: true, registration_id: reg.id, person_name: personName || null });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown error';
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
