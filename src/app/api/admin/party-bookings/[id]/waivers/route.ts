import QRCode from 'qrcode';
import { requireStaffContext } from '@/lib/authz';
import { isUuid } from '@/lib/open-play-reservations';
import { getWaiverStatus } from '@/lib/waivers';
export const dynamic = 'force-dynamic';
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await requireStaffContext();
  if (!c.ok) return c.response;
  const { id } = await params;
  if (!isUuid(id)) return Response.json({ ok: false, error: 'Invalid party.' }, { status: 400 });
  const party = await c.admin.from('party_bookings').select('id').eq('id', id).maybeSingle();
  if (party.error || !party.data) return Response.json({ ok: false, error: 'Party not found.' }, { status: 404 });
  const records = await c.admin.from('party_guest_waivers').select('waiver_id,household_id,created_at').eq('party_booking_id', id).order('created_at', { ascending: false }).limit(500);
  if (records.error) return Response.json({ ok: false, error: 'Unable to load guest waivers.' }, { status: 503 });
  const ids = (records.data ?? []).map(row => row.waiver_id);
  const waivers = ids.length ? await c.admin.from('waivers').select('id,parent_name,email,signed_at,waiver_expires_at,waiver_version,covered_person_ids,agreement_snapshot').in('id', ids) : { data: [], error: null };
  if (waivers.error) return Response.json({ ok: false, error: 'Unable to load guest waivers.' }, { status: 503 });
  const guestUrl = new URL(`/party-waiver?party=${id}`, req.url).toString();
  const seen = new Set<string>();
  const items = (records.data ?? []).flatMap(record => {
    if (seen.has(record.household_id)) return [];
    const waiver = (waivers.data ?? []).find(row => row.id === record.waiver_id);
    if (!waiver) return [];
    seen.add(record.household_id);
    const snapshot = waiver.agreement_snapshot as { children?: Array<{ first_name?: string; last_name?: string }> } | null;
    return [{ household_id: record.household_id, guardian_name: waiver.parent_name, email: waiver.email,
      children: (snapshot?.children ?? []).map(child => [child.first_name, child.last_name].filter(Boolean).join(' ')),
      signed_at: waiver.signed_at, expires_at: waiver.waiver_expires_at, status: getWaiverStatus([waiver]).status }];
  });
  return Response.json({ ok: true, guest_url: guestUrl, qr_data_url: await QRCode.toDataURL(guestUrl, { width: 220, margin: 2 }), items,
    truncated: records.data?.length === 500 }, { headers: { 'Cache-Control': 'private, no-store' } });
}
