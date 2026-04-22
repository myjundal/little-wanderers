import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

type NotifyLevel = 'light' | 'moderate' | 'busy' | 'near_capacity';

function parseHour(value: unknown) {
  if (value == null || value === '') return null;
  const num = Number(value);
  if (!Number.isInteger(num) || num < 0 || num > 23) return null;
  return num;
}

function parseLevel(value: unknown): NotifyLevel {
  const normalized = String(value ?? '').trim();
  if (normalized === 'light' || normalized === 'moderate' || normalized === 'busy' || normalized === 'near_capacity') {
    return normalized;
  }
  return 'moderate';
}

export async function GET() {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });

  const { data, error } = await supabase
    .from('push_subscriptions')
    .select('less_crowded_enabled,notify_when_level_at_or_below,quiet_hours_enabled,quiet_start_hour,quiet_end_hour,timezone_offset_minutes')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle();

  if (error) return NextResponse.json({ ok: false, error: 'Unable to load preferences.' }, { status: 500 });

  return NextResponse.json({
    ok: true,
    preferences: data ?? {
      less_crowded_enabled: true,
      notify_when_level_at_or_below: 'moderate',
      quiet_hours_enabled: false,
      quiet_start_hour: null,
      quiet_end_hour: null,
      timezone_offset_minutes: 0,
    },
  });
}

export async function PATCH(req: Request) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });

  const body = (await req.json()) as {
    less_crowded_enabled?: boolean;
    notify_when_level_at_or_below?: NotifyLevel;
    quiet_hours_enabled?: boolean;
    quiet_start_hour?: number | null;
    quiet_end_hour?: number | null;
    timezone_offset_minutes?: number;
  };

  const updatePayload = {
    less_crowded_enabled: Boolean(body.less_crowded_enabled),
    notify_when_level_at_or_below: parseLevel(body.notify_when_level_at_or_below),
    quiet_hours_enabled: Boolean(body.quiet_hours_enabled),
    quiet_start_hour: parseHour(body.quiet_start_hour),
    quiet_end_hour: parseHour(body.quiet_end_hour),
    timezone_offset_minutes: Number.isFinite(Number(body.timezone_offset_minutes)) ? Math.trunc(Number(body.timezone_offset_minutes)) : 0,
  };

  const { error } = await supabase.from('push_subscriptions').update(updatePayload).eq('user_id', user.id);
  if (error) return NextResponse.json({ ok: false, error: 'Unable to update preferences.' }, { status: 500 });

  return NextResponse.json({ ok: true });
}
