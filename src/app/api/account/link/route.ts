import { isSameOriginRequest } from '@/lib/request-origin';
import { cookies } from 'next/headers';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { getLatestHouseholdIdForUser } from '@/lib/households';
import { isFamilyManagerRole } from '@/lib/family-roles';
import { ACCOUNT_LINK_COOKIE, normalizeLoginContact, signAccountLink } from '@/lib/account-link';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
export async function GET() {
  const { data: { user } } = await (await createServerSupabaseClient()).auth.getUser();
  if (!user) return Response.json({ ok: false }, { status: 401, headers });
  const admin = createAdminSupabaseClient();
  const household = await getLatestHouseholdIdForUser(admin, user.id);
  if (!household) return Response.json({ ok: true, email: user.email || null, phone: user.phone || null }, { headers });
  const result = await admin.from('household_members').select('user_id').eq('household_id', household);
  if (result.error) return Response.json({ ok: false }, { status: 503, headers });
  const identities = await Promise.all((result.data ?? []).filter(row => row.user_id).map(row => admin.auth.admin.getUserById(row.user_id)));
  if (identities.some(r => r.error)) return Response.json({ ok: false }, { status: 503, headers });
  const users = identities.map(r => r.data.user);
  return Response.json({ ok: true, email: users.find(u => u?.email_confirmed_at)?.email || null, phone: users.find(u => u?.phone_confirmed_at)?.phone || null }, { headers });
}
export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) return Response.json({ ok: false }, { status: 403, headers });
  const { data: { user } } = await (await createServerSupabaseClient()).auth.getUser();
  if (!user) return Response.json({ ok: false, error: 'Please sign in first.' }, { status: 401, headers });
  if (!user.email_confirmed_at && !user.phone_confirmed_at) return Response.json({ ok: false, error: 'Verify your current login before connecting another.' }, { status: 403, headers });
  const body = await req.json().catch(() => null);
  if (!['email', 'phone'].includes(body?.method) || typeof body?.contact !== 'string') return Response.json({ ok: false, error: 'Choose an email or US phone number.' }, { status: 400, headers });
  const method = body.method as 'email' | 'phone';
  const contact = normalizeLoginContact(body.contact, method);
  if (!(method === 'email' ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact) && contact.length <= 254 : /^1\d{10}$/.test(contact))) return Response.json({ ok: false, error: 'Enter a valid email or US phone number.' }, { status: 400, headers });
  const admin = createAdminSupabaseClient();
  const household = await getLatestHouseholdIdForUser(admin, user.id);
  const member = household && await admin.from('household_members').select('role').eq('user_id', user.id).eq('household_id', household).maybeSingle();
  if (!household || !member || member.error || !isFamilyManagerRole(member.data?.role)) return Response.json({ ok: false, error: 'A family caregiver must connect logins.' }, { status: 403, headers });
  (await cookies()).set(ACCOUNT_LINK_COOKIE, signAccountLink({ user: user.id, household, method, contact, expires: Date.now() + 15 * 60_000 }), { httpOnly: true, sameSite: 'lax', secure: new URL(req.url).protocol === 'https:', path: '/', maxAge: 900 });
  const params = new URLSearchParams({ next: '/landing/people', link: method, contact: method === 'phone' ? `+${contact}` : contact });
  return Response.json({ ok: true, login: `/login?${params}` }, { headers });
}
