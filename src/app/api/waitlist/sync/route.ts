import { resolveSignupTime, signupSource } from '@/lib/signup-policy';
import { NextResponse } from 'next/server';
import { syncWaitlistContacts } from '@/lib/email-campaigns';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { isLikelyEmail, normalizeWaitlistEmail } from '@/lib/waitlist';

export const dynamic = 'force-dynamic';

type WaitlistSyncEntry = {
  email?: string;
  first_name?: string;
  last_name?: string;
  source?: string;
  external_id?: string;
  submitted_at?: string;
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
    return NextResponse.json({ ok: false, error: 'No Wanderlist entries provided.' }, { status: 400 });
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
    created_at: string;
  }>();

  const admin = createAdminSupabaseClient();
  const existingByEmail = new Map<string, string>();
  const emails = [...new Set(entries.map((entry) => normalizeWaitlistEmail(String(entry.email ?? ''))).filter(Boolean))];
  for (let i = 0; i < emails.length; i += 500) {
    const existing = await admin.from('waitlist_entries').select('normalized_email,created_at').in('normalized_email', emails.slice(i, i + 500));
    if (existing.error) return NextResponse.json({ ok: false, error: existing.error.message }, { status: 500 });
    (existing.data ?? []).forEach((row) => existingByEmail.set(row.normalized_email, row.created_at));
  }
  const now = new Date();
  let missingSubmissionTime = false;

  entries.forEach((entry) => {
    const email = String(entry.email ?? '').trim();
    const normalizedEmail = normalizeWaitlistEmail(email);

    if (!isLikelyEmail(email) || !normalizedEmail) {
      if (email) invalid.push(email);
      return;
    }

    const createdAt = resolveSignupTime(entry.submitted_at, rowsByEmail.get(normalizedEmail)?.created_at ?? existingByEmail.get(normalizedEmail), now);
    if (!createdAt) {
      missingSubmissionTime = true;
      return;
    }
    validCount += 1;
    rowsByEmail.set(normalizedEmail, {
      email,
      normalized_email: normalizedEmail,
      first_name: entry.first_name ? String(entry.first_name).trim() : null,
      last_name: entry.last_name ? String(entry.last_name).trim() : null,
      source: signupSource(new Date(createdAt)),
      external_id: entry.external_id ? String(entry.external_id).trim() : null,
      raw_payload: entry.raw_payload ?? entry,
      synced_at: now.toISOString(),
      created_at: createdAt,
    });
  });
  if (missingSubmissionTime) {
    return NextResponse.json({ ok: false, error: 'Include a valid original submitted_at timestamp for every new legacy form response imported after October 28. Update the Apps Script to send response.getTimestamp().toISOString().' }, { status: 400 });
  }
  const rows = Array.from(rowsByEmail.values());

  if (rows.length === 0) {
    return NextResponse.json({ ok: false, error: 'No valid Wanderlist emails provided.', invalid }, { status: 400 });
  }

  const { error } = await admin
    .from('waitlist_entries')
    .upsert(rows, { onConflict: 'normalized_email' });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  try {
    await syncWaitlistContacts(admin);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown error';
    return NextResponse.json({ ok: false, error: `Wanderlist synced, but contact tags failed: ${message}` }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    received: entries.length,
    synced: rows.length,
    duplicates: validCount - rows.length,
    invalid,
  });
}
