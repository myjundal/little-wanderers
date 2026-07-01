import { NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { isLikelyEmail, normalizeWaitlistEmail } from '@/lib/waitlist';

export const dynamic = 'force-dynamic';

type WaitlistSyncEntry = {
  email?: string;
  first_name?: string;
  last_name?: string;
  source?: string;
  external_id?: string;
  raw_payload?: Record<string, unknown>;
};

function getBearerSecret(req: Request) {
  const authorization = req.headers.get('authorization') ?? '';
  return authorization.toLowerCase().startsWith('bearer ') ? authorization.slice(7).trim() : '';
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    route: 'waitlist-sync',
  });
}

export async function POST(req: Request) {
  const expectedSecret = process.env.WAITLIST_SYNC_SECRET?.trim();
  const incomingSecret = req.headers.get('x-waitlist-sync-secret')?.trim() || getBearerSecret(req);

  if (!expectedSecret || incomingSecret !== expectedSecret) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as { entries?: WaitlistSyncEntry[] } | WaitlistSyncEntry | null;
  const entries = Array.isArray((body as { entries?: WaitlistSyncEntry[] } | null)?.entries)
    ? (body as { entries: WaitlistSyncEntry[] }).entries
    : body
      ? [body as WaitlistSyncEntry]
      : [];

  if (entries.length === 0) {
    return NextResponse.json({ ok: false, error: 'No waitlist entries provided.' }, { status: 400 });
  }

  const invalid: string[] = [];
  let validCount = 0;
  const rowsByEmail = new Map<string, {
    email: string;
    normalized_email: string;
    first_name: string | null;
    last_name: string | null;
    source: string;
    external_id: string | null;
    raw_payload: Record<string, unknown> | WaitlistSyncEntry;
    synced_at: string;
  }>();

  entries.forEach((entry) => {
    const email = String(entry.email ?? '').trim();
    const normalizedEmail = normalizeWaitlistEmail(email);

    if (!isLikelyEmail(email) || !normalizedEmail) {
      if (email) invalid.push(email);
      return;
    }

    validCount += 1;
    rowsByEmail.set(normalizedEmail, {
      email,
      normalized_email: normalizedEmail,
      first_name: entry.first_name ? String(entry.first_name).trim() : null,
      last_name: entry.last_name ? String(entry.last_name).trim() : null,
      source: entry.source ? String(entry.source).trim() : 'google_form',
      external_id: entry.external_id ? String(entry.external_id).trim() : null,
      raw_payload: entry.raw_payload ?? entry,
      synced_at: new Date().toISOString(),
    });
  });
  const rows = Array.from(rowsByEmail.values());

  if (rows.length === 0) {
    return NextResponse.json({ ok: false, error: 'No valid waitlist emails provided.', invalid }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();
  const { error } = await admin
    .from('waitlist_entries')
    .upsert(rows, { onConflict: 'normalized_email' });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    received: entries.length,
    synced: rows.length,
    duplicates: validCount - rows.length,
    invalid,
  });
}
