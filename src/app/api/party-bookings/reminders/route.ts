import { NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { sendDuePartyReminderEmails } from '@/lib/party-emails';
import { sendDueMembershipNotifications } from '@/lib/membership-notifications';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

function isAuthorized(req: Request) {
  const expected = process.env.PARTY_REMINDER_SECRET || process.env.CRON_SECRET;
  if (!expected) return process.env.NODE_ENV !== 'production';
  const auth = req.headers.get('authorization') ?? '';
  const querySecret = new URL(req.url).searchParams.get('secret') ?? '';
  return auth === `Bearer ${expected}` || querySecret === expected;
}

async function handle(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  try {
    const admin = createAdminSupabaseClient();
    // Retry pending membership alerts independently of party-email delivery.
    await sendDueMembershipNotifications(admin).catch(() => logger.error({ action: 'membership.notification_retry_failed' }));
    const result = await sendDuePartyReminderEmails(admin);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}
