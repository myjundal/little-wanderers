import { createHash } from 'node:crypto';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { getLatestHouseholdIdForUser } from '@/lib/households';
import { isFamilyManagerRole } from '@/lib/family-roles';
import { getWaiverStatus, WAIVER_STATUS_SELECT, WAIVER_VALIDITY_DAYS } from '@/lib/waivers';
import { WAIVER_VERSION, WAIVER_TITLE, WAIVER_PARAGRAPHS, WAIVER_AGREEMENTS, WAIVER_SIGNATURE_TEXT } from '@/lib/waiver-content';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
const familyRevision = (children: unknown[]) => createHash('sha256').update(JSON.stringify(children)).digest('hex');

async function context() {
  const { data: { user } } = await (await createServerSupabaseClient()).auth.getUser();
  if (!user) return { ok: false as const, response: json({ ok: false, error: 'Please sign in to complete your waiver.' }, 401) };
  const admin = createAdminSupabaseClient();
  const householdId = await getLatestHouseholdIdForUser(admin, user.id);
  if (!householdId) return { ok: false as const, response: json({ ok: false, error: 'Please complete your family profile first.' }, 404) };
  const [{ data: member, error: memberError }, { data: people, error: peopleError }] = await Promise.all([
    admin.from('household_members').select('role').eq('user_id', user.id).eq('household_id', householdId).maybeSingle(),
    admin.from('people').select('id,first_name,last_name,birthdate,role').eq('household_id', householdId).order('created_at'),
  ]);
  if (memberError || peopleError) throw new Error('Unable to load your family.');
  if (!member) return { ok: false as const, response: json({ ok: false, error: 'Family access required.' }, 403) };
  return { ok: true as const, user, admin, householdId, people: people ?? [], canSign: isFamilyManagerRole(member.role) };
}

export async function GET() {
  try {
    const ctx = await context();
    if (!ctx.ok) return ctx.response;
    const { data, error } = await ctx.admin.from('waivers').select(WAIVER_STATUS_SELECT).eq('household_id', ctx.householdId).order('signed_at', { ascending: false }).limit(100);
    if (error) throw error;
    const children = ctx.people.filter(person => person.role === 'child');
    return json({ ok: true, version: WAIVER_VERSION, family_revision: familyRevision(children), can_sign: ctx.canSign, children, waiver: getWaiverStatus(data ?? [], new Date(), children.map(child => child.id)) });
  } catch {
    return json({ ok: false, error: 'Unable to load your waiver. Please try again.' }, 503);
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await context();
    if (!ctx.ok) return ctx.response;
    if (!ctx.canSign) return json({ ok: false, error: 'A parent or legal guardian with caregiver access must sign.' }, 403);
    const body = await req.json().catch(() => null);
    if (body?.version !== WAIVER_VERSION) return json({ ok: false, error: 'The waiver has changed. Reload this page before signing.' }, 409);
    const signature = typeof body?.signature === 'string' ? body.signature.trim().replace(/\s+/g, ' ') : '';
    if (signature.length < 2 || signature.length > 150 || body?.is_guardian !== true || body?.electronic_consent !== true || typeof body?.photo_consent !== 'boolean' || !WAIVER_AGREEMENTS.every(item => body?.agreements?.[item.id] === true)) {
      return json({ ok: false, error: 'Please complete every required agreement, choose a photo preference, and enter your full legal name.' }, 400);
    }
    const children = ctx.people.filter(person => person.role === 'child');
    if (!children.length) return json({ ok: false, error: 'Please add your children in My Info/People before signing.' }, 400);
    // Refuse stale forms when another caregiver has changed the family profile.
    if (body.family_revision !== familyRevision(children) || !Array.isArray(body.child_ids) || body.child_ids.length !== children.length || !children.every(child => body.child_ids.includes(child.id))) {
      return json({ ok: false, error: 'Your family profile changed. Reload and review the children before signing.' }, 409);
    }
    const now = new Date();
    const expiresAt = new Date(now.getTime() + WAIVER_VALIDITY_DAYS * 86400000).toISOString();
    const row = {
      household_id: ctx.householdId, signed_by_user_id: ctx.user.id,
      signed_at: now.toISOString(), signed_date: now.toISOString(), waiver_expires_at: expiresAt,
      parent_name: signature, electronic_signature: signature, email: ctx.user.email ?? null, phone: ctx.user.phone ?? null,
      photo_consent: body.photo_consent, source: 'website', waiver_version: WAIVER_VERSION,
      covered_person_ids: children.map(child => child.id),
      agreement_snapshot: { title: WAIVER_TITLE, paragraphs: WAIVER_PARAGRAPHS, agreements: WAIVER_AGREEMENTS, signature_text: WAIVER_SIGNATURE_TEXT, is_guardian: true, electronic_consent: true, children },
    };
    const { error } = await ctx.admin.from('waivers').insert(row);
    if (error) throw error;
    return json({ ok: true, waiver: getWaiverStatus([row], now, children.map(child => child.id)) });
  } catch {
    return json({ ok: false, error: 'Your waiver could not be saved. Please try again; do not assume it is complete.' }, 503);
  }
}
