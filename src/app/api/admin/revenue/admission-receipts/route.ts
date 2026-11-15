import { requireRevenueContext } from '@/lib/revenue-access';
import { readAdmissionReceiptCandidates } from '@/lib/service-day-revenue-data';
import { revenueDay, validRevenueDate } from '@/lib/service-day-revenue';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const headers = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' };
export async function GET(req: Request) {
  const context = await requireRevenueContext();
  if (!context.ok) return context.response;
  const date = new URL(req.url).searchParams.get('date') ?? revenueDay(new Date());
  if (!validRevenueDate(date)) return Response.json({ ok: false, error: 'Choose a valid date.' }, { status: 400, headers });
  try { return Response.json({ ok: true, date, receipts: await readAdmissionReceiptCandidates(date) }, { headers }); }
  catch { return Response.json({ ok: false, error: 'Admission receipts could not be verified. No matches were saved.' }, { status: 503, headers }); }
}
