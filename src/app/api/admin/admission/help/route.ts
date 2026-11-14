import { requireStaffContext } from '@/lib/authz';
import { helpChecked, searchHelpReceipts, linkHelpReceipt, searchHelpWaivers } from '@/lib/staff-admission-help';
import { isUuid } from '@/lib/open-play-reservations';
import { getPartyDateKey } from '@/lib/party-config';
import { validRevenueDate } from '@/lib/service-day-revenue';
import { WAIVER_VERSION } from '@/lib/waiver-content';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
const message = (error: unknown) => error instanceof Error ? error.message : 'Unable to complete admission help. Please retry.';
const validDay = (value: unknown): value is string => typeof value === 'string' && validRevenueDate(value) && value <= getPartyDateKey(new Date());

export async function GET() {
  const context = await requireStaffContext();
  if (!context.ok) return context.response;
  try {
    const cases = helpChecked(await context.admin.from('staff_admission_cases').select('id,household_id,visit_date,category,note,status,created_at,created_by')
      .eq('status', 'open').order('created_at').limit(101));
    const ids = [...new Set(cases.map(row => row.household_id))];
    const families = ids.length ? helpChecked(await context.admin.from('households').select('id,name').in('id', ids)) : [];
    return json({ ok: true, cases: cases.slice(0, 100).map(row => ({ ...row, family_name: families.find(family => family.id === row.household_id)?.name || 'Family' })), truncated: cases.length > 100 });
  } catch (error) { return json({ ok: false, error: message(error) }, 503); }
}

export async function POST(req: Request) {
  const context = await requireStaffContext();
  if (!context.ok) return context.response;
  if (req.headers.get('origin') !== new URL(req.url).origin || req.headers.get('sec-fetch-site') === 'cross-site') return json({ ok: false, error: 'Please use the staff check-in page.' }, 403);
  try {
    const text = await req.text();
    if (text.length > 10000) throw new Error('Request is too long.');
    const body = JSON.parse(text);
    if (body.mode === 'resolve_case') {
      if (!isUuid(body.case_id) || typeof body.note !== 'string' || body.note.trim().length < 5 || body.note.length > 1500) throw new Error('Enter how this issue was resolved.');
      helpChecked(await context.admin.from('staff_admission_cases').update({ status: 'resolved', resolved_by: context.user.id, resolved_at: new Date().toISOString(), resolution: body.note.trim() })
        .eq('id', body.case_id).eq('status', 'open'));
      return json({ ok: true, status: 'resolved' });
    }
    if (!isUuid(String(body.household_id ?? '')) || !validDay(body.date)) throw new Error('Choose a family and a valid visit date.');
    const family = helpChecked(await context.admin.from('households').select('id').eq('id', body.household_id).single());
    if (!family) throw new Error('Family not found.');
    if (body.mode === 'search_receipts') return json({ ok: true, ...await searchHelpReceipts(context.admin, family.id, body.date, String(body.query ?? '')) });
    if (body.mode === 'link_receipt') {
      if (body.confirmed !== true || typeof body.order_id !== 'string' || !/^[\w:-]{1,200}$/.test(body.order_id)) throw new Error('Confirm this is the family’s completed Square receipt.');
      return json({ ok: true, ...await linkHelpReceipt(context.admin, context.user.id, family.id, body.date, body.order_id) });
    }
    if (body.mode === 'search_waivers') return json({ ok: true, ...await searchHelpWaivers(context.admin, family.id, String(body.query ?? '')) });
    if (body.mode === 'link_waiver') {
      if (!isUuid(String(body.waiver_id ?? '')) || body.guardian_confirmed !== true || typeof body.reason !== 'string'
        || body.reason.trim().length < 10 || body.reason.length > 1000 || !Array.isArray(body.mapping) || body.mapping.length < 1 || body.mapping.length > 20
        || body.mapping.some((row: { source_id?: string; target_id?: string }) => !isUuid(String(row?.source_id ?? '')) || !isUuid(String(row?.target_id ?? '')))) throw new Error('Match each child, confirm with the guardian, and enter a reason.');
      const result = helpChecked(await context.admin.rpc('staff_link_admission_waiver', { p_actor: context.user.id, p_family: family.id, p_waiver: body.waiver_id,
        p_mapping: body.mapping, p_reason: body.reason.trim(), p_version: WAIVER_VERSION, p_guardian_confirmed: true }));
      return json({ ok: true, ...result });
    }
    if (body.mode === 'create_case') {
      if (!['payment', 'waiver', 'other'].includes(body.category) || typeof body.note !== 'string' || body.note.trim().length < 5 || body.note.length > 1500 || !isUuid(String(body.request_id ?? ''))) throw new Error('Choose the issue type and add a short note.');
      const prior = helpChecked(await context.admin.from('staff_admission_cases').select('id,household_id,created_by').eq('id', body.request_id).maybeSingle());
      if (prior && (prior.household_id !== family.id || prior.created_by !== context.user.id)) throw new Error('Please reopen this family and retry.');
      if (!prior) helpChecked(await context.admin.from('staff_admission_cases').insert({ id: body.request_id, household_id: family.id, visit_date: body.date,
        category: body.category, note: body.note.trim(), created_by: context.user.id }));
      return json({ ok: true, status: 'saved' });
    }
    return json({ ok: false, error: 'Choose an admission help action.' }, 400);
  } catch (error) { return json({ ok: false, error: message(error) }, 409); }
}
