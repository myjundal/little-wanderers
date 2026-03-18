import { getOccupancySummary } from '@/lib/occupancy';
import { requireStaffContext } from '@/lib/authz';

function toPositiveInt(value: unknown, fallback = 1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(Math.trunc(parsed), 1);
}

export async function GET() {
  const context = await requireStaffContext();
  if (!context.ok) return context.response;

  try {
    const summary = await getOccupancySummary(context.admin);
    const recentEvents = [...summary.events].reverse().slice(0, 12);

    return Response.json({
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
      events: recentEvents,
    });
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
    const notes = typeof body?.notes === 'string' && body.notes.trim() ? body.notes.trim() : null;
    const summary = await getOccupancySummary(context.admin);

    if (!action) {
      return Response.json({ ok: false, error: 'action is required' }, { status: 400 });
    }

    let eventType: 'manual_increment' | 'manual_decrement' | 'reset';
    let delta = 0;

    if (action === 'increment') {
      eventType = 'manual_increment';
      delta = amount;
    } else if (action === 'decrement') {
      eventType = 'manual_decrement';
      delta = -Math.min(summary.occupancy, amount);
    } else {
      eventType = 'reset';
      delta = -summary.occupancy;
    }

    const { error } = await context.admin.from('occupancy_events').insert({
      event_type: eventType,
      delta,
      effective_date: summary.effectiveDate,
      notes,
      created_by: context.user.id,
      metadata: { action, requested_amount: amount },
    });

    if (error) {
      return Response.json({ ok: false, error: error.message }, { status: 500 });
    }

    const updated = await getOccupancySummary(context.admin);

    return Response.json({
      ok: true,
      occupancy: updated.occupancy,
      capacity: updated.capacity,
      progress: updated.progress,
      crowd_level: updated.crowdLevel,
      label: updated.crowdMeta.label,
      description: updated.crowdMeta.description,
      accent: updated.crowdMeta.accent,
      accent_strong: updated.crowdMeta.accentStrong,
      effective_date: updated.effectiveDate,
      events: [...updated.events].reverse().slice(0, 12),
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown error';
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
