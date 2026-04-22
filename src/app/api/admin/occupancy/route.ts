import { callOccupancyRpc, getOccupancyStatus } from '@/lib/occupancy';
import { requireStaffContext } from '@/lib/authz';
import { sendPushBatch } from '@/lib/push';

export const dynamic = 'force-dynamic';

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



async function notifyIfLessCrowded(context: Awaited<ReturnType<typeof requireStaffContext>> & { ok: true }, beforeLevel: string, afterLevel: string) {
  const score = (level: string) => ({ light: 1, moderate: 2, busy: 3, near_capacity: 4 }[level] ?? 99);
  if (score(afterLevel) >= score(beforeLevel)) return;

  const now = new Date();
  const cooldownStart = new Date(now.getTime() - 45 * 60 * 1000).toISOString();

  const { data: subscriptions, error } = await context.admin
    .from('push_subscriptions')
    .select('id,endpoint,p256dh_key,auth_key,last_notified_at,enabled')
    .eq('enabled', true)
    .or(`last_notified_at.is.null,last_notified_at.lt.${cooldownStart}`);

  if (error || !subscriptions?.length) return;

  const { sent } = await sendPushBatch(subscriptions, {
    title: 'Little Wanderers',
    body: 'It’s quieter now — a great time to stop by!',
    url: '/landing/visit',
  });

  if (sent > 0) {
    const ids = subscriptions.slice(0, sent).map((item) => item.id);
    if (ids.length > 0) {
      await context.admin.from('push_subscriptions').update({ last_notified_at: now.toISOString() }).in('id', ids);
    }
  }
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

    const before = await getOccupancyStatus(context.admin);

    if (action === 'increment') {
      await callOccupancyRpc(context.admin, 'record_manual_increment', amount);
    } else if (action === 'decrement') {
      await callOccupancyRpc(context.admin, 'record_manual_decrement', amount);
    } else {
      await callOccupancyRpc(context.admin, 'reset_occupancy');
    }

    const updated = await getOccupancyStatus(context.admin);
    await notifyIfLessCrowded(context, before.crowdLevel, updated.crowdLevel);
    return Response.json(formatResponse(updated));
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown error';
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
