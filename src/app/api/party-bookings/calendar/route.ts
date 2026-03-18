import { createClient } from '@supabase/supabase-js';
import { createServerSupabaseClient } from '@/lib/supabase/server';

const admin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export async function GET() {
  try {
    const server = createServerSupabaseClient();
    const {
      data: { user },
    } = await server.auth.getUser();

    if (!user) {
      return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }

    const supa = admin();
    const { data, error } = await supa
      .from('party_bookings')
      .select('id,start_time,end_time,status')
      .gte('start_time', new Date().toISOString())
      .neq('status', 'cancelled')
      .order('start_time', { ascending: true });

    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

    return Response.json({ ok: true, items: data ?? [] });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown error';
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
