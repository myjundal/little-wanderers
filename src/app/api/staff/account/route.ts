import { getCurrentUserRole, isStaffRole } from '@/lib/authz';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { hashStaffPin, validStaffPin } from '@/lib/staff-pin';
import { sameOrigin } from '@/lib/staff-kiosk';
export const dynamic = 'force-dynamic';
async function context() {
  const identity = await getCurrentUserRole();
  if (!identity.user || (!isStaffRole(identity.role) && !identity.roles.includes('instructor'))) return null;
  return identity;
}
export async function GET() {
  const identity = await context();
  if (!identity) return Response.json({ ok: false, error: 'Staff sign-in required.' }, { status: 403 });
  const admin = createAdminSupabaseClient();
  const [{ data: profile, error }, { data: entries, error: entriesError }] = await Promise.all([
    admin.from('staff_profiles').select('display_name,active,pin_hash').eq('user_id', identity.user!.id).maybeSingle(),
    admin.from('staff_time_entries').select('id,clock_in,clock_out,close_note').eq('user_id', identity.user!.id).order('clock_in', { ascending: false }).limit(100),
  ]);
  if (error || entriesError) return Response.json({ ok: false, error: 'Staff timeclock setup is not ready. Run the migration first.' }, { status: 503 });
  return Response.json({ ok: true, is_kiosk: identity.isKiosk, display_name: profile?.display_name ?? '', pin_set: Boolean(profile?.pin_hash), active: profile?.active ?? true, entries });
}
export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ ok: false, error: 'Invalid request origin.' }, { status: 403 });
  const identity = await context();
  if (!identity || identity.isKiosk) return Response.json({ ok: false, error: 'Set your PIN from your personal phone login.' }, { status: 403 });
  let body: { pin?: string; display_name?: string };
  try { body = await req.json(); } catch { return Response.json({ ok: false, error: 'Invalid request.' }, { status: 400 }); }
  if (!validStaffPin(body.pin) || !body.display_name?.trim() || body.display_name.trim().length > 100) return Response.json({ ok: false, error: 'Name and a 4-digit PIN are required.' }, { status: 400 });
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.rpc('staff_set_pin', { p_user_id: identity.user!.id, p_name: body.display_name.trim(), p_hash: hashStaffPin(body.pin) });
  if (error) return Response.json({ ok: false, error: 'Staff timeclock setup is not ready or PIN could not be saved.' }, { status: 503 });
  return Response.json({ ok: Boolean(data?.ok), error: data?.error }, { status: data?.ok ? 200 : 409 });
}
