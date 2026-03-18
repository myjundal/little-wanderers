import { callOccupancyRpc, getOccupancyStatus } from '@/lib/occupancy';
import { requireStaffContext } from '@/lib/authz';

function toPositiveInt(value: unknown, fallback = 1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(Math.trunc(parsed), 1);
}

function formatResponse(summary: Awaited<ReturnType<typeof getOccupancyStatus>>) {
  return {
    ok: true,
    occupancy: summary.occupancy,
    capacity: summary.capacity,
    progress: summary.progress,
    crowd_level: summary.crowdLevel,
    label: summary.crowdMeta.label,
    description: summary.crowdMeta.description,
    accent: summary.crowdMeta.accent,
    accent_strong: summary.crowdMeta.accentStrong,
    effective_date: summary.effectiveDate,
    last_updated_at: summary.lastUpdatedAt,
    events: [],
  };
}

export async function GET() {
  const context = await requireStaffContext();
  if (!context.ok) return context.response;

  try {
    const summary = await getOccupancyStatus(context.admin);
    return Response.json(formatResponse(summary));
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown error';
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const context = await requireStaffContext();
  if (!context.ok) return context.response;

  try {
    const body = await req.json();
    const action = body?.action as 'increment' | 'decrement' | 'reset' | undefined;
    const amount = toPositiveInt(body?.amount, 1);

    if (!action) {
      return Response.json({ ok: false, error: 'action is required' }, { status: 400 });
    }

    if (action === 'increment') {
      await callOccupancyRpc(context.admin, 'record_manual_increment', amount);
    } else if (action === 'decrement') {
      await callOccupancyRpc(context.admin, 'record_manual_decrement', amount);
    } else {
      await callOccupancyRpc(context.admin, 'reset_occupancy');
    }

    const updated = await getOccupancyStatus(context.admin);
    return Response.json(formatResponse(updated));
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown error';
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
