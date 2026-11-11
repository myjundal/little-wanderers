import { sendResendEmail, validateEmail } from '@/lib/email-campaigns';
import type { SupabaseClient } from '@supabase/supabase-js';

export type OpenPlayConfirmation = {
  reservationId: string;
  email: string;
  guardianName: string | null;
  childNames: string[];
  childCount: number;
  adultCount: number;
  startTime: string;
  endTime: string;
  amountCents: number;
  paymentStatus: string;
  paymentChoice: string;
};

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function renderOpenPlayConfirmation(input: OpenPlayConfirmation) {
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents < 0) throw new Error('Invalid reservation amount.');
  const start = new Date(input.startTime);
  const end = new Date(input.endTime);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) throw new Error('Invalid arrival window.');
  const date = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  }).format(start);
  const timeFormat = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit',
  });
  const time = `${timeFormat.format(start)}–${timeFormat.format(end)} (Eastern Time)`;
  const price = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(input.amountCents / 100);
  const payment = input.paymentStatus === 'paid' ? 'Paid'
    : input.paymentStatus === 'covered' || input.paymentChoice === 'membership' ? 'Included with your membership'
    : input.paymentStatus === 'review' ? 'Payment under review — please contact us before paying again'
    : 'Payment pending — view your reservation for payment options';
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || 'https://www.thelittlewanderers.com').replace(/\/$/, '');
  const manageUrl = `${siteUrl}/landing/soft-opening`;
  const waiverUrl = `${siteUrl}/landing/waiver?reservation=${encodeURIComponent(input.reservationId)}`;
  const name = input.guardianName?.trim() || 'Little Wanderers family';
  const rows: Array<[string, string]> = [
    ['Parent / guardian', name],
    ...(input.childNames.length ? [['Children', input.childNames.join(', ')] as [string, string]] : []),
    ['Visit date', date], ['Arrival window', time],
    ['Guests', `${input.childCount} child${input.childCount === 1 ? '' : 'ren'} · ${input.adultCount} adult${input.adultCount === 1 ? '' : 's'}`],
    ['Admission total', price], ['Payment status', payment],
  ];
  const subject = `Your Open Play reservation is confirmed — ${date}`;
  const html = `<!doctype html><html lang="en"><body style="margin:0;padding:24px;background:#faf7ff;color:#3f355a;font-family:Arial,Helvetica,sans-serif;line-height:1.6;">
    <main style="max-width:620px;margin:0 auto;padding:28px;background:#ffffff;border:1px solid #eadff3;border-radius:18px;">
      <p style="margin:0 0 8px;color:#79658f;font-size:13px;">LITTLE WANDERERS PLAY STUDIO &amp; CAFE</p>
      <h1 style="font-size:25px;line-height:1.25;margin:0 0 18px;color:#4f3f82;">Your Open Play visit is confirmed!</h1>
      <p>Hi ${escapeHtml(name)},</p><p>We’re looking forward to welcoming your family. Here are your reservation details:</p>
      <table style="width:100%;border-collapse:collapse;font-size:15px;"><tbody>${rows.map(([label, value]) => `<tr><th scope="row" style="text-align:left;vertical-align:top;padding:10px 8px;border-bottom:1px solid #eadff3;font-weight:400;color:#6d6480;">${escapeHtml(label)}</th><td style="padding:10px 8px;border-bottom:1px solid #eadff3;font-weight:600;">${escapeHtml(value)}</td></tr>`).join('')}</tbody></table>
      <p><strong>This is your arrival window, not a one-hour play limit.</strong> Aim to arrive within the window; once you’re here, you may stay until you’re ready to leave, up to closing.</p>
      <p>Please complete your family’s waiver before your visit.</p>
      <p><a href="${escapeHtml(waiverUrl)}" style="color:#5f3da4;font-weight:700;">Complete your waiver</a> &nbsp;·&nbsp; <a href="${escapeHtml(manageUrl)}" style="color:#5f3da4;font-weight:700;">View your reservation</a></p>
      <p style="font-size:13px;color:#6d6480;">Payment status above reflects the time this confirmation was prepared. Check your reservation for current payment details. This confirmation is not a payment receipt.</p>
      <p style="margin-bottom:0;font-size:14px;">See you soon!<br />Little Wanderers<br /><a href="mailto:hello@thelittlewanderers.com" style="color:#5f3da4;">hello@thelittlewanderers.com</a></p>
    </main></body></html>`;
  return { subject, html };
}

export async function sendOpenPlayConfirmation(input: OpenPlayConfirmation) {
  const email = validateEmail(input.email);
  if (!email) return { ok: false as const, error: 'Reservation contact email is unavailable.' };
  return sendResendEmail({
    to: email,
    ...renderOpenPlayConfirmation(input),
    idempotencyKey: `open-play-confirmation/${input.reservationId}`,
  });
}

/** Re-read the booking at delivery time so cancelled or past visits are skipped. */
export async function loadOpenPlayConfirmation(admin: SupabaseClient, reservationId: string, now = new Date()) {
  const result = await admin.from('open_play_reservations')
    .select('id,household_id,created_by_user_id,contact_email,child_ids,child_count,adult_count,amount_cents,payment_status,payment_choice,status,slot:open_play_reservation_slots(starts_at,ends_at),household:households(name,email)')
    .eq('id', reservationId).eq('status', 'reserved').maybeSingle();
  if (result.error) throw new Error('Unable to read reservation confirmation details.');
  const row = result.data;
  if (!row || row.status !== 'reserved') return null;
  const slot = Array.isArray(row.slot) ? row.slot[0] : row.slot;
  const household = Array.isArray(row.household) ? row.household[0] : row.household;
  if (!slot || Date.parse(slot.starts_at) <= now.getTime()) return null;
  let email = validateEmail(row.contact_email || '') || validateEmail(household?.email || '');
  if (!email && row.created_by_user_id) {
    const account = await admin.auth.admin.getUserById(row.created_by_user_id);
    if (account.error) throw new Error('Unable to read reservation login contact.');
    email = validateEmail(account.data.user?.email || '');
  }
  if (!email) throw new Error('Reservation contact email is unavailable.');
  const people = await admin.from('people').select('id,role,first_name,last_name')
    .eq('household_id', row.household_id).order('created_at', { ascending: true });
  if (people.error) throw new Error('Unable to read reservation guest names.');
  const fullName = (person: { first_name: string | null; last_name: string | null }) =>
    [person.first_name, person.last_name].filter(Boolean).join(' ').trim();
  const guardian = (people.data || []).find(person => person.role === 'adult');
  const childIds = new Set(row.child_ids || []);
  return {
    reservationId: row.id, email,
    guardianName: guardian ? fullName(guardian) : household?.name || null,
    childNames: (people.data || []).filter(person => person.role === 'child' && childIds.has(person.id)).map(fullName),
    childCount: row.child_count, adultCount: row.adult_count,
    startTime: slot.starts_at, endTime: slot.ends_at,
    amountCents: row.amount_cents, paymentStatus: row.payment_status, paymentChoice: row.payment_choice,
  } satisfies OpenPlayConfirmation;
}
