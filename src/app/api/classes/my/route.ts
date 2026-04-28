import { createClient } from '@supabase/supabase-js';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getLatestHouseholdIdForUser } from '@/lib/households';

export const dynamic = 'force-dynamic';
const NO_STORE_HEADERS = { 'cache-control': 'no-store, max-age=0' };

const admin = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

async function getHouseholdIdForUser(userId: string) {
  return getLatestHouseholdIdForUser(admin(), userId);
}

function isMissingColumnError(message: string) {
  return /column .* does not exist|Could not find the '.*' column/i.test(message);
}

export async function GET() {
  try {
    const server = createServerSupabaseClient();
    const {
      data: { user },
    } = await server.auth.getUser();

    if (!user) {
      return Response.json({ ok: false, error: 'unauthorized' }, { status: 401, headers: NO_STORE_HEADERS });
    }

    const householdId = await getHouseholdIdForUser(user.id);
    if (!householdId) {
      return Response.json({ ok: true, items: [] }, { headers: NO_STORE_HEADERS });
    }

    const supa = admin();
    const { data: people } = await supa
      .from('people')
      .select('id,first_name,last_name')
      .eq('household_id', householdId);

    const personIds = (people ?? []).map((p) => p.id);
    if (personIds.length === 0) return Response.json({ ok: true, items: [] }, { headers: NO_STORE_HEADERS });

    const byPersonId = new Map(
      (people ?? []).map((p) => [p.id, `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim()])
    );

    const primaryRegs = await supa
      .from('class_registrations')
      .select('id,class_id,person_id,status,created_at,attendance_status,attendance_marked_at,customer_favorite,customer_note,customer_note_updated_at')
      .in('person_id', personIds)
      .order('created_at', { ascending: false });

    if (primaryRegs.error && !isMissingColumnError(primaryRegs.error.message)) {
      return Response.json({ ok: false, error: primaryRegs.error.message }, { status: 500, headers: NO_STORE_HEADERS });
    }

    const regs = primaryRegs.error
      ? (await supa
          .from('class_registrations')
          .select('id,class_id,person_id,status,created_at')
          .in('person_id', personIds)
          .order('created_at', { ascending: false })).data?.map((row) => ({
            ...row,
            attendance_status: 'unknown',
            attendance_marked_at: null,
            customer_favorite: false,
            customer_note: null,
            customer_note_updated_at: null,
          })) ?? []
      : (primaryRegs.data ?? []);

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
    const now = Date.now();

    const items = (regs ?? []).map((r) => {
      const cls = byClassId.get(r.class_id) ?? null;
      const classStartMs = cls?.start_time ? new Date(cls.start_time).getTime() : null;
      const isUpcoming = classStartMs != null && classStartMs > now;

      let attendance_display_status: 'attended' | 'cancelled' | 'not_attended' | 'upcoming';
      if (isUpcoming) {
        attendance_display_status = 'upcoming';
      } else if (r.status === 'cancelled' || cls?.status === 'cancelled' || r.attendance_status === 'cancelled') {
        attendance_display_status = 'cancelled';
      } else if (r.attendance_status === 'attended' || r.status === 'attended') {
        attendance_display_status = 'attended';
      } else {
        attendance_display_status = 'not_attended';
      }

      return {
        id: r.id,
        status: r.status,
        attendance_status: r.attendance_status ?? 'unknown',
        attendance_display_status,
        attendance_marked_at: r.attendance_marked_at ?? null,
        created_at: r.created_at,
        person_id: r.person_id,
        person_name: byPersonId.get(r.person_id) ?? 'Unknown',
        customer_favorite: Boolean(r.customer_favorite),
        customer_note: r.customer_note ?? null,
        customer_note_updated_at: r.customer_note_updated_at ?? null,
        class: cls,
      };
    });

    return Response.json({ ok: true, items }, { headers: NO_STORE_HEADERS });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown error';
    return Response.json({ ok: false, error: message }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
