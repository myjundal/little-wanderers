import type { SupabaseClient } from '@supabase/supabase-js';
import { callOccupancyRpc, getOccupancyStatus } from '@/lib/occupancy';
import { requireStaffContext } from '@/lib/authz';
import { sendPushBatch } from '@/lib/push';

export const dynamic = 'force-dynamic';

type PushPreferenceRow = {
  id: string;
  endpoint: string;
  p256dh_key: string;
  auth_key: string;
  notify_when_level_at_or_below: string | null;
  quiet_hours_enabled: boolean | null;
  quiet_start_hour: number | null;
  quiet_end_hour: number | null;
  timezone_offset_minutes: number | null;
};

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

function crowdLevelScore(level: string) {
  return ({ light: 1, moderate: 2, busy: 3, near_capacity: 4 }[level] ?? 99);
}

function isWithinQuietHours(nowUtc: Date, offsetMinutes: number, startHour: number | null, endHour: number | null) {
  if (startHour == null || endHour == null) return false;
  const localMs = nowUtc.getTime() - offsetMinutes * 60_000;
  const localHour = new Date(localMs).getUTCHours();

  if (startHour === endHour) return true;
  if (startHour < endHour) {
    return localHour >= startHour && localHour < endHour;
  }

  return localHour >= startHour || localHour < endHour;
}

async function notifyIfLessCrowded(admin: SupabaseClient, beforeLevel: string, afterLevel: string) {
  const beforeScore = crowdLevelScore(beforeLevel);
  const afterScore = crowdLevelScore(afterLevel);
  if (afterScore >= beforeScore) return;

  const now = new Date();
  const cooldownStart = new Date(now.getTime() - 45 * 60 * 1000).toISOString();

  const { data, error } = await admin
    .from('push_subscriptions')
    .select('id,endpoint,p256dh_key,auth_key,last_notified_at,enabled,less_crowded_enabled,notify_when_level_at_or_below,quiet_hours_enabled,quiet_start_hour,quiet_end_hour,timezone_offset_minutes')
    .eq('enabled', true)
    .eq('less_crowded_enabled', true)
    .or(`last_notified_at.is.null,last_notified_at.lt.${cooldownStart}`);

  if (error) return;

  const subscriptions = (data ?? []) as PushPreferenceRow[];
  if (subscriptions.length === 0) return;

  const filtered = subscriptions.filter((item) => {
    const thresholdScore = crowdLevelScore(item.notify_when_level_at_or_below ?? 'moderate');
    if (afterScore > thresholdScore) return false;

    const quietEnabled = Boolean(item.quiet_hours_enabled);
    if (!quietEnabled) return true;

    return !isWithinQuietHours(
      now,
      Number(item.timezone_offset_minutes ?? 0),
      item.quiet_start_hour,
      item.quiet_end_hour
    );
  });

  if (filtered.length === 0) return;

  const { sent } = await sendPushBatch(filtered, {
    title: 'Little Wanderers',
    body: 'It’s quieter now — a great time to stop by!',
    url: '/landing/visit',
  });

  if (sent > 0) {
    const ids = filtered.slice(0, sent).map((item) => item.id);
    if (ids.length > 0) {
      await admin.from('push_subscriptions').update({ last_notified_at: now.toISOString() }).in('id', ids);
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
    await notifyIfLessCrowded(context.admin, before.crowdLevel, updated.crowdLevel);
    return Response.json(formatResponse(updated));
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown error';
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
