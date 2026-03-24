import { createClient } from '@supabase/supabase-js';
import { createServerSupabaseClient } from '@/lib/supabase/server';

const admin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

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

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { class_ids?: string[]; person_id?: string };
    const classIds = Array.isArray(body.class_ids) ? [...new Set(body.class_ids.filter(Boolean))] : [];
    const personId = body.person_id;

    if (!personId || classIds.length === 0) {
      return Response.json({ ok: false, error: 'person_id and class_ids are required' }, { status: 400 });
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
      .select('id')
      .eq('id', personId)
      .eq('household_id', householdId)
      .maybeSingle();

    if (!person) {
      return Response.json({ ok: false, error: 'person not found in your household' }, { status: 403 });
    }

    const { data: classes, error: classErr } = await supa
      .from('classes')
      .select('id,title,capacity,status,start_time,price_cents')
      .in('id', classIds);

    if (classErr) return Response.json({ ok: false, error: classErr.message }, { status: 500 });
    if ((classes ?? []).length !== classIds.length) {
      return Response.json({ ok: false, error: 'one or more classes were not found' }, { status: 404 });
    }

    const classById = new Map((classes ?? []).map((item) => [item.id, item]));
    const { data: regs } = await supa
      .from('class_registrations')
      .select('id,class_id,person_id,status')
      .in('class_id', classIds);

    const activeByClass = new Map<string, number>();
    const existingByClass = new Map<string, { id: string; status: string }>();

    (regs ?? []).forEach((reg) => {
      if (reg.status !== 'cancelled') {
        activeByClass.set(reg.class_id, (activeByClass.get(reg.class_id) ?? 0) + 1);
      }
      if (reg.person_id === personId) {
        existingByClass.set(reg.class_id, { id: reg.id, status: reg.status });
      }
    });

    for (const classId of classIds) {
      const klass = classById.get(classId);
      if (!klass) continue;

      if (klass.status !== 'scheduled') {
        return Response.json({ ok: false, error: `${klass.title} is not open for booking` }, { status: 409 });
      }

      const existing = existingByClass.get(classId);
      if (existing && existing.status !== 'cancelled') {
        return Response.json({ ok: false, error: `already registered for ${klass.title}` }, { status: 409 });
      }

      if (klass.capacity != null && (activeByClass.get(classId) ?? 0) >= klass.capacity) {
        return Response.json({ ok: false, error: `${klass.title} is full` }, { status: 409 });
      }
    }

    const restoredIds: string[] = [];
    const insertedRows: { id: string }[] = [];

    for (const classId of classIds) {
      const existing = existingByClass.get(classId);
      if (existing?.status === 'cancelled') {
        const { error } = await supa
          .from('class_registrations')
          .update({ status: 'scheduled' })
          .eq('id', existing.id);
        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
        restoredIds.push(existing.id);
        continue;
      }

      const { data, error } = await supa
        .from('class_registrations')
        .insert({ class_id: classId, person_id: personId, status: 'scheduled' })
        .select('id')
        .maybeSingle();

      if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
      if (data) insertedRows.push(data);
    }

    const totalPriceCents = classIds.reduce((sum, classId) => sum + (classById.get(classId)?.price_cents ?? 0), 0);

    return Response.json({
      ok: true,
      checkout_summary: {
        registration_count: classIds.length,
        inserted_count: insertedRows.length,
        restored_count: restoredIds.length,
        total_price_cents: totalPriceCents,
      },
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown error';
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
