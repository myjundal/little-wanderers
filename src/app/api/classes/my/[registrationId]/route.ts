import { createClient } from '@supabase/supabase-js';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getLatestHouseholdIdForUser } from '@/lib/households';

export const dynamic = 'force-dynamic';

const admin = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

function isMissingColumnError(message: string) {
  return /column .* does not exist|Could not find the '.*' column/i.test(message);
}

export async function PATCH(req: Request, { params }: { params: { registrationId: string } }) {
  try {
    const server = createServerSupabaseClient();
    const {
      data: { user },
    } = await server.auth.getUser();

    if (!user) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });

    const householdId = await getLatestHouseholdIdForUser(admin(), user.id);
    if (!householdId) return Response.json({ ok: false, error: 'household not found' }, { status: 404 });

    const supa = admin();
    const body = (await req.json()) as { customer_favorite?: boolean; customer_note?: string | null };
    const note =
      body.customer_note == null
        ? null
        : typeof body.customer_note === 'string'
          ? body.customer_note.trim().slice(0, 2000)
          : null;

    const { data: reg, error: regErr } = await supa
      .from('class_registrations')
      .select('id,person_id,attendance_status,status')
      .eq('id', params.registrationId)
      .maybeSingle();

    if (regErr) return Response.json({ ok: false, error: regErr.message }, { status: 500 });
    if (!reg) return Response.json({ ok: false, error: 'registration not found' }, { status: 404 });

    const { data: person, error: personErr } = await supa
      .from('people')
      .select('id,household_id')
      .eq('id', reg.person_id)
      .maybeSingle();

    if (personErr) return Response.json({ ok: false, error: personErr.message }, { status: 500 });
    if (!person || person.household_id !== householdId) {
      return Response.json({ ok: false, error: 'forbidden' }, { status: 403 });
    }

    const attended = reg.attendance_status === 'attended' || reg.status === 'attended';
    if (!attended) {
      return Response.json({ ok: false, error: 'favorites and notes are only allowed for attended classes' }, { status: 409 });
    }

    const payload = {
      customer_favorite: Boolean(body.customer_favorite),
      customer_note: note,
      customer_note_updated_at: new Date().toISOString(),
    };

    const { error: updateErr } = await supa.from('class_registrations').update(payload).eq('id', params.registrationId);
    if (updateErr) {
      if (isMissingColumnError(updateErr.message)) {
        return Response.json({ ok: false, error: 'Note/favorite columns are missing. Run latest SQL migration first.' }, { status: 409 });
      }
      return Response.json({ ok: false, error: updateErr.message }, { status: 500 });
    }

    return Response.json({ ok: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown error';
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
