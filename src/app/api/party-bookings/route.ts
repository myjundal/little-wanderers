import { createClient } from '@supabase/supabase-js';
import { createServerSupabaseClient } from '@/lib/supabase/server';

const admin = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

async function getHouseholdIdForUser(userId: string) {
  const supa = admin();
  const { data } = await supa
    .from('households')
    .select('id')
    .eq('owner_user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1);

  return data?.[0]?.id ?? null;
}

export async function GET() {
  try {
    const server = createServerSupabaseClient();
    const {
      data: { user },
    } = await server.auth.getUser();

    if (!user) {
      return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }

    const householdId = await getHouseholdIdForUser(user.id);
    if (!householdId) return Response.json({ ok: true, items: [] });

    const supa = admin();
    const { data, error } = await supa
      .from('party_bookings')
      .select('id,start_time,end_time,headcount_expected,price_quote_cents,notes,created_at')
      .eq('household_id', householdId)
      .order('start_time', { ascending: false });

    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

    return Response.json({ ok: true, items: data ?? [] });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown error';
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const startTime = body?.start_time as string | undefined;
    const endTime = body?.end_time as string | undefined;
    const headcountExpected = body?.headcount_expected == null ? null : Number(body.headcount_expected);
    const notes = (body?.notes as string | null) ?? null;

    if (!startTime || !endTime) {
      return Response.json({ ok: false, error: 'start_time and end_time are required' }, { status: 400 });
    }

    const start = new Date(startTime);
    const end = new Date(endTime);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      return Response.json({ ok: false, error: 'invalid time range' }, { status: 400 });
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
    const { data: inserted, error } = await supa
      .from('party_bookings')
      .insert({
        household_id: householdId,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        headcount_expected: headcountExpected,
        notes,
      })
      .select('id')
      .maybeSingle();

    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

    return Response.json({ ok: true, id: inserted?.id ?? null });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown error';
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
