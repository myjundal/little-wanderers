import { projectInfantSiblingAdmission } from '@/lib/infant-sibling-admission';
import { requireStaffContext } from '@/lib/authz';
import { paymentFlowEnabled, squareConfig, squareEnvironment } from '@/lib/square-client';
import { startAdmissionPos, verifyAdmissionPos, recoverAdmissionPos, reconcileAdmissionPos, type PosSale } from '@/lib/square-admission-pos';
import { getPartyDateKey, toPartyDateTimeIso } from '@/lib/party-config';
import { isUuid } from '@/lib/open-play-reservations';
import { getAdmissionCheckouts } from '@/lib/admission-checkout';
export const dynamic = 'force-dynamic';

async function saleFamily(admin: Awaited<ReturnType<typeof requireStaffContext>> & { ok: true }, sale: PosSale) {
  if (!sale.checkin_ids?.length) return null;
  const { data } = await admin.admin.from('checkins').select('household_id,person_id').in('id', sale.checkin_ids).limit(1).maybeSingle();
  if (data?.household_id) return data.household_id as string;
  if (!data?.person_id) return null;
  const person = await admin.admin.from('people').select('household_id').eq('id', data.person_id).maybeSingle();
  return person.data?.household_id ?? null;
}

export async function GET() {
  const c = await requireStaffContext();
  if (!c.ok) return c.response;
  const today = getPartyDateKey(new Date());
  const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const { data, error } = await c.admin.from('checkins').select('id,person_id,price_cents,payment_status,checked_in_at,square_environment')
    .gte('checked_in_at', toPartyDateTimeIso(today, 0)).lt('checked_in_at', toPartyDateTimeIso(tomorrow, 0));
  if (error) return Response.json({ ok: false, error: 'Unable to load today’s admission payments.' }, { status: 503 });
  const ids = [...new Set((data ?? []).map(row => row.person_id))];
  const { data: people, error: peopleError } = ids.length
    ? await c.admin.from('people').select('id,first_name,last_name,household_id,role,birthdate').in('id', ids)
    : { data: [], error: null };
  if (peopleError) return Response.json({ ok: false, error: 'Unable to load visitor names.' }, { status: 503 });
  const familyIds = [...new Set((people ?? []).map(person => person.household_id).filter(Boolean))];
  const { data: households, error: familyError } = familyIds.length
    ? await c.admin.from('households').select('id,name').in('id', familyIds)
    : { data: [], error: null };
  if (familyError) return Response.json({ ok: false, error: 'Unable to load visiting families.' }, { status: 503 });
  let checkouts: Map<string, string>;
  try { checkouts = await getAdmissionCheckouts(c.admin, data ?? []); }
  catch { return Response.json({ ok: false, error: 'Unable to load departures. Refresh admission status before continuing.' }, { status: 503 }); }
  const {data:pending,error:pendingError}=await c.admin.from('admission_pos_sales').select('id,checkin_ids,launched_at,created_by_user_id').eq('environment',squareEnvironment()).eq('status','open');
  if(pendingError)return Response.json({ok:false,error:'Unable to load pending Square payments.'},{status:503});
  const frozen = new Set<string>((pending ?? []).flatMap(sale => sale.checkin_ids ?? []));
  const priced = projectInfantSiblingAdmission(data ?? [], people ?? [], squareEnvironment(), frozen);
  const visits = priced.map(row => {
    const person = (people ?? []).find(person => person.id === row.person_id);
    return { ...row, checked_out_at: checkouts.get(row.id) ?? null, household_id: person?.household_id ?? null,
      household_name: (households ?? []).find(family => family.id === person?.household_id)?.name ?? 'Visiting family',
      name: [person?.first_name, person?.last_name].filter(Boolean).join(' ') || 'Visitor' };
  });
  return Response.json({ ok: true, date: today, enabled: paymentFlowEnabled('admission_pos'), visits, pending_sales:(pending??[]).filter(sale=>sale.created_by_user_id===c.user.id) }, { headers: { 'cache-control': 'no-store' } });
}

export async function POST(req: Request) {
  const c = await requireStaffContext();
  if (!c.ok) return c.response;
  const body = await req.json().catch(() => ({}));
  try {
    // Receipt verification stays available even if new POS launches are disabled.
    if (body.mode === 'verify' || body.mode === 'recover' || body.mode === 'sync') {
      if (!isUuid(String(body.state ?? '')) || (body.mode==='verify'&&(typeof body.transaction_id !== 'string' || !body.transaction_id || body.transaction_id.length > 200)))
        throw new Error('Invalid Square callback');
      const { data, error } = await c.admin.from('admission_pos_sales').select('*').eq('id', body.state)
        .eq('created_by_user_id', c.user.id).eq('environment', squareConfig().environment).maybeSingle();
      if (error || !data) throw new Error('POS sale not found');
      if(body.mode==='recover')return Response.json({ok:true,...await recoverAdmissionPos(c.admin,data as PosSale,c.user.id,body.confirm_no_payment===true)});
      let result;
      if (body.mode === 'sync') result = await reconcileAdmissionPos(c.admin, data as PosSale);
      else {
        try { result = await verifyAdmissionPos(c.admin, data as PosSale, body.transaction_id); }
        catch (verificationError) {
          // iOS returns a transaction ID, which is not always its Orders API ID.
          // Resolve only a provider-verified receipt bound to this frozen sale.
          result = await reconcileAdmissionPos(c.admin, data as PosSale);
          if (result.status !== 'paid') throw verificationError;
        }
      }
      return Response.json({ ok: true, ...result, household_id: await saleFamily(c, data as PosSale) }, { headers: { 'cache-control': 'no-store' } });
    }
    const ids = Array.isArray(body.checkin_ids) ? body.checkin_ids : [];
    if (!ids.length || ids.length > 30 || ids.some((id: unknown) => typeof id !== 'string' || !isUuid(id)))
      throw new Error('Choose one visiting family');
    return Response.json({ ok: true, ...await startAdmissionPos(c.admin, ids, c.user.id) });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Unable to prepare POS payment' }, { status: 409 });
  }
}
