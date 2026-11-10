import { isSameOriginRequest } from '@/lib/request-origin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
  const headers = { 'Cache-Control': 'private, no-store' };
  if (!isSameOriginRequest(req)) return Response.json({ ok: false }, { status: 403, headers });
  const body = await req.json().catch(() => null);
  if (typeof body?.access_token !== 'string' || typeof body?.refresh_token !== 'string' || body.access_token.length > 10000 || body.refresh_token.length > 10000) return Response.json({ ok: false }, { status: 400, headers });
  const supabase = await createServerSupabaseClient();
  const verified = await supabase.auth.getUser(body.access_token);
  if (verified.error || !verified.data.user) return Response.json({ ok: false }, { status: 401, headers });
  const saved = await supabase.auth.setSession({ access_token: body.access_token, refresh_token: body.refresh_token });
  if (saved.error || saved.data.user?.id !== verified.data.user.id) return Response.json({ ok: false }, { status: 401, headers });
  return Response.json({ ok: true }, { headers });
}
