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
    const classId = body?.class_id as string | undefined;
    const personId = body?.person_id as string | undefined;

    if (!classId || !personId) {
      return Response.json({ ok: false, error: 'class_id and person_id are required' }, { status: 400 });
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

    const { data: person } = await supa
      .from('people')
      .select('id,role')
      .eq('id', personId)
      .eq('household_id', householdId)
      .maybeSingle();

    if (!person) {
      return Response.json({ ok: false, error: 'person not found in your household' }, { status: 403 });
    }

    const { data: klass } = await supa
      .from('classes')
      .select('id,capacity,status,start_time')
      .eq('id', classId)
      .maybeSingle();

    if (!klass) return Response.json({ ok: false, error: 'class not found' }, { status: 404 });
    if (klass.status !== 'scheduled') {
      return Response.json({ ok: false, error: 'class is not open for booking' }, { status: 409 });
    }

    const { data: already } = await supa
      .from('class_registrations')
      .select('id,status')
      .eq('class_id', classId)
      .eq('person_id', personId)
      .maybeSingle();

    if (already && already.status !== 'cancelled') {
      return Response.json({ ok: false, error: 'already registered' }, { status: 409 });
    }

    if (klass.capacity != null) {
      const { data: regs } = await supa
        .from('class_registrations')
        .select('id,status')
        .eq('class_id', classId)
        .neq('status', 'cancelled');

      const booked = (regs ?? []).length;
      if (booked >= klass.capacity) {
        return Response.json({ ok: false, error: 'class is full' }, { status: 409 });
      }
    }

    if (already && already.status === 'cancelled') {
      const { error } = await supa
        .from('class_registrations')
        .update({ status: 'scheduled' })
        .eq('id', already.id);
      if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
      return Response.json({ ok: true, id: already.id, restored: true });
    }

    const { data: inserted, error: insertErr } = await supa
      .from('class_registrations')
      .insert({
        class_id: classId,
        person_id: personId,
        status: 'scheduled',
        household_id: householdId,
        child_id: person.role === 'child' ? person.id : null,
        created_by_user_id: user.id,
        created_by_role: 'customer',
      })
      .select('id')
      .maybeSingle();

    if (insertErr) return Response.json({ ok: false, error: insertErr.message }, { status: 500 });

    return Response.json({ ok: true, id: inserted?.id ?? null });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown error';
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
