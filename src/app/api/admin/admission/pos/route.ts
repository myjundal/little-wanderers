import { requireStaffContext } from '@/lib/authz';
import { paymentFlowEnabled, squareConfig } from '@/lib/square-client';
import { startAdmissionPos, verifyAdmissionPos, type PosSale } from '@/lib/square-admission-pos';
import { getPartyDateKey, toPartyDateTimeIso } from '@/lib/party-config';
import { isUuid } from '@/lib/open-play-reservations';
export const dynamic = 'force-dynamic';

export async function GET() {
  const c = await requireStaffContext();
  if (!c.ok) return c.response;
  const today = getPartyDateKey(new Date());
  const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const { data, error } = await c.admin.from('checkins').select('id,person_id,price_cents,payment_status')
    .gte('checked_in_at', toPartyDateTimeIso(today, 0)).lt('checked_in_at', toPartyDateTimeIso(tomorrow, 0));
  if (error) return Response.json({ ok: false, error: 'Unable to load today’s admission payments.' }, { status: 503 });
  const ids = [...new Set((data ?? []).map(row => row.person_id))];
  const { data: people, error: peopleError } = ids.length
    ? await c.admin.from('people').select('id,first_name,last_name,household_id').in('id', ids)
    : { data: [], error: null };
  if (peopleError) return Response.json({ ok: false, error: 'Unable to load visitor names.' }, { status: 503 });
  const familyIds = [...new Set((people ?? []).map(person => person.household_id).filter(Boolean))];
  const { data: households, error: familyError } = familyIds.length
    ? await c.admin.from('households').select('id,name').in('id', familyIds)
    : { data: [], error: null };
  if (familyError) return Response.json({ ok: false, error: 'Unable to load visiting families.' }, { status: 503 });
  const visits = (data ?? []).map(row => {
    const person = (people ?? []).find(person => person.id === row.person_id);
    return { ...row, household_id: person?.household_id ?? null,
      household_name: (households ?? []).find(family => family.id === person?.household_id)?.name ?? 'Visiting family',
      name: [person?.first_name, person?.last_name].filter(Boolean).join(' ') || 'Visitor' };
  });
  return Response.json({ ok: true, enabled: paymentFlowEnabled('admission_pos'), visits });
}

export async function POST(req: Request) {
  const c = await requireStaffContext();
  if (!c.ok) return c.response;
  const body = await req.json().catch(() => ({}));
  try {
    // Receipt verification stays available even if new POS launches are disabled.
    if (body.mode === 'verify') {
      if (!isUuid(String(body.state ?? '')) || typeof body.transaction_id !== 'string' || !body.transaction_id || body.transaction_id.length > 200)
        throw new Error('Invalid Square callback');
      const { data, error } = await c.admin.from('admission_pos_sales').select('*').eq('id', body.state)
        .eq('created_by_user_id', c.user.id).eq('environment', squareConfig().environment).maybeSingle();
      if (error || !data) throw new Error('POS sale not found');
      return Response.json({ ok: true, ...await verifyAdmissionPos(c.admin, data as PosSale, body.transaction_id) });
    }
    const ids = Array.isArray(body.checkin_ids) ? body.checkin_ids : [];
    if (!ids.length || ids.length > 30 || ids.some((id: unknown) => typeof id !== 'string' || !isUuid(id)))
      throw new Error('Choose one visiting family');
    return Response.json({ ok: true, ...await startAdmissionPos(c.admin, ids, c.user.id) });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Unable to prepare POS payment' }, { status: 409 });
  }
}
