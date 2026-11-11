import { requireStaffContext } from '@/lib/authz';
import { getPartyDateKey } from '@/lib/party-config';
import { admissionDayRange, getAdmissionCheckouts } from '@/lib/admission-checkout';
import { admissionStayStatistics } from '@/lib/admission-stays';
import type { AdmissionVisit } from '@/lib/admission-pos-ui';

export const dynamic = 'force-dynamic';
const headers = { 'cache-control': 'no-store' };

export async function GET(req: Request) {
  const context = await requireStaffContext();
  if (!context.ok) return context.response;
  const params = new URL(req.url).searchParams;
  const today = getPartyDateKey(new Date());
  const startDate = params.get('start') ?? today;
  const endDate = params.get('end') ?? today;
  let range;
  try { range = admissionDayRange(startDate, endDate); }
  catch (error) { return Response.json({ ok: false, error: (error as Error).message }, { status: 400, headers }); }
  try {
    const rows: Array<{ id: string; person_id: string; household_id: string | null; checked_in_at: string }> = [];
    let cursor: string | null = null;
    for (;;) {
      let query = context.admin.from('checkins').select('id,person_id,household_id,checked_in_at')
        .gte('checked_in_at', range.start).lt('checked_in_at', range.end).order('id').limit(500);
      if (cursor) query = query.gt('id', cursor);
      const { data, error } = await query;
      if (error) throw new Error('Unable to load visit history.');
      rows.push(...(data ?? []));
      if ((data?.length ?? 0) < 500) break;
      if (rows.length >= 15000) throw new Error('Too many visits. Please choose a shorter date range.');
      cursor = data![data!.length - 1].id;
    }
    const checkouts = await getAdmissionCheckouts(context.admin, rows);
    const names = new Map<string, string>();
    const familyIds = [...new Set(rows.map(row => row.household_id).filter((id): id is string => Boolean(id)))];
    for (let offset = 0; offset < familyIds.length; offset += 150) {
      const { data, error } = await context.admin.from('households').select('id,name').in('id', familyIds.slice(offset, offset + 150)).limit(151);
      if (error) throw new Error('Unable to load family names.');
      for (const family of data ?? []) names.set(family.id, family.name || 'Visiting family');
    }
    const visits: AdmissionVisit[] = rows.map(row => ({ ...row, checked_out_at: checkouts.get(row.id) ?? null,
      household_id: row.household_id || row.id, household_name: names.get(row.household_id ?? '') ?? 'Visiting family',
      name: '', price_cents: 0, payment_status: '' }));
    return Response.json({ ok: true, start: startDate, end: endDate, ...admissionStayStatistics(visits) }, { headers });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Unable to load stay statistics.' }, { status: 503, headers });
  }
}
