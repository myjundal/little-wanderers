import { createClient } from '@supabase/supabase-js';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getLatestHouseholdIdForUser } from '@/lib/households';

const admin = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

async function getHouseholdIdForUser(userId: string) {
  return getLatestHouseholdIdForUser(admin(), userId);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const registrationId = body?.registration_id as string | undefined;

    if (!registrationId) {
      return Response.json({ ok: false, error: 'registration_id is required' }, { status: 400 });
    }

    const server = createServerSupabaseClient();
    const {
      data: { user },
    } = await server.auth.getUser();

    if (!user) {
      return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }

    const householdId = await getHouseholdIdForUser(user.id);
    if (!householdId) {
      return Response.json({ ok: false, error: 'household not found' }, { status: 404 });
    }

    const supa = admin();
    const { data: reg } = await supa
      .from('class_registrations')
      .select('id,person_id,status')
      .eq('id', registrationId)
      .maybeSingle();

    if (!reg) {
      return Response.json({ ok: false, error: 'registration not found' }, { status: 404 });
    }

    const { data: person } = await supa
      .from('people')
      .select('id')
      .eq('id', reg.person_id)
      .eq('household_id', householdId)
      .maybeSingle();

    if (!person) {
      return Response.json({ ok: false, error: 'forbidden' }, { status: 403 });
    }

    if (reg.status === 'cancelled') {
      return Response.json({ ok: true, already_cancelled: true });
    }

    const { error } = await supa
      .from('class_registrations')
      .update({ status: 'cancelled' })
      .eq('id', registrationId);

    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

    return Response.json({ ok: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown error';
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
