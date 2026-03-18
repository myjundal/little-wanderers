import { createClient } from '@supabase/supabase-js';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

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
    if (!householdId) {
      return Response.json({ ok: true, items: [] });
    }

    const supa = admin();
    const { data: people } = await supa
      .from('people')
      .select('id,first_name,last_name')
      .eq('household_id', householdId);

    const personIds = (people ?? []).map((p) => p.id);
    if (personIds.length === 0) return Response.json({ ok: true, items: [] });

    const byPersonId = new Map(
      (people ?? []).map((p) => [p.id, `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim()])
    );

    const { data: regs, error: regErr } = await supa
      .from('class_registrations')
      .select('id,class_id,person_id,status,created_at')
      .in('person_id', personIds)
      .order('created_at', { ascending: false });

    if (regErr) {
      return Response.json({ ok: false, error: regErr.message }, { status: 500 });
    }

    const classIds = [...new Set((regs ?? []).map((r) => r.class_id))];
    let classes: {
      id: string;
      title: string;
      start_time: string;
      end_time: string;
      category: string | null;
      status: string;
    }[] = [];

    if (classIds.length) {
      const { data: classRows } = await supa
        .from('classes')
        .select('id,title,start_time,end_time,category,status')
        .in('id', classIds);
      classes = (classRows ?? []) as typeof classes;
    }

    const byClassId = new Map((classes ?? []).map((c) => [c.id, c]));

    const items = (regs ?? []).map((r) => ({
      id: r.id,
      status: r.status,
      created_at: r.created_at,
      person_id: r.person_id,
      person_name: byPersonId.get(r.person_id) ?? 'Unknown',
      class: byClassId.get(r.class_id) ?? null,
    }));

    return Response.json({ ok: true, items });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown error';
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
