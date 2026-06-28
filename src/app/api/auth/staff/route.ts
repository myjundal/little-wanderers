import { createServerSupabaseClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    return Response.json({ ok: false, is_staff: false, error: 'Unable to load session.' }, { status: 401 });
  }

  if (!user) {
    return Response.json({ ok: true, is_staff: false });
  }

  const { data, error } = await supabase.rpc('is_staff');

  if (error) {
    return Response.json({ ok: false, is_staff: false, error: 'Unable to check staff access.' }, { status: 500 });
  }

  return Response.json({ ok: true, is_staff: data === true });
}
