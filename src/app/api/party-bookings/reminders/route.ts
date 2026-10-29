import {expireSquareCheckoutHolds} from '@/lib/square-checkout-recovery';
import { NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { sendDuePartyReminderEmails } from '@/lib/party-emails';
import { expirePartyInvoiceHolds } from '@/lib/square-party';
import { paymentFlowEnabled } from '@/lib/square-client';

export const maxDuration=60;
export const dynamic = 'force-dynamic';

function isAuthorized(req: Request) {
  const expected = process.env.CRON_SECRET || process.env.PARTY_REMINDER_SECRET;
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
    const expired_holds = paymentFlowEnabled('party') ? await expirePartyInvoiceHolds(admin) : null;
    const expired_checkouts=await expireSquareCheckoutHolds(admin);
    const result = await sendDuePartyReminderEmails(admin);
    return NextResponse.json({ ...result, expired_holds,expired_checkouts });
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
