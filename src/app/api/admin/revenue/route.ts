import { requireRevenueContext } from '@/lib/revenue-access';
import { getServiceDayRevenue } from '@/lib/service-day-revenue-data';
import { revenueDay, validRevenueDate } from '@/lib/service-day-revenue';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const headers = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' };
export async function GET(req: Request) {
  const context = await requireRevenueContext();
  if (!context.ok) return context.response;
  const date = new URL(req.url).searchParams.get('date') ?? revenueDay(new Date());
  if (!validRevenueDate(date)) return Response.json({ ok: false, error: 'Choose a valid date.' }, { status: 400, headers });
  try { return Response.json({ ok: true, report: await getServiceDayRevenue(context.admin, date) }, { headers }); }
  catch { return Response.json({ ok: false, error: 'Revenue could not be verified. Please refresh and try again.' }, { status: 503, headers }); }
}
